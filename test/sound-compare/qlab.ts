/**
 * The sound comparison, QLab's side (docs/internal/sound-compare.md): each scene of scenes.ts built as a workspace in
 * QLab 5 by AppleScript, then played there by OSC while BlackHole's input is recorded. Run by hand on a Mac with QLab
 * open and BlackHole 2ch installed, never by `npm test`; always inside on-blackhole.sh, which silences the speakers
 * and makes BlackHole the system output (QLab's default patch plays to the system output):
 *
 *   node test/sound-compare/qlab.js build --dir DIR --empty EMPTY.qlab5 [scene…]
 *       the signals into DIR/media, and DIR/workspaces/<scene>.qlab5 for each scene: a copy of an empty workspace
 *       QLab saved, opened, built, saved and closed
 *   test/sound-compare/on-blackhole.sh node test/sound-compare/qlab.js play --dir DIR [scene…]
 *       each workspace opened, its steps sent at their moments (OSC to QLab on 53000), BlackHole recorded to
 *       DIR/rec/<scene>/qlab.wav (with .blocks.csv) and each step's wall-clock moment to qlab.json; then closed
 *
 * Then ec.ts plays the same workspaces through Endless Cues, and analyse.ts compares the recordings.
 * The empty workspace's OSC passcode is given by --passcode (QLab's new workspaces have one; it is in the workspace's
 * Network settings).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dgram from 'dgram';
import { execFileSync, spawn } from 'child_process';
import { SCENES } from './scenes';
import type { Scene, Step } from './scenes';
import { writeAll } from './signals';
import { encode, decode } from '../../core/net/osc';

const ROOT = path.join(__dirname, '..', '..');
export const LISTEN = path.join(ROOT, 'native', 'target', 'release', 'ec-audio');
export const BLACKHOLE = 'BlackHole 2ch';
const args = process.argv.slice(2);
const arg = (name: string, d = '') => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const QLAB = 'com.figure53.QLab.5';

const jxa = (code: string) => execFileSync('osascript', ['-l', 'JavaScript', '-e', code], { encoding: 'utf8' }).trim();
const names = (): string[] => JSON.parse(jxa(`JSON.stringify(Application('${QLAB}').workspaces.name())`));

/** A workspace opened in QLab (without bringing it to the front): its name there. */
export async function openWorkspace(file: string) {
  const before = names();
  execFileSync('open', ['-g', '-a', '/Applications/QLab.app', file]);
  for (let i = 0; i < 120; i++) {
    await sleep(250);
    const fresh = names().find((n) => !before.includes(n));
    if (fresh) { await sleep(1500); return fresh; }
  }
  throw new Error(`QLab did not open ${file}`);
}
export function closeWorkspace(name: string) {
  jxa(`Application('${QLAB}').workspaces.byName(${JSON.stringify(name)}).close({ saving: 'no' })`);
}

/** `ec-audio listen` recording BlackHole's input to `file` until stopped. */
export function record(file: string) {
  const p = spawn(LISTEN, ['listen', '--input', BLACKHOLE, '--db', '-30', '--record', file], { stdio: ['pipe', 'pipe', 'inherit'] });
  let ready: () => void;
  const listening = new Promise<void>((r) => { ready = r; });
  p.stdout.on('data', (b: Buffer) => { if (b.toString().includes('"listening"')) ready(); });
  const done = new Promise<void>((r) => p.on('exit', () => r()));
  return { listening, stop: async () => { p.stdin.end(); await done; } };
}

