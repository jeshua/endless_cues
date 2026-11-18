# 09 · QLab parity

A feature-by-feature comparison of Endless Cues (Public Alpha) with QLab 5. What is being done, and what is next, item by item, is [`../qlab-tracker.md`](../qlab-tracker.md); when a row here and a line there disagree, the tracker is the newer word.

**How it is made.** QLab's side is the official manual at <https://qlab.app/docs/v5/> (current to QLab 5.6.5), read page by page and written down as a flat inventory of about 1,900 features and behaviours, kept beside this document so any row can be checked:

- [`../internal/research/qlab-5/qlab-core-audio.md`](../internal/research/qlab-5/qlab-core-audio.md): workspace, cues, groups, lists, carts, inspector, tools, settings, audio (942 items)
- [`../internal/research/qlab-5/qlab-control-network.md`](../internal/research/qlab-5/qlab-control-network.md): network, OSC, MIDI, timecode, scripting, collaboration, remote (407 items)
- [`../internal/research/qlab-5/qlab-video-lighting.md`](../internal/research/qlab-5/qlab-video-lighting.md): video and lighting (574 items)

Our side is marked from the code and the tracker. Something the tracker calls "written, not run" is 🟡 unless a unit test or a smoke check covers it, and where a check uses a stand-in (a pretended eight-output device, a made signal in place of a microphone, a MIDI message handed to the host) the note says so.

**Limits.** The manual's screenshots were not read, so three command lists that exist only as images (the Keyboard, Workspace MIDI and OSC control tables) are known only in part. The OSC dictionary has 1,214 methods; the audio, video and settings families were listed by name, not read one by one. Nothing here was checked against a running copy of QLab.

**Marks.** ✅ we do it · 🟡 partly (the note says what exists) · ❌ we do not · ➕ we do it and QLab does not. The marks are strict: something the engine can do but no show file, key or button can reach is ❌ or 🟡, never ✅.

## Scorecard

Of 270 QLab features compared, we do 116 (43%), do 121 in part (45%) and lack 33 (12%). 27 rows are things we have and QLab does not.

| Area | ✅ | 🟡 | ❌ | ➕ |
|---|---|---|---|---|
| Workspace, window and modes | 12 | 8 | 2 | 1 |
| Cues: numbers, names, targets, appearance | 15 | 6 | 2 | 0 |
| Sequences and continue modes | 9 | 1 | 0 | 0 |
| Group cues | 10 | 0 | 1 | 1 |
| Cue lists and carts | 2 | 5 | 0 | 0 |
| GO, playhead and transport | 13 | 4 | 3 | 1 |
| Triggers and what a cue does to others | 4 | 5 | 0 | 1 |
| Inspector and editing tools | 10 | 8 | 1 | 1 |
| Cue types | 7 | 11 | 0 | 2 |
| Audio | 12 | 17 | 12 | 9 |
| Auditioning, overrides, status and logs | 3 | 5 | 0 | 1 |
| Network cues (out) | 6 | 7 | 3 | 1 |
| OSC control (in) | 7 | 9 | 2 | 0 |
| Show control broadcast (status out) | 0 | 3 | 1 | 0 |
| MIDI, MSC and timecode | 0 | 9 | 0 | 0 |
| Scripting and automation | 0 | 2 | 0 | 3 |
| Collaboration, remote and controllers | 0 | 4 | 2 | 0 |
| Video | 0 | 7 | 2 | 0 |
| Lighting | 1 | 5 | 1 | 1 |
| Saving, files and settings | 5 | 4 | 1 | 2 |
| Platform and licensing | 0 | 1 | 0 | 3 |
| **All** | **116** | **121** | **33** | **27** |

Rows are features of roughly equal weight to an operator, not manual pages, so read the proportions and not the decimals. Video and lighting are a handful of rows here and several hundred items in QLab's manual. A row marked ➕🟡 is counted under ➕. One row (recording the show's output) moved from the compared rows to the ➕ rows, since QLab does not do it; four ➕ rows are new.

## The short version

Endless Cues today is a cue list for sound, video on one stage, light over Art-Net and sACN, OSC, MIDI and timecode, with most of QLab's ways of building and running one: copy and paste (between shows too), Find, the single keys, cue templates, Paste Cue Properties, five group modes, lists with playheads of their own, cue carts, second windows, second triggers, a cue that ducks the others, Load, Reset and Target cues, a Triggers tab and a table of every trigger, a cue's own outputs as a matrix, OSC control over UDP and TCP with passcodes, and a QLab workspace opened directly. In a few places it goes past QLab (versions with diffs, an explicit save model with every pending change marked, a dry run, an assistant, a web remote, holds and counted loops inside a track, sACN, Windows and Linux builds). Against QLab as a whole it does two fifths, does a little more than that in part, and lacks a seventh.

**Read the 🟡 before the ✅.** Nearly half the rows are "partly", and for most of them the part that is missing is proof, not code. Almost all of this was written in a few days and is held up by unit tests and a smoke run. It has not been worked by a person's hands for long, and none of the MIDI, the timecode, the DMX, the output routing, the Mic cue, the stage or the remotes built for QLab has met real equipment. `CLAUDE.md` lists what has never been verified.

What a QLab user would hit, in the order they would hit it:

1. **Nothing has met its equipment.** No fixture has been lit, no projector driven, no MIDI or timecode device connected, no multi-output interface heard, and QLab Remote, the Stream Deck plugin and Companion have not been tried against the OSC control module.
2. **Video is one stage on one display.** No effects, masks, edge blending or mesh warps, no NDI, Syphon or Blackmagic, no rate or slices on a video, one font on a Text cue.
3. **Lighting has eight generic fixtures and your own, no library.** No fade curves, no pulls from another cue, no park or subcontrollers, no USB DMX.
4. **One audio device.** No plug-in effects, no gangs, no pan or trim on a cue; fade shapes are in dB only; a rate runs from 0.25 to 4 and keeps its pitch only on a streamed sound, which then has no exact loops.
5. **Editing lacks** Record Cue Sequence, a timeline view of a group, rich-text notes, named presets for Paste Cue Properties, typing a target's number in the list.
6. **Running lacks** hold-to-play on a cart button, triggers on a list, skip-if-disarmed, Load Last Selected, and status icons for tailing out or auditioning.
7. **Timecode is chased by the whole show, not per list**, with no freewheel setting, and cues are not stopped when timecode stops.
8. **A Script cue is a list of show commands, not AppleScript.** That is a decision, and it will still be a gap for anyone who scripts QLab.
9. **Main and backup is a module that has not run on two computers**, with no failover and no audio switch-over. Nobody else can edit a show while you do.
10. **Windows and Linux have never been launched by a person**, and the macOS build is not signed.

