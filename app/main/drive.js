/**
 * A virtual user's hands, eyes and ears (test/users/README.md).
 *
 *   electron . --drive=<session folder> [--drive-net] [a show or a QLab workspace]
 *
 * The app runs as it does for the smoke test (silent, its own settings folder, never the front app) and opens
 * a door on this computer only, which `bin/ec-user.js` talks to. Through it a user can do what a person at
 * the keyboard can do and nothing more:
 *
 *   look      a picture of the window, and what is on it as text, each thing with where it is
 *   click     the mouse, at a place or on a thing by what it says
 *   type/key  the keyboard, into whatever has the focus
 *   menu      the menu bar (a native menu cannot be clicked from inside the app, so its item is chosen by name)
 *   answer    a file dialog or a message box (also native: the user says which file, or which button)
 *   choose    an option of a drop-down list (its pop-up is native too)
 *   hear      what would be coming out of the speakers
 *
 * There is no command here that changes the show or plays it except through the window. Everything done is
 * written to <session>/journal.jsonl, one line an action, which is what the report's counts are made from.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { dialog, Menu, app } = require('electron');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAC = process.platform === 'darwin';

/** What is on the page, as a person scanning it would list it. Runs in the window. */
const OUTLINE = `(() => {
  const out = [];
  const short = (s, n = 90) => { s = String(s || '').replace(/\\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return null;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return null;
    const x = Math.round(Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2))), y = Math.round(Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
    const top = document.elementFromPoint(x, y);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) return null;      // something is over it
    return { x, y };
  };
  const cls = (el) => (typeof el.className === 'string' && el.className.trim() ? ' {' + el.className.trim() + '}' : '');
  const hint = (el) => short(el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('data-field') || '', 60);
  const CONTROL = 'button, a[href], input, select, textarea, [role=button], [contenteditable=true]';
  function walk(el, pointer) {
    if (el.nodeType !== 1 || ['SCRIPT', 'STYLE', 'TEMPLATE'].includes(el.tagName)) return;
    const b = box(el);
    const tag = el.tagName.toLowerCase();
    if (el.matches(CONTROL)) {
      if (!b) return;
      const h = hint(el);
      if (tag === 'input' || tag === 'textarea') {
        const type = el.type || 'text';
        const v = type === 'checkbox' || type === 'radio' ? (el.checked ? 'ticked' : 'not ticked') : 'value "' + short(el.value, 60) + '"';
        out.push({ ...b, kind: type === 'checkbox' ? 'checkbox' : type === 'range' ? 'slider' : 'field', text: h || short(el.placeholder, 40), more: v + (el.disabled ? ' (disabled)' : '') + cls(el) });
      } else if (tag === 'select') {
        const opts = [...el.options].map((o) => short(o.textContent, 30));
        out.push({ ...b, kind: 'dropdown', text: h, more: 'shows "' + short((el.selectedOptions[0] || {}).textContent, 40) + '"; options: ' + opts.slice(0, 16).join(' / ') + (opts.length > 16 ? ' / …' : '') + (el.disabled ? ' (disabled)' : '') });
      } else out.push({ ...b, kind: 'button', text: short(el.innerText) || h, more: (h && short(el.innerText) ? 'hint "' + h + '"' : '') + (el.disabled ? ' (disabled)' : '') + cls(el) });
      return;
    }
    if (tag === 'tr') {
      if (b) {
        const cells = [...el.children].map((c) => short(c.innerText, 50));
        out.push({ ...b, kind: el.parentElement && el.parentElement.tagName === 'THEAD' ? 'columns' : 'row', text: cells.join(' | '), more: cls(el).trim() });
      }
      for (const c of el.querySelectorAll(CONTROL)) walk(c, true);
      return;
    }
    const cs = getComputedStyle(el);
    const clickable = cs.cursor === 'pointer' && !pointer;
    if (clickable && b && el.children.length <= 6 && (el.innerText || '').length <= 90 && !el.querySelector(CONTROL)) {
      out.push({ ...b, kind: 'clickable', text: short(el.innerText) || hint(el), more: cls(el).trim() });
      return;
    }
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent).join(' ');
    if (own.trim() && b) out.push({ ...b, kind: 'text', text: short(own, 160), more: /^h[1-6]$/.test(tag) ? 'heading' : '' });
    else if (!own.trim() && b && !el.children.length && hint(el)) out.push({ ...b, kind: 'mark', text: hint(el), more: cls(el).trim() });
    for (const c of el.children) walk(c, pointer || clickable);
  }
  walk(document.body, false);
  out.sort((p, q) => (Math.abs(p.y - q.y) > 6 ? p.y - q.y : p.x - q.x));
  const f = document.activeElement;
  return { size: [innerWidth, innerHeight], items: out.slice(0, 420), cut: Math.max(0, out.length - 420),
           focus: f && f !== document.body ? (f.tagName.toLowerCase() + (f.getAttribute('data-field') ? ' ' + f.getAttribute('data-field') : '') + (f.value !== undefined ? ' "' + short(f.value, 40) + '"' : '')) : '' };
})()`;

