/**
 * The sound comparison, Endless Cues' side (docs/internal/sound-compare.md): each workspace qlab.ts built, imported
 * as the app imports it and played by the app's own host (app/main/host.ts: the cue engine, and the audio window or
 * the native engine) on BlackHole 2ch, with the same steps at the same moments, while BlackHole's input is recorded.
 * Run by hand, inside on-blackhole.sh, never by `npm test`:
 *
 *   test/sound-compare/on-blackhole.sh npx electron test/sound-compare/ec.js --dir DIR --engine webaudio|native [scene…]
 *       → DIR/rec/<scene>/<engine>.wav (.blocks.csv) and <engine>.json (each step's wall-clock moment, the import's notes)
 *
 * Its settings are a folder of its own in the system's temporary files; it opens no window but the audio window,
 * which is never shown.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { SCENES } from './scenes';
import type { Scene, Step } from './scenes';
import { record, showAppNotRunning, onBlackHole, BLACKHOLE } from './qlab';

const ROOT = path.join(__dirname, '..', '..');
const args = process.argv.slice(process.argv.findIndex((a) => a.endsWith('ec.js')) + 1);
const arg = (name: string, d = '') => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const engineName = arg('--engine', 'webaudio') === 'native' ? 'native' : 'webaudio';
const dir = path.resolve(arg('--dir'));
const flagged = new Set(['--dir', '--engine']);
const wanted = args.filter((a, i, all) => !a.startsWith('--') && !flagged.has(all[i - 1]));
const scenes = wanted.length ? SCENES.filter((s) => wanted.includes(s.id)) : SCENES;

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ec-sound-compare-')));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

type Snap = { mixer?: { audioReady?: boolean; devices?: { id: string; label: string }[]; device?: string; deviceOk?: boolean; engine?: { using?: string } } } & Record<string, any>;

async function main() {
  showAppNotRunning();
  onBlackHole();
  const { createHost } = require('../../app/main/host') as typeof import('../../app/main/host');
  const { binaryPath } = require('../../app/main/native-audio') as typeof import('../../app/main/native-audio');
  const { importQlab } = require('../../core/import/qlab') as typeof import('../../core/import/qlab');
  let config: Record<string, any> = { audio: { engine: engineName } };
  const lines: string[] = [];
  const host = createHost({ BrowserWindow, ipcMain, screen, log: (l) => { lines.push(l); if (process.env.EC_VERBOSE) console.error(l); },
    getConfig: () => config as any, saveConfig: (c) => { config = { ...config, ...c }; }, userDir: app.getPath('userData'),
    nativeBinary: binaryPath({ packaged: false, root: ROOT }) });
  host.start();
  const snap = () => host.snapshot() as unknown as Snap;
  const audio = () => snap().mixer as NonNullable<Snap['mixer']>;
  // the engine ready, and on BlackHole by name (each engine lists devices its own way)
  for (let i = 0; i < 100 && !(audio().audioReady && (audio().devices || []).length && (audio().engine || {}).using === engineName); i++) await sleep(100);
  const a = audio();
  if ((a.engine || {}).using !== engineName) throw new Error(`the ${engineName} engine is not the one playing: ${JSON.stringify(a.engine)}`);
  const dev = (a.devices || []).find((d) => d.label.includes(BLACKHOLE));
  if (!dev) throw new Error(`no ${BLACKHOLE} among ${(a.devices || []).map((d) => d.label).join(', ')}`);
  await host.cmd({ op: 'device', id: dev.id } as any);
  await sleep(1500);
  if (audio().device !== dev.id) throw new Error(`the output is ${audio().device}, not ${dev.id} (${BLACKHOLE})`);

  const cmdOf = (s: Step) => (s.do === 'go' ? { op: 'go' } : s.do === 'panic' ? { op: 'panic' } : s.do === 'start' ? { op: 'start', number: s.cue, from: 'osc' } : { op: 'stop', number: s.cue });
  for (const s of scenes as Scene[]) {
    const file = path.join(dir, 'workspaces', `${s.id}.qlab5`);
    const out = path.join(dir, 'rec', s.id);
    fs.mkdirSync(out, { recursive: true });
    const { doc, report } = importQlab(fs.readFileSync(file), { file });
    host.openImported(doc as any, report as any);
    await sleep(2500);             // (its sounds probed and decoded ahead, as after opening a show)
    const rec = record(path.join(out, `${engineName}.wav`));
    try {
      await rec.listening;
      await sleep(800);
      const t0 = Date.now() + 200;
      const done: { at: number; step: Step; answer: unknown }[] = [];
      for (const st of s.steps) {
        const wait = t0 + st.at * 1000 - Date.now();
        if (wait > 0) await sleep(wait);
        const at = Date.now();
        const answer = await host.cmd(cmdOf(st) as any);
        done.push({ at, step: st, answer: answer ?? null });
      }
      await sleep(Math.max(0, t0 + s.secs * 1000 - Date.now()));
      fs.writeFileSync(path.join(out, `${engineName}.json`), JSON.stringify({ engine: engineName, scene: s.id, steps: done, notes: report.issues.map((i) => `${i.cue}: ${i.why}`), log: lines.splice(0).filter((l) => /\[audio\]|\[native\]|operror|cannot/i.test(l)).slice(-60) }, null, 1));
      console.log(`${s.id}: recorded on ${engineName}`);
    } finally {
      await rec.stop();
      await host.cmd({ op: 'panic', hard: true } as any);
      await sleep(400);
    }
  }
  host.stop();
}

app.whenReady().then(async () => {
  let code = 0;
  try { await main(); } catch (err) { console.error((err as Error).stack || err); code = 1; }
  app.exit(code);
});
app.on('window-all-closed', () => {});
