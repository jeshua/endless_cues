/**
 * A Script cue's script: a short list of show commands, run in order.
 *
 *   # the storm, by hand
 *   /cue/12/start
 *   wait 2.5
 *   /cue/13/stop
 *   /playhead/20
 *
 * It is NOT a programming language, and that is the design. QLab's Script cue
 * runs AppleScript, which can do anything the person at the keyboard can; a
 * show file here may come from anyone (a download, an email, an assistant), and
 * opening one must never be a way to run code with the app's powers. So a
 * script can only say what an operator's own hands could do to THIS show's
 * transport: start, stop, pause and resume cues, press GO, move the playhead,
 * panic, and wait. No files, no network of its own, no editing, no saving, no
 * loops, no variables. Everything it does is a line a person can read.
 *
 * The words are the OSC control module's (app/main/modules/osc-control.js), so
 * whoever has driven the app from a Stream Deck already knows them, and a line
 * can be copied from one to the other:
 *
 *   /go                                  GO, as the button does
 *   /panic   /pause   /resume            everything
 *   /playhead/<number>   /playhead/next   /playhead/previous
 *   /cue/<number>/start                  (also: go, preview, stop, hardStop, panic, pause, resume, togglePause)
 *   /cue_id/<id>/start                   the same, naming the cue by its id
 *   wait <seconds>                       1.5, or 1:30
 *   # a note                             (and blank lines) are skipped
 *
 * parse() never throws: a line it cannot read is reported with its number and
 * left out of the steps, and show.js lists it among the cue's problems.
 */
import { parseSmart } from './cue-types';

const MAX_LINES = 200;
/** A cue's verb -> what the engine is asked to do (the same meanings the OSC control module gives them). */
const VERBS = { start: 'start', go: 'start', preview: 'preview', stop: 'stop', hardStop: 'stop', panic: 'stop', pause: 'pause', hardPause: 'pause', resume: 'resume', togglePause: 'toggle' };
const ALL = { '/go': 'go', '/panic': 'panic', '/pause': 'pause-all', '/resume': 'resume-all' };

function parse(text) {
  const steps = [], errors = [];
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = i + 1, s = raw.trim();
    if (!s || s.startsWith('#')) return;
    const bad = (why) => errors.push({ line, why });
    if (steps.length >= MAX_LINES) { if (steps.length === MAX_LINES && !errors.some((e) => /at most/.test(e.why))) bad(`a script has at most ${MAX_LINES} steps`); return; }
    const w = /^wait\s+(\S+)\s*(?:s|secs?|seconds?)?$/i.exec(s);
    if (w) { const secs = parseSmart('seconds', w[1]); if (Number.isFinite(secs) && secs >= 0) steps.push({ line, do: 'wait', secs }); else bad(`“${w[1]}” is not a time (wait 2, wait 1.5, wait 1:30)`); return; }
    if (!s.startsWith('/')) { bad(`“${s.split(/\s+/)[0]}” is not a command: a line is "wait <seconds>" or an address such as /cue/12/start`); return; }
    if (/\s/.test(s)) { bad('a command takes no arguments here: write the cue’s number in the address (/cue/12/start)'); return; }
    if (ALL[s]) { steps.push({ line, do: ALL[s] }); return; }
    const parts = s.split('/').slice(1).map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
    if (parts[0] === 'playhead' && parts.length === 2 && parts[1]) {
      if (parts[1] === 'next' || parts[1] === 'previous') steps.push({ line, do: 'move', step: parts[1] === 'next' ? 1 : -1 });
      else steps.push({ line, do: 'playhead', number: parts[1] });
      return;
    }
    if ((parts[0] === 'cue' || parts[0] === 'cue_id') && parts.length === 3 && parts[1]) {
      const verb = VERBS[parts[2]];
      if (!verb) { bad(`“${parts[2]}” is not something a script can do to a cue (${Object.keys(VERBS).join(', ')})`); return; }
      steps.push({ line, do: verb, ...(parts[0] === 'cue' ? { number: parts[1] } : { id: parts[1] }) });
      return;
    }
    bad(`${s} is not a command a script can run (/go, /panic, /pause, /resume, /playhead/<number>, /cue/<number>/start …, wait <seconds>)`);
  });
  return { steps, errors };
}

/** How long a script takes: the sum of its waits. */
const lengthOf = (steps) => steps.reduce((n, s) => n + (s.do === 'wait' ? s.secs : 0), 0);

export { parse, lengthOf, VERBS, MAX_LINES };
