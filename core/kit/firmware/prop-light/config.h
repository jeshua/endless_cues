// config.h -- this prop's settings: a light. (An example copy.)
//
// What it is
//   Everything about one prop that is not a secret. Endless Cues writes this
//   file for each prop; the copy here is an example, so that the sketch
//   compiles as it stands. The sketch has no other per-prop line.
//
// The protocol in brief
//   The prop listens for OSC on UDP port EC_PORT and answers /ec/hello with
//   /ec/here, giving PROP_NAME. /ec/look 0 is the OWN_ look below;
//   /ec/look 1..8 are the rows of LOOKS. See ec_osc.h for the rest.
//
// Status: compiled with arduino-cli 1.5.1 for esp32:esp32:esp32 and esp32:esp32:esp32c3
//   (core 3.3.7) on 2026-11-15; NEVER flashed to a board or run.

#define PROP_NAME   "lantern_a"  // the name it answers by
#define EC_PORT     53100        // the UDP port it listens on
#define EC_PROTOCOL 1            // the protocol version this was written for
#define BOARD_LABEL "esp32dev"   // which board this was set up for (information only)

// A fixed address such as "10.0.0.50", or "" to let the router choose.
// When set, the gateway is assumed to be .1 on the same network
// (10.0.0.50 -> gateway 10.0.0.1, netmask 255.255.255.0).
#define FIXED_ADDRESS ""

#define BUTTON_PIN  -1  // a button from this pin to GND steps through the looks; -1 = none
#define OTA         0   // 1 = accept updates over Wi-Fi, with OTA_PASS from secrets.h
#define BATTERY_PIN -1  // an analog pin that reads the battery; -1 = none (reports -1)

// The strip.
#define LED_PIN   5        // the strip's data pin
#define LED_COUNT 30       // how many LEDs
#define LED_ORDER NEO_GRB  // NEO_GRB (most WS2812), NEO_RGB (most WS2811) or NEO_BRG

// Its own look: what it shows at power-on, before anyone has told it anything.
#define OWN_R      255
#define OWN_G      180
#define OWN_B      100
#define OWN_LEVEL  0.4       // brightness, 0.0 to 1.0
#define OWN_EFFECT "steady"  // "steady", "breathe", "pulse" or "flicker"

// Looks 1 to 8: { red, green, blue, level, "effect" }.
// (The Look type is declared in the sketch, just above where it includes this file.)
const Look LOOKS[8] = {
  { 255, 180, 100, 0.6, "steady"  },  // 1 warm white
  { 200, 220, 255, 0.6, "steady"  },  // 2 cool white
  { 255,   0,   0, 0.6, "steady"  },  // 3 red
  { 255, 120,   0, 0.6, "steady"  },  // 4 amber
  {   0, 255,  40, 0.6, "steady"  },  // 5 green
  {   0,  60, 255, 0.6, "steady"  },  // 6 blue
  { 150,   0, 255, 0.6, "breathe" },  // 7 violet
  { 255, 180, 100, 0.1, "steady"  },  // 8 dim
};
