/**
 * How the assistant starts: what it says before anyone has typed, and cues made from a folder of sounds.
 *
 *   first({ doc, showDir, folder, rig, imported, provider, installed })
 *       → { state, line, asks: [{ label, text, offline, action? }], next: { label, text }, setup, helper }
 *     What the assistant drawer shows before the first message (docs/specs/15-assistant-and-rig.md, 4.6).
 *     Nothing in it is generic: the line is a fact about this show, and an ask is offered only when it is
 *     true of this show and will work when pressed. `offline` marks an ask the built-in helper can do with
 *     no model. `next` is one short line, the next step, or empty: few words everywhere (the owner's rule).
 *
 *   folderPlan(listing, { from }) → { ops, count, numbers, groups, loops, tidied, texts, videos }
 *   folderOps(listing, { from })  → the ops alone (`from`: the first cue number to give; nextNumber(doc) is the usual one)
 *   said(plan)          → what was guessed, as the reply a person reads
 *     Cues for the sounds in the show folder that no cue uses yet: in the order their names give, named
 *     without numbers and extensions, numbered in order, under a section heading where a sub-folder or a scene prefix says so. Nothing else
 *     is set: no level, no fade, no loop. What the names suggest beyond that (a loop) is said, not done.
 *
 * Pure: plain data in, plain data out. The listing comes from core/rig/folder.js; nothing here reads a disk.
 */
import * as show from '../show/show';
import * as devices from '../rig/devices';
import * as models from '../net/devices';
import type { Cue, Device, ShowDoc } from '../show/types';
import type { Op } from '../show/ops';

