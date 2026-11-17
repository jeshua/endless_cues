// ec_osc.h -- the little of OSC 1.0 that an Endless Cues prop needs.
//
// What it is
//   A header with no dependencies beyond <stdint.h> and <string.h>. It reads
//   one OSC message out of one UDP datagram, and it writes one message: the
//   prop's answer, /ec/here. It allocates nothing and never uses Arduino's
//   String. A packet it does not understand is refused (the parser returns
//   false) and the sketch ignores it: a malformed packet must never crash
//   a prop.
//
// The protocol in brief (Endless Cues prop protocol, version 1)
//   OSC 1.0 over UDP; the prop listens on port 53100.
//     /ec/hello                    -> the prop answers /ec/here to the sender
//     /ec/identify                 a light blinks white for 2 s
//     /ec/look   n [secs]          look 0 (its own) or 1..8
//     /ec/color  r g b [secs]      0..255 each
//     /ec/level  level [secs]      0..1 (a servo: its position)
//     /ec/effect name [speed]      steady | breathe | pulse | flicker
//     /ec/on [secs]   /ec/off [secs]
//     /ec/pulse  ms                a switch: on for that long, then off
//   Any message may end with one more string beginning '#', an id such as
//   "#a41f07". A prop acts once per id and ignores a repeat, so the booth
//   can send a message three times to cover a lost datagram.
//     /ec/here name:s kind:s fw:s state:s uptime:i signal:i battery:i
//
// What an OSC message looks like on the wire
//   address      a string starting '/', ended by a zero byte, then padded
//                with zero bytes to a multiple of 4
//   type tags    a string starting ',', one letter per argument
//                (i = int32, f = float32, s = string), padded the same way
//   arguments    i and f are 4 bytes, big-endian; s is padded like the above
//
// This file is shared by copying: the copies in prop-light/ and
// prop-switch/ must be identical to the one beside those folders.
//
// Status: compiled with arduino-cli 1.5.1 for esp32:esp32:esp32 and esp32:esp32:esp32c3
//   (core 3.3.7) on 2026-11-15; NEVER flashed to a board or run.

#ifndef EC_OSC_H
#define EC_OSC_H

#include <stdint.h>
#include <string.h>

#define EC_OSC_MAX_ARGS 8   // more arguments than this: the packet is refused
#define EC_OSC_ID_COUNT 8   // how many message ids are remembered
#define EC_OSC_ID_SIZE  16  // an id is compared on its first 15 characters

// One argument of a message. `type` says which of the fields is filled in.
struct EcOscArg {
  char type;      // 'i', 'f' or 's'
  int32_t i;      // when type is 'i'
  float f;        // when type is 'f'
  const char *s;  // when type is 's': points into the packet, not a copy
};

// One parsed message. `address` and the strings point into the packet's own
// bytes, so use the message before the packet buffer is reused.
struct EcOscMessage {
  const char *address;             // for example "/ec/look"
  int argCount;                    // not counting the trailing "#id"
  EcOscArg args[EC_OSC_MAX_ARGS];
  const char *id;                  // the trailing "#..." string, or NULL
};

// The last few message ids this prop has acted on.
struct EcOscIdRing {
  char ids[EC_OSC_ID_COUNT][EC_OSC_ID_SIZE];
  int next;  // where the next id will be written
};

// ---------------------------------------------------------------- reading