/** The show app is not running (the comparison never plays beside it). */
export function showAppNotRunning() {
  let out = '';
  // (a program whose path is inside the app: not a shell whose command line only mentions it)
  try { out = execFileSync('pgrep', ['-fl', '^/[^-]*Endless Cues\\.app/Contents/MacOS/'], { encoding: 'utf8' }).trim(); } catch { /* none */ }
  if (out) { console.error(`The show's app is running:\n${out}\nNot playing anything.`); process.exit(3); }
}
/** BlackHole is the system output (on-blackhole.sh has run): QLab's default patch plays there, not on the speakers. */
export function onBlackHole() {
  const tool = process.env.EC_DEFAULT_OUTPUT || path.join(process.env.TMPDIR || '/tmp', 'ec-default-output');
  const now = JSON.parse(execFileSync(tool, { encoding: 'utf8' }));
  if (now.name !== BLACKHOLE) { console.error(`The system output is ${now.name}: run this inside test/sound-compare/on-blackhole.sh`); process.exit(3); }
}

async function build(dir: string, empty: string, scenes: Scene[]) {
  const media = path.join(dir, 'media');
  fs.mkdirSync(path.join(dir, 'workspaces'), { recursive: true });
  const { applescript } = require('./scenes') as typeof import('./scenes');
  for (const s of scenes) {
    writeAll(media, Object.fromEntries(Object.entries(s.files).map(([k, v]) => [`${s.id}-${k}`, v])));
    const file = path.join(dir, 'workspaces', `${s.id}.qlab5`);
    fs.copyFileSync(empty, file);
    const ws = await openWorkspace(file);
    const script = path.join(dir, 'workspaces', `${s.id}.applescript`);
    fs.writeFileSync(script, applescript(s, ws, (f) => path.join(media, `${s.id}-${f}.wav`)));
    const out = execFileSync('osascript', [script], { encoding: 'utf8' }).trim();
    await sleep(500);
    closeWorkspace(ws);
    rewrite(file, s);
    console.log(`${s.id}: ${out}`);
  }
}

/**
 * What AppleScript cannot set, written into a saved workspace: a Fade cue's curve shapes, and an Audio cue's trim on
 * its main level (QLab 4 kept one beside each level). The archive's `cueLists` (an archive of its own) is converted
 * to XML by plutil, the objects changed, and it is converted back.
 */
