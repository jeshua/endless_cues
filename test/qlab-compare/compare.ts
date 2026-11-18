#!/usr/bin/env node
/**
 * A QLab workspace as QLab sees it, against the same file as the importer reads it: field by field.
 * Run by hand on a Mac with QLab 5 installed (not by npm test):
 *
 *   node test/qlab-compare/compare.js <workspace> [--dump qlab.json] [--json out.json] [--quiet] [--no-cli]
 *
 * QLab's side is read by qlab-dump.jxa through QLab's AppleScript dictionary: the workspace is opened, every cue's
 * properties read, and it is closed without saving. Nothing is fired. Give it a copy of a workspace, not the original.
 * `--dump` reads QLab's side from a file written before (or writes it there, the first time).
 *
 * Ours is core/import/qlab.ts, as the app runs it. The cues are matched by place (list, then position in each group),
 * which holds because the importer keeps every cue. Printed, per workspace: the cues whose type changed or that were
 * lost, each field that differs (QLab's value, then ours), whether the import's report said anything about each such
 * cue, the report's notes on cues where nothing was found to differ, then `ec validate`, `ec outline` and `ec simulate`
 * on the show written to a temporary folder, and how long each step took.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn, spawnSync } from 'child_process';
import { importQlab } from '../../core/import/qlab';
import * as show from '../../core/show/show';
import * as Lanes from '../../core/audio/lanes';
import * as midi from '../../core/net/midi';
import { wavInfo } from '../../core/engine/waveform';

type Any = Record<string, any>;
interface Diff { field: string; qlab: unknown; ours: unknown }
interface Row { path: string; qlabType: string; ourType: string; label: string; status: 'same' | 'differs' | 'type' | 'lost' | 'by design'; diffs: Diff[]; fields: number; said: string[] }

const args = process.argv.slice(2);
const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const flag = (name: string) => args.includes(name);
const file = path.resolve(args.find((a, i) => !a.startsWith('--') && !['--dump', '--json'].includes(args[i - 1])) || '');
if (!file || !fs.existsSync(file)) { console.error('usage: node test/qlab-compare/compare.js <workspace> [--dump qlab.json] [--json out.json] [--quiet] [--no-cli]'); process.exit(2); }

const timings: Record<string, number> = {};
const memory: Record<string, number> = {};
const time = <T>(name: string, fn: () => T): T => { const t0 = process.hrtime.bigint(); const r = fn(); timings[name] = Number(process.hrtime.bigint() - t0) / 1e6; memory[name] = Math.round(process.memoryUsage().heapUsed / 1e6); return r; };

// ── QLab's side ──────────────────────────────────────────────────────────
function qlabSide(): { workspace: string; cues: Any[]; error?: string } {
  const dump = opt('--dump');
  if (dump && fs.existsSync(dump)) return JSON.parse(fs.readFileSync(dump, 'utf8'));
  const t0 = Date.now();
  const answering = spawn('osascript', ['-l', 'JavaScript', path.join(__dirname, 'qlab-dump.jxa'), '--answer'], { stdio: 'ignore' });
  let out: string;
  try { out = execFileSync('osascript', ['-l', 'JavaScript', path.join(__dirname, 'qlab-dump.jxa'), file], { encoding: 'utf8', maxBuffer: 1 << 30 }); } finally { answering.kill(); }
  timings['QLab reads it (AppleScript)'] = Date.now() - t0;
  if (dump && !JSON.parse(out).error) fs.writeFileSync(dump, out);
  return JSON.parse(out);
}

// ── what each field should be here, from what QLab says ──────────────────
const TYPE: Record<string, string> = {
  Audio: 'audio', Video: 'video', Text: 'text', Camera: 'camera', Mic: 'mic', Light: 'light', Fade: 'fade', Network: 'network', MIDI: 'midi',
  'MIDI File': 'midifile', Timecode: 'timecode', Group: 'group', Start: 'start', Stop: 'stop', Pause: 'pause', Load: 'load', Reset: 'reset',
  Devamp: 'devamp', GoTo: 'goto', Target: 'target', Arm: 'arm', Disarm: 'disarm', Wait: 'wait', Memo: 'memo', Script: 'memo',
};
// cues there is nothing of here to make them as: kept as a Memo on purpose
const BY_DESIGN = new Set(['Script']);
const near = (a: unknown, b: unknown, tol = 0.011) => Math.abs((Number(a) || 0) - (Number(b) || 0)) <= tol;
const db = (v: unknown) => (v === null || v === undefined ? 0 : Math.max(-60, Number(v)));
const realpath = (p: string) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/** QLab's level matrix as what reaches each output: { channel: { output: dB } } with every master added in. */
function qlabRouting(levels: Any, channels: number) {
  const L = (r: number, c: number) => db(levels[`${r},${c}`]);
  const out: Record<number, Record<number, number>> = {};
  for (let r = 1; r <= channels; r++) for (let c = 1; c <= 8; c++) {
    if (levels[`${r},${c}`] === undefined || L(r, c) <= -60 || L(0, c) <= -60 || L(r, 0) <= -60 || L(0, 0) <= -60) continue;
    (out[r] ||= {})[c] = Math.round((L(0, 0) + L(r, 0) + L(0, c) + L(r, c)) * 10) / 10;
  }
  return out;
}
/** Ours the same way: its own outputs, or its pan on the bus (a mono file to 1 and 2), each with its level. */
function ourRouting(c: Any, channels: number) {
  const g = Number(c.gainDb) || 0, out: Record<number, Record<number, number>> = {};
  if (g <= -60) return out;
  if (Array.isArray(c.outputs) && c.outputs.length) {
    c.outputs.forEach((row: Any, i: number) => { for (const [k, v] of Object.entries(row || {})) if (Number(v) > -60) (out[i + 1] ||= {})[Number(k)] = Math.round((g + Number(v)) * 10) / 10; });
    return out;
  }
  const [l, r] = Lanes.panGains(c.pan || 0).map((x: number) => (x > 0 ? 20 * Math.log10(x) : -60));
  const put = (ch: number, o: number, d: number) => { if (d > -60) (out[ch] ||= {})[o] = Math.round((g + d) * 10) / 10; };
  if (channels === 1) { put(1, 1, l); put(1, 2, r); } else { put(1, 1, l); put(2, 2, r); for (let ch = 3; ch <= channels; ch++) put(ch, ch, 0); }
  return out;
}