// Read 4 bytes, most significant first.
static inline uint32_t ecOscReadU32(const uint8_t *p) {
  return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
         ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

// Read a padded string that starts at *pos. On success, returns a pointer to
// it and moves *pos past its padding. Returns NULL if the string runs off
// the end of the packet.
static inline const char *ecOscReadString(const uint8_t *data, int len, int *pos) {
  int start = *pos;
  int end = start;
  while (end < len && data[end] != 0) {
    end++;
  }
  if (end >= len) {
    return NULL;  // no zero byte before the end of the packet
  }
  int after = (end + 4) & ~3;  // past the zero byte, rounded up to 4
  if (after > len) {
    return NULL;  // the padding is missing
  }
  *pos = after;
  return (const char *)(data + start);
}

// Parse one datagram. Returns true and fills in *msg if it is a message this
// file understands; false for anything else (truncated, a bundle, an argument
// type other than i, f and s, too many arguments).
static inline bool ecOscParse(const uint8_t *data, int len, EcOscMessage *msg) {
  msg->address = NULL;
  msg->argCount = 0;
  msg->id = NULL;

  if (data == NULL || len < 4) {
    return false;
  }

  int pos = 0;
  const char *address = ecOscReadString(data, len, &pos);
  if (address == NULL || address[0] != '/') {
    return false;
  }
  msg->address = address;

  // Some old senders leave the type tags out when there are no arguments.
  if (pos == len) {
    return true;
  }

  const char *tags = ecOscReadString(data, len, &pos);
  if (tags == NULL || tags[0] != ',') {
    return false;
  }

  for (int t = 1; tags[t] != 0; t++) {
    if (msg->argCount >= EC_OSC_MAX_ARGS) {
      return false;
    }
    EcOscArg *arg = &msg->args[msg->argCount];
    arg->type = tags[t];
    arg->i = 0;
    arg->f = 0.0f;
    arg->s = NULL;

    if (tags[t] == 'i') {
      if (pos + 4 > len) return false;
      arg->i = (int32_t)ecOscReadU32(data + pos);
      pos += 4;
    } else if (tags[t] == 'f') {
      if (pos + 4 > len) return false;
      uint32_t bits = ecOscReadU32(data + pos);
      memcpy(&arg->f, &bits, 4);  // the same 4 bytes, read as a float
      pos += 4;
    } else if (tags[t] == 's') {
      arg->s = ecOscReadString(data, len, &pos);
      if (arg->s == NULL) return false;
    } else {
      return false;  // a type this file does not read
    }
    msg->argCount++;
  }

  // A last string argument beginning '#' is the message id, not an argument.
  if (msg->argCount > 0) {
    EcOscArg *last = &msg->args[msg->argCount - 1];
    if (last->type == 's' && last->s[0] == '#') {
      msg->id = last->s;
      msg->argCount--;
    }
  }
  return true;
}

// Is this message's address exactly `address`?
static inline bool ecOscIs(const EcOscMessage *msg, const char *address) {
  return msg->address != NULL && strcmp(msg->address, address) == 0;
}

// Argument n as a float, whether it was sent as an int or a float.
// Returns `fallback` if there is no argument n or it is a string.
static inline float ecOscArgFloat(const EcOscMessage *msg, int n, float fallback) {
  if (n < 0 || n >= msg->argCount) return fallback;
  if (msg->args[n].type == 'f') return msg->args[n].f;
  if (msg->args[n].type == 'i') return (float)msg->args[n].i;
  return fallback;
}

// Argument n as an int, whether it was sent as an int or a float (a float is
// rounded to the nearest whole number). Returns `fallback` if there is no
// argument n, it is a string, or it is a float too large to be an int.
static inline int32_t ecOscArgInt(const EcOscMessage *msg, int n, int32_t fallback) {
  if (n < 0 || n >= msg->argCount) return fallback;
  if (msg->args[n].type == 'i') return msg->args[n].i;
  if (msg->args[n].type == 'f') {
    float f = msg->args[n].f;
    if (!(f > -2000000000.0f && f < 2000000000.0f)) return fallback;
    return (int32_t)(f < 0.0f ? f - 0.5f : f + 0.5f);
  }
  return fallback;
}

// Argument n as a string, or NULL if there is no argument n or it is a number.
static inline const char *ecOscArgString(const EcOscMessage *msg, int n) {
  if (n < 0 || n >= msg->argCount) return NULL;
  if (msg->args[n].type != 's') return NULL;
  return msg->args[n].s;
}

// ------------------------------------------------------------ message ids

// Forget every id. Call once at start-up.
static inline void ecOscIdRingClear(EcOscIdRing *ring) {
  memset(ring, 0, sizeof(*ring));
}

// Has this id been seen before? If not, it is remembered (pushing out the
// oldest of the eight) and the answer is false: act on the message. If so,
// the answer is true: ignore the message.
static inline bool ecOscSeenBefore(EcOscIdRing *ring, const char *id) {
  for (int k = 0; k < EC_OSC_ID_COUNT; k++) {
    if (ring->ids[k][0] != 0 &&
        strncmp(ring->ids[k], id, EC_OSC_ID_SIZE - 1) == 0) {
      return true;
    }
  }
  strncpy(ring->ids[ring->next], id, EC_OSC_ID_SIZE - 1);
  ring->ids[ring->next][EC_OSC_ID_SIZE - 1] = 0;
  ring->next = (ring->next + 1) % EC_OSC_ID_COUNT;
  return false;
}

// ---------------------------------------------------------------- writing

// Append a padded string at *pos. Returns false if it does not fit.
static inline bool ecOscWriteString(uint8_t *buf, int size, int *pos, const char *s) {
  int n = (int)strlen(s);
  int padded = (n + 4) & ~3;  // room for the zero byte, rounded up to 4
  if (*pos + padded > size) {
    return false;
  }
  memset(buf + *pos, 0, padded);
  memcpy(buf + *pos, s, n);
  *pos += padded;
  return true;
}

// Append an int32, most significant byte first. Returns false if it does not fit.
static inline bool ecOscWriteInt(uint8_t *buf, int size, int *pos, int32_t value) {
  if (*pos + 4 > size) {
    return false;
  }
  uint32_t v = (uint32_t)value;
  buf[*pos + 0] = (uint8_t)(v >> 24);
  buf[*pos + 1] = (uint8_t)(v >> 16);
  buf[*pos + 2] = (uint8_t)(v >> 8);
  buf[*pos + 3] = (uint8_t)v;
  *pos += 4;
  return true;
}

// Build the prop's answer into buf:
//   /ec/here name:s kind:s fw:s state:s uptime:i signal:i battery:i
// Returns the number of bytes to send, or 0 if buf is too small
// (128 bytes is plenty for ordinary names).
static inline int ecOscWriteHere(uint8_t *buf, int size,
                                 const char *name, const char *kind,
                                 const char *fw, const char *state,
                                 int32_t uptimeSeconds, int32_t signalDbm,
                                 int32_t batteryPercent) {
  int pos = 0;
  bool ok = ecOscWriteString(buf, size, &pos, "/ec/here") &&
            ecOscWriteString(buf, size, &pos, ",ssssiii") &&
            ecOscWriteString(buf, size, &pos, name) &&
            ecOscWriteString(buf, size, &pos, kind) &&
            ecOscWriteString(buf, size, &pos, fw) &&
            ecOscWriteString(buf, size, &pos, state) &&
            ecOscWriteInt(buf, size, &pos, uptimeSeconds) &&
            ecOscWriteInt(buf, size, &pos, signalDbm) &&
            ecOscWriteInt(buf, size, &pos, batteryPercent);
  return ok ? pos : 0;
}

#endif  // EC_OSC_H