function rewrite(file: string, s: Scene) {
  const { unarchive } = require('../../core/import/plist') as typeof import('../../core/import/plist');
  const all = s.cues.flatMap((c) => [c, ...(c.children || [])]);
  const shapes = new Map(all.filter((c) => c.shape).map((c) => [c.n, c.shape!]));
  const trims = new Map(all.filter((c) => c.trim !== undefined).map((c) => [c.n, c.trim!]));
  if (!shapes.size && !trims.size) return;
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'ec-rewrite-'));
  const outer = path.join(tmp, 'outer.xml');
  execFileSync('plutil', ['-convert', 'xml1', file, '-o', outer]);
  let xml = fs.readFileSync(outer, 'utf8');
  const root = unarchive(fs.readFileSync(file)) as Record<string, unknown>;
  const inner = root.cueLists as Buffer;
  const b64 = inner.toString('base64');
  const innerFile = path.join(tmp, 'inner.plist');
  fs.writeFileSync(innerFile, inner);
  execFileSync('plutil', ['-convert', 'xml1', innerFile]);
  const ix = fs.readFileSync(innerFile, 'utf8');
  // (the archive's objects, in order; each names its class by a UID, read from the class table)
  const objects = splitObjects(ix);
  const classOf = (o: string) => { const m = /<key>\$class<\/key>\s*<dict>\s*<key>CF\$UID<\/key>\s*<integer>(\d+)<\/integer>/.exec(o); return m ? Number(m[1]) : -1; };
  const nameOf = (uid: number) => { const m = /<key>\$classname<\/key>\s*<string>([^<]+)<\/string>/.exec(objects[uid] ? objects[uid].text : ''); return m ? m[1] : ''; };
  const ref = (o: string, key: string) => { const m = new RegExp(`<key>${key}</key>\\s*<dict>\\s*<key>CF\\$UID</key>\\s*<integer>(\\d+)</integer>`).exec(o); return m ? Number(m[1]) : -1; };
  const int = (o: string, key: string) => { const m = new RegExp(`<key>${key}</key>\\s*<integer>(-?\\d+)</integer>`).exec(o); return m ? Number(m[1]) : NaN; };
  // (a string, or an NSMutableString holding one)
  const str = (uid: number) => { const t = objects[uid] ? objects[uid].text : ''; const m = /^\s*<string>([^<]*)<\/string>\s*$/.exec(t) || /<key>NS\.string<\/key>\s*<string>([^<]*)<\/string>/.exec(t); return m ? m[1] : ''; };
  const edits = new Map<number, string>();          // object index → its new text
  for (const o of objects) {
    const cls = nameOf(classOf(o.text)), n = str(ref(o.text, 'number'));
    if (cls === 'FadeCue' && shapes.has(n)) {
      const shape = shapes.get(n)!;
      const fade = objects[ref(o.text, 'fade')], sh = fade && objects[ref(fade.text, 'shapes')];
      for (const k of ['upShape', 'downShape']) {
        const at = sh ? ref(sh.text, k) : -1;
        if (at < 0) continue;
        let t = objects[at].text.replace(/(<key>type<\/key>\s*<integer>)\d+(<\/integer>)/, `$1${shape.type}$2`);
        if (shape.p !== undefined) t = t.replace(/(<key>curveParameter<\/key>\s*<)(integer|real)>[^<]+<\/(integer|real)>/, `$1real>${shape.p}</real>`);
        edits.set(at, t);
      }
    }
    if (cls === 'AudioCue' && trims.has(n)) {
      const levels = objects[ref(o.text, 'levels')], entries = levels && objects[ref(levels.text, 'entries')];
      const uids = entries ? [...(/<key>NS\.objects<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(entries.text) || ['', ''])[1].matchAll(/<integer>(\d+)<\/integer>/g)].map((x) => Number(x[1])) : [];
      const main = uids.find((u) => int(objects[u].text, 'row') === 0 && int(objects[u].text, 'column') === 0);
      if (main === undefined) throw new Error(`${s.id}: cue ${n} has no main level to trim`);
      edits.set(main, objects[main].text.replace(/(<key>trimLevel<\/key>\s*<)(integer|real)>[^<]+<\/(integer|real)>/, `$1real>${10 ** (trims.get(n)! / 20)}</real>`));
    }
  }
  if (edits.size < shapes.size * 2 + trims.size) throw new Error(`${s.id}: ${edits.size} objects found to change, of ${shapes.size * 2 + trims.size}`);
  let out = '', from = 0;
  objects.forEach((o, i) => { if (edits.has(i)) { out += ix.slice(from, o.at) + edits.get(i); from = o.at + o.text.length; } });
  out += ix.slice(from);
  fs.writeFileSync(innerFile, out);
  execFileSync('plutil', ['-convert', 'binary1', innerFile]);
  const nb64 = fs.readFileSync(innerFile).toString('base64');
  // (plutil writes <data> wrapped over lines: the blob is found by its bytes, whitespace aside)
  const dataRe = /<data>([\s\S]*?)<\/data>/g;
  let m: RegExpExecArray | null, done = false;
  while ((m = dataRe.exec(xml))) {
    if (m[1].replace(/\s+/g, '') === b64) { xml = xml.slice(0, m.index) + `<data>${nb64}</data>` + xml.slice(m.index + m[0].length); done = true; break; }
  }
  if (!done) throw new Error(`${s.id}: the cue lists' archive was not found in the workspace`);
  fs.writeFileSync(outer, xml);
  execFileSync('plutil', ['-convert', 'binary1', outer, '-o', file]);
  fs.rmSync(tmp, { recursive: true, force: true });
}
/** The top-level elements of an archive's $objects array in plutil's XML, each with where it starts. */
function splitObjects(xml: string) {
  const start = xml.indexOf('<key>$objects</key>');
  let i = xml.indexOf('<array>', start) + '<array>'.length;
  const out: { at: number; text: string }[] = [];
  const end = /<\/array>/y;
  for (;;) {
    while (/\s/.test(xml[i])) i++;
    end.lastIndex = i;
    if (end.test(xml)) break;
    const tag = /^<(\w+)(\/?)>/.exec(xml.slice(i, i + 40))!;
    let j: number;
    if (tag[2]) j = i + tag[0].length;
    else {
      // (the element closes at its matching tag: dicts and arrays nest)
      let depth = 0; const re = new RegExp(`<(/?)(${tag[1]})(/?)>`, 'g'); re.lastIndex = i;
      let mm: RegExpExecArray | null; j = i;
      while ((mm = re.exec(xml))) { if (mm[3]) continue; depth += mm[1] ? -1 : 1; if (depth === 0) { j = mm.index + mm[0].length; break; } }
    }
    out.push({ at: i, text: xml.slice(i, j) });
    i = j;
  }
  return out;
}