/** A QLab MIDI cue's message in the words a MIDI cue here is written in ('' when there are none for it). */
function midiWords(p: Any) {
  const ch = Number(p.channel) > 1 ? ` ch ${p.channel}` : '';
  if (p.messageType === 'voice') {
    const b1 = p.byteOne, b2 = p.byteTwo;
    return ({ note_on: `note ${b1} ${b2}${ch}`, note_off: `note off ${b1}${ch}`, program_change: `pc ${b1}${ch}`, control_change: `cc ${b1} ${b2}${ch}`,
      key_pressure: `key pressure ${b1} ${b2}${ch}`, channel_pressure: `pressure ${b1}${ch}`, pitch_bend: `bend ${p.byteCombo}${ch}` } as Any)[p.command] || '';
  }
  if (p.messageType === 'msc') {
    // the bytes MSC puts on the wire for these fields (compared as bytes: the words here are one way of many to say them)
    const ascii = (v: unknown) => [...String(v || '')].map((x) => x.charCodeAt(0) & 0x7f);
    const parts = [p.q_number, p.q_list, p.q_path].map((x) => String(x || '')); while (parts.length && !parts[parts.length - 1]) parts.pop();
    const cue = parts.flatMap((x, i) => [...(i ? [0] : []), ...ascii(x)]);
    const b14 = (n: unknown) => [Number(n) & 0x7f, (Number(n) >> 7) & 0x7f];
    const cmd = Number(p.commandNumber);
    const data = cmd === 6 ? [...b14(p.controlNumber), ...b14(p.controlValue)] : cmd === 7 ? [Number(p.macro) & 0x7f] : cmd === 4 ? [p.mscHours, p.mscMinutes, p.mscSeconds, p.mscFrames, p.mscSubframes].map((x) => Number(x) || 0).concat(cue) : [1, 2, 3, 5, 11].includes(cmd) ? cue : [];
    return [0xf0, 0x7f, Number(p.deviceid) & 0x7f, 2, Number(p.commandFormat), cmd, ...data, 0xf7].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  }
  if (p.messageType === 'sysex') { const hex = String(p.sysexMessage || '').replace(/[^0-9a-f]/gi, '').toUpperCase(); return hex ? `F0 ${(hex.match(/../g) || []).join(' ')} F7`.replace(/^F0 F0/, 'F0').replace(/F7 F7$/, 'F7') : '(empty sysex)'; }
  return '';
}

