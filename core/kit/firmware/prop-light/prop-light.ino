// prop-light.ino -- an Endless Cues prop: an addressable LED strip.
//
// What it is
//   A sketch for an ESP32 (Arduino framework, ESP32 core 3.x) that drives a
//   WS2812 / WS2811 strip with the Adafruit NeoPixel library. The whole strip
//   shows one colour, at one brightness, with one effect. Its settings are in
//   config.h and its Wi-Fi name and password in secrets.h; nothing in this
//   file is particular to one prop.
//
// The protocol in brief (version 1; ec_osc.h has the wire format)
//   OSC over UDP, port 53100.
//     /ec/hello                 answered with /ec/here (who it is, what it is doing)
//     /ec/identify              blinks white for 2 s, then carries on
//     /ec/look   n [secs]       look 0 (its own) or 1..8 from config.h
//     /ec/color  r g b [secs]   0..255 each
//     /ec/level  level [secs]   brightness 0..1
//     /ec/effect name [speed]   steady | breathe | pulse | flicker
//     /ec/on [secs]             back to what it was showing
//     /ec/off [secs]            dark
//   A message may end with an id such as "#a41f07": it is acted on once.
//
// What it must always do. Each rule is marked where the code keeps it.
//   RULE 1  Its own look at power-on, faded up over 1.5 s, before Wi-Fi is tried.
//   RULE 2  It carries on alone: it never waits for the booth and never goes
//           dark because the booth went quiet.
//   RULE 3  Wi-Fi is not in the show's path: nothing here waits for the network.
//   RULE 4  A hand wins: the button steps through the looks, whatever the
//           booth last said.
//   RULE 5  It can be asked: /ec/hello is always answered, with the truth.
//   RULE 6  Over-the-air updates are off as written (OTA 0 in config.h).
//
// Status: compiled with arduino-cli 1.5.1 for esp32:esp32:esp32 and esp32:esp32:esp32c3
//   (core 3.3.7) on 2026-11-15; NEVER flashed to a board or run.

#include <math.h>
#include <string.h>
#include <WiFi.h>
#include <WiFiUdp.h>
#include <Adafruit_NeoPixel.h>

// One look: a colour, a brightness and an effect. config.h has a table of these.
struct Look {
  uint8_t r, g, b;     // 0..255
  float level;         // 0.0..1.0
  const char *effect;  // "steady", "breathe", "pulse" or "flicker"
};

#include "config.h"
#include "secrets.h"
#include "ec_osc.h"

#if OTA
#include <ArduinoOTA.h>
#endif

#define FW_VERSION "light-1.0"

// ------------------------------------------------------------------ timing

const uint32_t FRAME_MS          = 20;    // the strip is redrawn 50 times a second
const uint32_t WIFI_FIRST_TRY_MS = 2000;  // first join: after the power-on fade is done
const uint32_t WIFI_RETRY_MS     = 10000; // then every 10 s for as long as it is not joined
const uint32_t DEBOUNCE_MS       = 30;    // a button must hold still this long to count
const uint32_t IDENTIFY_MS       = 2000;  // how long /ec/identify blinks
const float    POWER_ON_FADE_SECS = 1.5;
const float    BUTTON_FADE_SECS   = 0.3;

// ------------------------------------------------------------------- state

// The effects, in the order of EFFECT_NAMES.
const int EFFECT_STEADY  = 0;
const int EFFECT_BREATHE = 1;
const int EFFECT_PULSE   = 2;
const int EFFECT_FLICKER = 3;
const int EFFECT_COUNT   = 4;
const char *const EFFECT_NAMES[EFFECT_COUNT] = { "steady", "breathe", "pulse", "flicker" };

// What the light is showing is five numbers. Each one fades, by the clock,
// from where it was to where it was told to go.
const int CH_R     = 0;  // colour, 0..255
const int CH_G     = 1;
const int CH_B     = 2;
const int CH_LEVEL = 3;  // brightness, 0..1
const int CH_POWER = 4;  // 1 = on, 0 = off (/ec/on and /ec/off); the look is kept underneath
const int CH_COUNT = 5;

float valueNow[CH_COUNT]  = { 0, 0, 0, 0, 1 };  // what is on the strip this frame
float valueFrom[CH_COUNT] = { 0, 0, 0, 0, 1 };  // where the current fade started
float valueTo[CH_COUNT]   = { 0, 0, 0, 0, 1 };  // where it is going
uint32_t fadeStartMs = 0;
uint32_t fadeLengthMs = 0;

