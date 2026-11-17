/**
 * Where a window of the app may go, and what may be handed to the system's browser.
 *
 * Every page of the app has the preload's bridge (`window.ec`, `cueAudio`, `cueStage`): whatever page a window
 * shows can send the host commands. So a window never leaves the page it was opened on: a link clicked, a file
 * dropped on the window or a script setting `location` is refused (`will-navigate`), and only http(s) and mailto
 * addresses are opened outside, in the system's browser or mail program. No Electron here, so it is unit-tested.
 */

/** Whether a page at `from` may navigate itself to `to`: only to another page of the app's own `ec://app/`, or
 *  to the same file it is (a reload with another query). Anything else (another site, a file, a data: URL) is not. */
function mayNavigate(from, to) {
  let a, b;
  try { a = new URL(String(from)); b = new URL(String(to)); } catch { return false; }
  if (a.protocol === 'ec:' && a.host === 'app') return b.protocol === 'ec:' && b.host === 'app';
  if (a.protocol === 'file:') return b.protocol === 'file:' && b.pathname === a.pathname && !b.host && !a.host;
  return false;
}

/** Whether an address may be opened in the system's browser (or mail program): http, https and mailto only. */
function mayOpenOutside(url) {
  let u;
  try { u = new URL(String(url)); } catch { return false; }
  return u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:';
}

/** Hold one webContents to the rules above. `open` is shell.openExternal. */
function guard(wc, { open = () => {} } = {}) {
  wc.on('will-navigate', (e, url) => { if (!mayNavigate(wc.getURL(), url)) e.preventDefault(); });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  // (a window that sets its own handler afterwards replaces this one; until then, nothing opens a window)
  wc.setWindowOpenHandler(({ url }) => { if (mayOpenOutside(url)) open(url); return { action: 'deny' }; });
}

export { mayNavigate, mayOpenOutside, guard };