const FPS: Any = { fps_24: '24', fps_25: '25', fps_30_drop: '29.97df', fps_30_non_drop: '30' };
const MODE: Any = { timeline: 'timeline', start_first_and_enter: 'enter', start_first: 'first', start_random: 'random', playlist: 'playlist', cue_list: 'timeline' };
const SECOND: Any = { 0: 'nothing', 1: 'panic', 2: 'stop', 3: 'stop', 4: 'restart', 5: 'devamp' };
const SCOPE: Any = { 1: 'peers', 2: 'list', 3: 'all' };
const pad2 = (n: unknown) => String(Number(n) || 0).padStart(2, '0');

/** Each field QLab has for this cue, and ours: [field, QLab's, ours, same?]. */
function fields(q: Any, c: Any, ourPath: (uid: string) => string | null, idPath: (id: string) => string | null): Diff[] & { n?: number } {
  const p = q.props, t = p.qType, diffs: Diff[] = [];
  let n = 0;
  const cmp = (field: string, a: unknown, b: unknown, same?: boolean) => { n++; const eq = same ?? (typeof a === 'number' || typeof b === 'number' ? near(a, b) : (a ?? '') === (b ?? '')); if (!eq) diffs.push({ field, qlab: a, ours: b }); };
  const list = t === 'Cue List' || t === 'Cart';
  // (a list has no number here: by design, not compared)
  if (!list) cmp('number', p.name || '', c.number || '');
  if (!list) cmp('name', p.qName || '', c.name || '', !p.qName ? true : undefined);
  if (p.notes !== undefined) cmp('notes', p.notes || '', String(c.notes || '').slice(0, String(p.notes || '').length));
  if (list) return Object.assign(diffs, { n });
  cmp('colour', p.qColor || 'none', c.color || 'none', (p.qColor || 'none') === 'none' ? !c.color : !!c.color);
  if (p.useQColor2 && p.qColor2 && p.qColor2 !== 'none') cmp('colour once played', p.qColor2, c.color2 || 'none', !!c.color2);
  cmp('flagged', !!p.flagged, !!c.flagged);
  cmp('armed', p.armed !== false, c.armed !== false);
  cmp('pre-wait', p.preWait || 0, c.preWait || 0);
  // (a Start First and Enter group says auto-continue to AppleScript whatever it was saved with: its mode does that)
  if (!(t === 'Group' && p.mode === 'start_first_and_enter')) cmp('continue', ({ do_not_continue: 'none', auto_continue: 'auto-continue', auto_follow: 'auto-follow' } as Any)[p.continueMode] || 'none', c.continue || 'none');
  // (QLab reports a Wait cue's post-wait as its duration, whatever was saved)
  if (p.continueMode !== 'auto_follow' && t !== 'Wait') cmp('post-wait', p.postWait || 0, c.postWait || 0);
  if (q.cueTarget !== undefined && !['Memo', 'Wait', 'Script'].includes(t) && TYPE[t] !== 'memo') cmp('target', ourPath(q.cueTarget) || '(none)', (c.target && idPath(c.target)) || '(none)');
  if (p.hotkeyTrigger === 'enabled') cmp('hotkey trigger', 'on (key not readable here)', c.hotkey || '(none)', true);
  if (p.midiTrigger === 'enabled') {
    const kind = ({ note_on: 'note', control_change: 'cc', program_change: 'pc' } as Any)[p.midiCommand];
    // (QLab's display of the second byte: "any", ">64", "<10", or the one value it must be)
    const v = /^\d+$/.test(String(p.midiByteTwoString)) && kind !== 'pc' && !(kind === 'note' && Number(p.midiByteTwoString) === 0) ? ` ${p.midiByteTwoString}` : '';
    cmp('MIDI trigger', kind ? `${kind} ${p.midiByteOne}${v}${Number(p.midiTriggerChannel) > 0 ? ` ch ${p.midiTriggerChannel}` : ''}` : `(${p.midiCommand})`, c.midiTrigger || '(none)');
  }
  if (p.wallClockTrigger === 'enabled') cmp('clock trigger', `${pad2(p.wallClockHours)}:${pad2(p.wallClockMinutes)}${p.wallClockSeconds ? `:${pad2(p.wallClockSeconds)}` : ''}`, String(c.clockTrigger || '(none)').split(' ')[0]);
  if (p.timecodeTrigger === 'enabled') cmp('timecode trigger', `${pad2(p.timecodeHours)}:${pad2(p.timecodeMinutes)}:${pad2(p.timecodeSeconds)}:${pad2(p.timecodeFrames)}`, String(c.timecodeTrigger || '(none)').replace(/;/g, ':'));
  if (p.duckOthers === 'enabled') { cmp('duck others', Math.round(Number(p.duckLevel) * 10) / 10, c.duckOthers || 0, near(p.duckLevel, c.duckOthers, 0.11)); cmp('duck time', p.duckTime, c.duckTime ?? 1); }
  if (Number(p.secondTriggerAction) >= 0 && SECOND[p.secondTriggerAction]) cmp('second trigger', p.secondTriggerAction, c.secondTrigger || 'restart', SECOND[p.secondTriggerAction] === c.secondTrigger);
  if (p.secondTriggerOnRelease === 'enabled') cmp('second trigger on release', true, !!c.secondOnRelease);
  if (p.autoload) cmp('auto-load', true, !!c.autoLoad);
  if (Number(p.fadeAndStopOthers) > 0) { cmp('fade and stop others', p.fadeAndStopOthersTime, c.fadeOthers || 0); cmp('fade and stop others: which', SCOPE[p.fadeAndStopOthers], c.fadeOthersScope || 'all'); }

  const lv = q.levels || {};
  if (['Audio', 'Video'].includes(t)) {
    // (a file QLab cannot find either is "(none)" to it: the same, when it is not on this computer for us too)
    cmp('file', q.fileTarget ? realpath(q.fileTarget) : '(none)', c.file ? realpath(c.file) : '(none)', !q.fileTarget && (!c.file || !fs.existsSync(c.file)) ? true : undefined);
    // (no End at here is the file's own end: the same as QLab's when that is where QLab's is)
    const info = q.fileTarget && /\.wav$/i.test(q.fileTarget) ? wavInfo(q.fileTarget) : null;
    const len = info ? info.seconds : null;
    cmp('start at', p.startTime || 0, c.from || 0);
    if (Number(p.endTime) > 0) cmp('end at', p.endTime, c.cutAt ?? '(the file’s end)', c.cutAt === undefined ? len === null || Number(p.endTime) >= len - 0.02 : near(p.endTime, c.cutAt));
    cmp('loop', !!p.infiniteLoop, !!c.loop);
    if (!p.infiniteLoop && !(p.sliceMarkers || []).length) cmp('play count', p.playCount || 1, c.plays || 1);
    if (t === 'Audio') cmp('rate', p.rate || 1, c.rate || 1);
    if (t === 'Audio' && Math.abs((p.rate || 1) - 1) > 0.001) cmp('keep pitch', p.preservePitch === 'enabled', !!c.preservePitch);
    if ((p.sliceMarkers || []).length) cmp('slices', (p.sliceMarkers || []).map((s: Any) => `${s.time}×${s.playcount}`).join(' '), (c.markers || []).map((m: Any) => m.at).join(' ') + ' | ' + (c.loops || []).map((l: Any) => `${l.start}-${l.end}${l.hold ? '∞' : '×' + l.count}`).join(' '),
      (c.markers || []).length === p.sliceMarkers.length && p.sliceMarkers.every((s: Any, i: number) => near(s.time, c.markers[i].at)));
    if (p.integratedFade === 'enabled') cmp('integrated fade', 'on', c.envelope ? 'envelope' : '(none)', !!c.envelope);
    // (levels are kept to a tenth of a dB)
    cmp('level', db(lv['0,0']), c.gainDb || 0, c.pan !== undefined || c.outputs ? true : near(db(lv['0,0']), c.gainDb || 0, 0.06));
    const chans = Number(p.audioInputChannels) || 2;
    const a = qlabRouting(lv, chans), b = ourRouting(c, chans);
    // (QLab reads a matrix only for a file it has found: with none, it has no crosspoints to compare)
    if (q.fileTarget) cmp('routing', JSON.stringify(a), JSON.stringify(b), JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort()) && Object.keys(a).every((ch) => JSON.stringify(Object.keys(a[+ch]).sort()) === JSON.stringify(Object.keys(b[+ch]).sort()) && Object.keys(a[+ch]).every((o) => near(a[+ch][+o], b[+ch][+o], 0.6))));
  }
  if (['Video', 'Text', 'Camera'].includes(t)) {
    cmp('opacity', Math.round((p.opacity ?? 1) * 1000) / 10, c.opacity ?? 100, near((p.opacity ?? 1) * 100, c.opacity ?? 100, 0.6));
    cmp('x', p.translationX || 0, c.x || 0); cmp('y', p.translationY || 0, c.y || 0);
    cmp('scale', p.scaleX ?? 1, c.scale ?? 1);
    if (Math.abs((p.scaleX ?? 1) - (p.scaleY ?? 1)) > 0.001) cmp('scale down', p.scaleY, c.scale ?? 1);
    cmp('layer', p.layer ?? 1, c.layer ?? 1);
  }
  if (t === 'Video') { cmp('hold at end', !!p.holdAtEnd, !!c.holdEnd); if (Math.abs((p.rate || 1) - 1) > 0.001) cmp('rate', p.rate, c.rate || 1); }
  if (t === 'Text') cmp('text', p.text || '', c.text || '');
  if (t === 'Mic') cmp('level', db(lv['0,0']), c.gainDb || 0);
  if (t === 'Fade') {
    cmp('duration', p.duration || 0, c.duration || 0);
    const faded = Object.entries(lv).filter(([, v]) => Number(v) > -60).map(([k]) => k);
    const audio = !q.cueTarget || ['Audio', 'Mic', 'Video', 'Group'].includes(q.targetType || '');
    if (faded.includes('0,0') || !p.doOpacity) cmp('to level', db(lv['0,0']), c.db ?? -60, near(db(lv['0,0']), c.db ?? -60, 0.06));
    cmp('relative', p.audioFadeMode === 'relative', !!c.relative);
    cmp('stop target when done', !!p.stopTargetWhenDone, !!c.stopTarget);
    const others = faded.filter((k) => k !== '0,0');
    if (others.length) cmp('other levels faded', others.map((k) => `${k}:${Math.round(db(lv[k]))}`).join(' '), '(main level only)', false);
    if (p.doOpacity) cmp('to opacity', Math.round(p.opacity * 1000) / 10, c.opacity ?? '(none)');
    if (p.doTranslation) { cmp('to x', p.translationX, c.x ?? '(none)'); cmp('to y', p.translationY, c.y ?? '(none)'); }
    if (p.doScale) cmp('to scale', p.scaleX, c.scale ?? '(none)');
    if (p.doRotation) cmp('to rotation', p.rotation, c.rotation ?? '(none)');
    void audio;
  }
  if (t === 'Network') {
    // (a cue for a device's command has no custom message: QLab's own name for the cue ends with what it sends)
    const sent = p.customMessage || (/ - (\/\S.*)$/.exec(String(p.qDefaultName || '')) || [])[1] || (p.parameterValues || []).join(' ');
    cmp('message', sent, c.message || (c.type === 'memo' ? '(memo)' : ''));
    if (Number(p.fadeType) === 1) { cmp('fade from', p.fadeFrom, c.fadeFrom ?? '(none)'); cmp('fade to', p.fadeTo, c.fadeTo ?? '(none)'); cmp('fade time', p.duration, c.duration ?? '(none)'); }
  }
  if (t === 'MIDI') {
    const want = midiWords(p);
    let ours = c.midi || '(memo)';
    if (p.messageType === 'msc' && c.midi) { try { ours = midi.encode(midi.parseText(c.midi)).map((b: number) => b.toString(16).toUpperCase().padStart(2, '0')).join(' '); } catch (e) { ours = `${c.midi} (does not encode: ${(e as Error).message})`; } }
    cmp('message', want, ours, want.startsWith('(') ? !c.midi : undefined);
    if (p.fade === 'enabled' && p.messageType === 'voice') { cmp('fade to', p.endValue, c.fadeTo ?? '(none)'); cmp('fade time', p.duration, c.duration ?? '(none)'); }
  }
  if (t === 'MIDI File') { cmp('file', q.fileTarget ? realpath(q.fileTarget) : '(none)', c.file ? realpath(c.file) : '(none)'); cmp('rate', p.rate || 1, c.rate || 1); }
  if (t === 'Timecode') {
    cmp('send as', p.type, c.output || 'mtc');
    cmp('frame rate', FPS[p.smpteFormat] || p.smpteFormat, c.fps || '30');
    if (p.type === 'ltc') cmp('LTC output', p.outputChannel, c.channel || 1);
    cmp('start at', String(p.qDefaultName || '').replace(/;/g, ':').replace(/^(\d):/, '0$1:'), String(c.timecode || '').replace(/;/g, ':'));
    if (Number(p.duration) > 0) cmp('run for', p.duration, c.duration || 0);
  }
  if (t === 'Light') { cmp('commands', p.commandText || '', c.levels || ''); cmp('fade time', p.duration || 0, c.duration ?? 3); }
  if (t === 'Group') {
    cmp('mode', MODE[p.mode] || p.mode, c.mode || 'timeline');
    if (p.mode === 'playlist') { cmp('shuffle', !!p.playlistShuffle, !!c.shuffle); cmp('loop', !!p.playlistLoop, !!c.repeat); cmp('crossfade', p.playlistCrossfade ? p.playlistCrossfadeDuration : 0, c.crossfade || 0); }
  }
  if (t === 'Load') cmp('load to', p.loadTime || 0, c.at || 0);
  if (t === 'Wait') cmp('duration', p.duration || 0, c.duration || 0);
  if (t === 'Devamp') { cmp('then start next', !!p.startNextCueWhenSliceEnds, !!c.startNext); }
  if (t === 'Target') cmp('new target', p.assignedNumber || '(none)', c.to ? idPath(c.to) : '(none)', !p.assignedNumber ? !c.to : !!c.to);
  // (QLab 5 rewrites a QLab 4 script's "com.figure53.QLab.4" as it opens it)
  if (t === 'Script') {
    const plain = (x: unknown) => String(x || '').replace(/\r\n?/g, '\n').replace(/com\.figure53\.QLab\.4/g, 'com.figure53.QLab.5').replace(/[ \t]+$/gm, '').trim();
    cmp('script', plain(p.scriptSource), plain(c.notes).includes(plain(p.scriptSource)) ? plain(p.scriptSource) : '(not kept)');
  }
  return Object.assign(diffs, { n });
}

