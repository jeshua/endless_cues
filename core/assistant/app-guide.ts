/**
 * How to use the app, for the assistant: what is on the screen, where things are, and every key. It is what
 * read_reference answers for "app", "screens" and "keys", so it costs nothing until a question needs it (the fixed
 * prompt only says it is there).
 *
 * The screens are written here by hand, short, one item a thing a person looks for. Each item names the place it is
 * about in [brackets], a name in core/ui/places.js, so the model knows what show_in_app can point at; a test checks
 * that every name in brackets is one. The keys are not written here: they are core/ui/keys.js's, the table the menus
 * and the window are built from, so the guide cannot say a key the app does not have.
 *
 * The built-in helper (helper.js, no model) answers "where is…" and "what is the key for…" from the same items:
 * `ask` is the words a person uses for the thing, `keys` the ids of its keys in core/ui/keys.js.
 */
import * as uiKeys from '../ui/keys';
import * as places from '../ui/places';

// [heading, [{ at: the place, ask: what a person says, keys: key ids, text }]]. Keys in the text are written as a
// Mac shows them; the reader is told ⌘ is Ctrl elsewhere.
const SCREENS = [
  ['The title bar', [
    { at: 'tab:edit', ask: /\bedit (tab|mode)\b/, text: 'Edit [tab:edit]: the cue list, editable.' },
    { at: 'tab:rig', ask: /\brig\b|pre-?show check|equipment|devices?\b/, keys: ['rig'], text: 'Rig [tab:rig]: what the show depends on (devices, files, its script, the checklist) and whether each part is ready, worst first; Try on a device sends it one command; Look for props finds the kit’s props on the network.' },
    { at: 'tab:show', ask: /show mode|lock(ed)? (the )?(show|editing)|perform/, keys: ['showMode'], text: 'Show [tab:show]: the same list with editing locked, for the performance. The assistant sleeps there and points at nothing.' },
    { at: 'tab:live', ask: /live (view|mixer|tab)|clip slots?|crossfader/, keys: ['live'], text: 'Live [tab:live]: a mixing desk with clip slots; hidden until Settings ▸ General ▸ Show the Live view. Hiding it never changes what the show plays.' },
    { at: 'list-picker', ask: /(another|other|second|switch) (cue )?lists?/, text: 'With more than one list, a menu beside the tabs [list-picker] chooses the list on screen; a cart (a grid of buttons) is a kind of list.' },
    { at: 'undo', ask: /\b(undo|redo)\b/, keys: ['undo'], text: '↶ ↷ [undo]: undo and redo every edit, the assistant’s too.' },
    { at: 'save', ask: /\bsave\b|keep (my |the )?(changes|show|edits)|unsaved|not saved/, keys: ['save', 'saveNote'], text: 'Save · N [save]: nothing is kept until it is pressed; N counts what is not saved yet and hovering lists it. Each save is a version; Save with a Note names it.' },
    { at: 'more-menu', ask: /⋯|more menu|three dots|dots menu/, text: '⋯ [more-menu]: Versions [versions], Light Dashboard [lights], Network and MIDI Monitor [monitor], Show Log [log], Network in the Side Panel, and Report a Problem.' },
    { at: 'versions', ask: /versions?|earlier (save|version)|go back to (an? )?(earlier|older|saved)|restore|backups?/, keys: ['versions'], text: 'Versions (in ⋯ [versions]): every save, newest first; compare one with now or with another, restore one (undoable); timed backups at its foot.' },
    { at: 'log', ask: /show log|what (was|got) played|history of (the )?show/, keys: ['log'], text: 'Show Log (in ⋯ [log]): what was played and done, sitting by sitting, with a search.' },
    { at: 'monitor', ask: /monitor|messages? (sent|arriv|in|out)|what was sent|osc in|midi in/, keys: ['monitor'], text: 'Network and MIDI Monitor (in ⋯ [monitor]): every message sent and heard, and why.' },
    { at: 'lights', ask: /light (dashboard|faders?)|dmx|fixtures?/, keys: ['lights'], text: 'Light Dashboard (in ⋯ [lights]): the app’s own lights, live, once Settings ▸ Integrations ▸ Light has some.' },
    { at: 'assistant', ask: /assistant( button)?|qirx/, keys: ['assistant'], text: 'Assistant [assistant]: this drawer. Its ⚙ [assistant-settings] chooses who answers.' },
    { at: 'settings-button', ask: /\bsettings\b|preferences|options/, keys: ['settings'], text: '⚙ [settings-button]: Settings (its panes are below).' },
    { at: 'updates', ask: /\bupdates?\b|new version|upgrade/, text: 'A new version is a line in the title bar [updates] with Download and Restart; never in Show mode. Settings ▸ General has the automatic check.' },
  ]],
  ['The masthead (under the title bar)', [
    { at: 'go', ask: /\bgo\b( button)?|fire the (next )?cue|run the (next )?cue/, keys: ['go'], text: 'GO [go]: fires the cue standing by and moves the playhead on. Pressed twice too fast, the second is ignored (Settings ▸ General).' },
    { at: 'standing-by', ask: /standing by|playhead|next cue|which cue (is )?next/, keys: ['up', 'down', 'nextSeq'], text: 'Standing by [standing-by]: the cue the next GO fires, its notes (+ note adds one), what follows, and how many cues this GO starts. ↑ ↓ move the playhead; = and - go to the next or previous cue that needs a GO.' },
    { at: 'panic', ask: /panic|stop (everything|all|it all)|emergency|kill (the )?sound/, keys: ['panic'], text: 'Panic [panic]: fades everything out; pressed again, stops dead.' },
    { at: 'pause-all', ask: /pause (all|everything)|resume (all|everything)/, keys: ['pauseAll', 'resumeAll'], text: 'Pause all [pause-all], then Resume all.' },
    { at: 'fade-all', ask: /fade (all|everything)( out)?/, text: 'Fade all [fade-all]: everything out over 5 s.' },
    { at: 'reset', ask: /\breset\b|back to the (top|start)|start (again|over)/, text: 'Reset [reset] (Edit mode): stops everything and puts the playhead at the top; while sound plays it asks once more.' },
  ]],
  ['The cue list', [
    { at: 'add-cue', ask: /add (a |an )?(new )?cue|new cue|make a cue|toolbar/, keys: ['addCue'], text: 'The add-cue bar [add-cue] (Edit mode): the common cue types [add-type:fade]; a button adds one after the selection, Audio asks for a sound first, and a button dragged onto the list puts it there.' },
    { at: 'add-cue-more', ask: /other (cue )?types?|more (cue )?types|\+ button|plus button|every (cue )?type/, text: '+ [add-cue-more]: every other cue type; type to find one.' },
    { at: 'cue-list', ask: /cue list|the list\b|rows?\b/, keys: ['rename', 'number', 'preWait', 'duration', 'postWait'], text: 'The cue list [cue-list]: a row a cue, with its number, name, target, times and continue. Double-click a value to type it (or Q, N, E, D, W on the selected row); drag rows to move them; right-click a row for its menu (Colour, Duplicate, Run from Here, Delete…). One cue is a row: cue:<number> points at it.' },
    { at: 'cue-list', ask: /chains?|auto-?(continue|follow)|continues?\b|start together/, keys: ['continue'], text: 'Chains: cues that one GO starts together are joined by a line down the left; a cue’s continue mode (C cycles it) chains it to the next: auto-continue with it, auto-follow when it ends.' },
    { at: 'row-stop', ask: /stop (a|one|this|that|the) (cue|sound|track)|■|row'?s? stop/, keys: ['stopCue'], text: 'A playing row has its own ■ [row-stop] (fades it out; again, or with ⌥, stops dead) and a level meter [row-meter] (or “no output” when its bus has none).' },
    { at: 'cue-list', ask: /sections?|headings?|fold|collapse|expand/, keys: ['collapse', 'expand', 'fold', 'unfold'], text: 'Sections and folding: a Section is a heading over the cues after it (GO passes over it); its caret folds it; < and > fold every group; View ▸ Fold All Sections; the strip of sections above the list jumps to one.' },
    { at: 'zoom', ask: /zoom|see (more|all|the whole)|whole (show|list)|smaller rows/, keys: ['zoom'], text: 'Zoom [zoom]: the whole list small, at a glance; also ⌘−, ⌘= and ⌘0, or a pinch.' },
    { at: 'find', ask: /\bfind\b|search|look for a cue/, keys: ['find', 'jump', 'loadToTime'], text: 'Find [find]: a strip over the list; Enter goes to the next match. Jump to Cue [jump-to-cue] by number; Load to Time [load-to-time] starts the cue standing by part-way in.' },
    { at: 'run-from', ask: /run from|rehearse from|start (from|in) the middle|from this cue/, text: 'Run from here [run-from] (Edit mode): works out what would be playing at that cue (levels, loops, fades) and starts there.' },
    { at: 'check', ask: /check (the |my )?show|problems?|broken|warnings?|missing (files?|sounds?)/, keys: ['checks'], text: 'Check [check], in the footer: what is broken, missing or odd, without playing anything; the footer also counts broken cues, warnings and flagged cues.' },
  ]],
  ['The inspector (under the list, in Edit mode: the selected cue)', [
    { at: 'inspector', ask: /inspector|(cue'?s?|its) (settings|properties|fields)/, text: 'The inspector [inspector]: the selected cue’s settings, in tabs. Rarely used fields wait under More. A field whose name needs explaining has an ⓘ: click it. Several cues selected: a change goes to all.' },
    { at: 'inspector-tab:basics', ask: /basics/, text: 'Basics [inspector-tab:basics]: number, name, notes [inspector-field:notes], colour [inspector-field:color], flag, armed, continue [inspector-field:continue], and the waits once one is set.' },
    { at: 'inspector-field:color', ask: /colou?r/, text: 'A cue’s colour: Basics ▸ Colour [inspector-field:color], six colours and … for any; or right-click the row ▸ Colour.' },
    { at: 'inspector-tab:type', ask: /(audio|fade|group|network|device|light|midi|video) tab|(sound|its) file|target/, keys: ['target'], text: 'The type’s own tab [inspector-tab:type], named after it: a sound’s file and level [inspector-field:gainDb], a fade’s target and how far, a group’s mode, a device’s command…' },
    { at: 'inspector-field:gainDb', ask: /level|volume|louder|quieter|\bgain\b/, text: 'A sound’s level: its Audio tab, Level [inspector-field:gainDb]; a bus’s level is its knob in the mixer.' },
    { at: 'inspector-tab:time', ask: /loops?|trim|start at|end at|markers?|waveform|tempo|automation|volume line|pan line|envelope/, keys: ['startHere', 'endHere', 'holdRegion'], text: 'Time & Loops [inspector-tab:time] (a sound): its waveform, where it starts and ends, loops and markers (dragged on it), its tempo, and lines over its length (Volume, Pan, an effect’s setting), each drawn and edited there.' },
    { at: 'inspector-tab:design', ask: /effects?|\beq\b|reverb|compressor|sound design|telephone|on the phone|under ?water|rack/, text: 'Sound design [inspector-tab:design] (a sound, a mic, a video): a rack of effects (eq, compressor, gate, delay, reverb, pitch…), each with its knobs and a power switch, in order; presets at the top.' },
    { at: 'inspector-tab:triggers', ask: /triggers?|hotkey|midi note|osc (address|trigger)|timecode trigger|from a (key|button)/, text: 'Triggers [inspector-tab:triggers]: what else fires the cue (a hotkey, a MIDI note, an OSC address, timecode, a time of day); the playhead stays. All triggers… lists the show’s.' },
    { at: 'audition', ask: /audition|preview|listen to (a|one|this|the) cue/, keys: ['audition'], text: 'Audition [audition]: plays the selected cue without moving the playhead.' },
  ]],
  ['The side panel (right)', [
    { at: 'active-cues', ask: /active cues|what('s| is) playing|running (cues|now)|time left/, text: 'Active cues [active-cues]: what is playing, each with pause, ■ and the time left; click a bar to skip there.' },
    { at: 'mixer', ask: /mixer|bus(es)?\b|knobs?|master/, text: 'The mixer [mixer]: a knob a bus (drag it, or Tab to it and use the arrows), the master fader [master], Defaults, ● Rec (records the outputs to the show folder), ⚙ (Settings ▸ Audio). A moved knob is kept only by Save.' },
    { at: 'network-panel', ask: /network (panel|messages)|sent messages/, text: 'Network [network-panel]: the last messages sent, once ⋯ ▸ Network in the Side Panel is ticked.' },
    { at: 'resident', ask: /side panel assistant|robot|head in the (side )?panel/, text: 'The assistant’s face [resident] opens this drawer; Settings ▸ Assistant can hide it.' },
  ]],
  ['The footer', [
    { at: 'report', ask: /report|\bbug\b|send (an? )?(idea|feedback)|feedback/, text: 'Report [report]: a problem or an idea for the makers, with a picture of the window; nothing is sent until Send.' },
    { at: 'output-device', ask: /output( device)?|sound card|(audio )?interface|speakers?/, text: 'The sound output [output-device]: opens Settings ▸ Audio.' },
  ]],
  ['Settings (⚙): its panes', [
    { at: 'settings:general', ask: /general settings|double[- ]go|panic (fade|time)|theme|row size|dark|appearance/, text: 'General [settings:general]: GO and safety (the double-GO guard, the panic fade), updates, the look (theme, row size, showing the Live view).' },
    { at: 'settings:show', ask: /show settings|numbering|templates?|timed backups?/, text: 'Show [settings:show]: the show’s own settings: numbering, templates, timed backups.' },
    { at: 'settings:audio', ask: /audio settings|routing|outputs?\b.*bus|ducking|monitor feed/, text: 'Audio [settings:audio]: the output device, the buses and the outputs each plays on, ducking, the monitor feed.' },
    { at: 'settings:network', ask: /network settings|osc (patch|control|in)|patch(es)?/, text: 'Integrations, along its top: Network [settings:network] (OSC patches, control from outside, passcodes), Video [settings:video] (the stage display), Light [settings:light] (the app’s own DMX), Triggers [settings:triggers] (every trigger in the show), Modules [settings:modules] (a lighting desk, MIDI, timecode…).' },
    { at: 'settings:assistant', ask: /who answers|choose (a )?model|api key|sign in/, text: 'Assistant [settings:assistant]: who answers, and signing in.' },
    { at: 'settings:keys', ask: /change (a|the|my) keys?|remap|rebind|keyboard shortcuts?|list of keys/, text: 'Keys [settings:keys]: every key; the single keys can be changed (on this computer), the ⌘ keys cannot.' },
    { at: 'settings:about', ask: /about|which version|licen[cs]e/, text: 'About [settings:about].' },
  ]],
];

const items = () => SCREENS.flatMap(([, list]) => list);
const keysOf = (ids = []) => {
  const all = uiKeys.all();
  return ids.map((id) => all.find((k) => k.id === id)).filter(Boolean);
};
const keyWords = (ids) => keysOf(ids).map((k) => `${k.what}: ${k.keys}`).join('; ');

function screensText() {
  return ['HOW TO USE THE APP. Names in [brackets] are places show_in_app can point at; cue:<number> is a cue’s row, settings:<pane> a pane.',
    ...SCREENS.flatMap(([head, list]) => [`${head}:`, ...list.map((it) => `- ${it.text}${it.keys && it.keys.length ? ` (${keyWords(it.keys)})` : ''}`)])].join('\n');
}

/** Every key, from the app's own table. */
function keysText() {
  const all = uiKeys.all();
  const line = (k) => `${k.keys} ${k.what}${k.kind === 'menu' ? ` (${k.where})` : ''}`;
  return ['KEYS (as they come; Settings ▸ Keys can change the single keys on a computer). On Windows and Linux ⌘ is Ctrl and ⌥ is Alt. The single keys work everywhere but in a field being typed in.',
    `Running the show: ${all.filter((k) => k.where === 'Running the show').map(line).join(' · ')}`,
    `Editing the selected cue: ${all.filter((k) => k.where === 'Editing').map(line).join(' · ')}`,
    `The cue list: ${all.filter((k) => k.kind === 'page').map(line).join(' · ')}`,
    `Menus: ${all.filter((k) => k.kind === 'menu').map(line).join(' · ')}`].join('\n');
}

/** read_reference's answer for the app: `part` is "app" (both), "screens" or "keys". */
function guide(part = 'app') {
  if (part === 'keys') return keysText();
  if (part === 'screens') return screensText();
  return `${screensText()}\n\n${keysText()}`;
}

/** Every [name] the guide's text uses. */
function namedPlaces() {
  const out = new Set();
  for (const it of items()) { out.add(it.at); for (const m of it.text.matchAll(/\[([a-z][a-z0-9:-]*)\]/gi)) out.add(m[1]); }
  return [...out];
}

/**
 * For the built-in helper: the item a "where is…" or "what is the key for…" question is about, or null. The first
 * item whose words are in the question wins, most specific first (a field before its tab, a tab before the list).
 */
const ORDER = ['inspector-field:', 'inspector-tab:', 'settings:', 'tab:'];
function find(question) {
  const q = ` ${String(question || '').toLowerCase().replace(/[?!.]+/g, ' ')} `;
  const rank = (it) => { const i = ORDER.findIndex((p) => it.at.startsWith(p)); return i < 0 ? ORDER.length : i; };
  const hits = items().filter((it) => it.ask.test(q));
  if (!hits.length) return null;
  hits.sort((a, b) => rank(a) - rank(b));
  const it = hits[0];
  return { at: it.at, text: it.text.replace(/\s*\[[^\]]+\]/g, ''), keys: keysOf(it.keys || []), place: places.resolve(it.at) };
}

export { guide, screensText, keysText, namedPlaces, find, SCREENS };
