// The assistant's face: QIRX-G, a robot puppet from Endless Forms (the show this app was made to run), drawn as
// one flat shape in the colour of the words around it: the whole head (an angular block with a cupped top and two
// wings) with the pentagon window of its one eye cut out of it. Its outline and the eye's corners are traced from a
// photograph of the real head. docs/brand-assistant.md says where it may appear.
//
// The eye lights only while the assistant is answering: G's own lamp colour (255, 222, 0 in the puppet's firmware),
// brightening and dimming (steady with reduced motion). Otherwise it is an empty window. Words say the state too.
// That yellow lives only inside the eye (styles.css `--qirx-lamp`; nothing else may use it) and only while it
// answers, so it is never mistaken for standing by; a waiting change is shown by the app's own dot and words.
import { html, ec, cx, keys } from './lib.js';
import type { State, Info, CueList } from './lib.js';

// The drawing, in a box 28.9 wide and 24 tall.
const BOX = '0 0 28.9 24';
// the head's outline, made symmetrical (the photograph it was traced from was taken at a slight angle): from the
// middle of the cupped top, round the left horn and wing to the chin, then the mirror image back up the right
const BODY = 'M14.45 5.75L12 5.5L9.3 4.6L6.5 2.8L3.65 0.3L2.7 1L2.2 3L1.6 5.9L0.15 12.1L0.6 13.3L2.2 14.9L6.6 19.3L13.2 23.6L14.45 24L15.7 23.6L22.3 19.3L26.7 14.9L28.3 13.3L28.75 12.1L27.3 5.9L26.7 3L26.2 1L25.25 0.3L22.4 2.8L19.6 4.6L16.9 5.5Z';
// the eye's window: five corners, point down, on the head's centre line
const EYE = '11,9.9 17.9,9.9 19.5,15.55 14.45,18.7 9.4,15.55';
const ratio = 28.9 / 24;
/** What the head shows: asleep, awake, thinking (its eye lit) or waiting (changes to look at). */
export type QirxMood = 'asleep' | 'awake' | 'thinking' | 'waiting';
// the head with the eye cut out of it
const HEAD = `${BODY}M${EYE.split(' ').join('L')}Z`;

/** What the assistant is doing, from the host's state: { state: asleep | awake | thinking | waiting, why, words }.
 *  `words` is the state in a few plain words ('' when it is simply ready). */
export function qirxState(s: State): { state: QirxMood; why: string; words: string } {
  const a = s.assistant || {};
  if (s.mode === 'show') return { state: 'asleep', why: 'show', words: 'asleep in Show mode' };
  if (!a.available) return { state: 'asleep', why: 'off', words: 'off' };
  if ('busy' in a && a.busy) return { state: 'thinking', why: '', words: 'thinking' };
  if (s.proposal) { const n = ((s.proposal.changes || []).length + (s.proposal.files || []).length) || 1; return { state: 'waiting', why: '', words: `${n} change${n === 1 ? '' : 's'} to look at` }; }
  return { state: 'awake', why: '', words: '' };
}

/** The head, `size` pixels tall, in the colour of the words around it; its eye lit while it answers. With no
 *  `label` it is decoration beside words that already say it. */
export function Qirx({ size = 44, state = 'awake', label = '' }: { size?: number; state?: QirxMood; label?: string }) {
  return html`<svg class="qirx" data-qirx=${state} viewBox=${BOX} width=${Math.round(size * ratio)} height=${size} role=${label ? 'img' : null} aria-label=${label || null} aria-hidden=${label ? null : 'true'}>
    <polygon class="lamp" points=${EYE} /><path class="head" fill-rule="evenodd" d=${HEAD} /></svg>`;
}

/** The same head on a button or a badge, sized by the text beside it. */
export function QirxSign({ state = 'awake' }: { state?: QirxMood } = {}) {
  return html`<svg class="qirx qirx-sign" data-qirx=${state} viewBox=${BOX} aria-hidden="true"><polygon class="lamp" points=${EYE} /><path class="head" fill-rule="evenodd" d=${HEAD} /></svg>`;
}

/** The resident: the head in the side panel, above the mixer, in a row of its own so that it never covers
 *  anything. The head is small, about the height of the words it stands before. A click opens the assistant; a right-click offers to hide it (Settings ▸ Assistant brings it back). */
export function Resident({ s, info, open, isOpen, refreshInfo }: { s: State; info: Info | null; open: () => void; isOpen: boolean; refreshInfo?: () => void }) {
  const q = qirxState(s);
  const view: Partial<Info['view']> = (info && info.view) || {};
  const empty = !s.doc.lists.some((l: CueList) => l.cues.length);
  // on a new, empty show, once: the first thing to ask for. Any click on the resident ends it for good.
  const hint = q.state === 'awake' && empty && view.qirxHint !== false ? 'Start from a folder of sounds…' : '';
  const set = async (change: Record<string, unknown>) => { await ec.app({ op: 'view', view: change }); if (refreshInfo) refreshInfo(); };
  const click = () => { if (view.qirxHint !== false) set({ qirxHint: false }); open(); };
  const menu = async (ev: MouseEvent) => {
    ev.preventDefault();
    const r = await ec.app({ op: 'cue-menu', items: [{ id: 'open', label: 'Ask the Assistant' }, { sep: true }, { id: 'hide', label: 'Hide the QIRX' }] });
    if (r && r.picked === 'hide') set({ qirx: false }); else if (r && r.picked === 'open') open();
  };
  const words = q.words || hint;
  return html`<button class=${cx('resident', isOpen && 'on')} data-resident=${q.state} data-why=${q.why} aria-pressed=${isOpen ? 'true' : 'false'}
      title=${keys(`Ask the assistant (⌘K)${q.words ? ` · ${q.words}` : ''}\nRight-click to hide it`)} onClick=${click} onContextMenu=${menu}>
    <span class="rwords"><b><${Qirx} size=${18} state=${q.state} />Ask the assistant <span class="kbd">${keys('⌘K')}</span></b>
      ${words ? html`<span class="rstate" data-resident-words>${q.state === 'waiting' ? html`<span class="dot standby"></span>` : null}${words}</span>` : null}</span>
  </button>`;
}
