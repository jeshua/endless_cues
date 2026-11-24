/**
 * USB DMX: an interface on a serial port, for a rig with no network node.
 *
 * A USB DMX interface is a serial port (an FTDI chip). Node has no serial port of its own, so the port is
 * Chromium's (Web Serial), opened in the hidden audio window, which is where Web MIDI already lives:
 *
 *   core/light/output.ts ──▶ the host ──▶ the audio window ──▶ createUsbSender (this file) ──▶ the port
 *
 * This file is the part with no port in it: the bytes each kind of interface takes, which of this computer's
 * serial ports is the interface, and the sender that keeps one fed. It is plain code with no Node and no
 * browser in it (it is bundled into the audio window, and tested with a pretended port).
 *
 * Two kinds of interface, and a person says which they have (the two cannot be told apart from outside:
 * both are an FTDI chip with the same USB numbers):
 *
 *   'pro'   The Enttec DMX USB Pro and what speaks its language (the Pro Mk2, DMXking's ultraDMX family).
 *           It has a processor of its own and makes the DMX signal itself. Its framing (its published API,
 *           "DMX USB Pro Widget API Specification 1.44"):
 *
 *             0x7E  label  length low  length high  …data…  0xE7
 *
 *           Label 6 is "Output Only Send DMX": the data is the DMX start code (0) and then 24 to 512 levels.
 *           The widget goes on sending that frame by itself until it is given another, so a message is
 *           written only when the levels change. The port's baud rate does not matter to it.
 *
 *   'open'  The "Open DMX" cables (Enttec's Open DMX USB and the many cheap FTDI cables like it). There is
 *           no processor: the serial line IS the DMX line, at 250000 baud with two stop bits, and the
 *           computer makes every frame, over and over: a break (the line held low, at least 88 µs), a mark,
 *           then the start code and 512 levels. The break is made by asking the port for one and letting go
 *           a moment later, with timers: it comes out far longer than it need be (a millisecond or more,
 *           which DMX allows), so the frames are slower than a desk's, about 30 a second, and their timing
 *           is as steady as this program's timers and no steadier. A light will follow it; it is not a
 *           signal to trust for a moving head's fast chase.
 */
const START = 0x7e, END = 0xe7;
const LABEL_SEND_DMX = 6;

/** The kinds of interface: one that makes DMX itself, and a bare cable. */
export type UsbKind = 'pro' | 'open';
export const KINDS: readonly { id: UsbKind; name: string }[] = [
  { id: 'pro', name: 'Enttec DMX USB Pro (and DMXking)' },
  { id: 'open', name: 'Open DMX cable (FTDI)' },
];
export const kindOf = (x: unknown): UsbKind => (x === 'open' ? 'open' : 'pro');

