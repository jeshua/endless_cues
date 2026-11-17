/**
 * Every key the window answers to, in one table: the menus are built from it (app/main/main.js), the window's own
 * handler and Settings ▸ Keys read it (app/renderer/lib.js, handed it by the preload), and the assistant's guide
 * to the app is written from it (core/assistant/app-guide.js). So a key changed here is changed everywhere, and
 * the guide cannot say a key the app does not have.
 *
 *   ACTIONS   the single keys that run the show and edit the list, each with the key it comes with; a person may
 *             give an action other keys in Settings ▸ Keys (kept on this computer, not here)
 *   MENU      the menus' shortcuts, as Electron writes an accelerator, with the menu item each is on
 *   PAGE      the ⌘ keys the window handles itself (no menu item has them), as they are shown
 *   SHOWN     the list Settings ▸ Keys shows under "Fixed": a label and a menu id (or several), or the keys as shown
 *
 * Nothing here needs a window or Electron: it is data and two small functions.
 */

// [id, what it does, its keys as KeyboardEvent.key names (the first is the one the action is known by)]
const ACTIONS = [
  ['Running the show', [
    ['go', 'GO', [' ']], ['panic', 'Panic (again: stop dead)', ['Escape']], ['up', 'Playhead up', ['ArrowUp']], ['down', 'Playhead down', ['ArrowDown']],
    ['nextSeq', 'Next cue that needs a GO', ['=']], ['prevSeq', 'Previous cue that needs a GO', ['-']],
    ['pauseAll', 'Pause all', ['[']], ['resumeAll', 'Resume all', [']']], ['pauseCue', 'Pause / resume the selected cue', ['p']],
    ['stopCue', 'Fade out and stop the selected cue (again: dead)', ['s']], ['holdRegion', 'Hold the next loop / let go', ['l']],
    ['hold', 'Hold the section it is in', ['h']], ['arm', 'Arm / disarm the selected cue', ['a']], ['audition', 'Audition the selected cue', ['v']]]],
  ['Editing', [
    ['rename', 'Rename', ['q', 'Enter']], ['number', 'Number', ['n']], ['notes', 'Notes', ['o']], ['target', 'Target, or a sound’s file', ['t']],
    ['preWait', 'Pre-wait', ['e']], ['duration', 'Duration', ['d']], ['postWait', 'Post-wait', ['w']], ['continue', 'Continue mode', ['c']], ['flag', 'Flag', ['f']],
    ['startHere', 'Start at where it is playing', ['shift+i']], ['endHere', 'End at where it is playing', ['shift+o']],
    ['delete', 'Delete', ['Backspace', 'Delete']], ['collapse', 'Fold every group (sections stay)', ['<']], ['expand', 'Unfold every group', ['>']],
    ['fold', 'Fold the selected section or group', ['ArrowLeft']], ['unfold', 'Unfold the selected section or group', ['ArrowRight']]]],
];

// [id, accelerator, what it does, the menu item it is on]. `Settings…` is in the app's own menu on a Mac and in File
// elsewhere; the reload is the developers' (View ▸ Reload).
const MENU = [
  ['settings', 'CmdOrCtrl+,', 'Settings', 'Endless Cues ▸ Settings… (File ▸ Settings… on Windows and Linux)'],
  ['newShow', 'CmdOrCtrl+N', 'New show', 'File ▸ New Show'],
  ['open', 'CmdOrCtrl+O', 'Open a show', 'File ▸ Open…'],
  ['save', 'CmdOrCtrl+S', 'Save a version', 'File ▸ Save'],
  ['saveNote', 'Shift+CmdOrCtrl+S', 'Save with a note', 'File ▸ Save with a Note…'],
  ['addSounds', 'Shift+CmdOrCtrl+O', 'Add sounds', 'File ▸ Add Sounds…'],
  ['cut', 'CmdOrCtrl+X', 'Cut', 'Edit ▸ Cut'],
  ['copy', 'CmdOrCtrl+C', 'Copy', 'Edit ▸ Copy'],
  ['paste', 'CmdOrCtrl+V', 'Paste', 'Edit ▸ Paste'],
  ['pasteProps', 'Alt+CmdOrCtrl+V', 'Paste cue properties', 'Edit ▸ Paste Cue Properties…'],
  ['showMode', 'CmdOrCtrl+Shift+M', 'Show mode, or back to Edit', 'View ▸ Show Mode'],
  ['live', 'CmdOrCtrl+L', 'Live mixer', 'View ▸ Live Mixer (once the Live view is shown)'],
  ['rig', 'CmdOrCtrl+Shift+R', 'The Rig', 'View ▸ Rig'],
  ['assistant', 'CmdOrCtrl+K', 'Assistant', 'View ▸ Assistant'],
  ['versions', 'CmdOrCtrl+Shift+V', 'Versions', 'View ▸ Versions'],
  ['monitor', 'CmdOrCtrl+Shift+N', 'Network and MIDI monitor', 'View ▸ Network and MIDI Monitor'],
  ['log', 'Alt+CmdOrCtrl+L', 'Show log', 'View ▸ Show Log'],
  ['blackout', 'CmdOrCtrl+Shift+B', 'Stage blackout, or back', 'View ▸ Black Out the Stage'],
  ['lights', 'CmdOrCtrl+Shift+D', 'Light dashboard', 'View ▸ Light Dashboard'],
  ['reload', 'Alt+CmdOrCtrl+R', 'Reload the window', 'View ▸ Reload'],
  ['loadToTime', 'CmdOrCtrl+T', 'Load to time', 'Tools ▸ Load to Time…'],
  ['jump', 'CmdOrCtrl+J', 'Jump to cue', 'Tools ▸ Jump to Cue…'],
  ['find', 'CmdOrCtrl+F', 'Find', 'Tools ▸ Find…'],
  ['renumber', 'CmdOrCtrl+R', 'Renumber the selection', 'Tools ▸ Renumber Selected Cues…'],
  ['target', 'CmdOrCtrl+E', 'Go to the target', 'Tools ▸ Go to the Selected Cue’s Target'],
  ['checks', 'Shift+CmdOrCtrl+F', 'Check the show', 'Tools ▸ Check the Show'],
  ['ownList', 'Shift+CmdOrCtrl+L', 'This list in a window', 'Window ▸ This List in Its Own Window'],
  ['ownInspector', 'Shift+CmdOrCtrl+I', 'Inspector in a window', 'Window ▸ Inspector in Its Own Window'],
];

