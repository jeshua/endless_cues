/**
 * USB DMX: the bytes an interface takes. NOT wired to anything: the app sends DMX over the network only.
 *
 * A USB DMX interface is a serial port (an FTDI chip), and Node has no serial port of its own: it
 * needs a native module (`serialport`), built for each platform and signed with the app. That is a
 * dependency this app does not take yet (no build step, nothing native), so this file is what such
 * a sender would write to the port once there is one, and docs/specs/14-lighting.md says the rest.
 *
 * The Enttec DMX USB Pro's framing (its published API, "DMX USB Pro Widget API Specification 1.44"),
 * which the Pro Mk2 and DMXking's ultraDMX family also speak:
 *
 *   0x7E  label  length low  length high  …data…  0xE7
 *
 * Label 6 is "Output Only Send DMX": the data is the DMX start code (0) and then 24 to 512 levels.
 * The widget goes on sending that frame by itself until it is given another, so one message per
 * change is enough (a steady refresh from here is not needed, and holds the last frame for free).
 * The port is opened at any baud rate (the widget ignores it); 57600 is the customary one.
 *
 * (The cheap "Open DMX" cables are not this: they have no processor, and the computer must make the
 * DMX timing itself, break and all, at 250000 baud. That cannot be done reliably from JavaScript.)
 */
const START = 0x7e, END = 0xe7;
const LABEL_SEND_DMX = 6;

/** One "send DMX" message for an Enttec DMX USB Pro: the frame it will repeat until told otherwise. */
function enttecProFrame(levels) {
  const src = Buffer.from(levels || []);
  if (src.length > 512) throw new Error(`a DMX universe is up to 512 levels (got ${src.length})`);
  const n = Math.max(24, src.length);              // the widget wants at least 24 levels
  const b = Buffer.alloc(5 + 1 + n);
  b[0] = START; b[1] = LABEL_SEND_DMX;
  b.writeUInt16LE(n + 1, 2);                       // the start code counts
  b[4] = 0x00;                                     // DMX start code
  src.copy(b, 5);
  b[b.length - 1] = END;
  return b;
}

export { enttecProFrame };