int effect = EFFECT_STEADY;
float effectSpeed = 1.0;     // 1 is normal, 2 is twice as fast
float effectClock = 0.0;     // seconds, running at effectSpeed
float flickerNow = 1.0;      // the flicker effect's brightness this frame
float flickerTarget = 1.0;   // and where it is drifting to
int flickerStep = -1;        // which twentieth of a second the target was chosen in

int currentLook = 0;         // the look the button steps on from
char stateWord[12] = "own";  // what /ec/here reports while the light is on

uint32_t identifyStartMs = 0;
bool identifying = false;

uint32_t lastFrameMs = 0;

// The button.
bool buttonStable = HIGH;    // the debounced reading (HIGH = not pressed)
bool buttonLastRaw = HIGH;
uint32_t buttonChangedMs = 0;

// Wi-Fi.
bool wifiStarted = false;    // has the radio been switched on yet?
bool wifiWasJoined = false;  // was it joined the last time we looked?
uint32_t wifiLastTryMs = 0;
bool otaStarted = false;

WiFiUDP udp;
uint8_t packet[256];         // one incoming datagram
uint8_t answer[128];         // one outgoing /ec/here
EcOscIdRing seenIds;

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, LED_ORDER + NEO_KHZ800);

// ----------------------------------------------------------------- helpers