// ── run ──────────────────────────────────────────────────────────────────
const buf = fs.readFileSync(file);
const imp = time('import', () => importQlab(buf, { file }));
const { doc, report } = imp;
const q = qlabSide();
if (q.error) { console.error(`QLab: ${q.error}`); process.exit(1); }

// our cues by place: "0.3.1" is list 0, its 4th cue, that one's 2nd child
const ours = new Map<string, Any>(), placeOf = new Map<string, string>();
doc.lists.forEach((l, i) => {
  ours.set(String(i), { ...l, type: l.cart ? 'cart' : 'list' });
  const walk = (cues: Any[], at: string) => cues.forEach((c, k) => { const p = `${at}.${k}`; ours.set(p, c); placeOf.set(c.id, p); if (c.children) walk(c.children, p); });
  walk(l.cues, String(i));
});
// A shuffled playlist shows QLab's shuffled order, and a cart its buttons' order, not the file's: their cues are matched
// to ours by number and name (each subtree's places renamed to the file's order).
for (const g of q.cues.filter((c) => (c.props.qType === 'Group' && c.props.playlistShuffle) || c.props.qType === 'Cart')) {
  const at = g.path.join('.'), mine = ours.get(at), theirs = mine && (mine.children || mine.cues);
  if (!theirs) continue;
  const key = (n: unknown, m: unknown) => `${n || ''}|${String(m || '').replace(/^\([\w ]+ cue\)$/, '')}`;      // (a nameless cue kept as a Memo is named for its kind)
  const free = theirs.map((c: Any, i: number) => ({ i, k: key(c.number, c.name) }));
  const kids = q.cues.filter((c) => c.path.length === g.path.length + 1 && c.path.slice(0, -1).join('.') === at);
  const to = new Map<number, number>();
  for (const k of kids) { const hit = free.findIndex((f: Any) => f.k === key(k.props.name, k.props.qName)); if (hit >= 0) { to.set(k.path[k.path.length - 1], free[hit].i); free.splice(hit, 1); } }
  const depth = g.path.length;
  for (const c of q.cues) if (c.path.length > depth && c.path.slice(0, depth).join('.') === at && to.has(c.path[depth])) c.path = [...c.path.slice(0, depth), to.get(c.path[depth]), ...c.path.slice(depth + 1)];
}
const qByPlace = new Map<string, Any>(), qPlaceOfUid = new Map<string, string>();
for (const c of q.cues) { const p = c.path.join('.'); qByPlace.set(p, c); qPlaceOfUid.set(c.props.id, p); }
for (const c of q.cues) if (c.cueTarget) c.targetType = (qByPlace.get(qPlaceOfUid.get(c.cueTarget) || '') || { props: {} }).props.qType;

