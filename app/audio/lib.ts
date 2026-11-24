// The files of core/ the audio window plays by, as the page's globals (audio.ts uses them; build/compile.mjs
// bundles this file into audio-lib.bundle.js). They are the code the tests run, and Chain and Timecode go on into
// the worklets as text. Usb is not sound: the window has the serial ports (Web Serial), so a USB DMX interface is
// fed from here (core/light/usb.ts).
import * as Timecode from '../../core/timecode/timecode';
import * as Chain from '../../core/audio/chain';
import * as Lanes from '../../core/audio/lanes';
import * as Usb from '../../core/light/usb';

Object.assign(globalThis, { Timecode, Chain, Lanes, Usb });
