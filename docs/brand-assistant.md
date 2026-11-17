# The assistant's face: QIRX-G

*A development note: the rules for how the assistant looks and speaks in the app, written for whoever changes it.*

The QIRX are three robot puppets from *Endless Forms*, the show this app was made to run: hand-made metal heads,
each with one lamp for an eye. The assistant's face is **QIRX-G**, the whole head drawn flat: the angular block
with its cupped top and two wings in a few tones of metal, and in the middle the pentagon window of its eye. It is a
drawing, not a photograph (photographs were tried and the owner chose the drawing); its outline and the eye's five
corners are traced from a photograph of the real head, so the proportions are true.

## Where it appears

| Place | What | Size |
|---|---|---|
| The side panel, above the mixer | **The resident**: "Ask the assistant", the key, and the head. A click opens the drawer. | 44 px |
| The title bar's Assistant button | The sign: the head in the colour of the words, the eye cut out of it, showing no state | 13 px |
| The assistant drawer's header | The sign, beside "Assistant" | 13 px |
| The drawer's first screen | The head beside the first line | 48 px |
| Beside each of its replies, and while it thinks | The head, small | 18 px |
| The drawer in Show mode | The head asleep, with "Asleep in Show mode." | 48 px |
| Settings ▸ Assistant | The head beside the heading, and the switch that hides the resident | 30 px |
| Settings ▸ About | One line saying what the QIRX are | 30 px |

Nowhere else. Not in a cue row, the inspector, a menu, the review card (that is the person's decision), the Rig
page, the stage or any output window, or the web remote.

**Why the side panel.** The resident has a row of its own there, between Active cues and the mixer, so it can
never cover a control, a cue row's end, the Playing strip, the inspector or a drawer, at any window size; when the
panel is short the panel scrolls. Laid over the corner of the cue list it would have sat on the last rows'
post-waits.

## What the eye says

Always with words as well: colour and movement never carry a meaning alone here.

| State | The eye | The words | When |
|---|---|---|---|
| asleep | the milky, unlit window; dimmed | "off", or "asleep in Show mode" | Nobody is set to answer, or the app is in Show mode |
| awake | lit low, still | none | Ready |
| thinking | brightens and dims slowly, up to the full lamp | "thinking" | A request is being worked on |
| waiting | lit low, with the app's yellow dot beside it | "3 changes to look at" | A change is waiting for review |

## Rules

- **In Show mode it is asleep, dimmed, and nothing of it moves.** A show never has a mascot moving in the
  operator's eye.
- **One animation exists: the thinking eye** (the opacity of the full lamp over the low one, nothing else).
  `prefers-reduced-motion` holds it lit; the word says "thinking" either way.
- **G's eye is yellow, and yellow here means standing by.** The lamp is the puppet's own colour (255, 222, 0 in
  its firmware). So: that yellow and its low version live only inside the glyph (`--qirx-lamp`, `--qirx-rest`
  in `styles.css`), and no control, text or chip uses them; at rest the lamp is low (a dark mustard, well under
  `--standby`'s brightness) and is fully lit only while thinking; "a change is waiting" is never the eye alone,
  always the app's own yellow dot and the words; and the sign on a button shows no state at all, so that a lit
  eye never sits in the title bar beside the unsaved chip.
- **It is quiet.** It does not bounce, speak, pop up or offer tips. One exception: on a new, empty show the
  resident says "Start from a folder of sounds…" once, and any click on it ends that for good.
- **It can be hidden**: right-click the resident ▸ *Hide the QIRX*, or Settings ▸ Assistant ▸ *Show the QIRX*.
  That is remembered on this computer (`view.qirx` in `config.json`); the title-bar button stays.
- **It is "the assistant" in every sentence that tells someone what to do.** "QIRX" is its name where a name
  belongs (About, and the switch that hides it). It has no personality, voice or backstory in the app beyond
  About's one line.
- **Who answers is said in words** (the drawer's badge: "built-in helper", a model's name), never by the eye.
- **Few words.** The drawer and everything the eye touches: a heading is two to four words, a row is a label and
  at most five words, nothing explains what a button plainly does, no brackets.

## The drawing

`app/renderer/Qirx.js`: `Qirx` (the eye with a state), `QirxSign` (the plain sign), `Resident`, and `qirxState`
(the state and its words, from what the host pushes). The pentagon is one line of five points (`EYE`), traced
from a photograph of the real eye's window; the colours are four custom properties at the top of the QIRX block
in `styles.css`. There are no image files.