const saidOf = new Map<string, string[]>();
for (const i of report.issues) if (i.id) { if (!saidOf.has(i.id)) saidOf.set(i.id, []); saidOf.get(i.id)!.push(i.why); }

const rows: Row[] = [];
for (const qc of q.cues) {
  const place = qc.path.join('.'), c = ours.get(place), t = qc.props.qType;
  const label = `${qc.props.name ? qc.props.name + ' ' : ''}${qc.props.qName || t}`;
  const list = t === 'Cue List' || t === 'Cart';
  const want = list ? (t === 'Cart' ? 'cart' : 'list') : TYPE[t] || 'memo';
  if (!c) { rows.push({ path: place, qlabType: t, ourType: '(none)', label, status: 'lost', diffs: [], fields: 0, said: [] }); continue; }
  const said = [...((c.id && saidOf.get(c.id)) || []), ...(c.file && report.missing.includes(c.file) ? ['(its file is in the report’s list of missing files)'] : [])];
  const d = fields(qc, c, (uid) => qPlaceOfUid.get(uid) || null, (id) => placeOf.get(id) || null);
  const status: Row['status'] = BY_DESIGN.has(t) && c.type === 'memo' ? 'by design' : c.type !== want ? 'type' : d.length ? 'differs' : 'same';
  rows.push({ path: place, qlabType: t, ourType: c.type, label, status, diffs: d, fields: d.n || 0, said });
}
// anything of ours QLab did not have (it should be nothing)
const extra = [...ours.keys()].filter((p) => !qByPlace.has(p));