/** OSC to QLab on this computer, with its passcode. */
async function oscClient(passcode: string) {
  const sock = dgram.createSocket('udp4');
  const replies: string[] = [];
  sock.on('message', (b) => { const m = decode(b); if (m) replies.push(`${m.address} ${m.args.join(' ')}`); });
  await new Promise<void>((r) => sock.bind(53001, '127.0.0.1', () => r()));
  const send = (address: string, a: unknown[] = []) => new Promise<void>((r) => sock.send(encode(address, a), 53000, '127.0.0.1', () => r()));
  await send('/connect', [passcode]);
  await sleep(300);
  return { send, replies, close: () => sock.close() };
}
const addressOf = (s: Step) => (s.do === 'go' ? '/go' : s.do === 'panic' ? '/panic' : `/cue/${s.cue}/${s.do}`);

async function play(dir: string, scenes: Scene[], passcode: string) {
  showAppNotRunning();
  onBlackHole();
  for (const s of scenes) {
    const file = path.join(dir, 'workspaces', `${s.id}.qlab5`);
    const out = path.join(dir, 'rec', s.id);
    fs.mkdirSync(out, { recursive: true });
    const ws = await openWorkspace(file);
    const osc = await oscClient(passcode);
    const rec = record(path.join(out, 'qlab.wav'));
    try {
      await rec.listening;
      await sleep(800);
      const t0 = Date.now() + 200;
      const done: { at: number; step: Step }[] = [];
      for (const st of s.steps) {
        const wait = t0 + st.at * 1000 - Date.now();
        if (wait > 0) await sleep(wait);
        const at = Date.now();
        await osc.send(addressOf(st));
        done.push({ at, step: st });
      }
      await sleep(Math.max(0, t0 + s.secs * 1000 - Date.now()));
      fs.writeFileSync(path.join(out, 'qlab.json'), JSON.stringify({ engine: 'qlab', scene: s.id, steps: done, replies: osc.replies }, null, 1));
      console.log(`${s.id}: recorded (${osc.replies.length} replies: ${osc.replies.slice(0, 2).join('; ')})`);
    } finally {
      await rec.stop();
      osc.close();
      closeWorkspace(ws);
      await sleep(500);
    }
  }
}

if (require.main === module) {
  const verb = args[0];
  const dir = path.resolve(arg('--dir'));
  if (!arg('--dir')) { console.error('--dir DIR'); process.exit(2); }
  const flagged = new Set(['--dir', '--empty', '--passcode']);
  const wanted = args.slice(1).filter((a, i, all) => !a.startsWith('--') && !flagged.has(all[i - 1]));
  const scenes = wanted.length ? SCENES.filter((s) => wanted.includes(s.id)) : SCENES;
  (verb === 'build' ? build(dir, path.resolve(arg('--empty')), scenes) : verb === 'play' ? play(dir, scenes, arg('--passcode')) : Promise.reject(new Error('build | play')))
    .catch((err) => { console.error(err.stack || err); process.exit(1); });
}
