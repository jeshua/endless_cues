// prop-switch.ino -- an Endless Cues prop: a relay on a pin, or a servo.
//
// What it is
//   A sketch for an ESP32 (Arduino framework, ESP32 core 3.x) that switches
//   one output. OUTPUT_KIND in config.h chooses which: a relay (the pin goes
//   high or low), or a hobby servo (a 50 Hz pulse made by the ESP32's own
//   LEDC timer, no servo library). Its settings are in config.h and its
//   Wi-Fi name and password in secrets.h; nothing in this file is particular
//   to one prop.
//
// The protocol in brief (version 1; ec_osc.h has the wire format)
//   OSC over UDP, port 53100.
//     /ec/hello                answered with /ec/here (who it is, what it is doing)
//     /ec/identify             does nothing here (a switch must not fire to show itself)
//     /ec/on    /ec/off        on, off (a servo: to its "on" end, its "off" end)
//     /ec/pulse ms             on for that long, then off
//     /ec/level level [secs]   a servo only: its position, 0..1, moving over secs
//   A message may end with an id such as "#a41f07": it is acted on once, so
//   a message sent three times never fires a relay three times.
//
// What it must always do. Each rule is marked where the code keeps it.
//   RULE 1  Its own state at power-on (off, or on if START_ON), before Wi-Fi is tried.
//   RULE 2  It carries on alone: it never waits for the booth and never
//           changes because the booth went quiet.
//   RULE 3  Wi-Fi is not in the show's path: nothing here waits for the network.
//   RULE 4  A hand wins: the button toggles it, whatever the booth last said.
//   RULE 5  It can be asked: /ec/hello is always answered, with the truth.
//   RULE 6  Over-the-air updates are off as written (OTA 0 in config.h).
//
// Status: compiled with arduino-cli 1.5.1 for esp32:esp32:esp32 and esp32:esp32:esp32c3
//   (core 3.3.7) on 2026-11-15; NEVER flashed to a board or run.

#include <string.h>
#include <WiFi.h>
#include <WiFiUdp.h>

#include "config.h"
#include "secrets.h"
#include "ec_osc.h"

#if OTA
#include <ArduinoOTA.h>
#endif

#define FW_VERSION "switch-1.0"

// ------------------------------------------------------------------ timing

const uint32_t WIFI_FIRST_TRY_MS = 2000;   // first join: two seconds after power-on
const uint32_t WIFI_RETRY_MS     = 10000;  // then every 10 s for as long as it is not joined
const uint32_t DEBOUNCE_MS       = 30;     // a button must hold still this long to count
const uint32_t SERVO_FRAME_MS    = 20;     // a moving servo is updated 50 times a second
const int32_t  PULSE_MAX_MS      = 60000;  // the longest /ec/pulse

// The servo's signal: 50 pulses a second, counted in 14 bits (0..16383 is
// one 20 000 microsecond period). 14 bits works on every ESP32 family.
const uint32_t SERVO_HZ      = 50;
const uint8_t  SERVO_BITS    = 14;
const float    SERVO_PERIOD_US = 20000.0;

// ------------------------------------------------------------------- state

// Where the output is: 0 = off, 1 = on. A relay is only ever 0 or 1; a servo
// can be anywhere between, and moves there by the clock.
float positionNow  = 0.0;
float positionFrom = 0.0;
float positionTo   = 0.0;
uint32_t moveStartMs = 0;
uint32_t moveLengthMs = 0;
uint32_t lastServoFrameMs = 0;

// /ec/pulse: on now, off once pulseLengthMs have gone by.
bool pulsing = false;
uint32_t pulseStartMs = 0;
uint32_t pulseLengthMs = 0;

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

// ----------------------------------------------------------------- helpers

float clampFloat(float value, float low, float high) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

// ------------------------------------------------------------------ output

// Put the output where positionNow says.
void writeOutput() {
  if (OUTPUT_KIND == OUTPUT_SERVO) {
    float us = SERVO_MIN_US + (SERVO_MAX_US - SERVO_MIN_US) * positionNow;
    uint32_t duty = (uint32_t)(us / SERVO_PERIOD_US * (1 << SERVO_BITS));
    ledcWrite(OUT_PIN, duty);
  } else {
    bool on = positionNow >= 0.5;
    bool pinHigh = RELAY_ACTIVE_LOW ? !on : on;
    digitalWrite(OUT_PIN, pinHigh ? HIGH : LOW);
  }
}

// Get the pin ready, already in its starting state.
void beginOutput() {
  if (OUTPUT_KIND == OUTPUT_SERVO) {
    // ESP32 core 3.x: ledcAttach(pin, frequency, bits), then ledcWrite(pin, duty).
    // Core 2.x differs: there it is ledcSetup(channel, frequency, bits),
    // ledcAttachPin(pin, channel) and ledcWrite(channel, duty).
    ledcAttach(OUT_PIN, SERVO_HZ, SERVO_BITS);
    writeOutput();
  } else {
    // The pin is low for a few microseconds between these two lines: far
    // too short for a relay to move, even one that switches on when low.
    pinMode(OUT_PIN, OUTPUT);
    writeOutput();
  }
}

