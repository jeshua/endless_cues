/**
 * The smoke run's checks of the audio engine's switch (docs/specs/18-native-audio.md), called last from smoke.ts:
 * Web Audio as the app comes, said in the status bar; then the native engine asked for. With `ec-audio` built
 * (`npm run native`) it is started `--silent` and makes the sound until Web Audio is asked for again; without it, the
 * app says so in a notice and the show log, and Web Audio plays on for the sitting.
 */
import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { binaryPath } from './native-audio';
import type { Smoke, Snap } from './smoke';

async function run({ host, check, until, page }: Pick<Smoke, 'host' | 'check' | 'until' | 'page'>) {
  const snap = () => host.snapshot() as Snap;
  const used = () => page<string>(`(document.querySelector('[data-audio-engine-used]') || {}).textContent || ''`);
  host.cmd({ op: 'panic', hard: true });
  if (process.env.EC_SMOKE_NATIVE === '1') {
    // (the whole run was on the native engine: it is still the one making the sound, and the switch back works)
    check('EC_SMOKE_NATIVE: the native engine made the sound for the whole run, and the status bar says so', snap().mixer.engine.using === 'native' && /Native/.test(await used()), [snap().mixer.engine, await used()]);
    host.cmd({ op: 'audio-engine', engine: 'webaudio' });
    check('…and asked for Web Audio, the window makes the sound at once', await until(() => snap().mixer.engine.using === 'webaudio' && snap().mixer.audioReady, 3000), snap().mixer.engine);
    return;
  }
  check('the sound is made by Web Audio as the app comes, and the status bar says so', snap().mixer.engine.using === 'webaudio' && snap().mixer.engine.wanted === 'webaudio' && /Web Audio/.test(await used()), [snap().mixer.engine, await used()]);
  const r = host.cmd({ op: 'audio-engine', engine: 'native' });
  // (where the app itself looks: its resources in a packaged app, native/target in a checkout)
  const built = fs.existsSync(binaryPath({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, root: path.join(__dirname, '..', '..') }));
  if (!built) {
    check('with no native engine built, asking for it falls back to Web Audio at once, with the reason', r.when === 'now' && snap().mixer.engine.using === 'webaudio' && /no native engine/.test(snap().mixer.engine.failed || ''), [r, snap().mixer.engine]);
    check('…said in a notice and the show log', /native audio engine failed/.test(snap().notice) && host.showLog.tail(20).some((l) => l.kind === 'warning' && /native audio engine failed/.test(l.text)), snap().notice);
    check('…and Web Audio is ready again', await until(() => snap().mixer.audioReady, 3000));
    return;
  }
  const ok = await until(() => (snap().mixer.engine.using === 'native' && snap().mixer.audioReady) || !!snap().mixer.engine.failed, 10000);
  if (snap().mixer.engine.failed) { check('the native engine starts --silent and says it is ready', false, snap().mixer.engine); return; }
  check('the native engine starts --silent and says it is ready; the status bar says Native', ok && await until(async () => /Native/.test(await used()), 3000), [snap().mixer.engine, await used()]);
  check('…and its events reach the host: its outputs and its meters', await until(() => snap().mixer.outputs >= 2 && Array.isArray(snap().mixer.level) && snap().mixer.level!.length >= 2, 3000), [snap().mixer.outputs, snap().mixer.level]);
  host.cmd({ op: 'audio-engine', engine: 'webaudio' });
  check('…and asked for Web Audio again, the window makes the sound at once', await until(() => snap().mixer.engine.using === 'webaudio' && snap().mixer.audioReady, 3000), snap().mixer.engine);
}

export { run };
