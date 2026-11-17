/**
 * Cue templates: what a new cue of a type starts with, in this show.
 *
 * Kept in the show file (`settings.templates`: { fade: { duration: 5 }, audio: { bus: 'music' } }), so they are
 * versioned and travel with the show. A template is made from a cue ("new Fade cues start like this one") and
 * holds that cue's settings without what belongs to the one cue: its number, name and notes, what it is aimed
 * at, its file, and what was found from its sound.
 *
 * Whoever adds a cue for a person applies it (`withTemplate`): the toolbar, a dropped sound. A paste, a
 * duplicate and the assistant do not: they say what the cue is themselves.
 */
const { TYPES, fieldsOf, coerce } = require('./cue-types');

const OWN = new Set(['number', 'name', 'notes', 'flagged', 'file', 'target', 'hotkey', 'oscTrigger', 'midiTrigger', 'clockTrigger', 'timecodeTrigger', 'cell',
  'markers', 'loops', 'tempo', 'beats', 'downbeats', 'message', 'midi', 'lightCue', 'from', 'cutAt', 'to', 'end', 'at']);

/** The template a cue would make: its settings that a new cue of its type could start with. */
function templateOf(cue) {
  const out = {};
  if (!cue || !TYPES[cue.type]) return out;
  for (const f of fieldsOf(cue.type)) if (!OWN.has(f.key) && cue[f.key] !== undefined) out[f.key] = JSON.parse(JSON.stringify(cue[f.key]));
  return out;
}

/** A show's template for a type, with anything this version cannot use left out (a hand-edited file, a field since removed). */
function templateFor(doc, type) {
  const raw = ((doc && doc.settings && doc.settings.templates) || {})[type];
  const out = {};
  if (!raw || typeof raw !== 'object' || !TYPES[type]) return out;
  for (const f of fieldsOf(type)) {
    if (OWN.has(f.key) || raw[f.key] === undefined) continue;
    const r = coerce({ ...f, required: false }, raw[f.key]);
    if (r.ok && r.value !== undefined) out[f.key] = r.value;
  }
  return out;
}

/** A new cue's fields over its type's template: what was asked for wins. */
function withTemplate(doc, spec) { return { ...templateFor(doc, spec.type), ...spec }; }

module.exports = { templateOf, templateFor, withTemplate, OWN };
