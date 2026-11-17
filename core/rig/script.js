/**
 * The script: one text file in the show folder whose marks say where the cues are.
 *
 * A mark is a line that is "@cue <number>" and, if you like, a name: "@cue 12 Thunder". It may sit inside a
 * comment ("<!-- @cue 12 Thunder -->"), so a Markdown script still reads cleanly. The line of text above a
 * mark is the line it is called on. The app never writes the script: it reads the marks, and says which have
 * no cue (core/rig/check.js). docs/specs/15-assistant-and-rig.md, section 3.8.
 *
 *   read(showDir, file)   → { ok, why, lines, marks: [{ line, number, name, quote, section }], sections: [{ line, name }] }
 *   compare(doc, marks)   → { missing: [mark…] }        the marks whose number no cue has
 *
 * `lines` is how many lines the file has; a line is counted from 1. A section is a Markdown heading, or a
 * line beginning ACT or SCENE.
 */
const folder = require('./folder');
const show = require('../show/show');

const MARK = /^\s*(?:<!--\s*)?@cue\s+(\S+?)(?:\s+(.*?))?\s*(?:-->)?\s*$/i;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const SCENE = /^\s*((?:ACT|SCENE)\b.*?)\s*$/;

function read(showDir, file) {
  const none = { ok: false, why: '', lines: 0, marks: [], sections: [] };
  if (!file) return { ...none, why: 'This show names no script.' };
  const r = folder.readAll(showDir, file);
  if (!r.ok) return { ...none, why: r.why };
  const marks = [], sections = [];
  let section = '', quote = '';
  r.lines.forEach((text, i) => {
    const m = MARK.exec(text);
    if (m && m[1] !== '-->') { marks.push({ line: i + 1, number: m[1], name: (m[2] || '').trim(), quote, section }); return; }
    const h = HEADING.exec(text) || SCENE.exec(text);
    if (h) { section = h[1].trim(); sections.push({ line: i + 1, name: section }); quote = ''; return; }
    // the line a mark is called on: the last line of words above it (a comment or a blank line is not one)
    const t = text.trim();
    if (t && !/^<!--.*-->$/.test(t)) quote = t;
  });
  return { ok: true, why: '', lines: r.lines.length, marks, sections };
}

/** The marks whose number no cue has (numbers are compared as cue numbers are: as text, whatever their case). */
function compare(doc, marks) {
  const have = new Set();
  show.walk(doc, (c) => { if (c.number != null && c.number !== '') have.add(String(c.number).trim().toLowerCase()); });
  return { missing: (marks || []).filter((m) => !have.has(String(m.number).trim().toLowerCase())) };
}

module.exports = { read, compare, MARK };