float clampFloat(float value, float low, float high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

// The number of an effect by its name, or -1 if there is no such effect.
int effectFromName(const char *name) {
  for (int k = 0; k < EFFECT_COUNT; k++) {
    if (strcmp(name, EFFECT_NAMES[k]) == 0) return k;
  }
  return -1;
}

void setStateWord(const char *word) {
  strncpy(stateWord, word, sizeof(stateWord) - 1);
  stateWord[sizeof(stateWord) - 1] = 0;
}

// ------------------------------------------------------------------- fades

// Begin a fade from whatever is showing now. After calling this, set the
// valueTo[] entries that should change. A fade that was still running is
// carried on to the same place on the new clock.
void startFade(float secs) {
  secs = clampFloat(secs, 0.0, 600.0);
  for (int c = 0; c < CH_COUNT; c++) {
    valueFrom[c] = valueNow[c];
  }
  fadeStartMs = millis();
  fadeLengthMs = (uint32_t)(secs * 1000.0);
}

// When the light is dark there is no colour to fade from: take the new
// colour at once, so that a fade up from dark changes brightness only.
void snapColourIfDark() {
  if (valueFrom[CH_LEVEL] * valueFrom[CH_POWER] <= 0.0) {
    valueFrom[CH_R] = valueTo[CH_R];
    valueFrom[CH_G] = valueTo[CH_G];
    valueFrom[CH_B] = valueTo[CH_B];
  }
}

// Move every value along its fade. Called once a frame.
void updateFade(uint32_t now) {
  float t = 1.0;
  uint32_t elapsed = now - fadeStartMs;
  if (fadeLengthMs > 0 && elapsed < fadeLengthMs) {
    t = (float)elapsed / (float)fadeLengthMs;
  }
  for (int c = 0; c < CH_COUNT; c++) {
    valueNow[c] = valueFrom[c] + (valueTo[c] - valueFrom[c]) * t;
  }
}

// ------------------------------------------------------------ what it does

void setEffect(int which, float speed) {
  effect = which;
  effectSpeed = clampFloat(speed, 0.05, 20.0);
}

// Recall look n: 0 is the prop's own look, 1..8 are the rows of LOOKS.
void applyLook(int n, float secs) {
  if (n < 0 || n > 8) return;

  float r = OWN_R, g = OWN_G, b = OWN_B, level = OWN_LEVEL;
  const char *effectName = OWN_EFFECT;
  if (n >= 1) {
    r = LOOKS[n - 1].r;
    g = LOOKS[n - 1].g;
    b = LOOKS[n - 1].b;
    level = LOOKS[n - 1].level;
    effectName = LOOKS[n - 1].effect;
  }

  startFade(secs);
  valueTo[CH_R] = clampFloat(r, 0, 255);
  valueTo[CH_G] = clampFloat(g, 0, 255);
  valueTo[CH_B] = clampFloat(b, 0, 255);
  valueTo[CH_LEVEL] = clampFloat(level, 0.0, 1.0);
  valueTo[CH_POWER] = 1.0;
  snapColourIfDark();

  int which = effectFromName(effectName);
  setEffect(which < 0 ? EFFECT_STEADY : which, 1.0);
  currentLook = n;
}

void applyColor(float r, float g, float b, float secs) {
  startFade(secs);
  valueTo[CH_R] = clampFloat(r, 0, 255);
  valueTo[CH_G] = clampFloat(g, 0, 255);
  valueTo[CH_B] = clampFloat(b, 0, 255);
  valueTo[CH_POWER] = 1.0;
  snapColourIfDark();
}

void applyLevel(float level, float secs) {
  startFade(secs);
  valueTo[CH_LEVEL] = clampFloat(level, 0.0, 1.0);
  valueTo[CH_POWER] = 1.0;
}

// on = true: back to the look it had. on = false: dark, the look kept.
void applyPower(bool on, float secs) {
  startFade(secs);
  valueTo[CH_POWER] = on ? 1.0 : 0.0;
}

// The one word /ec/here reports.
const char *currentStateWord() {
  if (valueTo[CH_POWER] <= 0.0) return "off";
  return stateWord;
}

// ----------------------------------------------------------------- effects

// How bright the effect makes this frame, 0..1. dt is the seconds since the
// last frame. Everything here is worked out from the clock: nothing waits.
float effectBrightness(float dt) {
  effectClock += dt * effectSpeed;
  if (effectClock > 3600.0) effectClock -= 3600.0;  // keep the number small

  if (effect == EFFECT_BREATHE) {
    // A slow swell, once every 4 s, never quite to dark.
    float wave = 0.5 - 0.5 * cos(effectClock * 2.0 * PI / 4.0);
    return 0.1 + 0.9 * wave;
  }
  if (effect == EFFECT_PULSE) {
    // A beat every second: bright at once, then falling away.
    float part = effectClock - floor(effectClock);  // 0..1 through the beat
    float fall = (1.0 - part) * (1.0 - part);
    return 0.15 + 0.85 * fall;
  }
  if (effect == EFFECT_FLICKER) {
    // A candle: 20 times a second pick a new brightness, and drift towards it.
    int step = (int)(effectClock * 20.0);
    if (step != flickerStep) {
      flickerStep = step;
      flickerTarget = random(45, 101) / 100.0;
    }
    flickerNow += (flickerTarget - flickerNow) * 0.4;
    return flickerNow;
  }
  return 1.0;  // steady
}

// ------------------------------------------------------------------- frame

void fillStrip(float r, float g, float b) {
  uint32_t colour = strip.Color((uint8_t)(r + 0.5), (uint8_t)(g + 0.5), (uint8_t)(b + 0.5));
  for (int k = 0; k < LED_COUNT; k++) {
    strip.setPixelColor(k, colour);
  }
  strip.show();
}

// Draw one frame. Called from loop(), at most 50 times a second, so that
// strip.show() (which takes about 30 microseconds per LED) is not run on
// every pass of the loop.
void drawFrame(uint32_t now) {
  float dt = (now - lastFrameMs) / 1000.0;
  lastFrameMs = now;

  updateFade(now);
  float bright = valueNow[CH_LEVEL] * valueNow[CH_POWER] * effectBrightness(dt);

  if (identifying) {
    if (now - identifyStartMs >= IDENTIFY_MS) {
      identifying = false;  // done: the look underneath never stopped
    } else {
      // White at half brightness, on and off four times a second.
      bool lit = ((now / 125) % 2) == 0;
      float white = lit ? 128.0 : 0.0;
      fillStrip(white, white, white);
      return;
    }
  }

  fillStrip(valueNow[CH_R] * bright, valueNow[CH_G] * bright, valueNow[CH_B] * bright);
}

// ------------------------------------------------------------------ button

// RULE 4: a hand wins. A press steps to the next look (0, 1, ... 8, 0, ...)
// and turns the light on, whatever the booth last said.
void buttonPressed() {
  int next = (currentLook + 1) % 9;
  applyLook(next, BUTTON_FADE_SECS);
  char word[12];
  snprintf(word, sizeof(word), "look%d", next);
  setStateWord(word);
}

// Read the button without waiting: a change counts once it has held still
// for DEBOUNCE_MS.
void buttonTick(uint32_t now) {
  if (BUTTON_PIN < 0) return;

  bool raw = digitalRead(BUTTON_PIN);
  if (raw != buttonLastRaw) {
    buttonLastRaw = raw;
    buttonChangedMs = now;
  }
  if (raw != buttonStable && now - buttonChangedMs >= DEBOUNCE_MS) {
    buttonStable = raw;
    if (buttonStable == LOW) {  // the button joins the pin to GND
      buttonPressed();
    }
  }
}

// ----------------------------------------------------------------- battery

// Battery percent, or -1 if there is no BATTERY_PIN.
// This assumes one lithium cell (3.3 V empty, 4.2 V full) read through two
// equal resistors that halve it. A different battery or divider needs
// different numbers here. It is a rough guide, not a fuel gauge.
int batteryPercent() {
  if (BATTERY_PIN < 0) return -1;

  float volts = analogReadMilliVolts(BATTERY_PIN) * 2.0 / 1000.0;
  float percent = (volts - 3.3) / (4.2 - 3.3) * 100.0;
  return (int)clampFloat(percent, 0.0, 100.0);
}

// ---------------------------------------------------------------- messages

// RULE 5: it can be asked. The answer goes back to whoever asked, at the
// address and port the question came from, and says what is true right now.
void answerHello() {
  int length = ecOscWriteHere(answer, sizeof(answer),
                              PROP_NAME, "light", FW_VERSION, currentStateWord(),
                              (int32_t)(millis() / 1000), (int32_t)WiFi.RSSI(),
                              (int32_t)batteryPercent());
  if (length == 0) return;

  udp.beginPacket(udp.remoteIP(), udp.remotePort());
  udp.write(answer, length);
  udp.endPacket();
}

// Act on one datagram. Anything not understood is ignored.
void handlePacket(const uint8_t *data, int length) {
  EcOscMessage msg;
  if (!ecOscParse(data, length, &msg)) return;

  // Hello is answered every time, even a repeat.
  if (ecOscIs(&msg, "/ec/hello")) {
    answerHello();
    return;
  }

  // Anything else with an id is acted on once.
  if (msg.id != NULL && ecOscSeenBefore(&seenIds, msg.id)) return;

  if (ecOscIs(&msg, "/ec/identify")) {
    identifying = true;
    identifyStartMs = millis();

  } else if (ecOscIs(&msg, "/ec/look")) {
    int n = ecOscArgInt(&msg, 0, -1);
    if (n < 0 || n > 8) return;
    applyLook(n, ecOscArgFloat(&msg, 1, 0.0));
    char word[12];
    snprintf(word, sizeof(word), "look%d", n);
    setStateWord(word);

  } else if (ecOscIs(&msg, "/ec/color")) {
    if (msg.argCount < 3) return;
    applyColor(ecOscArgFloat(&msg, 0, 0), ecOscArgFloat(&msg, 1, 0),
               ecOscArgFloat(&msg, 2, 0), ecOscArgFloat(&msg, 3, 0.0));
    setStateWord("color");

  } else if (ecOscIs(&msg, "/ec/level")) {
    if (msg.argCount < 1) return;
    applyLevel(ecOscArgFloat(&msg, 0, 0.0), ecOscArgFloat(&msg, 1, 0.0));
    setStateWord("level");

  } else if (ecOscIs(&msg, "/ec/effect")) {
    const char *name = ecOscArgString(&msg, 0);
    if (name == NULL) return;
    int which = effectFromName(name);
    if (which < 0) return;
    setEffect(which, ecOscArgFloat(&msg, 1, 1.0));
    setStateWord(EFFECT_NAMES[which]);

  } else if (ecOscIs(&msg, "/ec/on")) {
    applyPower(true, ecOscArgFloat(&msg, 0, 0.0));

  } else if (ecOscIs(&msg, "/ec/off")) {
    applyPower(false, ecOscArgFloat(&msg, 0, 0.0));
  }
  // /ec/pulse is for switches; a light ignores it, and anything else.
}

// Take in whatever datagrams have arrived: a few at most on each pass, so
// that a flood of them cannot hold the loop.
void messagesTick() {
  if (!wifiWasJoined) return;

  for (int k = 0; k < 4; k++) {
    int size = udp.parsePacket();
    if (size <= 0) return;
    if (size > (int)sizeof(packet)) continue;  // too big to be ours
    int length = udp.read(packet, sizeof(packet));
    if (length > 0) handlePacket(packet, length);
  }
}

// ------------------------------------------------------------------- Wi-Fi

// Is there a network to join? Not while secrets.h is still as it was written.
bool wifiConfigured() {
  return strcmp(WIFI_SSID, "CHANGE-ME") != 0 && strlen(WIFI_SSID) > 0;
}

// Ask the radio to join. This returns at once: the joining happens in the
// background, and wifiTick() notices when it has worked.
void wifiJoin() {
  if (!wifiStarted) {
    wifiStarted = true;
    WiFi.persistent(false);        // do not wear the flash with the network's name
    WiFi.mode(WIFI_STA);           // (switching the radio on takes a moment, once)
    WiFi.setAutoReconnect(false);  // rejoining is done here, every WIFI_RETRY_MS
    WiFi.setSleep(false);          // answer promptly; costs some battery

    if (strlen(FIXED_ADDRESS) > 0) {
      IPAddress address;
      if (address.fromString(FIXED_ADDRESS)) {
        // The gateway is assumed to be .1 on the same network.
        IPAddress gateway(address[0], address[1], address[2], 1);
        IPAddress netmask(255, 255, 255, 0);
        WiFi.config(address, gateway, netmask, gateway);
      }
    }
  } else {
    WiFi.disconnectAsync();  // drop a half-made attempt; does not wait
  }
  WiFi.begin(WIFI_SSID, WIFI_PASS);
}

// RULE 6: over-the-air updates. Compiled in only when config.h says OTA 1,
// and refused while the password is still "CHANGE-ME".
void otaStart() {
#if OTA
  if (otaStarted) return;
  if (strcmp(OTA_PASS, "CHANGE-ME") == 0) return;
  ArduinoOTA.setHostname(PROP_NAME);
  ArduinoOTA.setPassword(OTA_PASS);
  ArduinoOTA.begin();
  otaStarted = true;
#endif
}

void otaTick() {
#if OTA
  // Returns at once unless an update is arriving. (While one is being
  // written the light holds still: that is the one time the loop is held.)
  if (otaStarted && wifiWasJoined) ArduinoOTA.handle();
#endif
}

// RULE 3: Wi-Fi is not in the show's path. This looks at the radio and
// returns; it never waits for it. Not joined: ask again every 10 s, for
// ever, without a restart. Meanwhile the light goes on with its look.
void wifiTick(uint32_t now) {
  if (!wifiConfigured()) return;

  bool joined = wifiStarted && (WiFi.status() == WL_CONNECTED);

  if (joined && !wifiWasJoined) {
    udp.begin(EC_PORT);
    otaStart();
    Serial.print("Joined. Address: ");
    Serial.println(WiFi.localIP());
  }
  if (!joined && wifiWasJoined) {
    udp.stop();
    wifiLastTryMs = now;  // give the radio 10 s before asking again
    Serial.println("Network lost. Carrying on.");
  }
  wifiWasJoined = joined;

  if (!joined) {
    uint32_t wait = wifiStarted ? WIFI_RETRY_MS : WIFI_FIRST_TRY_MS;
    if (now - wifiLastTryMs >= wait) {
      wifiLastTryMs = now;
      wifiJoin();
    }
  }
}

// ---------------------------------------------------------- setup and loop

void setup() {
  Serial.begin(115200);

  // RULE 1: its own look at power-on, faded up over 1.5 s. Wi-Fi is not
  // touched here at all: the first join is asked for from loop(), after
  // this fade has had time to finish.
  strip.begin();
  strip.show();  // all dark, at once
  applyLook(0, POWER_ON_FADE_SECS);
  lastFrameMs = millis();

  if (BUTTON_PIN >= 0) {
    pinMode(BUTTON_PIN, INPUT_PULLUP);
  }
  ecOscIdRingClear(&seenIds);
  randomSeed(esp_random());

  Serial.println();
  Serial.print("Endless Cues prop light \"");
  Serial.print(PROP_NAME);
  Serial.println("\" " FW_VERSION);
  if (!wifiConfigured()) {
    Serial.println("secrets.h has no network yet: running its own look only.");
  }
}

// RULE 2: it carries on alone. Nothing in this loop waits for the booth, or
// times out because the booth is quiet: the light keeps doing the last thing
// it was told (or its own look) for as long as it has power.
// RULE 3: nothing in this loop waits at all. There is no delay() in this
// sketch and no "while not connected".
void loop() {
  uint32_t now = millis();

  buttonTick(now);
  wifiTick(now);
  messagesTick();
  otaTick();

  if (now - lastFrameMs >= FRAME_MS) {
    drawFrame(now);
  }
}

// A note for ESP32 core 2.x: this sketch was written for core 3.x.
// WiFi.disconnectAsync() does not exist in 2.x; there, use
// WiFi.disconnect() in its place.