What is unfinished in our own code, independent of QLab, is in [Open on our side](#open-on-our-side).

---

## 1. Workspace, window and modes

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Show document with its settings | `.qlab5` file, optionally in a project folder | ✅ | A folder: `show.json`, `media/`, `versions/`, `backups/`, `logs/`. |
| Several windows on one show | Lists, carts and inspectors in their own windows | 🟡 | A list, a cart or the inspector in a window of its own (Window menu): more views of the one show. Smoke-checked for a cart and the inspector. One inspector; no status window, and Settings stays in the main window. |
| GO button, standby display, notes in a masthead | Yes | ✅ | Also "then …", DISARMED and LOADED badges, a show clock. |
| GO border green when armed | Yes | ✅ | |
| GO border red while double-GO protection blocks, flash on a blocked GO | Yes | ✅ | The red state is smoke-checked. |
| Notes editable in the masthead | Yes | ✅ | In Edit mode: “+ note”, or a click on the notes, in the masthead (smoke-checked). O still goes to them in the inspector. |
| Rich-text notes (styles, images) | Yes | ❌ | Plain text. |
| Toolbar, one button per cue type | Yes | ✅ | |
| Drag a cue type from the toolbar to a place in the list | Yes | 🟡 | Written: a type dragged from the toolbar lands between the cues it is dropped between. A test run cannot drag, so it has not been run. |
| Toolbox (reorderable; first ten get ⌘0–⌘9) | Yes | 🟡 | Fixed order; ⌘1–⌘0. |
| Resizable / hideable masthead, sidebar, inspector | Yes | 🟡 | Drawers open and close, and the inspector can go to its own window; no free resizing. |
| Cue list columns: status, type, number, name, target, pre-wait, duration, post-wait, continue | Yes | ✅ | |
| Every column editable in place | Double-click any cell | 🟡 | Number, name, pre-wait, duration and post-wait in place (the pre-wait is smoke-checked; the others written, not run); continue by click or C; target and notes in the inspector. |
| Status icons: running, paused, loaded, broken, warning, flagged | Yes | ✅ | |
| Status icons: tailing out, overridden, auditioning, crossfading | Yes | ❌ | The states do not exist. An output held back is a chip in the title bar, not an icon on a cue. |
| Footer: cue count, warnings button | Yes | ✅ | Problems are counted and listed in the footer. |
| Three row sizes | Yes | ✅ | Compact, normal and large (Settings ▸ General; this computer’s, not the show’s). Smoke-checked. |
| Edit mode and Show mode | Yes | ✅ | Show hides the toolbar and inspector and the host refuses edits. |
| Show mode asks before closing or quitting | Yes | 🟡 | We ask in either mode when there are unsaved changes or sound is playing. |
| Show mode suppresses OS interruptions (App Nap, sleep, ⌘Tab, Mission Control) | Preference | 🟡 | Display sleep is blocked. Nothing else. |
| Full screen | Yes | ✅ | The platform's own. |
| Launcher window (recents, templates, connect) | Yes | 🟡 | No launcher window: Open Recent and New Show from Template in the File menu, the last show reopens, a demo show. |
| Themes | Follows macOS dark mode | ➕ | Three themes, chosen per computer. |

## 2. Cues: numbers, names, targets, appearance

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Cue number is any text, may be empty | Yes | ✅ | |
| Cue numbers unique in the workspace | Enforced | 🟡 | A duplicate is a warning, not refused. |
| Auto-number new cues with an increment | Setting | ✅ | A new cue takes the next number, counting by the show’s step; Settings ▸ Show switches it off (smoke-checked). |
| Renumber selected (start, step, prefix, suffix), skipping used numbers | ⌘R | 🟡 | ⌘R: start, step, prefix, suffix; numbers other cues have are passed over (tested). The tool opens (smoke-checked); it has not been run through by hand. |
| Delete numbers of selected cues | ⌘D | ✅ | Tools ▸ Delete the Numbers of Selected Cues (smoke-checked). ⌘D duplicates here. |
| Default names from the target, dimmer than typed names, updated on rename | Yes | ✅ | |
| Clearing a name restores the default | Yes | ✅ | |
| File target: choose, drop a file on the row, T key | Yes | 🟡 | Choose in the inspector or with T (written, not run); a sound dropped on an Audio cue replaces its file (the command behind the drop is smoke-checked; a real drop from the desktop is not); files dropped between cues make new ones. |
| Cue target: type the number, or drag one cue onto another | Yes | 🟡 | Picked from a list in the inspector (T goes to it), or one cue dropped on the middle of another (smoke-checked). Not typed as a number. |
| New targeting cue takes the selected cue as its target; asks when several are selected | Yes | ✅ | With several selected it takes the last and does not ask. |
| Reveal target, clear target, jump to target, highlight related cues | Yes | 🟡 | Go to Target (⌘E), and the cue the selected one is aimed at, and the cues aimed at it, are marked in the list (smoke-checked). Clearing is in the inspector. |
| Fade / Reset can target an output patch or audio map | Yes | ❌ | |
| Notes | Yes | ✅ | |
| Cue colours | 20 | ✅ | Twenty, and none. |
| Second colour after a cue has played | Yes | ✅ | A second colour the cue takes once it has played, until Reset (smoke-checked). |
| Flag | Yes, F key, listed in Warnings, hollow flag on a collapsed group | ✅ | Stored, drawn, set with F or the right-click menu; counted in the footer and listed with the problems; a collapsed group that holds one shows a hollow flag (smoke-checked). |
| Armed / disarmed, drawn striped | Yes | ✅ | Live toggle with A; Arm and Disarm cues. |
| Skip if disarmed | Yes | ❌ | An import says so when a cue had it. |
| Auto-load | Per cue, and a default for new cues | ✅ | On a cue or a group: its sounds are read into memory while it stands by, in any list (tested). |
| Times to the millisecond; `90`, `1:30`, `1:02:03` | Yes | ✅ | |
| A typed level with no sign is a cut | Yes | ✅ | |
| A broken cue shows a red X with the reason; warnings a yellow triangle | Yes | ✅ | |
| A broken cue still runs its waits and continue, so a sequence survives | Yes | 🟡 | A broken cue is skipped and logged and the continue still passes on; its waits were not checked. |

## 3. Sequences and continue modes

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Pre-wait | Yes | ✅ | Ignored on a group that waits for a beat. |
| Post-wait before an auto-continue | Yes | ✅ | |
| Auto-continue | Yes | ✅ | From GO and from any other start (tested). |
| Auto-follow | Yes | ✅ | The same. Waits for sounds, groups, Wait and Fade cues. |
| Continue modes on cues inside a group | Yes (not in Timeline groups) | ✅ | In the two "start first" modes (tested). Not in an all-together group, as in QLab, nor in a playlist or a random group. |
| A cue started by a trigger, a Start cue, OSC or MSC runs its sequence | Yes | ✅ | Tested for a trigger, a Start cue and `/cue/n/start`; the playhead stays. |
| Playhead moves to the first cue after the whole sequence | Yes | ✅ | |
| Move playhead to next / previous sequence (`=` `-`) | Yes | ✅ | `=` and `-` (smoke-checked), and over OSC. |
| Disarmed cue in a sequence still passes the continue on | Yes | ✅ | |
| Preview plays one cue alone, skipping its pre-wait and continues | V | 🟡 | V fires the cue alone, without its continues but with its pre-wait. Off in Show mode. |

## 4. Group cues

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Groups, nested, collapse and expand | Yes | ✅ | `<` and `>` collapse and expand every group (written, not run). |
| Group selected cues | Yes | ✅ | ⌘G; ⇧⌘G ungroups. |
| Mode: Timeline (all children at once) | Yes | ✅ | "All together". |
| Mode: Start First and Enter | Yes | ✅ | Each GO fires the next child and the playhead waits on the group until the last has gone. Tested; run in the app. |
| Mode: Start First | Yes | ✅ | Tested. |
| Mode: Start Random (round-robin) | Yes | ✅ | Dealt like cards: every child once before any comes again (tested). |
| Mode: Playlist (one after another; shuffle, loop, crossfade with curves; next / previous) | Yes | ✅ | Shuffle, repeat, crossfade, "next" in Active Cues (tested). No crossfade curve, no "previous". |
| Timeline tab: lanes, drag to set pre-wait, snapping, trim, slip, nudge, zoom | Yes | ❌ | Pre-waits are typed. |
| Fade a group (everything inside it) | Yes | ✅ | A Fade can target a Group; with "stop target" what was still waiting in it is called off (tested). |
| Start / Stop / Pause a group | Yes | ✅ | |
| Fade and stop everything outside the group when it starts | "Fade & stop others" on any cue, three scopes | ✅ | On any cue, reaching everything, its list or its peers (tested). |
| Start on the next beat or bar of the music playing | No | ➕🟡 | Reads the playing sound's tempo, which the app can find from the sound or take typed (engine tested). The group's own setting has not been run in the app, and a tempo that changes is not followed. |

## 5. Cue lists and carts

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Several cue lists | Unlimited | 🟡 | Add, rename, remove and show in Settings ▸ Show; chosen from the title bar. The operations are tested; the controls are written, not run. |
| Each list has its own playhead and keeps running when not shown | Yes | ✅ | Each list keeps its playhead and runs on off screen; the list selector marks one that is running (tested, smoke-checked). A cart is shown and pressed while the list being run keeps its place. |
| Start cue on a list = GO on that list; triggers on a list | Yes | 🟡 | A Start cue aimed at a list is that list’s GO (tested, smoke-checked). No triggers on a list. |
| Fade a list | Yes | ✅ | A Fade (or a Stop) aimed at a cue list takes every sound the list started (tested). |
| A list in its own window | Yes | 🟡 | Window ▸ This List in Its Own Window: another view of the one show. Smoke-checked with a cart, not with a list. |
| List syncs to incoming timecode | Yes | 🟡 | The whole show chases (one setting, not per list); see section 15. |
| Cue carts (grid up to 15×15, click to fire, hold-to-play) | Yes | 🟡 | A list drawn as a grid of buttons, up to 15×15: mouse, touch, arrows and Enter; colour, name, number, hotkey and a running indicator on each button; drag to move or swap; a QLab cart imports with each cue on its button (tested, smoke-checked). No hold-to-play on a button (a hotkey can: "second trigger on release"), one button size, no timecode sync. |

## 6. GO, playhead and transport

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| GO fires the standing-by cue and advances | Space | ✅ | |
| Double-GO protection, any duration | Yes | ✅ | Per show, default 0.3 s, applied to every source, and (beyond QLab) to a cue's own trigger repeating: the same hotkey, OSC or MIDI message, cart button or remote start for one cue within the time is ignored and logged. |
| Require key-up before GO re-arms | Setting | 🟡 | A held Space does not GO again (the keyboard's repeat is ignored). Always on, not a setting, and the keyboard only. |
| Playhead independent of the selection, with a setting to lock them | Yes | ✅ | Locked by default; Settings ▸ Show unlocks it, and a click on a cue’s left edge then stands by on it (smoke-checked). |
| Click the status column to move the playhead | Yes | ✅ | Click a top-level row. |
| Select a cue by number (⌘J); move the playhead to a cue by number (⇧⌘J) | Yes | ✅ | ⌘J moves the playhead, and the selection with it, to a cue in any list; it works in Show mode. Smoke-checked. |
| Load Last Selected (L) | Yes | ❌ | L holds or lets go of a loop region here. |
| Panic: fade and stop over the panic duration | Esc | ✅ | |
| Second panic stops dead | Yes | ✅ | Within 1.5 s. |
| Panic one cue; double-tap to hard stop | S | 🟡 | S fades the selected cue out and S again stops it dead: written, not run. The ■ beside an active sound does the same and is checked. |
| Pause / resume one cue, pause all, resume all | P `[` `]` | ✅ | |
| Reset: stop all, clear temporary changes, playheads to the top | Yes | ✅ | Live arm toggles are kept. Asks first while anything sounds. |
| Fade everything out over a time | `/panicInTime` | ✅ | "Fade all", 5 s; over OSC, the time sent. |
| Load to Time: field and slider, negative = from the end, whole sequence | ⌘T | ✅ | ⌘T, a field and a slider; a negative time counts back from the end; it counts through a pre-wait and into a group (tested, smoke-checked). Edit mode only, and for the cue standing by, not a whole sequence. |
| Click in a waveform to load to that time | Yes | 🟡 | Clicking marks a place; Skip and Fade to act on a playing cue. A waiting cue is loaded with ⌘T, not with a click. |
| Loaded cues show as loaded | Yes | ✅ | LOADED badge. |
| Active Cues: elapsed, remaining, pause, stop, progress | Yes | ✅ | Also waits and fades with countdowns, and a chip for a loop region held or armed. |
| Scrub a running cue by dragging in Active Cues | Yes | 🟡 | Click to skip (off in Show mode); no drag. |
| Newest active cue at top or bottom | Setting | ❌ | |
| Crossfade to another place in a playing track | No | ➕ | "Fade to", 1.5 s. |
| Open cue / close cue when the workspace opens or closes | Setting | ❌ | |

## 7. Triggers and what a cue does to others

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Hotkey trigger on a cue | Yes | ✅ | A letter, a digit or an F-key, with shift or alt; the app's own keys are refused with a reason; a QLab hotkey comes across on import. Run in the app; no test. |
| MIDI trigger on a cue, with Capture | Yes | 🟡 | A MIDI trigger on any cue, with Learn. Tested and smoke-checked with a message handed to the host; no MIDI hardware has been connected. No conditions on the second byte ("greater than"). |
| Wall-clock trigger, by day of week | Yes | 🟡 | A cue's Clock trigger (`19:25 fri sat`). Parsing and firing are tested with a handed-in time and fired in the smoke run; nobody has watched the real clock reach a time. |
| Timecode trigger, with Capture | Yes | 🟡 | A time on any cue, fired from chased MTC or LTC; no Capture. |
| OSC trigger on a cue: any address, with Learn | Workspace-level "OSC controls" only; a cue is started by `/cue/n/start` | ➕ | A pattern and optional arguments on any cue; Learn keeps the arguments. |
| Triggers table for the whole show | Workspace Status ▸ Triggers | ✅ | Settings ▸ Integrations ▸ Triggers, with what each trigger shares with another (the show's own MIDI and OSC commands among them). |
| Fade & stop others when this cue starts: peers / list / all | Any cue | ✅ | Any cue, with all, its list, or its peers (tested). A Fade cue spares the sound it moves. |
| Duck or boost others while this cue runs | Any cue | 🟡 | Any cue: every other sound is held so many dB down (or up) for as long as it runs, over a fade time (tested; checked by the gains in the test run, not heard). And between buses: a bus can dip while another sounds (Settings ▸ Audio). |
| Second trigger: nothing / panic / stop / hard stop / restart / devamp | Any cue | ✅ | Any cue: start again, nothing, fade out and stop (over the panic time), stop, or out of its loop (tested). Stop is dead at once; there is no separate hard stop. |
| Second trigger on release (hold to play) | Yes | 🟡 | Letting go of a cue’s hotkey can be its second trigger (engine-tested; not tried with a held key in the window), and the end of its MIDI note is written. Not on a cart button. |

## 8. Inspector and editing tools

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Tabbed inspector: Basics, Triggers, the type's own tabs | Yes | ✅ | Basics, the type's tab, Time & Loops, Triggers. |
| Pop the inspector out; an inspector pinned to one cue | Yes | 🟡 | Window ▸ Inspector in Its Own Window; it follows the main window's selection (smoke-checked). One only, and not pinned to a cue. |
| Batch edit a selection; "mixed" shown | Yes | ✅ | A number is not typed onto several cues at once. |
| Cut, copy, paste cues | Yes | ✅ | ⌘X ⌘C ⌘V, within a show and from one show to another (their sounds come too); in a text box they act on the text. Between shows it is unit-tested and run by hand, not in the smoke run. |
| Duplicate (⌥-drag) | Yes | ✅ | ⌘D; targets inside the copy follow the copy; the copy carries no number. |
| Paste Cue Properties, with presets | ⇧⌘V | 🟡 | ⌥⌘V: choose which of the copied cue's settings go onto the selection; the last choice is remembered (smoke-checked). No named presets. (⇧⌘V opens Versions here.) |
| Find (names, numbers, notes, file names, messages) | ⌘F | ✅ | Also triggers and desk cue numbers; Enter next, Shift+Enter previous, select all found. Smoke-checked for a name. |
| Right-click menu on a cue or a control, with help | Yes | 🟡 | On a cue: stand by here, audition, arm, rename, number, flag, cut / copy / paste, paste properties, go to target, make a template, duplicate, group, ungroup, delete. Written; the test run has no screen to show it on, so it has not been seen. Nothing on a control; help is a tooltip. |
| Single keys: N number, Q name | Yes | ✅ | |
| Single keys: O notes, T target, E pre-wait, D duration, W post-wait, C continue, F flag | Yes | 🟡 | All seven. E, C and O are smoke-checked; T, D, W and F are written, not run. A arms and disarms. |
| Remap keys per show | Settings ▸ Controls ▸ Keyboard | 🟡 | Every single key (GO, Panic, the playhead, the letters) can be changed, given a second key or reset in Settings ▸ Keys (smoke-checked). Kept on the computer, not in the show; the ⌘ shortcuts are fixed. |
| Move selected cues with keys | ⌥⌘↑↓ | 🟡 | ⌥⌘↑ ⌥⌘↓ move one selected cue among its siblings. Written, not run. |
| Drag to reorder, into a group, several at once | Yes | ✅ | |
| Drop files or a folder to make cues | Yes | 🟡 | Files; folders not checked. A new sound is on the bus every Audio cue starts on; a show can ask for a sound of half a minute or more to go on the Music bus (Settings ▸ Show; off as it comes). |
| Cue templates (defaults per cue type, per show) | Yes | ✅ | “New cues of this type start like this one”, kept in the show; a new cue from the toolbar or a dropped sound starts from it (smoke-checked). |
| Workspace templates | Yes | ✅ | File ▸ Save as a Template…, New Show from Template: the cues and settings, a new id, no passcodes or keys (tested, smoke-checked). |
| Record Cue Sequence (fire by hand, get the timing as a group) | Yes | ❌ | |
| Live fade preview on / off | Yes | 🟡 | Editing a playing cue's level is always heard. No silent preparation. |
| Undo / redo | Yes | ✅ | 200 steps, labelled, covers settings and mixer; it survives the first Save. |
| Every pending change marked on its control, with the saved value and a put-back | No | ➕ | |

## 9. Cue types

| Type | QLab 5 | Us | Note |
|---|---|---|---|
| Group | 5 modes | 🟡 | Five modes and no timeline view. Section 4. |
| Audio | Yes | 🟡 | Section 10. |
| Mic | Yes (Audio licence) | 🟡 | A live input (device, channel) onto a bus, with a level and a fade in; Fade and Stop cues work on it. Smoke-checked with a stand-in signal; not opened on a real input, and its delay through the app is not measured. |
| Video, Camera, Text | Yes | 🟡 | All three, on one stage. Section 18. |
| Light | Instruments and levels over DMX | 🟡 | Levels as light commands, faded and sent as DMX; and/or a desk cue number, called and optionally fired on the desk. Section 19. |
| Fade | Levels, rate, effects, geometry, patches; curves | 🟡 | The level of one Audio, Mic or Video cue, or of every sound in a Group or a cue list; a picture's opacity, position, scale and rotation; a Light cue's lights. Linear only; no rate, no effects. |
| Network | OSC, text, hex; devices; 1D / 2D fades | 🟡 | OSC, plain text and hex, with devices; 1D fades with four curve shapes and 2D fades along a typed path. Tested on loopback only. Section 12. |
| MIDI, MIDI File | Yes | 🟡 | Both: a MIDI cue written as text (with a faded value), and a MIDI File cue (tempo changes, a rate, pause and stop). Tested to the byte; nothing has been sent to hardware. Section 15. |
| Timecode | LTC / MTC out | 🟡 | 24, 25, 29.97 drop, 30. Read back only by the app itself. |
| Start, Stop, Pause | Yes | ✅ | Start resumes a paused target, as in QLab, and runs the target's sequence; aimed at a cue list it is that list's GO. A Stop cue also ends what was to follow its target; aimed at a list, everything in it. |
| Load | Any cue, to a time, negative allowed | ✅ | Any cue, counted through its pre-wait and into a group; a negative time is from the end (tested). |
| Reset | Yes | ✅ | Its target is stopped, unloaded, armed as written and aimed where it was written to aim; a Fade’s effect is undone (tested). |
| Devamp | Leave the current slice or the cue's loop; can start the next cue and stop the target on the boundary | 🟡 | Ends a whole-file loop after its pass, and lets a track out of the loop region it is held in or armed for (tested). It can start the next cue as the loop ends (timed by the engine’s clock: tested on a fake one, not measured against real audio). It does not stop the target on the boundary. |
| GoTo | Yes | ✅ | Also across lists. |
| Target | Re-target another cue at run time | ✅ | Re-aims another cue until Reset, a Reset cue or an edit (tested). |
| Arm, Disarm | Yes | ✅ | |
| Wait, Memo | Yes | ✅ | |
| Script | AppleScript | 🟡 | Not code, by design: a short list of show commands as text, run in order with waits (`/cue/12/start`, `/go`, `/panic`, `/playhead/20`, `wait 2`). It can do what an operator's hands could do to this show's transport; it cannot run arbitrary code or reach another application. Tested, smoke-checked. |
| Mix | No (a Fade on a patch is the nearest) | ➕🟡 | Ramps bus faders over its duration; the mixer shows where a cue has put a fader until a hand is on it (smoke-checked by the gains, not heard). |
| Jump | No (Devamp and slices are the nearest) | ➕🟡 | Moves a playing track to another place in itself as a cut, a fade or a blend. Untested; the beat-aligned parts read a tempo the app can find. |

## 10. Audio

### Files and engine

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| WAV, AIFF, AAC, M4A, MP3 | Yes | ✅ | Each checked end to end by the smoke run, with FLAC, Ogg Vorbis and Opus. AIFF plays from a WAV copy (Chromium does not read it). One bit depth of each. |
| CAF | Recommended format | 🟡 | PCM only, from a WAV copy; compressed CAF is refused. |
| The audio of a video file | Yes | 🟡 | Through a Video cue (section 18): its sound plays on a bus as an Audio cue’s does. An Audio cue does not take a video file. |
| Files up to 24 channels | Audio licence | 🟡 | A WAV of more than two channels is read by its header and each channel is routed through the cue’s matrix (checked by meter with four channels). Other formats, and how many channels, are untried. |
| Sample rates to 192 kHz, converted on the fly | Yes | 🟡 | The browser engine resamples; not measured. |
| Sample-accurate sync of cues started together | Yes | 🟡 | Buffer-decoded tracks start on the audio clock; streamed ones do not. Not measured. |
| Output device choice | Any number of patches, any Core Audio device | 🟡 | One device, per computer. Each bus can be sent to any pair of its outputs (see Levels and routing). |
| Per-device buffer size | Preference | ❌ | |
| Workspace min / max level limits | Yes | ✅ | Settings ▸ Audio; cues and fades are held, the mixer's faders are not. |
| Safety limiter on the master | No (an AU on a device output) | ➕ | On / off per show, with an indicator; one for each output pair in use. |

### The Audio cue

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Waveform | Yes | ✅ | Peaks and RMS, cursor, markers, loop lane. |
| Start and end time | Fields, draggable handles, ⇧I ⇧O | ✅ | Fields, handles to drag on the waveform, and ⇧I ⇧O at the place it is playing. End is cut to the sample. |
| Play count | Any number, or infinite | ✅ | A count, or Loop for ever (tested). It can be typed while the sound plays. |
| Slices with their own play counts; markers imported from the file | Yes | 🟡 | Loop regions: each with a count, or held until let go, or held by the operator (tested; run in the app). QLab's slices come across on import with their counts. Regions are typed or made from markers, not drawn, and nothing reads markers from the sound file. |
| Rate 0.03–33, preserve pitch | Yes | 🟡 | 0.25–4 on an Audio cue, and a Fade can move it. Pitch is kept only on a streamed sound, which then has no exact loops. Positions are checked; it has not been listened to. |
| Integrated fade envelope drawn over the waveform | Yes | 🟡 | The Volume line, always drawn on the waveform, with bends; pan and effect settings have lines too (beyond QLab). Scheduled 60 ms ahead in 10 ms ramps, not to the sample. |
| Open in an external editor, reveal in Finder | Yes | ❌ | |
| Zoom the waveform; view one channel | Yes | ❌ | |
| Hold a section of a playing track, several armed in order | No | ➕ | From the loop lane, the L key or a chip in Active Cues. A sound of the same length in the same group (a click) goes round with it. |
| Named markers on the waveform | Slices only | ➕🟡 | Add at a click or a typed time, and remove; no rename or drag. |

### Levels and routing

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| A level per cue | Yes | ✅ | Heard at once when changed on a playing cue. |
| Cue matrix: file channels × cue outputs, crosspoints | Yes | 🟡 | A cue's Own outputs: channels × the device's outputs, a level each; its bus still rides it. No gangs. Meters only: not heard on a real interface. |
| Gangs | Yes | ❌ | |
| Pan | By level per output | 🟡 | Per cue (Audio and Mic, equal power), and as a line over a sound. Not per bus. |
| Trim (untouched by fades) | Yes | ❌ | |
| Set default levels, set all silent, name inputs | Yes | ❌ | |
| Meters on the cue | Yes | ❌ | Meters are on buses and the master. |
| Output patches: up to 128 cue outputs routed to device outputs | Audio licence for editing | 🟡 | Each bus goes to one pair of the device's outputs (Settings ▸ Audio), with a master and limiter per pair; a pair the device lacks is silent and flagged. Smoke-checked on a pretended eight-output device; not heard on a real one. A cue can have outputs of its own (the matrix above), and each output a name and a trim. No named patches, no mono bus outputs. |
| Named buses with a fader and meter each, into a master | Cue outputs of a patch | ✅ | Add, rename, remove in Settings. |
| Mute and solo of outputs | Yes | ❌ | |
| Effects on cue outputs and device outputs | Audio licence | 🟡 | Each bus sends to one reverb and one delay; a cue has an eq and a chain of tools of its own. Checked by meter, none of it heard. No plug-ins, nothing on the device's outputs. |
| Mixer moves are unsaved edits, marked, with Defaults | n/a | ➕ | |

### Fades

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Fade a cue's level over a time | Yes | ✅ | |
| Stop target when done | Yes | ✅ | Left alone, on for a fade to silence (QLab leaves it off, and the sound playing at −∞). An imported fade keeps QLab's setting. |
| Absolute and relative | Yes | ✅ | Relative is measured from the cue's own level, and a later fade cancels an earlier one still waiting on the same sound. |
| An absolute fade clears earlier relative changes | Yes | ❌ | They are independent. |
| Fade any of several levels at once, each active or not | Yes | ❌ | There is one level. |
| Curve shapes: S-curve, custom, parametric, linear multi-step; separate up and down | Yes | 🟡 | Linear, S-curve, custom points; separate up and down. In dB only; no parametric. |
| Domain: slider, decibel, linear | Yes | ❌ | |
| Fade a group, a list, a patch | Yes | 🟡 | A group and a list (tested). A bus is moved by a Mix cue. |
| Fade rate; fade effects | Audio licence | 🟡 | Rate, yes. No effects. |
| Set levels from target; revert fade action | Yes | ✅ | The one main level (and rate). |
| Dip only the voice band of a sound | No | ➕ | A peaking band near 1.2 kHz, so music keeps its bass and air under speech. Untested. |

### Effects, live input, spatial

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| AudioUnit effects on a cue | Audio licence | ❌ | |
| Mic cues (live input through the cue list) | Audio licence | 🟡 | See Mic in section 9: smoke-checked with a stand-in signal, not opened on a real input. No effects on it. |
| Object audio: maps, marks, objects, paths | Audio licence | ❌ | |
| Record the show's output | No | ➕🟡 | ● Rec in the mixer writes what outputs 1–2 get to `recordings/` in the show folder. The file and its length are smoke-checked; it has not been listened to. |

## 11. Auditioning, overrides, status and logs

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Audition to other outputs, per kind of output; Audition GO; always-audition | Yes | 🟡 | V can play to a pair of its own (Settings ▸ Audio). No always-audition, same device only. |
| Override Controls: suspend input or output per kind | Yes | 🟡 | OSC out, MIDI out, timecode out and DMX out can each be held back (Tools ▸ Hold Back …): a red chip in the title bar while on, and the monitor says "held back" (tested, smoke-checked). Nothing for MIDI in or OSC in. |
| Warnings list with Inspect Cue | Workspace Status ▸ Warnings | 🟡 | Problems in the footer, on the row and in the inspector. No hide, no settings warnings beyond the patch status. |
| Log of cue triggers, including blocked GOs | Yes | 🟡 | The app log (last 300 lines in Settings ▸ About). |
| Log of OSC in and out, with a filter | Yes | ✅ | The monitor, a drawer beside the cue list, with a send line; it says "did nothing" beside a message nothing acted on. |
| Log of MIDI in | Yes | ✅ | In the same monitor, in and out. Smoke-checked with a message handed to the host; no MIDI hardware has been connected. |
| Disconnection warnings for devices | Yes | 🟡 | Per network patch (idle / sent / answering / error). A lost audio device: the show moves to the system default and back when it returns (not tried by unplugging one). |
| Media playback log (CSV, for rights reporting) | Preference | ✅ | What played, when and for how long it was heard: `logs/playback.csv` in the show folder, and File ▸ Export the Playback Log… (tested, smoke-checked). Beside it, the show log: every GO, cue, trigger, ignored GO and problem, one file a sitting (View ▸ Show Log). |
| Check a show without running it | No | ✅ | Tools ▸ Check the Show (⇧⌘F): broken targets, missing or unplayable files, outputs this device lacks, cues that never play, cues that start each other for ever, clashing triggers, equipment not answering. |
| Start a rehearsal mid-show with what would be playing | No | ✅ | Run from Here…: loops, held sections and sounds the show stops later, at their faded levels; the last command to each device; previewed first; Edit mode only. |
| Dry run: what each GO would do, second by second, without sound | No | ➕ | `ec simulate`, and the assistant's `simulate` tool. |

## 12. Network cues (out)

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Patches: name, address, port, UDP or TCP | Yes | ✅ | TCP reconnects by itself; SLIP or length-prefix framing. |
| Several destinations on one patch (main and backup) | Yes | 🟡 | A patch can have several destinations (tested on loopback only). |
| Choose the network interface | Yes | 🟡 | Per patch (tested on loopback; never on a computer with two real networks). |
| Passcode on a patch (to talk to a QLab) | Yes | ❌ | Send `/connect` yourself. (The Main and backup module sends its own.) |
| mDNS names | Yes | 🟡 | The OS resolver; not checked. |
| Copy patches between shows, export | Yes | 🟡 | A show's settings, patches among them, export to a file and import into another show as one undoable edit, without passcodes or keys (tested). Not patch by patch, no drag. |
| OSC message typed as text; ints, floats, strings | Yes | ✅ | `f:1`, `i:1`, `s:1` force an argument's type. |
| OSC `\T \F \I \N` arguments | Yes | ✅ | Read and written. |
| Plain text and hex messages | Yes | 🟡 | Both, over UDP and TCP, with escapes (tested on loopback; never against a device). |
| Device descriptions | About 90 devices | 🟡 | Nine: generic, ETC Eos, grandMA3, X32/M32, X Air, QLab, Endless Cues, REAPER, Resolume. None checked against hardware. |
| Send (test) button; the composed message shown | Yes | ✅ | Per cue (Audition) and per patch (Test). |
| Per-patch status: sent, answering, last in and out | No | ➕ | |
| Resend at a rate for a duration | 1–120 /s | ✅ | A duration and no token: the same message 1 to 120 times a second for that long (tested). |
| 1D fade with `#v#` | Curves, int or float, `#v#` in the address too | ✅ | Four curve shapes, floats or whole numbers, 1 to 120 a second, in the arguments or the address. |
| 2D fade (`#x#` `#y#`, drawn path, loop) | Yes | 🟡 | Along a typed path at an even speed, with loop (tested). The path is typed, not drawn. |
| Live queries inside a message (`#/cue/1/…#`) | Yes | ❌ | |
| Per-patch defaults for new cues | Yes | ❌ | |

## 13. OSC control (in)

Everything in this section is tested against the module itself, over UDP on one computer. No remote, plugin or controller made for QLab has been tried against it.

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| UDP on 53000, port changeable | Yes | ✅ | Opened only when something needs it. |
| TCP in | Yes | 🟡 | On the input port, SLIP and length-prefixed, beside UDP (tested on loopback and in the app; no real remote). |
| Plain-text commands on 53535 | Yes | ❌ | |
| Replies as `/reply/…` with JSON | To 53001 or a port the client sets | 🟡 | Over UDP to port 53001 (`/udpReplyPort` changes it); a plain command is answered only after `/alwaysReply 1`; a long answer goes over TCP. No `/replyFormat`. |
| `/workspace/{id}/…` prefix | Yes | 🟡 | Accepted and ignored. |
| Passcodes | Any number, each with view / edit / control; a no-passcode row; delay after wrong tries | 🟡 | Several, each with view, edit and control, and a no-passcode row; 61 s memory, `/thump`, and a wait after wrong tries (tested). Which permission each address needs is ours, not read from QLab’s table. |
| `/go`, `/go/{n}`, `/panic`, `/panicInTime`, `/stop`, `/hardStop`, `/pause`, `/resume`, `/reset` | Yes | ✅ | |
| `/playhead/{n}`, `/next`, `/previous`; `/select/{n}` | Yes | ✅ | Also `nextSequence`, `previousSequence`, `/playheadID`, `/select/next`. `/select` moves the playhead. |
| `/cue/{n}/start`, `stop`, `hardStop`, `pause`, `resume`, `togglePause` | Yes | ✅ | A start runs the cue's sequence. |
| `/cue/{n}/load`, `loadAt`, `preview`, `panic`, `reset` | Yes | 🟡 | All five on any cue. The module is tested with a fake host and the host’s own commands in the smoke run; not the two together over a socket, and no real remote. |
| Address by `/cue_id/`, `/cue/selected`, `/cue/playhead`, `/cue/active`; wildcards in numbers | Yes | ✅ | `selected` is the cue standing by. |
| Read and write any cue property (`/cue/{n}/name`, `/preWait`, levels …), `+` `-`, `/live` | About 1,200 methods | 🟡 | Ten to read or write (number, name, notes, pre-wait, post-wait, duration, continue mode, armed, flagged, colour) and about a dozen to read (type, is running, elapsed, children …); `valuesForKeys`. A write is an edit, so Show mode refuses it. No levels, no `/live`. |
| `/cueLists`, `/runningCues`, `/selectedCues`, `/valuesForKeys` | Yes | 🟡 | All four, and `/runningOrPausedCues`. A long show’s `/cueLists` is refused over UDP and answered over TCP. Not the `/shallow` and `/uniqueIDs` forms. |
| `/new`, `/move`, `/delete`, `/renumber`, `/save`, `/undo`, `/redo`, `/showMode` | Yes | 🟡 | All of them (tested; no real remote). Edits are refused in Show mode; `/renumber` numbers the cue standing by; the shape of `/move`’s reply is ours. |
| `/version`, `/workspaces` | Yes | ✅ | `/version` answers with the QLab dictionary it follows, not the app's own. |
| `/updates` (push when the workspace changes) | Yes | ✅ | Tested with a stand-in client. |
| Assign any incoming OSC address to a workspace command, with Capture | Settings ▸ Controls ▸ OSC | 🟡 | GO, Panic, Pause all, Resume all, playhead down and up, each with Capture (Settings ▸ Integrations ▸ Network ▸ Incoming OSC). Tested; no real controller. Not every command QLab lists. |
| Duplicate-message filter | Preference | ❌ | |

## 14. Show control broadcast (status out)

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| OSC events for go, cue start, cue stop, playhead | Subscribed with `/listen` | 🟡 | In QLab’s form: `/listen`, `/ignore`, `/qlab/event/workspace/…` (tested; written from the manual, not compared with QLab). The Show feedback module still sends its own to one patch. |
| Events for pause all, resume all, panic, reset | Yes | 🟡 | The six “All” events are in the same broadcast (tested; not compared with QLab). |
| A custom outgoing format (to fire another device from every GO) | `/eventFormat` | 🟡 | `/eventFormat`, and the Show feedback module’s prefix. |
| MSC broadcast | Yes | ❌ | A MIDI cue can send one MSC message; nothing sends one for every GO. |

## 15. MIDI, MSC and timecode

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| MIDI cue: note, program, control, pressure, pitch bend; fades | Yes | 🟡 | All of them, written as text. A fade sends every whole value on the way (no curve shapes). |
| MIDI Show Control out; SysEx out | Yes | 🟡 | GO, STOP, RESUME, TIMED_GO, LOAD, FIRE, ALL_OFF, RESTORE, RESET, GO_OFF, to one device ID or all; raw SysEx as hex. |
| MIDI File cue | Yes | 🟡 | Tempo changes, a rate, pause and stop (sounding notes are ended). |
| MIDI patches | Yes | 🟡 | One output for the show, or every output; every input is listened to (Settings ▸ Integrations ▸ Network ▸ MIDI). No named patches, no choice per cue. |
| Workspace controlled by MIDI notes or controllers, with Capture | Yes | 🟡 | GO, Panic, Pause all, Resume all, playhead up and down, each written as text; typed, not captured. |
| Workspace controlled by MSC | Yes | 🟡 | GO, TIMED_GO, LOAD, STOP, RESUME, ALL_OFF, RESET, for the app's device ID or all-call. Not run against a desk. |
| Timecode cue: LTC or MTC out, eight frame rates | Yes | 🟡 | Four rates (the ones MTC can name): 24, 25, 29.97 drop, 30. |
| Chase incoming LTC or MTC per list: start, stop, freewheel, look-back | Yes | 🟡 | The show chases MTC or LTC: triggers fire as times pass, a located time starts a cue part way in, the playhead follows. Cues are not stopped when timecode stops; no freewheel setting (a quarter of a second without a frame is "stopped"). |
| Timecode status window | Yes | 🟡 | The time going out is in Active Cues; the time coming in is in Settings ▸ Integrations ▸ Network ▸ Timecode. |

All of this is tested to the byte against the MIDI, MTC, MSC, Standard MIDI File and SMPTE 12M specifications, and LTC by decoding the app's own output; the path from a message arriving to a cue firing and a message leaving is smoke-checked with the message handed to the host. No MIDI or timecode hardware has been connected, so nothing here has left or entered the computer on a port: every row is 🟡 for that reason.

## 16. Scripting and automation

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Script cue | AppleScript | 🟡 | A Script cue runs a short list of show commands as text, in order, with waits (section 9). Not AppleScript and not code, by design: a show file may come from anyone, and opening one must not be a way to run a program. No loops, no variables, no files, no other applications. |
| The whole workspace scriptable from outside | AppleScript dictionary, OSC | 🟡 | The show is a readable JSON file with a command line (`ec validate / outline / diff / simulate / versions / apply / import-qlab`) and an MCP server. A running show can be driven and partly read and written over OSC (section 13): transport, ten cue properties, the lists. Not levels, not making or moving cues. |
| An assistant that edits the show and proposes the change for review | No | ➕ | A private draft, a diff to accept or reject; bring your own key or use Claude Code or Codex. Its tools are tested directly and one live turn was run; the key-based providers have not met a live service. |
| Other agents can work on a show (MCP) | No | ➕ | Against the open app or a show folder. |
| Edit a show file from the command line, checked as every edit is | No | ➕ | `ec apply <show> <ops.json>`: the same operations the app and the assistant write, shape-checked in one place (`core/show/ops.ts`) and refused with the reason (tested). |

## 17. Collaboration, remote and controllers

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Several people editing one workspace over the network, with permissions | Yes | ❌ | |
| Phone or tablet remote | QLab Remote (iOS; paid for control and editing) | 🟡 | A web page for any device: list, standby, notes, running; GO, playhead, Panic; view-only switch. A fader per bus and the master, and Load to Time, behind a Levels button (drawn in an offscreen browser; not on a phone). No editing, no carts. Plain HTTP with a key in the address. |
| QLab Remote itself connecting to us | n/a | ❌ | Not tried. TCP in, the reply port and the property and update methods exist; QLab Remote may still not connect (no Bonjour, no encrypted connection). |
| Stream Deck | Official plugin over OSC, no passcode | 🟡 | Transport, playhead moves, start-by-number, `/cue/selected` and the actions that make or move cues are all written to the same addresses. Not tried. |
| Bitfocus Companion | Community module over OSC | 🟡 | The same. Not tried. |
| Main and backup computers | By hand (a patch with two destinations, or MIDI / OSC from one to the other) | 🟡 | A Main and backup module: the main says its transport again to the backup over OSC control (GO, playhead, start, stop, pause, panic, reset, load to time), with a heartbeat each end watches. Tested with two engines in one test, not on two computers. No automatic failover and no audio switch-over; edits and the mixer are not mirrored. |

## 18. Video

QLab's manual describes 20 areas of video; we have a first slice of four of them: one stage on one display ([13 · Video and the stage](13-video.md)).

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Video cues (files, stills, alpha, ProRes / HAP / H.264 and others) | Yes | 🟡 | H.264, VP8/VP9 (with alpha), AV1 and stills; no ProRes or Hap; no rate, slices or play count. |
| Camera cues (live inputs, NDI, Syphon, Blackmagic) | Video licence | 🟡 | A camera the computer sees as a webcam; no sound; no NDI, Syphon or Blackmagic. |
| Text cues | Yes | 🟡 | One font, size and colour. |
| Geometry: position, scale, rotation in three axes, crop, anchor, layer, opacity, blend modes | Yes | 🟡 | Position, scale, rotation (one axis), layer, opacity. |
| About 60 video effects | Video licence | ❌ | |
| Fading and animating geometry, with paths | Yes | 🟡 | A Fade moves opacity, position, scale, rotation in a straight line; no curves or paths. |
| Stages, regions, masks, warping, edge blending | Video licence for most | 🟡 | One stage, a four-corner pin, a blackout, a test pattern. |
| Output routing to displays, NDI, Syphon, Blackmagic | Yes | 🟡 | One display (or a window). |
| Monitor and audition windows, video metrics | Yes | ❌ | |

A Resolume template exists for Network cues, so a media server can be driven too. An imported workspace’s Video, Text and Camera cues come across as cues for the stage, each with a note saying what to check. None of this has been on a real projector: it has been drawn offscreen and read back as pixels.

## 19. Lighting

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| DMX out by Art-Net or USB devices | Yes (16 addresses free) | 🟡 | Art-Net and sACN (QLab has no sACN), any number of universes and addresses. No USB. Never tried on a fixture. [14](14-lighting.md) |
| Light patch, groups, a library of about 1,950 fixture definitions | Yes | 🟡 | Patch, groups of groups, eight generic fixtures and your own written as text. No manufacturer library, no virtual pan/tilt or CMY/HSI. |
| Light cues holding levels, with fades and curves | Yes | 🟡 | Tracking levels, a full-state cue, one linear fade time. No curves, no collate, no pull from another cue. |
| A command language ("1 thru 5 = 50") | Yes | 🟡 | The same shape: names, groups, `all`, parameters, ranges, lists, `home`, `pass`. Not `= cue A`. |
| Light Dashboard: live control, record, update, park, subcontrollers | Yes | 🟡 | Live levels, command line with a time, blackout, clear, revert, new cue from changes or everything, update the selected cue. No park, subcontrollers, audition or undo. |
| MIDI control of the dashboard | Yes | ❌ | |
| Fire a cue on a lighting console | A Network cue with the desk's device description | ✅ | A Light cue with the Lighting desk module: ETC Eos (fire, ping, hears the desk's active cue), grandMA3 and generic OSC (fire only). A send that failed is flagged on the cue. Not checked against a desk from this code base. |
| Light cues as rows the operator calls, with a switch to hide and skip them | No | ➕ | |

## 20. Saving, files and settings

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| Save, Save As | Yes | ✅ | |
| Media copied in beside the show as it is added | Project folder (default on) | ✅ | `media/`; Save As collects outside files; one copy of a sound however many cues use it. |
| Automatic timestamped backups, rotated | Yes | ✅ | A copy of the working show every few minutes while it is changing (5 by default), pruned, in `backups/`; listed under Versions ▸ Backups, and going back to one is an undoable edit (tested, smoke-checked). Also a version on every Save and a journal of unsaved edits offered back after a crash. |
| Versions with a note, compare, restore | No (backup files) | ➕ | Whole snapshots by content; the difference from the show as it is now is shown in operator's terms. Two saved versions are compared with `ec diff`, not in the app. |
| Nothing is written until Save; every unsaved change listed | The file is likewise not autosaved over | ➕ | |
| Find missing media in a folder and relink | File Target Search | 🟡 | Tools ▸ Find Missing Sounds in a Folder…: by file name, four folders deep, as one edit. Written, not run. |
| Import and export settings; drag patches between shows | Licence | ✅ | File ▸ Import Settings…, Export Settings…: settings and modules as a file, without passcodes or keys; importing is one checked, undoable edit (tested, smoke-checked). No drag of a patch. |
| Import a QLab 4 workspace, a Go Button show | Yes | 🟡 | QLab 5 and QLab 4 workspaces are read from the file itself, with no QLab needed, and open as a new unsaved show with a report of what did not come across; lists, carts, groups and their modes, sounds, fades, slices, hotkeys, MIDI and Mic cues come across. Mapped from QLab 5.6 files and run on one real workspace of each version; other versions unverified. Video, Light, Timecode and Script cues become Memos. No Go Button. |
| Double-click a show to open it | Yes | 🟡 | A `.ecshow` folder or its `show.json` opens, and a `.qlab5` is imported; refused while the show is sounding. Written; not run from the desktop in a packaged build. |
| Restore what was running after a crash | No | ❌ | Neither does. |
| App preferences: launch behaviour, update prompt, autosave interval | Yes | 🟡 | Last show reopens; theme, audio device, keys and held-back outputs per computer; the backup interval per show. No update check. |
| Unknown fields in the file kept | n/a | ✅ | A field this version does not know is kept on save and not played, in a cue as in the settings (tested). |

## 21. Platform and licensing

| Feature | QLab 5 | Us | Note |
|---|---|---|---|
| macOS | 11 and later | 🟡 | Signed and notarised builds (`node bin/release.js mac`); smoke-run in CI. |
| Windows, Linux | No | ➕🟡 | Installers are configured and unit tests pass in CI on both. One copy of the app at a time, opening a show from the desktop and the shortcut labels are written for both; the app has still not been launched by a person on either. |
| Price | Free for stereo audio and basic video; licences for the rest; rent by the day | ➕ | Nothing is locked. AGPL. |
| Demo mode, licence manager, USB and offline licences | Yes | n/a | |
| Source available | No | ➕ | |

---

## Open on our side

Things in our own code, none of which depends on QLab:

- **Read by the engine, not by a show**: a blended Jump's match scores (`04-cue-engine.md` section 12). A field the cue-type table does not list is kept on save, not played (tested).
- **Beat grids**: a tempo that changes within a track is found in sections on synthesised tracks only; the Jump blends' match scores are not made.
- **Devamp** on a Start–End loop has not been checked (a held or armed region is tested).
- **Opening a show from the desktop**: a handler is written for a show folder, a `show.json` and a `.qlab5`; not run from the desktop in a packaged build.
- **Untested**: parts of the audio window are covered only by smoke checks that use stand-in signals (output routing, a Mic cue, ducking, the recording, a cue's eq). Nothing in the audio window has been checked by ear.

## What to do, in order

1. **Run what is written and not run**, by hand, and fix what that finds: the right-click menu, S on a cue, relinking missing sounds, the clock trigger firing, opening a show from the desktop.
2. **Meet the hardware**: a MIDI interface, timecode equipment, a multi-output audio interface, a real microphone, a dimmer or a fixture on an Art-Net or sACN node, a lighting desk, a projector on a second display, two computers for main and backup; then QLab Remote, the Stream Deck plugin and Companion. Launch the app on Windows and on Linux. Sign the macOS build.
3. **Write the tests that are still missing** (the last line of "Open on our side").
4. **What is left of sequencing**: hold-to-play on a cart button, triggers on a list, skip if disarmed, a Devamp that lands on the sample.
5. **What is left of OSC**: levels as properties, the `/shallow` and `/uniqueIDs` forms, `/replyFormat`, MSC broadcast; and whatever trying the real remotes finds.
6. **What is left of editing**: Record Cue Sequence, a timeline view of a group, rich-text notes, named presets for Paste Cue Properties.
7. **What is left of audio depth**: trim on a cue, a fade's domain (slider, linear), a sample-exact envelope, a zoomed waveform that follows the playhead.
8. **Audio beyond that**: plug-in effects, gangs, object audio, in the native audio engine ([18](18-native-audio.md)) behind the interface the cue engine already uses.
9. **Timecode per list, editing from the web remote, collaboration.**
10. **Video and lighting past their first slice**: more stages, masks, blending and warps, NDI and Syphon; a fixture library, fade curves, USB DMX. Each is still a product the size of everything above.
