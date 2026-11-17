// secrets.example.h -- the template for secrets.h: this prop's Wi-Fi name and password.
// Endless Cues writes it into a show folder as secrets.h; to build this folder by hand, copy it to
// secrets.h first (secrets.h is gitignored here, so a real password is never committed).
//
// What it is
//   The one file that is yours alone. Type your network's name and password
//   between the quotes. Never share this file and never put it in a
//   repository: Endless Cues does not hold it, and never overwrites it.
//
// The protocol in brief
//   The prop joins this network and listens for OSC on UDP port 53100
//   (see ec_osc.h). While WIFI_SSID is still "CHANGE-ME" the prop does not
//   try to join anything: it just runs its own look.
//
// Status: compiled with arduino-cli 1.5.1 for esp32:esp32:esp32 and esp32:esp32:esp32c3
//   (core 3.3.7) on 2026-11-15; NEVER flashed to a board or run.

#define WIFI_SSID "CHANGE-ME"  // the network's name (2.4 GHz; an ESP32 does not join 5 GHz)
#define WIFI_PASS "CHANGE-ME"  // the network's password
#define OTA_PASS  "CHANGE-ME"  // only used if config.h says OTA 1