const KEYS = { space: 'Space', enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', backspace: 'Backspace', delete: 'Delete',
               up: 'Up', down: 'Down', left: 'Left', right: 'Right', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
               home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown' };
const MODS = { cmd: 'meta', command: 'meta', meta: 'meta', ctrl: 'control', control: 'control', shift: 'shift', alt: 'alt', option: 'alt', opt: 'alt' };

function parseKey(combo) {
  const parts = String(combo).split('+').map((p) => p.trim()).filter(Boolean);
  if (String(combo).endsWith('+')) parts.push('+');
  const key = parts.pop() || '';
  const mods = parts.map((p) => MODS[p.toLowerCase()]).filter(Boolean);
  return { key: KEYS[key.toLowerCase()] || (key.length === 1 ? key : key[0].toUpperCase() + key.slice(1)), mods };
}
/** "Shift+CmdOrCtrl+S" and "cmd+shift+s" as one spelling. */
function accelKey(text) {
  const parts = String(text).split('+').map((p) => p.trim().toLowerCase()).filter(Boolean)
    .map((p) => (p === 'cmdorctrl' || p === 'commandorcontrol' ? (MAC ? 'meta' : 'control') : MODS[p] || (KEYS[p] || p).toLowerCase()));
  const key = parts.pop();
  return [...parts.sort(), key].join('+');
}

function open({ dir, win, host, log }) {
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });
  const journal = path.join(dir, 'journal.jsonl');
  const write = (line) => { try { fs.appendFileSync(journal, JSON.stringify({ at: new Date().toISOString(), ...line }) + '\n'); } catch { /* the session folder went away */ } };
  let shots = fs.readdirSync(path.join(dir, 'shots')).length;
  const wc = win.webContents;
  const page = (js) => wc.executeJavaScript(js, true);
  // The window is never the front one, and a page that is not focused sends no blur: a field would keep what was
  // typed only on Enter. The page is told it has the keyboard, as it would for a person.
  try { wc.debugger.attach('1.3'); wc.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {}); } catch (err) { log(`[drive] focus emulation: ${err.message}`); }

  // ── native dialogs: the user answers them by name ──
  let pending = null;               // the dialog that is open: { kind, title, detail, buttons, finish }
  const flashes = [];               // boxes that could not wait for an answer
  const ask = (info, onAnswer, cancelled) => new Promise((resolve) => {
    if (pending) pending.finish(null);
    const timer = setTimeout(() => { if (pending && pending.info === info) { flashes.push(`The ${info.kind} dialog "${info.title}" was left open for two minutes and was cancelled.`); pending.finish(null); } }, 120000);
    pending = { info, finish: (a) => { clearTimeout(timer); pending = null; resolve(a === null ? cancelled : onAnswer(a)); } };
  });
  const options = (args) => args.find((a) => a && typeof a === 'object' && !a.webContents) || {};
  const exts = (o) => (o.filters || []).map((f) => `${f.name} (${(f.extensions || []).join(', ')})`).join('; ');
  dialog.showOpenDialog = (...args) => { const o = options(args);
    return ask({ kind: 'open-file', title: o.title || 'Open', detail: `${(o.properties || []).includes('openDirectory') ? 'choose a folder' : 'choose a file'}${(o.properties || []).includes('multiSelections') ? ' (several allowed)' : ''}${exts(o) ? `; shows: ${exts(o)}` : ''}` },
      (a) => ({ canceled: false, filePaths: a.paths }), { canceled: true, filePaths: [] }); };
  dialog.showSaveDialog = (...args) => { const o = options(args);
    return ask({ kind: 'save-file', title: o.title || 'Save', detail: `type where to save it; suggested: ${o.defaultPath || ''}` },
      (a) => ({ canceled: false, filePath: a.paths[0] }), { canceled: true, filePath: '' }); };
  dialog.showMessageBox = (...args) => { const o = options(args); const buttons = o.buttons && o.buttons.length ? o.buttons : ['OK'];
    return ask({ kind: 'message', title: o.message || o.title || '', detail: o.detail || '', buttons },
      (a) => ({ response: Math.max(0, buttons.findIndex((b) => b.toLowerCase() === String(a.button).toLowerCase())) }), { response: o.cancelId ?? buttons.length - 1 }); };
  dialog.showMessageBoxSync = (...args) => { const o = options(args); const buttons = o.buttons || ['OK'];
    flashes.push(`A message box appeared and was cancelled for you (it cannot wait in a test session): "${o.message || ''}" ${o.detail || ''} [${buttons.join(' / ')}]`);
    return o.cancelId ?? buttons.length - 1; };
  dialog.showErrorBox = (title, content) => { flashes.push(`An error box appeared: "${title}" ${content || ''}`); };

  // ── the menu bar ──
  const menuItems = (menu = Menu.getApplicationMenu(), trail = []) => {
    const out = [];
    for (const item of (menu ? menu.items : [])) {
      if (item.type === 'separator' || !item.visible) continue;
      const here = [...trail, item.label];
      if (item.submenu) out.push(...menuItems(item.submenu, here));
      else out.push({ path: here, item });
    }
    return out;
  };
  const plain = (s) => String(s).replace(/…|\.\.\./g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  // The Edit menu's own items act on the text field being typed in; the rest of the system's items (Quit,
  // Reload, Minimise…) would end or hide the session, so a virtual user is told they are out of reach.
  const EDIT_ROLES = { selectall: 'selectAll', copy: 'copy', cut: 'cut', paste: 'paste', undo: 'undo', redo: 'redo' };
  const roleOf = (m) => String(m.item.role || '').toLowerCase();
  const typing = () => page('(() => { const f = document.activeElement; return !!f && (f.tagName === "INPUT" || f.tagName === "TEXTAREA" || f.isContentEditable); })()');
  const choose = (m) => { m.item.click(undefined, win, wc); return `${m.path.join(' ▸ ')}`; };
  async function chooseRole(m) {
    const fn = EDIT_ROLES[roleOf(m)];
    if (!fn) return { error: `${m.path.join(' ▸ ')} belongs to the operating system and is not available in a test session.` };
    if (await typing()) wc[fn]();
    return { text: `chose ${m.path.join(' ▸ ')}` };
  }

  // ── the mouse and the keyboard ──
  const mouse = (type, x, y, o = {}) => wc.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: o.right ? 'right' : 'left', clickCount: o.count || 1, modifiers: o.mods || [] });
  async function clickAt(x, y, o = {}) {
    mouse('mouseMove', x, y); await sleep(40);
    for (let n = 1; n <= (o.double ? 2 : 1); n++) { mouse('mouseDown', x, y, { ...o, count: n }); mouse('mouseUp', x, y, { ...o, count: n }); await sleep(60); }
  }
  async function find(text, nth) {
    const want = plain(text);
    const items = (await page(OUTLINE)).items;
    let hits = items.filter((i) => plain(i.text) === want);
    if (!hits.length) hits = items.filter((i) => plain(i.text).includes(want));
    // a control before the words beside it
    const controls = hits.filter((i) => i.kind !== 'text' && i.kind !== 'columns');
    if (controls.length) hits = controls;
    if (!hits.length) return { error: `Nothing on the window says "${text}". Look again.` };
    if (hits.length > 1 && !nth) return { error: `${hits.length} things say "${text}": ${hits.slice(0, 8).map((h, i) => `#${i + 1} (${h.x},${h.y}) ${h.kind} "${h.text}"`).join('; ')}. Click by place, or add --nth N.` };
    return hits[(nth || 1) - 1] || { error: `There are only ${hits.length}.` };
  }

  const line = (i) => `(${i.x},${i.y}) ${i.kind}${i.text ? ` "${i.text}"` : ''}${i.more ? `  ${i.more}` : ''}`;

  const ops = {
    async look() {
      await sleep(250);
      const o = await page(OUTLINE);
      const file = path.join(dir, 'shots', `${String(++shots).padStart(3, '0')}.png`);
      fs.writeFileSync(file, (await wc.capturePage()).toPNG());
      const said = flashes.splice(0);
      return { shot: file, text: [
        `window ${o.size[0]}×${o.size[1]}, title "${win.getTitle()}"`,
        ...said,
        ...(pending ? [`A DIALOG IS OPEN (${pending.info.kind}): "${pending.info.title}" ${pending.info.detail}${pending.info.buttons ? `  buttons: ${pending.info.buttons.join(' / ')}` : ''}  → use: answer`] : []),
        ...(o.focus ? [`the keyboard is in: ${o.focus}`] : []),
        ...o.items.map(line),
        ...(o.cut ? [`… and ${o.cut} more things further down`] : []),
      ].join('\n') };
    },
    async click(c) {
      if (pending) return { error: `A dialog is open ("${pending.info.title}"). Answer it first.` };
      let at = c;
      if (c.text !== undefined) { const hit = await find(c.text, c.nth); if (hit.error) return hit; at = hit; }
      if (!(at.x >= 0 && at.y >= 0)) return { error: 'click needs a place (x y) or what the thing says' };
      await clickAt(at.x, at.y, { double: !!c.double, right: !!c.right, mods: (c.mods || []).map((m) => MODS[m.toLowerCase()]).filter(Boolean) });
      return { text: `clicked (${at.x},${at.y})${at.text ? ` ${at.kind} "${at.text}"` : ''}${c.double ? ' twice' : ''}` };
    },
    async drag(c) {
      // A thing the page lets you pick up (a cue row) is moved by the browser's own drag and drop, which mouse events
      // sent to a hidden window start and never finish. Its events are given to the page directly instead.
      const dnd = await page(`(async () => {
        const beat = () => new Promise((r) => setTimeout(r, 60));
        const from = document.elementFromPoint(${Math.round(c.x)}, ${Math.round(c.y)});
        const el = from && from.closest('[draggable="true"]');
        if (!el) return false;
        const dt = new DataTransfer();
        const ev = (type, x, y) => new DragEvent(type, { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, dataTransfer: dt });
        el.dispatchEvent(ev('dragstart', ${Math.round(c.x)}, ${Math.round(c.y)}));
        await beat();
        const to = document.elementFromPoint(${Math.round(c.x2)}, ${Math.round(c.y2)}) || document.body;
        to.dispatchEvent(ev('dragenter', ${Math.round(c.x2)}, ${Math.round(c.y2)}));
        to.dispatchEvent(ev('dragover', ${Math.round(c.x2)}, ${Math.round(c.y2)}));
        await beat();
        to.dispatchEvent(ev('drop', ${Math.round(c.x2)}, ${Math.round(c.y2)}));
        el.dispatchEvent(ev('dragend', ${Math.round(c.x2)}, ${Math.round(c.y2)}));
        return true;
      })()`);
      if (dnd) { await sleep(150); return { text: `dragged (${c.x},${c.y}) → (${c.x2},${c.y2})` }; }
      mouse('mouseMove', c.x, c.y); await sleep(40); mouse('mouseDown', c.x, c.y);
      for (let i = 1; i <= 8; i++) { mouse('mouseMove', c.x + (c.x2 - c.x) * i / 8, c.y + (c.y2 - c.y) * i / 8, { mods: ['leftButtonDown'] }); await sleep(30); }
      mouse('mouseUp', c.x2, c.y2);
      return { text: `dragged (${c.x},${c.y}) → (${c.x2},${c.y2})` };
    },
    async scroll(c) {
      wc.sendInputEvent({ type: 'mouseWheel', x: Math.round(c.x), y: Math.round(c.y), deltaX: 0, deltaY: -Number(c.by || 300), canScroll: true });
      return { text: `scrolled ${c.by || 300} at (${c.x},${c.y})` };
    },
    async type(c) {
      if (pending) return { error: `A dialog is open ("${pending.info.title}"). Answer it first.` };
      await wc.insertText(String(c.text));
      return { text: `typed "${c.text}"` };
    },
    async key(c) {
      if (pending) return { error: `A dialog is open ("${pending.info.title}"). Answer it first.` };
      const { key, mods } = parseKey(c.key);
      // a menu's shortcut is the operating system's to catch, so it is found here as the system would
      const want = accelKey(c.key);
      const m = mods.length ? menuItems().find((x) => x.item.accelerator && x.item.enabled && accelKey(x.item.accelerator) === want) : null;
      if (m && !roleOf(m)) return { text: `pressed ${c.key}: the menu's ${choose(m)}` };
      if (m && !EDIT_ROLES[roleOf(m)]) return chooseRole(m);
      wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods });
      if (key.length === 1 && !mods.includes('meta') && !mods.includes('control')) wc.sendInputEvent({ type: 'char', keyCode: mods.includes('shift') ? key.toUpperCase() : key.toLowerCase(), modifiers: mods });
      else if (key === 'Space' && !mods.length) wc.sendInputEvent({ type: 'char', keyCode: ' ' });
      else if (key === 'Enter' && !mods.length) wc.sendInputEvent({ type: 'char', keyCode: '\r' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods });
      if (m && await typing()) wc[EDIT_ROLES[roleOf(m)]]();          // ⌘A, ⌘C, ⌘V, ⌘Z in a text field
      return { text: `pressed ${c.key}` };
    },
    async menus() {
      return { text: menuItems().map((m) => `${m.path.join(' ▸ ')}${m.item.accelerator ? `   [${m.item.accelerator.replace('CmdOrCtrl', MAC ? 'Cmd' : 'Ctrl')}]` : ''}${m.item.enabled ? '' : '   (greyed out)'}${m.item.checked ? '   ✓' : ''}`).join('\n') };
    },
    async menu(c) {
      if (pending) return { error: `A dialog is open ("${pending.info.title}"). Answer it first.` };
      const want = String(c.path).split(/\s*(?:>|▸)\s*/).map(plain);
      const hits = menuItems().filter((m) => { const p = m.path.map(plain); return want.length === 1 ? p[p.length - 1] === want[0] : p.length === want.length && p.every((x, i) => x === want[i]); });
      if (hits.length !== 1) return { error: hits.length ? `${hits.length} menu items are called that: give the whole path (File > Save).` : `There is no menu item "${c.path}". Use: menus` };
      if (!hits[0].item.enabled) return { error: `${hits[0].path.join(' ▸ ')} is greyed out.` };
      if (roleOf(hits[0])) return chooseRole(hits[0]);
      return { text: `chose ${choose(hits[0])}` };
    },
    async answer(c) {
      if (!pending) return { error: 'No dialog is open.' };
      const info = pending.info;
      if (c.cancel) { pending.finish(null); return { text: `cancelled "${info.title}"` }; }
      if (info.kind === 'message') {
        if (!info.buttons.some((b) => b.toLowerCase() === String(c.button || '').toLowerCase())) return { error: `Its buttons are: ${info.buttons.join(' / ')}` };
        pending.finish({ button: c.button }); return { text: `pressed "${c.button}" in "${info.title}"` };
      }
      const paths = (c.paths || []).map((p) => path.resolve(p));
      if (!paths.length) return { error: 'Say which file: answer <path>' };
      if (info.kind === 'open-file') { const gone = paths.find((p) => !fs.existsSync(p)); if (gone) return { error: `There is no ${gone}` }; }
      pending.finish({ paths }); return { text: `answered "${info.title}" with ${paths.join(', ')}` };
    },
    async choose(c) {
      let at = c;
      if (c.text !== undefined) { const hit = await find(c.text, c.nth); if (hit.error) return hit; at = hit; }
      const r = await page(`(() => {
        let el = document.elementFromPoint(${Math.round(at.x)}, ${Math.round(at.y)});
        while (el && el.tagName !== 'SELECT') el = el.parentElement;
        if (!el) return { error: 'That is not a drop-down list.' };
        if (el.disabled) return { error: 'That drop-down list is disabled.' };
        const want = ${JSON.stringify(plain(c.option))};
        const norm = (s) => String(s).replace(/…/g, '').replace(/\\s+/g, ' ').trim().toLowerCase();
        const opt = [...el.options].find((o) => norm(o.textContent) === want) || [...el.options].find((o) => norm(o.textContent).includes(want));
        if (!opt) return { error: 'Its options are: ' + [...el.options].map((o) => o.textContent.trim()).join(' / ') };
        if (opt.disabled) return { error: 'That option is greyed out.' };
        el.value = opt.value;
        el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
        return { picked: opt.textContent.trim() };
      })()`);
      return r.error ? r : { text: `chose "${r.picked}" from the drop-down at (${at.x},${at.y})` };
    },
    // (for whoever is debugging the app, not for a virtual user: ec-user has no verb for it)
    async js(c) { try { return { text: JSON.stringify(await page(String(c.code))) }; } catch (err) { return { error: String(err) }; } },
    async hear() {
      const s = host.snapshot(false);
      const t = (x) => `${Math.floor(x / 60)}:${(x % 60).toFixed(1).padStart(4, '0')}`;
      // which of the device's outputs it comes out of, when not the first pair
      const where = (id) => { const c = host.engine.byId.get(id) || {}; const b = s.mixer.buses.find((x) => x.id === c.bus); return !b || !(b.out > 1) ? '' : b.noOutput ? `, SILENT: its bus (${b.name}) is sent to outputs ${b.out}–${b.out + 1}, which the device does not have` : `, on outputs ${b.out}–${b.out + 1} only (${b.name})`; };
      const lines = s.engine.active.map((a) => a.mic ? `🎙 ${a.number ? `${a.number} ` : ''}"${a.name}": a live input, open at ${Number(a.db).toFixed(1)} dB${a.fadingTo != null ? ` (fading to ${a.fadingTo} dB)` : ''} for ${t(a.elapsed)}${where(a.id)}` : a.kind === 'audio'
        ? `♪ ${a.number ? `${a.number} ` : ''}"${a.name}" at ${Number(a.db).toFixed(1)} dB${a.fadingTo != null ? ` (fading to ${a.fadingTo} dB)` : ''}, ${t(a.elapsed)} of ${t(a.total)}${a.loop ? ', looping' : ''}${a.holding ? (a.count ? `, pass ${a.count.pass} of ${a.count.of} of a counted section` : ', held in a loop') : ''}${a.paused ? ', PAUSED' : ''}${where(a.id)}`
        : `… ${a.number ? `${a.number} ` : ''}"${a.name}" is waiting (${t(a.elapsed)} of ${t(a.total)})${a.paused ? ', PAUSED' : ''}`);
      return { text: [`(A test session makes no sound. This is what would be coming out of the speakers.)`, ...(lines.length ? lines : ['Silence.'])].join('\n') };
    },
    async stop() { setTimeout(() => { host.stop(); app.exit(0); }, 150); return { text: 'the app is closed' }; },
  };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', async () => {
      let c = {}, r;
      try { c = JSON.parse(body || '{}'); r = ops[c.op] ? await ops[c.op](c) : { error: `unknown: ${c.op}` }; }
      catch (err) { r = { error: `the app failed: ${err.message}` }; log(`[drive] ${c.op}: ${err.stack || err}`); }
      const { op, ...args } = c;
      write({ op, args, ...(r.error ? { error: r.error } : { did: r.shot ? path.basename(r.shot) : r.text.split('\n')[0] }) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(r));
    });
  });
  server.listen(0, '127.0.0.1', () => {
    fs.writeFileSync(path.join(dir, 'door.json'), JSON.stringify({ port: server.address().port, pid: process.pid }));
    log(`[drive] a virtual user's session: ${dir}`);
  });
  win.showInactive();               // drawn, so it can be pictured, without taking the keyboard from whoever is working
}

module.exports = { open, parseKey, accelKey };
