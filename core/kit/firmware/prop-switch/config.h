// config.h -- this prop's settings: a switch (a relay or a servo). (An example copy.)
//
// What it is
//   Everything about one prop that is not a secret. Endless Cues writes this
//   file for each prop; the copy here is an example, so that the sketch
//   compiles as it stands. The sketch has no other per-prop line.
//
// The protocol in brief
//   The prop listens for OSC on UDP port EC_PORT and answers /ec/hello with
//   /ec/here, giving PROP_NAME. /ec/on, /ec/off and /ec/pulse ms work it;
//   /ec/level 0..1 places a servo. See ec_osc.h for the rest.
//
// Status: compiled with arduino-cli 1.5.1 for esp32:esp32:esp32 and esp32:esp32:esp32c3
//   (core 3.3.7) on 2026-11-15; NEVER flashed to a board or run.

#define PROP_NAME   "trapdoor_a"  // the name it answers by
#define EC_PORT     53100         // the UDP port it listens on
#define EC_PROTOCOL 1             // the protocol version this was written for
#define BOARD_LABEL "esp32dev"    // which board this was set up for (information only)

// A fixed address such as "10.0.0.51", or "" to let the router choose.
// When set, the gateway is assumed to be .1 on the same network
// (10.0.0.51 -> gateway 10.0.0.1, netmask 255.255.255.0).
#define FIXED_ADDRESS ""

#define BUTTON_PIN  -1  // a button from this pin to GND toggles it; -1 = none
#define OTA         0   // 1 = accept updates over Wi-Fi, with OTA_PASS from secrets.h
#define BATTERY_PIN -1  // an analog pin that reads the battery; -1 = none (reports -1)

// The output.
#define OUTPUT_RELAY 0
#define OUTPUT_SERVO 1

#define OUT_PIN          5             // the relay's or the servo's signal pin
#define OUTPUT_KIND      OUTPUT_RELAY  // OUTPUT_RELAY or OUTPUT_SERVO
#define RELAY_ACTIVE_LOW 0             // 1 if the relay board switches on when the pin is LOW
#define START_ON         0             // 1 = on at power-on (a servo: at its "on" end)
#define SERVO_MIN_US     1000          // a servo's pulse at "off" (position 0), microseconds
#define SERVO_MAX_US     2000          // a servo's pulse at "on" (position 1), microseconds