/** A file in the show folder, as core/rig/folder.js lists it (as much as is read here). */
export interface FolderEntry { path: string; kind: string; usedBy?: string[] }
/** A sound the plan makes a cue for: its path, its name in full, and the name it is given. */
interface PlanCue { path: string; long: string; name: string; cues?: undefined }
/** A run of sounds under one heading: by a sub-folder, or by a scene written at the front of their names. */
interface PlanGroup { key: string; by: string; name: string; cues: PlanCue[] }
export type Plan = ReturnType<typeof folderPlan>;
/** One thing the drawer offers to ask. `offline`: the built-in helper can do it with no model. */
export interface Ask { label: string; text: string; offline: boolean; action?: string }
/** A way to have something answer (Settings, and the first screen with no model). */
export interface SetupRow { id: string; label: string; says: string; found: boolean; set: string | null; open: string | null; signIn?: boolean }
export interface FirstOptions {
  doc: ShowDoc;
  showDir?: string | null;
  folder?: FolderEntry[] | null;
  /** the Rig as the app has it: each device's state */
  rig?: { devices?: Record<string, { state?: string }> } | null;
  /** what the QLab import said */
  imported?: { issues?: unknown[] } | null;
  provider?: string;
  installed?: Record<string, boolean | undefined>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (words: string[]) => (words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`);
const KIT_MODELS = ['ec-prop-light', 'ec-prop-switch'];

// ── cues from a folder ────────────────────────────────────────────────

/** Words on the end of a file name that say which bounce it is, not what it is: "thunder FINAL v3". */
const BOUNCE = /[\s\-–(]+(?:final\d*|finals|master(?:ed)?|mix(?:down)?\d*|bounce\d*|edit\d*|new|copy|v\d+(?:\.\d+)?|\d{1,2}\)|take\s*\d+)\)?$/i;
/** A scene written at the front of a name: "Sc2 thunder", "Act 1 - Storm", "Scene 3. rain". */
const SCENE = /^(sc|scn|scene|act|part)\s*\.?\s*(\d+[a-z]?)\s*[-–:.\s]\s*(\S.*)$/i;
const SCENE_WORD: Record<string, string> = { sc: 'Scene', scn: 'Scene', scene: 'Scene', act: 'Act', part: 'Part' };
/** Folders that hold a show's sounds without meaning anything by it: never a group. */
const HOLDERS = new Set(['media', 'audio', 'sound', 'sounds', 'music', 'tracks', 'wav', 'wavs', 'mp3']);

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stem = (file: string) => file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
/** "01 walk-in" → "walk-in": a running-order number at the front goes (a name that is only a number stays). */
const unnumbered = (s: string) => { const t = s.replace(/^\(?\d{1,3}[a-z]?\)?\s*[-–._)\s]\s*/i, '').trim(); return t || s; };
function untidied(s: string) { let t = s; for (;;) { const u = t.replace(BOUNCE, '').trim(); if (!u || u === t) return t; t = u; } }

function folderPlan(listing: FolderEntry[] = [], { from = 1 }: { from?: number } = {}) {
  const sounds = listing.filter((e) => e.kind === 'sound' && !(e.usedBy || []).length && !/^props\//.test(e.path));
  // each sound: where it is, the scene its name begins with (if it does), and its name both ways
  const items = sounds.map((e) => {
    const parts = e.path.split('/');
    const base = unnumbered(stem(parts[parts.length - 1]));
    const sc = SCENE.exec(base);
    const dir = parts.slice(0, -1).filter((d) => !HOLDERS.has(d.toLowerCase()));
    return { path: e.path, dir: dir.length ? dir.join('/') : '', scene: sc ? `${SCENE_WORD[sc[1].toLowerCase()]} ${sc[2].toUpperCase()}` : '', rest: sc ? sc[3].trim() : base, base };
  });
  // a sub-folder is a group when it does not hold everything; a scene prefix when two or more share it
  const dirs = new Set(items.map((i) => i.dir));
  const scenes = new Map<string, number>();
  for (const i of items) if (i.scene && !(i.dir && dirs.size > 1)) scenes.set(i.scene, (scenes.get(i.scene) || 0) + 1);
  const groups: PlanGroup[] = [];            // in the order each is first met
  const top: (PlanCue | PlanGroup)[] = [];               // the running order: a sound, or a group at the place of its first sound
  let tidied = false;
  for (const i of items) {
    const byDir = i.dir && dirs.size > 1;
    const key = byDir ? `dir:${i.dir}` : i.scene && scenes.get(i.scene)! > 1 ? `scene:${i.scene}` : '';
    const long = capital(key.startsWith('scene:') ? i.rest : i.base);
    const cue: PlanCue = { path: i.path, long, name: capital(untidied(long)) };
    if (!key) { top.push(cue); continue; }
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, by: byDir ? 'folder' : 'prefix', name: byDir ? capital(unnumbered(stem(i.dir.split('/').pop()!))) : i.scene, cues: [] }; groups.push(g); top.push(g); }
    g.cues.push(cue);
  }
  // a tidied name that two sounds would share is no name: those keep what tells them apart
  const all = [...top.filter((t): t is PlanCue => !t.cues), ...groups.flatMap((g) => g.cues)];
  const seen = new Map<string, number>();
  for (const c of all) seen.set(c.name.toLowerCase(), (seen.get(c.name.toLowerCase()) || 0) + 1);
  for (const c of all) { if (seen.get(c.name.toLowerCase())! > 1) c.name = c.long; else if (c.name !== c.long) tidied = true; }
  // every sound gets a whole number in the running order, so that it can be called; a group is not a thing to call
  let n = Math.max(1, Math.round(Number(from)) || 1) - 1;
  const first = n + 1;
  const audio = (c: PlanCue) => ({ type: 'audio', number: String(++n), name: c.name, file: c.path });
  // one GO a sound: a scene's sounds are a run of cues under a section heading (core/show/sections.js), which never
  // plays; a group would fire them together, which is never what a folder of a scene's sounds means
  const ops = top.flatMap((t): Op[] => (t.cues
    ? [{ op: 'cue.add', cue: { type: 'section', name: t.name } }, ...t.cues.map((c): Op => ({ op: 'cue.add', cue: audio(c) }))]
    : [{ op: 'cue.add', cue: audio(t) }]));
  return {
    ops, count: all.length, numbers: all.length ? [first, n] : null,
    groups: groups.map((g) => ({ name: g.name, by: g.by, count: g.cues.length })),
    loops: all.filter((c) => /\bloop(s|ed|ing)?\b/i.test(c.long)).map((c) => c.name),
    tidied,
    texts: listing.filter((e) => e.kind === 'text' && !/^props\//.test(e.path) && !/^(AGENTS|CLAUDE)\.md$/.test(e.path)).map((e) => e.path),
    videos: listing.filter((e) => e.kind === 'video' && !(e.usedBy || []).length).length,
  };
}
const folderOps = (listing: FolderEntry[], opts?: { from?: number }) => folderPlan(listing, opts).ops;
/** The number the next new cue takes: one more than the highest whole number in the show. */
function nextNumber(doc: ShowDoc) { let top = 0; show.walk(doc, (c) => { const v = Number(c.number); if (Number.isFinite(v)) top = Math.max(top, Math.floor(v)); }); return top + 1; }

/** What the plan guessed, said plainly. The last sentence is always what was NOT done. */
function said(plan: Plan) {
  if (!plan.count) return 'There are no sounds in this folder that a cue does not already use.';
  const out = [`${plural(plan.count, 'cue')} in file-name order${plan.numbers ? (plan.numbers[0] === plan.numbers[1] ? `, numbered ${plan.numbers[0]}` : `, numbered ${plan.numbers[0]} to ${plan.numbers[1]}`) : ''}, named after their files${plan.tidied ? ', without words like “FINAL” or “v3”' : ''}.`];
  const folders = plan.groups.filter((g) => g.by === 'folder'), scenes = plan.groups.filter((g) => g.by === 'prefix');
  if (folders.length) out.push(`Each sub-folder has a section heading: ${list(folders.map((g) => g.name))}.`);
  if (scenes.length) out.push(`Names that start with the same scene have a section heading: ${list(scenes.map((g) => g.name))}.`);
  if (plan.groups.length) out.push('Each sound is its own GO.');
  if (plan.loops.length) out.push(`${list(plan.loops.map((n) => `“${n}”`))} ${plan.loops.length === 1 ? 'is called a loop. I did not make it loop.' : 'are called loops. I did not make them loop.'}`);
  if (plan.texts.length) out.push(`I did not read ${list(plan.texts)}.`);
  if (plan.videos) out.push(`I left the ${plural(plan.videos, 'video')} alone.`);
  out.push('Nothing else is set: no levels, fades or loops.');
  return out.join(' ');
}

// ── the first screen ──────────────────────────────────────────────────

/** The ways to have something answer, each true of this computer (4.6.1). The Endless Cues assistant is first:
 *  nothing to install and no key; choosing it signs in (`signIn`), and nothing contacts the service before that. */
function setupRows(installed: Record<string, boolean | undefined> = {}) {
  const cli = (id: string, label: string, says: string): SetupRow => ({ id, label, says, found: true, set: id, open: null });
  const rows: SetupRow[] = [{ id: 'cloud', label: 'Endless Cues assistant', says: 'free during the beta', found: false, set: 'cloud', open: null, signIn: true }];
  // (Claude Code first when both are there; Codex takes the place when it alone is)
  if (installed['claude-code']) rows.push(cli('claude-code', 'Claude Code', 'uses your Claude plan'));
  else if (installed.codex) rows.push(cli('codex', 'Codex', 'uses your Codex sign-in'));
  rows.push(
    { id: 'key', label: 'Your own key', says: 'Anthropic, OpenAI…', found: false, set: null, open: 'anthropic' },
    { id: 'local', label: 'Ollama', says: 'free, on this computer', found: false, set: null, open: 'ollama' },
    { id: 'helper', label: 'Built-in helper', says: 'no model, a few jobs', found: false, set: 'demo', open: null },
  );
  return { title: 'Who should answer?', rows, foot: '' };
}

/** Whether a list's numbers want doing again: one missing among numbered ones, one twice, one out of order. */
function numbersUntidy(cues: Cue[]) {
  const nums = cues.map((c) => (c.number == null ? '' : String(c.number).trim()));
  const have = nums.filter(Boolean);
  if (have.length < 3) return false;
  if (have.length !== nums.length || new Set(have).size !== have.length) return true;
  const n = have.map(Number);
  if (n.some((x) => !Number.isFinite(x))) return false;      // lettered numbers (12A) are somebody's system: leave them be
  return n.some((x, i) => i > 0 && x <= n[i - 1]) || n.some((x) => !Number.isInteger(x));
}

function first({ doc, showDir = null, folder = null, rig = null, imported = null, provider = 'off', installed = {} }: FirstOptions) {
  const none = provider === 'off' || !provider, helper = provider === 'demo';
  const modelFree = none || helper;
  const cues: Cue[] = []; show.walk(doc, (c) => cues.push(c));
  const devs = devices.list(doc);
  const files = folder || [];
  const unused = (kind: string) => files.filter((e) => e.kind === kind && !(e.usedBy || []).length && !/^props\//.test(e.path));
  const sounds = unused('sound'), videos = unused('video');
  const script = (doc.settings.rig && doc.settings.rig.script) || '';
  const texts = files.filter((e) => e.kind === 'text' && !/^props\//.test(e.path) && !/^(AGENTS|CLAUDE)\.md$/.test(e.path) && !/\.(json|toml|yaml|csv|ino|h|cpp)$/i.test(e.path));
  const wasImported = !!imported || /^Imported from the QLab/.test(doc.notes || '');
  const asks: Ask[] = [];
  const ask = (label: string, text?: string, offline = false, more: { action?: string } = {}) => asks.push({ label, text: text === undefined ? `${label}.` : text, offline, ...more });
  let state: string, line: string, next: { label: string; text: string };

  const soundsAsk = () => { if (sounds.length) ask(cues.length ? `Make cues for ${plural(sounds.length, 'unused sound')}` : `Make cues from ${sounds.length === 1 ? 'this sound' : `these ${sounds.length} sounds`}`, cues.length ? `Make cues for the ${plural(sounds.length, 'sound')} in this folder that no cue uses.` : `Make cues from the ${plural(sounds.length, 'sound')} in this folder.`, true); };
  const textAsk = () => {
    // the one text file that is plainly the thing to read: the only one, or the only one that calls itself a script, a cue sheet or a running order
    const named = texts.filter((e) => /script|cue|running|order/i.test(e.path));
    const one = texts.length === 1 ? texts[0] : named.length === 1 ? named[0] : null;
    if (one && one.path !== script) ask(`Make cues from ${one.path}`, `Read ${one.path} and make cues from it.`);
    else if (script && !cues.length) ask(`Cue every mark in ${script}`, `Read the script (${script}) and put a cue at every mark.`);
  };

  if (wasImported) {
    state = 'imported';
    const patches = (doc.settings.network.patches || []);
    const notCome = imported ? (imported.issues || []).length : Math.max(0, String(doc.notes || '').split('\n').length - 1);
    line = `Imported from QLab: ${plural(cues.length, 'cue')}${patches.length ? `, ${plural(patches.length, 'network patch', 'network patches')}` : ''}${notCome ? `, ${plural(notCome, 'thing')} did not come across` : ''}.`;
    if (notCome) ask('What did not come across?', 'What did not come across from QLab, and what should I do about each?');
    ask('Check the show for problems', undefined, true);
    const patch = patches.find((p) => p && p.device && p.device !== 'generic' && models.DEVICES[p.device] && !devs.some((d) => d.id === p.id));
    if (patch) ask(`Make “${patch.name}” a device`, `Turn the patch “${patch.name}” into a device.`, true);
    next = { label: '', text: '' };
  } else if (devs.length) {
    state = 'devices';
    const live = (rig && rig.devices) || {};
    const stateOf = (d: Device) => (live[d.id] && live[d.id].state) || '';
    const there = devs.filter((d) => stateOf(d) === 'ready'), away = devs.filter((d) => stateOf(d) === 'problem' || (stateOf(d) === 'look' && d.alive && d.alive.how !== 'none'));
    const known = there.length + away.length > 0;
    line = !known ? `${plural(devs.length, 'device')}: ${list(devs.slice(0, 4).map((d) => d.name))}${devs.length > 4 ? ` and ${devs.length - 4} more` : ''}.`
      : `${plural(devs.length, 'device')}: ${there.length === devs.length ? (devs.length === 1 ? 'it is answering' : devs.length === 2 ? 'both answering' : 'all answering') : `${there.length} answering`}${away.length ? `, ${list(away.slice(0, 3).map((d) => d.name))} ${away.length === 1 ? 'is' : 'are'} not` : ''}.`;
    if (away.length) ask(`Why is ${away[0].name} not answering?`, `Why is ${away[0].name} not answering?`, true);
    const usedDevices = new Set<string>(); for (const c of cues) { if (c.type === 'device' && c.device) usedDevices.add(c.device); if (c.type === 'network' && c.patch) usedDevices.add(c.patch); }
    const idle = devs.find((d) => !usedDevices.has(d.id) && (d.commands || []).length);
    if (idle) { const cmd = idle.commands.find((c) => c.id === idle.test) || idle.commands[0]; ask(`Add a cue: ${cmd.label} to ${idle.name}`, `Add a cue that sends ${cmd.label} to ${idle.name}.`, true); }
    ask('Is everything ready?', 'Is everything ready?', true);
    const bare = showDir && devs.find((d) => KIT_MODELS.includes(d.model as string) && !files.some((e) => e.path.startsWith(`props/${d.id}/`)));
    if (bare) ask(`Write firmware for ${bare.name}`, undefined, true);
    if (!cues.length) soundsAsk();
    next = { label: 'Next: ask me to hand the show over.', text: '' };
  } else if (cues.length) {
    state = 'cues';
    const broken = new Set(show.problems(doc).filter((p) => p.level === 'error').map((p) => p.id)).size;
    line = `${plural(cues.length, 'cue')}${broken ? `, ${broken} of them broken` : ''}.`;
    if (broken) ask(`Fix the ${broken === 1 ? 'broken cue' : `${broken} broken cues`}`);
    soundsAsk();
    const untidy = doc.lists.find((l) => numbersUntidy(l.cues));
    if (untidy) ask(`Renumber ${untidy.name} in tens`, `Renumber ${untidy.name} in tens.`, true);
    // sounds that nothing ever takes out: an Audio cue no Fade or Stop is aimed at (two or more, or it is not a pattern)
    const aimed = new Set(cues.filter((c) => c.target).map((c) => c.target));
    const open = cues.filter((c) => c.type === 'audio' && !aimed.has(c.id));
    if (open.length > 1) {
      const buses = doc.settings.audio.buses || [];
      const count = new Map<string, number>(); for (const c of open) { const b = c.bus || (buses[0] && buses[0].id) || ''; count.set(b, (count.get(b) || 0) + 1); }
      const [busId] = [...count].sort((a, b) => b[1] - a[1])[0];
      const bus = buses.find((b) => b.id === busId);
      ask(`Add fade-outs to the ${bus ? bus.name : 'Audio'} cues`, `Add a 3 second fade-out after every ${bus ? `Audio cue on the ${bus.name} bus` : 'Audio cue'} that has none.`);
    }
    if (!broken) textAsk();
    next = { label: 'Next: tell me about your equipment.', text: '' };
  } else if (sounds.length || videos.length || (texts.length && showDir)) {
    state = 'folder';
    const have = [sounds.length && plural(sounds.length, 'sound'), videos.length && plural(videos.length, 'video'), texts.length && plural(texts.length, 'text file')].filter((x): x is string => !!x);
    line = `${capital(list(have))} not in a cue yet.`;
    soundsAsk();
    textAsk();
    next = sounds.length
      ? { label: 'Next: tell me how each one should end.', text: '' }
      : { label: 'Next: put the show’s sounds in this folder.', text: '' };
  } else {
    state = 'empty';
    line = 'An empty show.';
    ask('Start from a folder of sounds…', 'How do I start from a folder of sounds?', true, { action: 'start-in-folder' });
    next = { label: '', text: '' };
  }

  // With no model (off, or the built-in helper), only what the helper can really do is offered.
  const offered = (modelFree ? asks.filter((a) => a.offline) : asks).slice(0, 4);
  if (none) {
    // nobody answers yet: the asks the helper can do, and who could answer. No "next": there is nobody to tell.
    return { state: 'no-model', under: state, line, asks: offered, next: { label: '', text: '' }, setup: setupRows(installed), helper: false };
  }
  if (helper) {
    // the next rung, in the words the helper takes (the drawer's header says who is answering)
    const rung = state === 'devices' ? 'Next: ask me to “hand the show over”.'
      : state === 'cues' ? 'Next: ask me to “look for props”.'
        : '';
    return { state, line, asks: offered, setup: null, helper: true, next: { label: rung, text: '' } };
  }
  return { state, line, asks: offered, next, setup: null, helper: false };
}

export { first, folderPlan, folderOps, nextNumber, said, setupRows, numbersUntidy };
