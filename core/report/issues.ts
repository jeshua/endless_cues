/**
 * Something went wrong: the line of the app's own log that the status bar offers to report (app/main/main.js keeps
 * one of these; app/renderer/app.js draws it, and Report a Problem attaches it). It only notices and remembers: it
 * never opens anything, and the window decides when to show it (in Show mode, as a small mark until Edit).
 *
 *   isIssue(line)              whether a log line says something went wrong (an error, a cue that could not play,
 *                              a device or output that dropped, a window that died and was made again)
 *   createIssues({ now })      .seen(line) -> true when it is news; .latest() -> { line, at, count } | null; .dismiss()
 */

// (the words the report's own error lines are picked by (core/report/report.js), and the ones the app uses when a
// part of it drops or dies: an output gone, the audio window made again, a MIDI message dropped)
const BAD = /\b(error|uncaught|could not|cannot|failed|exception)\b|\bdied\b|\bis gone\b|\bDROPPED\b|\bstopped answering\b|\[page\]/i;
// (what is not the app going wrong: the assistant being refused a tool, a report's own sending, a test run's own words)
const NOT = /^(?:[\d:.]+\s+)?\[(?:agent|report|update|updates)\]|SMOKE /;

function isIssue(line) {
  const s = String(line || '');
  return BAD.test(s) && !NOT.test(s);
}

/** `quiet` ms: the same kind of line again within it is counted, not announced again. */
function createIssues({ now = () => Date.now(), quiet = 30000 } = {}) {
  let latest = null;            // { line, at, count }
  let told = new Map();         // a line without its time -> when it was last announced
  const key = (line) => String(line).replace(/^[\d:.]+\s+/, '').replace(/\d+/g, '#').slice(0, 200);
  return {
    /** A log line: remembered when it is an issue. True when the window should be told (news, not a repeat). */
    seen(line) {
      if (!isIssue(line)) return false;
      const t = now(), k = key(line);
      latest = { line: String(line).replace(/^[\d:.]+\s+/, '').slice(0, 500), at: t, count: (latest ? latest.count : 0) + 1 };
      const last = told.get(k);
      told.set(k, t);
      if (told.size > 200) told = new Map([...told].slice(-100));
      return last === undefined || t - last > quiet;
    },
    latest: () => (latest ? { ...latest } : null),
    /** Put away (dismissed, or reported): nothing is offered until the next issue. */
    dismiss() { latest = null; },
  };
}

export { isIssue, createIssues };
