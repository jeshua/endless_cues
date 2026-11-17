// The three files of core/ the audio window plays by, as the page's globals (audio.ts uses them; build/compile.mjs
// bundles this file into audio-lib.bundle.js). They are the code the tests run, and Chain and Timecode go on into
// the worklets as text.
import * as Timecode from '../../core/timecode/timecode';
import * as Chain from '../../core/audio/chain';
import * as Lanes from '../../core/audio/lanes';

Object.assign(globalThis, { Timecode, Chain, Lanes });