// ── the show written, opened, checked and simulated, as the app and ec do ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qlab-compare-'));
const dir = path.join(tmp, 'Imported.ecshow');
fs.mkdirSync(dir);
const text = time('save (stringify + write)', () => { const s = show.stringify(doc); fs.writeFileSync(path.join(dir, 'show.json'), s); return s; });
const opened = time('open (parse + normalise)', () => show.normalise(JSON.parse(text)));
time('checks (show.problems)', () => show.problems(opened.doc));
time('check the show (core/show/check)', () => { const check = require('../../core/show/check') as typeof import('../../core/show/check'); const tr = require('../../core/show/triggers') as Any; const rowsT = tr.triggersOf(opened.doc); return check.checkShow(opened.doc, { problems: show.problems(opened.doc), triggers: rowsT }); });
time('engine doc (toEngineDoc)', () => show.toEngineDoc(opened.doc));
const sim = time('simulate (every GO from the top)', () => { const { simulate } = require('../../core/engine/dry-run') as typeof import('../../core/engine/dry-run'); let cues = 0; show.walk(opened.doc, () => cues++); return simulate(opened.doc, { gos: Math.min(cues, 400), maxEvents: 20000 }); });
const cli: Any = {};
if (!flag('--no-cli')) {
  const ec = path.join(__dirname, '..', '..', 'bin', 'ec.js');
  for (const cmd of ['validate', 'outline', 'simulate']) {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [ec, cmd, dir], { encoding: 'utf8', maxBuffer: 1 << 28 });
    const lines = (r.stdout || '').trim().split('\n');
    cli[cmd] = { code: r.status, ms: Date.now() - t0, lines: lines.length, tail: lines.slice(-1)[0], errors: (r.stderr || '').trim().split('\n').filter(Boolean).slice(0, 3),
      broken: cmd === 'validate' ? lines.filter((l) => l.startsWith('BROKEN')).map((l) => l.replace(/\s+/g, ' ')) : undefined };
  }
}
fs.rmSync(tmp, { recursive: true, force: true });