/** How a port is opened for each kind (Web Serial's names). The Pro ignores the rate; 57600 is the customary one. */
export const SERIAL: Record<UsbKind, { baudRate: number; dataBits: 8; stopBits: 1 | 2; parity: 'none'; flowControl: 'none' }> = {
  pro: { baudRate: 57600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
  open: { baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none', flowControl: 'none' },
};

/** An Open DMX frame's timing, in milliseconds: the break, the mark after it, and the wait for 513 slots to leave
 *  the port (44 µs each, 22.6 ms) before the next break may cut the line. */
export const OPEN_TIMING = { breakMs: 1, markMs: 1, frameMs: 26 };

function levelsOf(levels?: ArrayLike<number> | null): Uint8Array {
  const src = Uint8Array.from(levels || []);
  if (src.length > 512) throw new Error(`a DMX universe is up to 512 levels (got ${src.length})`);
  return src;
}

/** One "send DMX" message for an Enttec DMX USB Pro: the frame it will repeat until told otherwise. */
function enttecProFrame(levels?: ArrayLike<number> | null): Uint8Array {
  const src = levelsOf(levels);
  const n = Math.max(24, src.length);              // the widget wants at least 24 levels
  const b = new Uint8Array(5 + 1 + n);
  b[0] = START; b[1] = LABEL_SEND_DMX;
  b[2] = (n + 1) & 0xff; b[3] = (n + 1) >> 8;      // the start code counts; low byte first
  b[4] = 0x00;                                     // DMX start code
  b.set(src, 5);
  b[b.length - 1] = END;
  return b;
}

/** What follows the break on an Open DMX cable: the start code and all 512 levels (a short universe is filled with 0). */
function openDmxFrame(levels?: ArrayLike<number> | null): Uint8Array {
  const b = new Uint8Array(513);
  b.set(levelsOf(levels), 1);
  return b;
}

// ── which port ──────────────────────────────────────────────────────────

/** A serial port as the system lists it (Electron's `select-serial-port`). */
export interface SerialPortInfo { portId: string; portName?: string; displayName?: string; vendorId?: string; productId?: string; serialNumber?: string }

const FTDI = 0x0403;
/** A USB vendor number as Electron gives it (a decimal string) or as people write it (0403). */
const isFtdi = (vendorId: unknown) => { const s = String(vendorId ?? '').trim().toLowerCase(); return !!s && (Number(s) === FTDI || s === '0403' || s === '0x0403'); };
/** A port whose name is the one an FTDI cable gets on a Mac (cu.usbserial-…) or on Linux (ttyUSB0). */
const namedUsb = (p: SerialPortInfo) => /usbserial|ttyUSB/i.test(String(p.portName || ''));
const base = (s: unknown) => String(s ?? '').trim().replace(/^.*[\\/]/, '').toLowerCase();
/** What a port is called in the window: its own name where it has one. */
const portLabel = (p: SerialPortInfo) => String(p.portName || p.displayName || p.portId);

/** The ports that could be a DMX interface: an FTDI chip, or named as one is. */
function candidates(list: readonly SerialPortInfo[] | null | undefined): SerialPortInfo[] {
  return (list || []).filter((p) => p && p.portId && (isFtdi(p.vendorId) || namedUsb(p)));
}

/**
 * The port a universe gets. `want` is what the person typed (a port's name, with or without /dev/, or an
 * interface's serial number); empty means the first interface found. `taken`: ports other universes hold.
 * Never a port that is not a USB serial one unless it is named outright (a Mac lists its Bluetooth devices as ports).
 */
function choosePort(list: readonly SerialPortInfo[] | null | undefined, want = '', taken: ReadonlySet<string> = new Set()): { port: SerialPortInfo | null; why: string } {
  const all = (list || []).filter((p) => p && p.portId);
  const w = base(want);
  if (w) {
    const p = all.find((x) => base(x.portName) === w || base(x.displayName) === w || base(x.serialNumber) === w);
    if (!p) { const seen = candidates(all).map(portLabel); return { port: null, why: `no serial port named ${String(want).trim()}${seen.length ? ` (found: ${seen.join(', ')})` : ''}` }; }
    return taken.has(p.portId) ? { port: null, why: `${portLabel(p)} is another universe’s` } : { port: p, why: '' };
  }
  const found = candidates(all);
  const free = found.find((p) => !taken.has(p.portId));
  if (free) return { port: free, why: '' };
  return { port: null, why: found.length ? 'every USB DMX interface found is another universe’s' : 'no USB DMX interface found: is it plugged in?' };
}

// ── the sender ──────────────────────────────────────────────────────────

/** An open port, as much of it as DMX needs. `write` is done when the bytes are with the system. */
export interface DmxPort { write(bytes: Uint8Array): Promise<void>; setBreak(on: boolean): Promise<void> }

const same = (a: Uint8Array, b: Uint8Array) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };

/**
 * Keeps one interface fed. `set(levels)` is the newest look; `stop()` lets go of the port (the caller closes it).
 * A Pro is written to when the levels change (one write at a time: levels that arrive meanwhile wait, and only
 * the newest of them is sent). An Open DMX cable is written to all the time. When the port fails, `failed` is
 * told once and nothing more is written.
 */
function createUsbSender({ kind, port, failed = () => {}, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), timing = OPEN_TIMING }: {
  kind: UsbKind; port: DmxPort; failed?: (why: string) => void; sleep?: (ms: number) => Promise<void>; timing?: typeof OPEN_TIMING;
}) {
  let levels: Uint8Array = new Uint8Array(0);
  let fresh = false;             // levels the Pro has not been given yet
  let busy = false, on = true, frames = 0;
  const lost = (err: unknown) => { if (!on) return; on = false; failed(String((err as Error)?.message || err)); };

  async function flush() {
    if (busy) return;
    busy = true;
    try { while (on && fresh) { fresh = false; await port.write(enttecProFrame(levels)); frames++; } }
    catch (err) { lost(err); }
    busy = false;
  }
  async function loop() {
    try {
      while (on) {
        await port.setBreak(true); await sleep(timing.breakMs);
        await port.setBreak(false); await sleep(timing.markMs);
        if (!on) break;
        await port.write(openDmxFrame(levels)); frames++;
        await sleep(timing.frameMs);
      }
    } catch (err) { lost(err); }
  }
  if (kind === 'open') void loop();

  return {
    set(next: ArrayLike<number>) {
      const b = levelsOf(next);
      if (frames + (fresh ? 1 : 0) > 0 && same(b, levels)) return;        // (the first look is always sent, all zeros or not)
      levels = b;
      if (kind === 'pro') { fresh = true; void flush(); }
    },
    stop() { on = false; },
    /** How many frames have been written (a test, and the window's report, look here). */
    frames: () => frames,
    running: () => on,
  };
}

export type UsbSender = ReturnType<typeof createUsbSender>;

export { enttecProFrame, openDmxFrame, choosePort, candidates, portLabel, createUsbSender };
