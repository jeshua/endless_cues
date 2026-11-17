/**
 * How late does a timer wake? Measured in the main process and in a hidden window (as the audio window is), which
 * is why MIDI that must leave on time is stamped with its time rather than sent when a timer fires
 * (core/net/playout.js). Not part of `npm test`: it needs Electron and ten seconds.
 *
 *   npx electron test/manual/timer-jitter.js          (SECS=30 for longer)
 *
 * Prints, in milliseconds, how late a 10 ms timer aimed at fixed times woke in each process, and how far apart the
 * two processes think the same moment is (which bounds the error in handing a time from one to the other; it
 * includes the message's own travel). Opens no audio device, no MIDI port and no visible window.
 */
import { app, BrowserWindow } from 'electron';

const stats = (a: number[]) => { const s = [...a].sort((x, y) => x - y), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, mean: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(2), p50: +q(0.5).toFixed(2), p99: +q(0.99).toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
// the same loop in both: aim at t0 + k × every, note how late each wake is
const LOOP = `(secs, every) => new Promise((resolve) => { const late = []; let next = performance.now() + every; const end = next + secs * 1000;
  const tick = () => { const now = performance.now(); late.push(now - next); while (next <= now) next += every; if (now >= end) resolve(late); else setTimeout(tick, Math.max(0, next - performance.now())); };
  setTimeout(tick, every); })`;

if (app.setActivationPolicy) app.setActivationPolicy('accessory');
app.whenReady().then(async () => {
  const secs = Number(process.env.SECS) || 10, every = 10;
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('data:text/html,<title>timer jitter</title>');
  // some work in main meanwhile, as a show's host has (building the state it pushes to the window)
  const busy = setInterval(() => { const o = []; for (let i = 0; i < 20000; i++) o.push({ i, s: String(i) }); JSON.stringify(o); }, 100);
  const asked = performance.timeOrigin + performance.now();
  const heard = await win.webContents.executeJavaScript('performance.timeOrigin + performance.now()');
  const [main, page] = await Promise.all([eval(LOOP)(secs, every), win.webContents.executeJavaScript(`(${LOOP})(${secs}, ${every})`)]);      // eslint-disable-line no-eval
  clearInterval(busy);
  console.log(JSON.stringify({ everyMs: every, secs, mainLateMs: stats(main), windowLateMs: stats(page), sameMomentApartMs: +(heard - asked).toFixed(2) }, null, 2));
  app.exit(0);
});