// ── print ────────────────────────────────────────────────────────────────
const by: Record<string, { cues: number; same: number; differs: number; type: number; lost: number; design: number; fields: number; fieldDiffs: number }> = {};
for (const r of rows) {
  const b = by[r.qlabType] ||= { cues: 0, same: 0, differs: 0, type: 0, lost: 0, design: 0, fields: 0, fieldDiffs: 0 };
  b.cues++; b.fields += r.fields; b.fieldDiffs += r.diffs.length;
  if (r.status === 'same') b.same++; else if (r.status === 'differs') b.differs++; else if (r.status === 'type') b.type++; else if (r.status === 'lost') b.lost++; else b.design++;
}
const silent = rows.filter((r) => (r.status === 'differs' || r.status === 'type') && !r.said.length);
const saidNothingDiffered = rows.filter((r) => r.status === 'same' && r.said.length);
const result = { workspace: path.basename(file), qlab: q.workspace, version: report.qlabVersion, counts: report.counts, rows, extra, by, silent: silent.map((r) => r.path), saidNothingDiffered: saidNothingDiffered.map((r) => ({ path: r.path, label: r.label, said: r.said })), summary: report.summary, missing: report.missing.length, timings, memory, cli, simulate: { error: (sim as Any).error || null } };
if (opt('--json')) fs.writeFileSync(opt('--json')!, JSON.stringify(result, null, 1));