// [id, what it does, the keys as shown]: the window's own (app/renderer/app.js handles each)
const PAGE = [
  ['undo', 'Undo / redo', '⌘Z  ⇧⌘Z'], ['selectAll', 'Select all', '⌘A'], ['duplicate', 'Duplicate', '⌘D'],
  ['group', 'Group · Ungroup', '⌘G  ⇧⌘G'], ['move', 'Move cue up / down', '⌥⌘↑  ⌥⌘↓'], ['extend', 'Extend the selection', '⇧↑  ⇧↓'],
  ['addCue', 'Add a cue (toolbar order)', '⌘1 … ⌘0'], ['zoom', 'Zoom the cue list out / in / back', '⌘−  ⌘=  ⌘0'],
];

// Settings ▸ Keys, "Fixed": [label, menu ids separated by spaces, or a page id]
const SHOWN = [['Find', 'find'], ['Load to time', 'loadToTime'], ['Jump to cue', 'jump'], ['Renumber the selection', 'renumber'], ['Undo / redo', 'undo'], ['Select all', 'selectAll'], ['Duplicate', 'duplicate'],
  ['Cut · Copy · Paste cues', 'cut copy paste'], ['Paste cue properties', 'pasteProps'], ['Go to the target', 'target'], ['Check the show', 'checks'], ['Group · Ungroup', 'group'], ['Move cue up / down', 'move'], ['Extend the selection', 'extend'], ['Add a cue (toolbar order)', 'addCue'], ['Zoom the cue list', 'zoom'],
  ['Save a version', 'save'], ['Save with a note', 'saveNote'], ['Add sounds', 'addSounds'], ['Versions', 'versions'], ['Live mixer', 'live'], ['Assistant', 'assistant'], ['Monitor', 'monitor'], ['Show log', 'log'], ['The Rig', 'rig'],
  ['Lights dashboard', 'lights'], ['Stage blackout, or back', 'blackout'], ['This list in a window', 'ownList'], ['Inspector in a window', 'ownInspector'], ['Show mode', 'showMode'], ['Settings', 'settings'], ['New show · Open', 'newShow open']];

const byId = (rows) => Object.fromEntries(rows.map((r) => [r[0], r]));
const MENU_BY_ID = byId(MENU), PAGE_BY_ID = byId(PAGE);

/** An accelerator as a Mac writes it: "Shift+CmdOrCtrl+S" → "⇧⌘S". (The window's keys() makes Ctrl+Shift+S of it elsewhere.) */
function glyphs(accel) {
  const parts = String(accel).split('+');
  const key = parts.pop() || '+';
  const has = (w) => parts.some((p) => p.toLowerCase() === w);
  return `${has('alt') ? '⌥' : ''}${has('shift') ? '⇧' : ''}${has('cmdorctrl') || has('cmd') || has('ctrl') || has('commandorcontrol') ? '⌘' : ''}${key.length === 1 ? key.toUpperCase() : key}`;
}
/** A menu item's accelerator, for main.js. Throws on an id that is not in the table, so a typo cannot drop a key. */
function accel(id) { const r = MENU_BY_ID[id]; if (!r) throw new Error(`no menu key "${id}"`); return r[1]; }
/** The keys for one SHOWN line: a page id's own, or each menu id's accelerator. */
function shownKeys(ref) {
  if (PAGE_BY_ID[ref]) return PAGE_BY_ID[ref][2];
  return ref.split(' ').map((id) => glyphs(accel(id))).join('  ');
}

/** A single key as its cap shows it (the default keys of ACTIONS): " " → Space, "Escape" → Esc, "shift+i" → ⇧I. */
const CAP = { ' ': 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backspace: '⌫', Delete: 'Del', Enter: 'Enter' };
const cap = (k) => (CAP[k] || (/^shift\+/.test(k) ? `⇧${k.slice(6).toUpperCase()}` : k.length === 1 ? k.toUpperCase() : k));

/** What the window is handed (the preload asks for it once, before the page's modules load). */
function forPage() {
  return { actions: ACTIONS, fixed: SHOWN.map(([label, ref]) => [label, shownKeys(ref)]) };
}

/** Every key, flat, for looking one up: [{ id, what, keys (Mac glyphs), where, kind: 'single' | 'menu' | 'page' }]. */
function all() {
  return [
    ...ACTIONS.flatMap(([group, list]) => list.map(([id, what, ks]) => ({ id, what, keys: ks.map(cap).join(' or '), where: group, kind: 'single' }))),
    ...MENU.map(([id, a, what, where]) => ({ id, what, keys: glyphs(a), where, kind: 'menu' })),
    ...PAGE.map(([id, what, ks]) => ({ id, what, keys: ks.replace(/\s{2,}/g, ' · '), where: 'the cue list', kind: 'page' })),
  ];
}

module.exports = { ACTIONS, MENU, PAGE, SHOWN, glyphs, accel, shownKeys, cap, forPage, all };