// Go to a position (0..1) over secs seconds. A relay goes at once.
void moveTo(float position, float secs) {
  if (OUTPUT_KIND != OUTPUT_SERVO) secs = 0.0;
  secs = clampFloat(secs, 0.0, 600.0);

  positionFrom = positionNow;
  positionTo = clampFloat(position, 0.0, 1.0);
  moveStartMs = millis();
  moveLengthMs = (uint32_t)(secs * 1000.0);

  if (moveLengthMs == 0) {
    positionNow = positionTo;
    writeOutput();
  }
}

void switchOn()  { pulsing = false; moveTo(1.0, 0.0); }
void switchOff() { pulsing = false; moveTo(0.0, 0.0); }

// On now; outputTick() turns it off when the time is up.
void startPulse(int32_t ms) {
  if (ms < 1) return;
  if (ms > PULSE_MAX_MS) ms = PULSE_MAX_MS;
  moveTo(1.0, 0.0);
  pulsing = true;
  pulseStartMs = millis();
  pulseLengthMs = (uint32_t)ms;
}

// Carry a servo along its move, and end a pulse, by the clock.
void outputTick(uint32_t now) {
  if (pulsing && now - pulseStartMs >= pulseLengthMs) {
    pulsing = false;
    moveTo(0.0, 0.0);
  }

  if (positionNow != positionTo && now - lastServoFrameMs >= SERVO_FRAME_MS) {
    lastServoFrameMs = now;
    uint32_t elapsed = now - moveStartMs;
    if (elapsed >= moveLengthMs) {
      positionNow = positionTo;
    } else {
      float t = (float)elapsed / (float)moveLengthMs;
      positionNow = positionFrom + (positionTo - positionFrom) * t;
    }
    writeOutput();
  }
}

// The one word /ec/here reports: where it is going to be.
const char *currentStateWord() {
  if (positionTo >= 1.0) return "on";
  if (positionTo <= 0.0) return "off";
  return "level";  // a servo placed somewhere between its ends
}

// ------------------------------------------------------------------ button

// RULE 4: a hand wins. A press toggles the output (and ends a pulse),
// whatever the booth last said.
void buttonPressed() {
  if (positionTo >= 0.5) {
    switchOff();
  } else {
    switchOn();
  }
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
                              PROP_NAME, "switch", FW_VERSION, currentStateWord(),
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

  // Anything else with an id is acted on once: a relay is never fired twice.
  if (msg.id != NULL && ecOscSeenBefore(&seenIds, msg.id)) return;

  if (ecOscIs(&msg, "/ec/on")) {
    switchOn();

  } else if (ecOscIs(&msg, "/ec/off")) {
    switchOff();

  } else if (ecOscIs(&msg, "/ec/pulse")) {
    startPulse(ecOscArgInt(&msg, 0, 0));

  } else if (ecOscIs(&msg, "/ec/level")) {
    // A servo's position. A relay has no "level" and ignores this.
    if (OUTPUT_KIND != OUTPUT_SERVO) return;
    if (msg.argCount < 1) return;
    pulsing = false;
    moveTo(ecOscArgFloat(&msg, 0, 0.0), ecOscArgFloat(&msg, 1, 0.0));
  }
  // /ec/identify: a switch does nothing (it still answers /ec/hello).
  // /ec/look, /ec/color and /ec/effect are for lights; ignored, like anything else.
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
  // written the output stays as it is: that is the one time the loop is held.)
  if (otaStarted && wifiWasJoined) ArduinoOTA.handle();
#endif
}

// RULE 3: Wi-Fi is not in the show's path. This looks at the radio and
// returns; it never waits for it. Not joined: ask again every 10 s, for
// ever, without a restart. Meanwhile the output stays as it was told.
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

  // RULE 1: its own state at power-on: off, or on if config.h says START_ON.
  // Wi-Fi is not touched here at all: the first join is asked for from loop().
  positionNow = START_ON ? 1.0 : 0.0;
  positionFrom = positionNow;
  positionTo = positionNow;
  beginOutput();

  if (BUTTON_PIN >= 0) {
    pinMode(BUTTON_PIN, INPUT_PULLUP);
  }
  ecOscIdRingClear(&seenIds);

  Serial.println();
  Serial.print("Endless Cues prop switch \"");
  Serial.print(PROP_NAME);
  Serial.println("\" " FW_VERSION);
  if (!wifiConfigured()) {
    Serial.println("secrets.h has no network yet: the button is the only way to work it.");
  }
}

// RULE 2: it carries on alone. Nothing in this loop waits for the booth, or
// times out because the booth is quiet: the output stays as it was last told
// for as long as it has power.
// RULE 3: nothing in this loop waits at all. There is no delay() in this
// sketch and no "while not connected".
void loop() {
  uint32_t now = millis();

  buttonTick(now);
  wifiTick(now);
  messagesTick();
  otaTick();
  outputTick(now);
}

// A note for ESP32 core 2.x: this sketch was written for core 3.x.
// Besides the LEDC calls in beginOutput(), WiFi.disconnectAsync() does not
// exist in 2.x; there, use WiFi.disconnect() in its place.
