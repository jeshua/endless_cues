/**
 * The safety net, run by smoke.js near its end: a fade to silence stopping its target by itself, Check the show
 * (its list, in the window), Run from here (its preview, and what it starts), double-GO protection on a cue's own
 * trigger, and the show log (the Log view, its file beside the show, and the report's copy with no names in it).
 * Pictures: safety-check, safety-run-from, safety-log.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const show = require('../../core/show/show');
const { applyOps } = require('../../core/show/ops');

async function run({ host, win, check, until, page, sleep, shot }) {
  const { writeWav } = require('../../examples/make-demo');
  const snap = () => host.snapshot();
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ec-smoke-safety-')), 'Safety.ecshow');
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  const tone = (secs, hz) => { const n = Math.round(44100 * secs), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.2 * Math.sin(2 * Math.PI * hz * i / 44100); return x; };
  writeWav(path.join(dir, 'media', 'rain.wav'), tone(2, 330));
  writeWav(path.join(dir, 'media', 'music.wav'), tone(20, 440));
  const built = applyOps(show.newShow('Safety'), [
    { op: 'cue.add', ref: 'rain', cue: { type: 'audio', number: '1', name: 'Rain', file: 'media/rain.wav', loop: true } },
    { op: 'cue.add', ref: 'music', cue: { type: 'audio', number: '2', name: 'Music', file: 'media/music.wav' } },
    { op: 'cue.add', ref: 'down', cue: { type: 'fade', number: '3', target: '@music', db: -12, duration: 0.2 } },
    { op: 'cue.add', ref: 'lamp', cue: { type: 'network', number: '4', message: '/lamp/color blue' } },
    { op: 'cue.add', ref: 'here', cue: { type: 'memo', number: '5', name: 'Here', midiTrigger: 'note 60' } },
    { op: 'cue.add', ref: 'gone', cue: { type: 'audio', number: '6', file: 'media/rain.wav' } },
    { op: 'cue.add', ref: 'lost', cue: { type: 'fade', number: '7', target: '@gone' } },
    { op: 'cue.add', ref: 'a', cue: { type: 'start', number: '8' } },
    { op: 'cue.add', ref: 'b', cue: { type: 'start', number: '9', target: '@a' } },
    { op: 'cue.set', id: '@a', props: { target: '@b' } },
    { op: 'cue.add', ref: 'off', cue: { type: 'audio', number: '10', file: 'media/rain.wav', armed: false } },
    { op: 'cue.add', ref: 'out', cue: { type: 'fade', number: '11', target: '@music', duration: 0.3 } },
    { op: 'cue.remove', id: '@gone' },
  ]);
  const id = (ref) => built.refs[ref];
  fs.writeFileSync(path.join(dir, 'show.json'), show.stringify(built.doc));
  host.cmd({ op: 'panic', hard: true });
  host.cmd({ op: 'mode', mode: 'edit' });
  host.open(dir);
  await until(() => Object.keys(snap().engine.durations).length >= 2, 4000);
  const has = (sel) => page(`!!document.querySelector(${JSON.stringify(sel)})`);
  const click = (sel) => page(`(() => { const b = document.querySelector(${JSON.stringify(sel)}); if (!b) return false; b.click(); return true; })()`);
  const menu = (action) => win.webContents.send('ec-menu', action);

  // 1. a fade to silence left alone stops its target; the inspector's switch says so
  check('a Fade to silence left alone is one that stops its target (and one to −12 is not)', snap().fadeStops.includes(id('out')) && !snap().fadeStops.includes(id('down')), snap().fadeStops);

  // 2. Check the show
  const c = host.cmd({ op: 'check' });
  const says = (re, level) => c.lines.some((x) => re.test(x.text) && (!level || x.level === level));
  check('Check finds a target that is gone, a loop with no wait and a cue that never plays, without playing anything',
    says(/target is gone/, 'problem') && says(/no wait \(8 → 9 → 8\)/, 'problem') && says(/never plays/, 'look') && !snap().engine.active.length, c.lines.map((x) => `${x.level}: ${x.text}`));
  await click('.footer [data-check]');
  check('…the footer’s Check opens it as one list, each line a button', await until(() => page(`document.querySelectorAll('.checks [data-check-line]').length >= 3 && /problem/.test(document.querySelector('[data-check-summary]').textContent)`), 4000),
    await page(`[...document.querySelectorAll('.checks [data-check-line]')].map((b) => b.textContent)`));
  await shot('safety-check');
  await click('.checks .ch button');

  // 3. Run from here: what it will start is said first; then it starts it, at the levels the fades left
  const pre = host.cmd({ op: 'run-from', id: id('here'), preview: true });
  check('Run from here says first what it will bring back', pre.text === 'Starts 2 sounds and sends 1 message.' && pre.lines.length === 3 && !snap().engine.active.length, pre);
  host.cmd({ op: 'playhead', id: id('here') });
  await sleep(400);                          // (the selection follows the playhead once the page hears of it)
  menu('tool-run-from');
  check('…Tools ▸ Run from the Selected Cue… shows that in a sheet before anything starts', await until(() => page(`/Starts 2 sounds/.test((document.querySelector('[data-run-from-text]') || {}).textContent || '')`), 4000) && !snap().engine.active.length);
  await shot('safety-run-from');
  await click('[data-run-from-go]');
  const act = (ref) => snap().engine.active.find((x) => x.id === id(ref));
  check('…and Run from here starts the loop and the music, the music at the −12 its fade left, with the playhead on the cue',
    await until(() => act('rain') && act('music') && Math.abs(act('music').db - -12) < 0.1 && snap().engine.playhead === id('here'), 4000) && await until(async () => !(await has('[data-run-from]')), 4000),
    [snap().engine.active.map((x) => [x.name, x.db]), snap().engine.playhead]);
  host.cmd({ op: 'mode', mode: 'show' });
  check('…Show mode refuses it', !!host.cmd({ op: 'run-from', id: id('here') }).error);
  host.cmd({ op: 'mode', mode: 'edit' });
  host.cmd({ op: 'panic', hard: true });

  // 4. double-GO protection on a cue's own trigger: the same MIDI note twice at once is one start
  const started = () => (host.showLog.since(0).filter((e) => /^START 5 /.test(e.text)).length);
  const was = started();
  host.midiIn([0x90, 60, 100]); host.midiIn([0x90, 60, 100]);
  check('a trigger that bounces (the same MIDI note twice within the double-GO time) starts its cue once, and the log says the second was ignored',
    started() === was + 1 && host.showLog.since(0).some((e) => e.kind === 'ignored' && /MIDI note 60/.test(e.text)), host.showLog.tail(6).map((e) => e.text));
  check('…and the same for a cart button or a remote’s start', !host.cmd({ op: 'start', id: id('rain'), from: 'cart' }).ignored && host.cmd({ op: 'start', id: id('rain'), from: 'cart' }).ignored === 'double GO');
  host.cmd({ op: 'panic', hard: true });

  // 5. the show log: the Log view, its file beside the show, and the copy a report would carry
  menu('log');
  check('View ▸ Show Log lists what happened, GOs and problems marked', await until(() => page(`document.querySelectorAll('[data-log] .logl').length > 5 && !!document.querySelector('[data-log] .logl.ignored') && !!document.querySelector('[data-log] .logl.show')`), 4000));
  await click('[data-log-kind="problems"]');
  check('…narrowed to the problems, only problems are left', await until(() => page(`(() => { const r = [...document.querySelectorAll('[data-log] .logl')]; return r.length > 0 && r.every((x) => /\\b(ignored|warning|error)\\b/.test(x.className)); })()`), 2000));
  await shot('safety-log');
  await click('[data-log-kind="all"]');
  await page(`(() => { const i = document.querySelector('[data-log-find]'); i.value = 'run from'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('…and searched', await until(() => page(`(() => { const r = [...document.querySelectorAll('[data-log] .logl')]; return r.length >= 1 && r.every((x) => /run from/i.test(x.textContent)); })()`), 2000));
  menu('log');
  await sleep(400);                          // (the lines are written a moment after they happen)
  const logs = fs.existsSync(path.join(dir, 'logs')) ? fs.readdirSync(path.join(dir, 'logs')) : [];
  const file = logs.find((f) => /\.log$/.test(f));
  const text = file ? fs.readFileSync(path.join(dir, 'logs', file), 'utf8') : '';
  check('the show log is written beside the show, one file for the sitting, as words and as a table', !!file && logs.some((f) => /\.csv$/.test(f)) && /GO|START 5/.test(text) && /ignored/.test(text) && /run from 5/.test(text), logs);
  const bare = host.reportLog(100);
  check('the copy a problem report carries has no cue’s name and no file’s', bare.length > 5 && !bare.some((l) => /Music|Rain|Here|music\.wav|rain\.wav/.test(l)) && bare.some((l) => /▶ 1 /.test(l)), bare.slice(-6));
  host.cmd({ op: 'panic', hard: true });
}

module.exports = { run };
