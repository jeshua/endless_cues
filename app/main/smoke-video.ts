/**
 * The stage's part of the end-to-end check (smoke.ts calls it): Video, Text and Camera cues, through the real
 * engine, audio window and output window. The stage is drawn offscreen, so nothing appears on any display; what
 * it shows is read back as pixels. Its media are made here by code (test-media.ts).
 */
import * as fs from 'fs';
import * as path from 'path';
import { png, webm } from './test-media';
import type { Smoke, Snap } from './smoke';

const GREEN = [20, 200, 60], BLUE = [30, 60, 220], ORANGE = [240, 140, 20];

async function run({ host, check, until, sleep, shot, log }: Pick<Smoke, 'host' | 'check' | 'until' | 'sleep' | 'shot' | 'log'>) {
  const snap = () => host.snapshot() as Snap;
  const st = () => host.stage.status();
  const stagePage = (js: string) => host.stage.window()!.webContents.executeJavaScript(js, true);
  const audioPage = (js: string) => host.audioWindow()!.webContents.executeJavaScript(js, true);
  /** The colour of the stage at a place (0–1 across and down), as the window is drawn. */
  const pixel = async (fx = 0.5, fy = 0.5) => {
    const img = await host.stage.window()!.webContents.capturePage();
    const { width, height } = img.getSize();
    const b = img.toBitmap();
    const i = (Math.min(height - 1, Math.floor(fy * height)) * width + Math.min(width - 1, Math.floor(fx * width))) * 4;
    return [b[i + 2], b[i + 1], b[i]];
  };
  const near = (p: number[], c: readonly number[], tol = 50) => p.every((v, i) => Math.abs(v - c[i]) <= tol);
  const dark = (p: number[]) => p.every((v) => v < 24);
  const sees = (c: readonly number[], fx?: number, fy?: number, ms = 4000) => until(async () => near(await pixel(fx, fy), c), ms);
  const black = (fx?: number, fy?: number, ms = 4000) => until(async () => dark(await pixel(fx, fy)), ms);

  // the stage opens offscreen, black
  check('the stage is closed until it is opened', st().open === false);
  host.cmd({ op: 'stage-open' });
  check('the stage opens (offscreen in a test run) without becoming the front window', await until(() => st().ready) && !host.stage.window()!.isVisible() && !host.stage.window()!.isFocused(), st());
  check('an empty stage is black', await black());

  // media, made by code
  const media = path.join(host.document.showDir!, 'media');
  const film = await webm(stagePage, { secs: 4, colours: [GREEN, BLUE] });
  fs.writeFileSync(path.join(media, 'smoke-film.webm'), film.bytes);
  fs.writeFileSync(path.join(media, 'smoke-card.png'), png(64, 36, ORANGE));
  if (!film.sound) log(`SMOKE note  the test video has no sound track (${film.audioError || 'no Opus encoder here'})`);

  const r = host.cmd({ op: 'edit', label: 'stage cues', ops: [
    { op: 'cue.add', ref: 'film', cue: { type: 'video', file: 'media/smoke-film.webm', bus: 'vocals', number: 'V1', name: 'Film' } },
    { op: 'cue.add', ref: 'half', cue: { type: 'fade', target: '@film', duration: 0, scale: 0.5 } },
    { op: 'cue.add', ref: 'dim', cue: { type: 'fade', target: '@film', duration: 0.6, opacity: 0 } },
    { op: 'cue.add', ref: 'card', cue: { type: 'video', file: 'media/smoke-card.png', fit: 'stretch', number: 'V2', name: 'Card' } },
    { op: 'cue.add', ref: 'title', cue: { type: 'text', text: 'ENDLESS', size: 300, textColor: '#ffffff', layer: 5 } },
    { op: 'cue.add', ref: 'cam', cue: { type: 'camera', fit: 'fill' } },
    { op: 'cue.add', ref: 'late', cue: { type: 'load', target: '@film', at: 3.3 } },
  ] });
  const id = (ref: string) => r.refs && r.refs[ref];
  check('Video, Text and Camera cues can be added', !!(id('film') && id('cam')) && !r.error, r);
  check('a video is measured like a sound, and a still is not asked to be', await until(() => Math.abs((snap().engine.durations['media/smoke-film.webm'] || 0) - 4) < 0.3), snap().engine.durations);
  check('none of them is a problem', !snap().problems.some((p) => Object.values(r.refs || {}).includes(p.id)), snap().problems);

  // V1: a video plays, picture and sound
  host.cmd({ op: 'fire', id: id('film') });
  check('a Video cue shows its first frames on the stage', await sees(GREEN), await pixel());
  check('…and its sound plays in the audio window', await until(async () => (await audioPage(`voices.has(${JSON.stringify(id('film'))})`))));
  if (film.sound) check('…on the cue’s bus', await until(() => ((snap().mixer.buses.find((b) => b.id === 'vocals') || {}).peak ?? -60) > -40, 3000), snap().mixer.buses.map((b) => [b.id, b.peak]));
  const a = () => snap().engine.active.find((x) => x.id === id('film'));
  check('it runs as a sound does in Active Cues, marked as a picture', !!a() && a()!.picture === 'video' && a()!.total > 3.5, a());
  await sleep(1200);
  const drift = async () => Math.abs((await stagePage(`layers.get(${JSON.stringify(id('film'))}).media.currentTime`)) - (await audioPage(`voices.get(${JSON.stringify(id('film'))}).el.currentTime`)));
  check('the picture keeps step with its sound (within a tenth of a second)', await until(async () => (await drift()) < 0.1, 3000), await drift().catch(() => null));
  check('its later frames come', await sees(BLUE, 0.5, 0.5, 4000), await pixel());
  await shot('v1-video');

  // pause, a skip back, resume
  host.cmd({ op: 'pause', id: id('film') });
  await sleep(250);
  const t1 = await stagePage(`layers.get(${JSON.stringify(id('film'))}).media.currentTime`);
  await sleep(300);
  check('pause holds the picture', Math.abs((await stagePage(`layers.get(${JSON.stringify(id('film'))}).media.currentTime`)) - t1) < 0.02);
  host.cmd({ op: 'seek', id: id('film'), t: 0.5 });
  host.cmd({ op: 'resume', id: id('film') });
  check('a skip back takes the picture with it', await sees(GREEN), await pixel());

  // V2: geometry and opacity, by a Fade
  host.cmd({ op: 'fire', id: id('half') });
  check('a Fade aimed at a video scales it (the corner of the stage goes black, the middle stays)', (await black(0.1, 0.1)) && near(await pixel(), GREEN), [await pixel(0.1, 0.1), await pixel()]);
  host.cmd({ op: 'fire', id: id('dim') });
  check('…and fades its opacity to nothing over a time, the cue still running', (await black(0.5, 0.5, 3000)) && !!a(), [await pixel(), !!a()]);
  check('a Fade that names no level leaves the video’s sound where it was', a() && a()!.db === 0 && !a()!.fadingTo, a() && [a()!.db, a()!.fadingTo]);
  host.cmd({ op: 'stop', id: id('film') });
  check('Stop clears it from the stage', await until(async () => (await stagePage('layers.size')) === 0));

  // a video played to its end leaves a black stage
  host.cmd({ op: 'fire', id: id('late') });
  host.cmd({ op: 'fire', id: id('film') });
  check('a Load cue starts the picture where it says', await sees(BLUE), await pixel());
  check('a video that reaches its end leaves the stage black', (await until(() => !a(), 4000)) && (await black()), [!!a(), await pixel()]);

  // a video with no sound track of its own still plays, and still ends
  const mute = await webm(stagePage, { secs: 1.5, colours: [BLUE], tone: false });
  fs.writeFileSync(path.join(media, 'smoke-silent.webm'), mute.bytes);
  const r2 = host.cmd({ op: 'edit', label: 'silent film', ops: [{ op: 'cue.add', ref: 'silent', cue: { type: 'video', file: 'media/smoke-silent.webm' } }] });
  await until(() => snap().engine.durations['media/smoke-silent.webm'] > 1);
  host.cmd({ op: 'fire', id: r2.refs.silent });
  check('a video with no sound of its own plays', (await sees(BLUE)) && !snap().problems.some((p) => p.id === r2.refs.silent), [await pixel(), snap().problems]);
  check('…and ends', (await until(() => !snap().engine.active.some((x) => x.id === r2.refs.silent), 4000)) && (await black()));

  // a still, a title over it, a camera
  host.cmd({ op: 'fire', id: id('card') });
  check('a still image fills the stage', (await sees(ORANGE)) && near(await pixel(0.02, 0.02), ORANGE), await pixel());
  host.cmd({ op: 'fire', id: id('title') });
  const white = () => stagePage(`(() => { const r = document.querySelector('.title').getBoundingClientRect(); return r.width > 200 && r.height > 50 ? [r.width, r.height] : null; })()`);
  check('a Text cue draws its title over it, on its own layer', !!(await until(white)) && (await until(async () => {
    const img = await host.stage.window()!.webContents.capturePage(); const b = img.toBitmap(); let n = 0;
    for (let i = 0; i < b.length; i += 4) if (b[i] > 230 && b[i + 1] > 230 && b[i + 2] > 230) n++;
    return n > 500;
  }, 3000)));
  await shot('v3-title');
  host.cmd({ op: 'stop', id: id('title') });

  // V4: the corner pin, the blackout, the test pattern
  host.cmd({ op: 'edit', label: 'corner pin', ops: [{ op: 'show.set', path: 'settings.video.pin', value: [[0.25, 0.25], [1, 0], [1, 1], [0, 1]] }] });
  check('the corner pin pulls a corner of the stage in (black where it was, the picture still in the middle)', (await black(0.08, 0.08)) && near(await pixel(0.6, 0.6), ORANGE), [await pixel(0.08, 0.08), await pixel(0.6, 0.6)]);
  host.cmd({ op: 'undo' });
  check('…and undo squares it again', await sees(ORANGE, 0.08, 0.08), await pixel(0.08, 0.08));
  host.cmd({ op: 'stage-blackout', on: true });
  check('a blackout covers what is showing, which goes on running', (await black()) && snap().engine.active.some((x) => x.id === id('card')) && snap().stage.blackout === true);
  host.cmd({ op: 'stage-blackout', on: false });
  check('…and lifts', await sees(ORANGE));
  host.cmd({ op: 'stage-pattern', on: true });
  check('the test pattern is drawn over everything', await until(async () => { const p = await pixel(0.3, 0.9); return !near(p, ORANGE) ; }, 3000), await pixel(0.3, 0.9));
  await shot('v4-pattern');
  host.cmd({ op: 'stage-pattern', on: false });
  await sees(ORANGE, 0.3, 0.9);

  // a camera (a stand-in picture in a test run: no camera is opened)
  host.cmd({ op: 'stop', id: id('card') });
  host.cmd({ op: 'fire', id: id('cam') });
  check('a Camera cue shows a live picture', await until(async () => { const p = await pixel(0.5, 0.5); return !dark(p); }, 5000), await pixel());
  host.cmd({ op: 'fire', id: id('card') });

  // a stage that is closed and opened again is told what is up
  host.cmd({ op: 'stage-close' });
  check('the stage closes; what was on it goes on running', st().open === false && snap().engine.active.some((x) => x.id === id('card')));
  host.cmd({ op: 'stage-open' });
  check('opened again, it shows what is running', (await until(() => st().ready)) && (await until(async () => (await stagePage('layers.size')) === 2, 4000)), await stagePage('layers.size').catch(() => null));

  // panic: the picture fades out with everything else, to black
  host.cmd({ op: 'panic' });
  await sleep(250);
  const mid = await stagePage(`Math.max(...[...layers.values()].map((l) => Number(l.el.style.opacity)))`).catch(() => null);
  check('Esc fades the stage out', mid != null && mid < 1 && mid > 0, mid);
  check('…to black, with nothing left on it', (await until(async () => (await stagePage('layers.size')) === 0, 4000)) && (await black()) && snap().engine.active.length === 0, snap().engine.active.map((x) => x.name));
  host.cmd({ op: 'stage-close' });
}

export { run };