const quiet = flag('--quiet');
console.log(`${path.basename(file)} (QLab ${report.qlabVersion || '?'}): QLab has ${q.cues.length} cues and lists, the import ${report.counts.cues} cues in ${report.counts.lists} lists${extra.length ? `, and ${extra.length} QLab does not have` : ''}`);
console.log('\nBy cue type          cues  same  differs  type  lost  memo   fields  differ');
for (const [t, b] of Object.entries(by).sort((a, z) => z[1].cues - a[1].cues)) console.log(`  ${t.padEnd(18)} ${String(b.cues).padStart(5)} ${String(b.same).padStart(5)} ${String(b.differs).padStart(8)} ${String(b.type).padStart(5)} ${String(b.lost).padStart(5)} ${String(b.design).padStart(5)} ${String(b.fields).padStart(8)} ${String(b.fieldDiffs).padStart(7)}`);
const fieldCount: Record<string, number> = {};
for (const r of rows) for (const d of r.diffs) fieldCount[`${r.qlabType}: ${d.field}`] = (fieldCount[`${r.qlabType}: ${d.field}`] || 0) + 1;
console.log('\nFields that differ, most first');
for (const [k, v] of Object.entries(fieldCount).sort((a, z) => z[1] - a[1])) console.log(`  ${String(v).padStart(5)}  ${k}`);
if (!quiet) {
  console.log('\nCues that differ (QLab → ours)');
  for (const r of rows.filter((x) => x.status !== 'same' && x.status !== 'by design')) {
    console.log(`  ${r.path} ${r.qlabType} “${r.label}”${r.status === 'type' ? ` became ${r.ourType}` : r.status === 'lost' ? ' LOST' : ''}${r.said.length ? '' : '   [the report said nothing]'}`);
    for (const d of r.diffs) console.log(`      ${d.field}: ${JSON.stringify(d.qlab)} → ${JSON.stringify(d.ours)}`);
  }
  if (saidNothingDiffered.length) { console.log('\nThe report spoke of these, and nothing compared here differed (advice, or a false alarm?)'); for (const r of saidNothingDiffered) console.log(`  ${r.path} “${r.label}”: ${r.said.join(' / ')}`); }
}
console.log(`\nSilent differences: ${silent.length} of ${rows.filter((r) => r.status === 'differs' || r.status === 'type').length} cues that differ had no word in the report`);
console.log('\nThe report’s summary');
for (const l of report.summary) console.log(`  ${l}`);
console.log('\nTimes (ms) and heap (MB)');
for (const [k, v] of Object.entries(timings)) console.log(`  ${k.padEnd(36)} ${v.toFixed(1).padStart(9)}${memory[k] ? `  ${memory[k]} MB` : ''}`);
for (const [k, v] of Object.entries(cli)) console.log(`  ec ${k.padEnd(33)} ${String(v.ms).padStart(9)}  exit ${v.code}: ${v.tail}${v.errors.length ? `  STDERR ${v.errors.join(' | ')}` : ''}`);
if (cli.validate && cli.validate.broken.length) { console.log('\nec validate: broken'); for (const l of cli.validate.broken.slice(0, quiet ? 5 : 50)) console.log(`  ${l}`); }
