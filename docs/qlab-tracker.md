# QLab completeness tracker

The living list of what stands between Endless Cues and QLab 5, in the order we mean to do it. The audit behind it is [`specs/09-qlab-parity.md`](specs/09-qlab-parity.md) (a snapshot of 13 Nov 2026); this file is what changes as work lands.

`npm run tracker` prints the counts per stage.

**Marks.** `[x]` done, with a test or a smoke check · `[~]` partly done or done but not yet run in the app (the note says which) · `[ ]` not started. An item is only `[x]` when something checks it.

**Rule.** When a change lands, its line here changes in the same commit.

---

## Stage 1 · Repair what the audit found

- [x] **R1** A cue started by a trigger, a Start cue or `/cue/n/start` runs its sequence (auto-continue, auto-follow); the playhead stays. `engine.start`, host op `start`. Tested.
- [x] **R2** A Stop cue ends what was to follow the cue it stops, as the operator's stop does. Tested.
- [x] **R3** Load to Time counts through a pre-wait, for a top-level cue and for a group's children. Tested.
- [x] **R4** Load to Time takes a negative time (back from the end). `engine.lengthOf`. Tested.
- [x] **R5** A Mix cue's fader moves show on the mixer (the knob is labelled "·mix" until Reset or a hand on it). Smoke-checked on the audio window's fader; not heard.
- [x] **R6** Quantise "best" removed from the inspector (it needed data no show can hold).
- [x] **R7** Stale claims corrected: Mix "turns ducking on", versions "saved at once".
- [x] **R8** Each engine feature no show file could reach is decided (`specs/04-cue-engine.md` §12): a Jump's Loop from has a field; stanza chains, `after` / `afterWait`, pre-wait "audio", `withScene`, light-cue groups and the `visuals` hook are taken out. A blended Jump's `landings` / "best" stays until R9 gives it scores.
- [~] **R9** Beat grids: a cue's `tempo` (found from its sound when asked, or typed) gives the engine its beats and bars, so quantise has something to read (tested). Not yet: tempo that changes, and the Jump blends' match scores.
- [x] **R10** Loop regions: typed in (from, to) on Time & Loops, made from markers, or drawn by dragging across the waveform (smoke-checked).
- [~] **R11** Devamp acts on a Start–End loop and on a held region. (A held region: done, U3.)
- [x] **R12** Continue modes on cues inside a group: in the "start first" modes (U35). Tested.
- [x] **R13** Unknown fields in a cue are kept on save, and not played. Tested. (Unknown settings were already kept.)
- [x] **R14** The "Endless Cues account" assistant provider is not offered (it shows only in a show already set to it).
- [~] **R15** Opening from the desktop: a `.ecshow` folder or its `show.json` opens; a `.qlab5` is imported into a new show (the app now says it can view QLab 5 workspaces, as an alternate, never the default). Refused while the show is sounding. Written; not run from Finder in a packaged build.
- [x] **R16** Unit tests for Jump and blends, quantise, holds, seek, End at, fade-out tails, voice-band fades, Mix and the OSC trigger path (`test/engine-music.test.ts`; the trigger matching is now `core/net/triggers.ts`).
- [x] **R17** Show recording: ● Rec in the mixer writes what outputs 1–2 get to `recordings/` in the show folder (smoke-checked: the file and its length). The monitor feed (a mono copy of outputs 1–2 on another output, with its own level and meter) is a show setting in Settings ▸ Audio. Neither listened to; the monitor metered only on the test run's pretended outputs.
- [x] **R18** `12-roadmap.md` and `09-qlab-parity.md` brought up to date (2026-11-15) with the code and this tracker; the README's status too. 09's scorecard recounted by script.

## Stage 2 · Controls for what is already built

- [x] **C1** Load to Time: Tools ▸ Load to Time (⌘T), a field and a slider in the toolbar's place. Smoke-checked.
- [x] **C2** Jump to cue by number (⌘J), in any list; works in Show mode. Smoke-checked. The assistant moved to ⌘K.
- [x] **C3** Renumber selected cues (⌘R): start, step, prefix, suffix; numbers other cues have are passed over. Tested; run in the app.
- [x] **C4** Cue lists: add, rename, remove, show (Settings ▸ Show). Run in the app; a cue added while a second list shows lands in that list.
- [x] **C5** Single keys: E pre-wait, D duration, W post-wait (typed in the list), C continue, F flag, O notes, T target. Arm / disarm on A. Smoke-checked for E, C and O; D, W, F and T run in the app.
- [x] **C6** Pre-wait, duration and post-wait editable in the list by double-click. Run in the app.
- [x] **C7** GO is red while double-GO protection would ignore it, and flashes on an ignored GO. Smoke-checked.
- [x] **C8** Compare two saved versions: the "with…" list beside each version in the drawer. Smoke-checked.
- [x] **C9** Hold as a transport key (H).
- [x] **C10** Waveform: drag handles for Start and End; ⇧I ⇧O at the playing position; zoom to ×64 (buttons, ⌘-scroll, pinch) on finer peaks. The zoomed view does not follow the playhead.
- [x] **C11** Flagged cues listed with the problems (the footer's counts, ⇧⌘F); a hollow flag on a collapsed group that holds one. Smoke-checked.
- [x] **C12** Notes editable in the masthead, in Edit mode. Smoke-checked.
- [x] **C13** Ungroup (⇧⌘G); move the selected cue with ⌥⌘↑↓; fold / unfold every group (`<` `>`, View ▸ Fold All Groups; sections: View ▸ Fold All Sections, or ⌥-click a caret). Run in the app; smoke-checked with sections (C15).
- [~] **C14** S: fade and stop the selected cue; again, stop dead. Written; not run.
- [x] **C15** Sections: a heading row that never plays (GO, continues and auto-follow pass over it; Jump and Load to one land on its first cue; Jump takes its name); fold by click, ⌥-click for all, ← →, `<` `>`, View ▸ Fold All; a folded heading shows the cue standing by; Show mode opens the section the playhead is in; folds kept per show on this computer; a strip of section names above the list. Unit-tested (`test/sections.test.ts`) and smoke-checked (`app/main/smoke-sections.ts`).

## Stage 3 · Editing basics

- [~] **E1** Cut, copy, paste of cues within and between shows: the clipboard is the host's; in another show sounds are copied in, lost targets dropped, numbers in use not pasted. Unit-tested and run by hand between two shows; only the same-show paste is in the smoke run.
- [~] **E2** Find (⌘F): names, numbers, notes, files, messages, triggers; Enter next, Shift+Enter previous; select all found. Smoke-checked for a name. No replace.
- [~] **E3** Right-click menu on a cue (stand by here, audition, arm, rename, number, flag, cut/copy/paste, duplicate, group, ungroup, delete). Written; a test run has no screen to show it on, so it has not been seen.
- [~] **E4** Drag a cue onto a cue to set its target (smoke-checked); drop one sound file on an Audio cue to replace its file (the host command is smoke-checked; the drop from the desktop has not been done by hand).
- [x] **E5** New top-level cues take the next number; a setting for it and its step (Settings ▸ Show); Delete numbers (Renumber strip, Tools menu). Smoke-checked.
- [x] **E6** A new targeting cue takes the selected cue as its target (U16).
- [x] **E7** Paste Cue Properties (⌥⌘V): a chooser of which fields. Tested; smoke-checked.
- [x] **E8** Cue templates per type, per show ("Start like this one" in the inspector; listed in Settings ▸ Show). Tested; smoke-checked.
- [x] **E9** "Lock the playhead to the selection" as a show setting; off, a click on a cue's left edge moves the playhead. Smoke-checked.
- [~] **E10** Keys remappable: every single key (GO, Panic, the playhead, the letters) can be changed, given a second key, or reset, in Settings ▸ Keys; kept on this computer, not in the show. Smoke-checked. The ⌘ shortcuts are the menus' and are fixed.
- [x] **E11** Go to a cue's target (⌘E, the Go to button); the selected cue's target and the cues aimed at it are marked. Smoke-checked. Clearing a target is the Target list's "— choose —".
- [x] **E12** Twenty colours; a second colour once a cue has played, until Reset. Tested; smoke-checked.
- [~] **E13** Row sizes: compact, normal, large (Settings ▸ General; smoke-checked). A cue type dragged from the toolbar to a place in the list: run in the app, no smoke check.
- [~] **E14** Find missing sounds in a folder and relink (Tools menu): by file name, four folders deep. Written; not run.

## Stage 4 · Sequencing

- [x] **Q1** Group mode: Start First and Enter (U35). Tested; run in the app.
- [x] **Q2** Group mode: Start First (U35). Tested.
- [x] **Q3** Group mode: Start Random, dealt so that every child plays once before any plays again. Tested.
- [x] **Q4** Group mode: Playlist (shuffle, repeat, crossfade; "next" in Active cues; a stop ends it). Tested; run in the app. A QLab Playlist group imports as one, without those three settings.
- [x] **Q5** Each list keeps its own playhead and runs on when another is shown (the selector marks it ▶); a Start cue aimed at a list is its GO. Tested; smoke-checked.
- [~] **Q6** Second trigger on any cue: starts it again / nothing / fades it out / stops it / devamps (tested). On release: a hotkey's key-up and a MIDI note's end are written, not run in the window or on hardware. No separate "hard stop" (a stop here is one). Not read from a QLab workspace.
- [x] **Q7** Fade & stop others on any cue, kept to all / the cue's list / its peers. Tested.
- [~] **Q8** Duck or boost others while a cue runs; they come back when it ends; shown in Active cues. Tested; smoke-checked on the audio window's gains. Not heard.
- [~] **Q9** Skip if disarmed; auto-load (a standing-by cue's sounds decoded ahead, so its GO plays from memory). Tested in the engine; not run in the app.
- [x] **Q10** Reset cue (stopped, unloaded, armed as written, re-aimed, a Fade undone) and Target cue (re-aims another cue until Reset). Tested.
- [x] **Q11** Load cue on any cue, with a negative time (from the end). Tested.
- [x] **Q12** Fade a group (U7) or a whole cue list. Tested.
- [~] **Q13** Next / previous sequence (`=` `-`, remappable). Tested; smoke-checked. Not: open and close cues.
- [ ] **Q14** Timeline view of a group (drag to set pre-waits).
- [ ] **Q15** Record Cue Sequence.

## Stage 5 · Triggers and MIDI

- [x] **T1** Hotkey trigger on a cue (a letter, digit or F-key, with shift+ or alt+; the app's own keys are refused, with a reason); a QLab hotkey comes across. Run in the app.
- [~] **T2** Wall-clock trigger, by day of week: a cue's Clock trigger (`19:25 fri sat`). Parsing and firing are tested with a handed-in time (once, on its days, not for a time long past) and fired in the smoke run; nobody has watched the real clock reach a time.
- [x] **T3** A Triggers tab in the inspector (hotkey, OSC, MIDI, clock, timecode; it says what else each would set off), and Settings ▸ Triggers: every trigger in the show in one table, shared ones marked. Run in the app.
- [~] **T4** MIDI in: a MIDI trigger on any cue, with Learn; notes, programs, controllers, pressure and pitch bend (tested with messages handed to the host; no MIDI hardware has been connected).
- [~] **T5** Show commands from MIDI notes and controllers: GO, Panic, Pause, Resume, playhead up and down (Settings ▸ Integrations ▸ Network ▸ MIDI). Reviewed against the specification; no MIDI hardware has been connected. A controller written with no value fires on every value.
- [~] **T6** MSC in: GO and TIMED_GO (with a cue number), LOAD (the playhead goes to the cue), STOP, RESUME, ALL OFF, RESET, for the app's device ID or all-call, any command format (Settings ▸ Integrations ▸ Network ▸ MIDI). Tested to the byte; not run against a desk. Group device IDs are not answered.
- [~] **T7** MIDI cue: note on/off (with a length), program change, controller, key and channel pressure, pitch bend, MSC (with LOAD and TIMED_GO), raw SysEx, written as text; a controller, pressure or bend faded over a time; a QLab MIDI cue's message and fade on import (where QLab keeps a bend's value is a guess). Tested to the byte. Not sent to hardware yet.
- [~] **T8** MIDI File cue: a standard MIDI file played out with its tempo changes, a rate, pause and stop (sounding notes ended). Parsing and playout tested; messages are stamped with their time and handed to Web MIDI. Not sent to hardware yet.
- [~] **T9** Any incoming OSC message assigned to a show command (GO, Panic, Pause all, Resume all, playhead down and up), with Capture, in Settings ▸ Integrations ▸ Network ▸ Incoming OSC; obeyed with OSC control off and without a passcode. Tested. The command list mirrors MIDI's (QLab's own list is a screenshot in its manual); no real controller has sent one.

## Stage 6 · OSC breadth

- [~] **O1** Read and write cue properties over OSC (`/cue/{n}/name`, `/preWait`, `/continueMode`, `/armed`…), with `+` `-` and toggle. Tested against the module; no real remote.
- [~] **O2** `/cue_id/`, `/cue/selected` (= the cue standing by), `/cue/playhead`, `/cue/active`; patterns in numbers. Tested; no real remote.
- [~] **O3** `/cueLists`, `/runningCues`, `/runningOrPausedCues`, `/selectedCues`, `/valuesForKeys`. Tested. A long show's `/cueLists` is refused over UDP and answered over TCP. Not: the `/shallow` and `/uniqueIDs` forms.
- [~] **O4** `/updates` push; `/version`, `/workspaces`. Tested; no real remote.
- [~] **O5** OSC in over TCP on the input port (SLIP, and length-prefixed), beside UDP; UDP answers to port 53001, `/udpReplyPort`, `/alwaysReply`. Tested on loopback and in the app; no real remote.
- [~] **O6** Passcodes with view / edit / control, a no-passcode row, the delay after wrong tries; a table in Settings ▸ Integrations ▸ Modules. Tested. Which permission each address needs is by what it does (QLab's per-method table was not to hand).
- [~] **O7** `/cue/{n}/preview`, `/panic`, `/loadAt`, `/panicInTime`, `/playhead/nextSequence`, `/playhead/active`; `/cue/{n}/load` and `/loadAt` on a cue not standing by, `/cue/{n}/reset` and `/playhead/none` (through the host's per-cue ops). The module is tested with a fake host and the host's own ops (`load`, `reset` with a cue, `playhead` to none, `sequence`) in the smoke run; the two have not been run end to end over a socket, and no real remote has sent one.
- [~] **O8** `/showMode`, `/undo`, `/redo`, `/save`, `/new`, `/move`, `/delete`, `/renumber` (edits: Show mode refuses them). Tested; no real remote. `/renumber` numbers the cue standing by (the selection is one cue); the shape of `/move`'s reply is ours.
- [~] **O9** Show control broadcast in QLab's form: `/listen`, `/ignore`, `/qlab/event/workspace/…` (go, cue/start, cue/stop, playhead, and the six "All" events), `/eventFormat`. Tested; written from the manual, not compared with QLab. Not: MSC broadcast.
- [ ] **O10** Tried against QLab Remote, the Stream Deck plugin and Companion. Not done (needs the equipment); the script to follow is `docs/specs/06-control-surfaces.md` section 6.6.
- [~] **O11** Network cues: plain text and hex (UDP and TCP, with escapes); `\T \F \I \N`; resend; fade curves (four named shapes) and integer values; 2D fades along a typed path, with loop; several destinations per patch; interface choice. Tested on loopback. Not: a curve or path drawn by hand, smooth paths, live preview, OSC queries inside a message.
- [ ] **O12** More device descriptions, each checked against the device. Not done (needs the equipment); the method is in spec 06 section 6.6 D.

## Stage 7 · Audio depth (no new engine)

- [~] **A1** Fade curve shapes: linear, S-curve and custom points, separate up and down on Fade cues, and on an Audio cue's fade in and fade out. Applied in dB only (no slider / linear domain); not on a Mic cue's fade in; a trim during a shaped fade finishes it linearly.
- [~] **A2** Play count (tested); a loop region with a count goes round that many times, the click with it (tested; run in the app). QLab's slices are imported with their counts (U32). Not yet: markers read from the file.
- [~] **A3** A Devamp can start the next cue when the loop ends (region or whole loop). Tested on a fake clock; a region's end is met by a timer, not to the sample, and has not been measured against real audio. Not: slices as such (a loop region with a count is the slice here).
- [~] **A4** Rate 0.25–4 on Audio cues, with or without keeping pitch; a Fade cue fades the rate. Keeping pitch needs a streamed sound, so such a sound has no exact loop regions (the cue warns). End at, fade-out tails, counted loops, playlist crossfades, the next downbeat and a Devamp's "start next" are all counted at the sound's rate (tested). A Fade's rate is not applied to a Video cue (its picture would not follow). Positions checked, not listened to; Jump cues on a track at a rate other than 1 untried.
- [ ] **A5** Bus mute and solo.
- [x] **A6** Pan per cue (Audio and Mic) and as a line over a sound. Not per bus.
- [~] **A7** Level envelope drawn on the waveform, followed 30 times a second (not sample-exact). The QLab importer reads an integrated fade only in a guessed form no real workspace has confirmed.
- [~] **A8** An absolute fade lets go of a held voice-band dip; "Set level from target" and "Revert fade" on a Fade cue. Not done: live fade preview off.
- [x] **A9** Min / max level limits as a show setting (Settings ▸ Audio): cues, fades and trims are held and a cue above the maximum is flagged; mixer faders are not.
- [x] **A10** Ducking: one bus dips while another sounds (Settings ▸ Audio): threshold, depth, attack, hold, release, the voice band or everything; a DUCK light in the mixer. Smoke-checked with a stand-in signal on the key bus; not heard.
- [x] **A11** Formats checked end to end by the smoke run (duration, waveform, seek, loop region): WAV, MP3, M4A, FLAC, Ogg Vorbis, Opus as they are; AIFF and PCM CAF from a WAV copy, because Chromium reads neither. One bit depth of each; compressed AIFF-C / CAF refused with a reason.

## Stage 7b · Tempo and sends (ours, not QLab's)

- [~] **M6** Tempo found from a sound (`core/audio/tempo.ts`), kept in the cue as `tempo`; typed, halved, doubled, nudged, "1 is here". Tested on made tracks and nine real ones; run through the audio window in smoke.
- [~] **M8** Tempo that changes within a track: a section per tempo (own bpm, bar line, beats in a bar), found automatically where a tempo lasts 16 s or more and edited by hand ("1 is here", "+ here", beats in a bar 1–16); grid, quantise, beat-loops and the bar counter read the section the track is in. Tested on synthesised tracks only; a gradual change is not found; beat one is never guessed.
- [~] **M11** Sends and returns: a reverb and a delay per show as bus sends (N5, Settings ▸ Audio).

## Stage 8 · Audio routing (bus to output pair: done in the web engine; the rest probably needs a native one)

- [ ] **N1** More than one output device. Not built: two devices are two unlocked clocks and Web Audio gives no way to measure or correct the drift; the design that would work (a bus belongs to a device) and what to build first (audition on a second device) are written up in specs/05-audio.md. One device's many outputs: see N2–N4.
- [~] **N2** Output routing: each bus goes to a pair of the device's outputs (Settings ▸ Audio), its own master and limiter per pair; a pair the device lacks is silent and flagged, never moved to 1–2. Each output can be named and trimmed down (after the limiter), with a meter each. Smoke-checked on a pretended eight-output device. NOT yet heard on a real multi-output interface. Not: a bus to a single output, output patches.
- [~] **N3** A cue's own outputs: an Audio or Mic cue can be sent to chosen outputs instead of its bus's pair, a level per channel × output (inspector ▸ More ▸ Own outputs), mono outputs included; its bus's fader, mute, solo and ducking still move it, and each pair's master and limiter still come last. Smoke-checked by meters; NOT heard on a real interface. Not: gangs; a change is heard from the cue's next play.
- [~] **N4** Multichannel files: with outputs of its own, each channel of a file is routed (checked with a four-channel WAV, by meters); on a bus it is folded to two. Channel count is read from WAV headers only. NOT heard on a real interface.
- [~] **N5** Effects: one reverb and one delay per show as bus sends and returns (Settings ▸ Audio), and a three-band EQ on a cue. Returns are metered in the test run; nobody has listened to them. Not: plugins, effects on a routed cue or on a device output, pre-delay or tempo sync.
- [~] **N6** Mic cue: a live input (device, channel) onto a bus, with a level and a fade in; Fade and Stop cues work on it. Smoke-checked with a stand-in signal. NOT yet opened on a real input, and its delay through the app has not been measured.
- [~] **N7** Audition to other outputs: V can play to a pair of its own on the same device (Settings ▸ Audio), the cue alone and not in the house. Smoke-checked by meters. Not: always-audition, a second device, audition for anything but sound.
- [~] **N8** Device loss: the show falls back to the system default with a notice and returns when the device is back (decision unit-tested, smoke-fed device lists). Not tried by unplugging an interface; what happens to sounds playing at that moment is unknown.

## Stage 9 · Import and files

- [x] **I1** Open a QLab 5 workspace (`.qlab5`) directly: File ▸ Import a QLab Workspace…, drop it on the window, or `ec import-qlab`. Read from the file itself (no QLab needed, any platform); opens as a new unsaved show with a report of what did not come across. The reader and the mapping are tested against a made-up workspace and were run on one real 173-cue workspace; the window side is smoke-checked. Mapped from files saved by QLab 5.6: other versions unverified.
- [~] **I1b** QLab 4 (`.qlab4`) workspaces are read: checked on a real QLab 4.7 workspace of Audio, Fade and Group cues (every sound found, the levels, waits, continues and fades right; an End at that is only the file's end is dropped once the file is measured). Its Network and MIDI cues are read by QLab 5's names and have not met a real QLab 4 file. Video, Text and Camera cues come across (their file, text, geometry and layer; from a made-up fixture only, and the names a QLab Video cue's geometry is read under are unconfirmed). Light cues come across with their commands where the text can be found (a made-up fixture only; no real workspace with Light cues has been read, and the patch is not read). MIDI File cues come across, and Timecode cues by guess (the field names are from a real file; what they hold is not confirmed). Not: Script cues.
- [x] **I2** Timed backups of the working show (unsaved changes and all) every `settings.backup.minutes` while it changes, pruned (newest `keep`, then one a day for two weeks); listed and restored under Versions ▸ Backups as an undoable edit. Tested; smoke-checked. The timer is off in test runs and has not been watched over a long sitting.
- [~] **I3** Show templates (File ▸ Save as a Template…, New Show from Template) and settings import / export, with no passcodes in either. Tested; smoke-checked.
- [x] **I4** Media playback log: every sound that played, when and for how many seconds, in `logs/playback.csv`; File ▸ Export the Playback Log…. Tested; smoke-checked. Mics are not logged.
- [~] **I5** Signed and notarised macOS build; Windows and Linux run by a person. Read for and fixed without being run there: one copy of the app, a show opened by its `show.json`, shortcut labels, About, `npm install`, closing the main window quits. `10-cross-platform.md` lists what a person must check.

## Stage 10 · Carts, timecode, windows, redundancy

- [~] **X1** Cue carts: a list drawn as a grid of buttons (to 15×15), each starting its cue while the list being run keeps its playhead; mouse, arrows and Enter, drag to move or swap; a QLab cart imports as one. Tested; smoke-checked. Not: hold-to-play / second trigger, cell sizes, a touch screen tried, positions checked against a cart QLab itself saved.
- [~] **X2** Timecode cue: MTC out (full frame and quarter frames) and LTC out as sound on a chosen output, at 24 / 25 / 29.97 drop / 30. MTC tested to the byte and by its stamped times; LTC decoded by the app's own reader through the real audio worklets. Timers wake 1–5 ms late (measured), so MIDI is stamped 100 ms ahead; neither has been read by timecode equipment, and timing at a MIDI port is unmeasured.
- [~] **X3** Chase incoming timecode (MTC on any MIDI input; LTC on an audio input): a timecode trigger on any cue, a located time starts a cue part way in, the playhead follows. Tested on a fake clock and, for LTC, against the app's own output. Not yet: stopping cues when timecode stops, chase per list, capturing a trigger from the incoming time, a real LTC input.
- [~] **X4** A list, a cart or the inspector in a window of its own (Window menu). Smoke-checked for a cart and the inspector. Not: a plain list window checked, several inspectors, a status window.
- [~] **X5** Override controls: OSC out, MIDI out, timecode out and DMX out each held back for rehearsal (Tools ▸ Hold Back …), said in the monitor and by one red chip in the title bar that names them; kept through a restart. MIDI out holds everything on its way to the port (MTC and a MIDI file's messages too); timecode out holds MTC and stops LTC, which starts again where the cue has got to (smoke-checked with the app's own LTC reader); DMX out makes every packet and sends none. Tested (DMX on loopback); smoke-checked. No equipment connected to see nothing arrive; no input overrides.
- [~] **X6** Main and backup: a module on the main says its transport again to the backup in OSC control's addresses, with a heartbeat; the backup says when the main goes quiet. Tested with two engines, including a lost message. Never run on two computers; nothing fails over by itself; edits, the mixer and trigger-fired cues are not mirrored (06 lists what take-over needs).
- [~] **X7** Web remote: a fader per bus and the master, and Load to Time, behind a Levels button. Tested, and drawn in an offscreen browser; not on a phone. Not: editing cues. HTTPS: not done; what it would take is in spec 06 section 7.
- [ ] **X8** Collaboration (several editors).
- [x] **X9** Script cue: a list of show commands as text (the OSC control addresses, and `wait`), run in order by the engine; not code, by design. Bad lines are errors on the cue. Tested; smoke-checked.

## Stage 11 · Video and lighting

- [~] **V1** Video cues on one display. Video files and stills play on a stage window (Settings ▸ Video: a display or a window, test pattern), sound through the cue's bus with every Audio transport; tested offscreen by pixels. Left: a run on a real projector (focus, menu bar, unplug/replug, lip sync by eye); playback rate, play counts and slices; a stage monitor in the operator's window.
- [~] **V2** Geometry, opacity, layers; fades of them. Size, opacity, position, scale, rotation (one axis) and layer per cue; a Fade moves opacity, position, scale and rotation linearly. Left: crop, anchor, 3D rotation, blend modes, fade curves and paths, relative geometry fades.
- [~] **V3** Text and Camera cues. Text: one font, size, colour, alignment. Camera: a webcam-class device by name, mirror, no sound. Left: rich text, a Camera cue's own sound, a real camera tried.
- [~] **V4** Stages, regions, warping, masks, edge blending. One stage with a four-corner pin (typed, not dragged), a blackout and a test pattern. Left: several stages and regions, masks, edge blending, mesh warps (what each takes: `docs/specs/13-video.md`).
- [ ] **V5** NDI, Syphon, Blackmagic. Needs native code (an SDK or GPU texture sharing per platform); why, and the route, are in `docs/specs/13-video.md`.
- [~] **L1** DMX out over the network: Art-Net (ArtDmx; answers ArtPoll, lists nodes) and sACN (multicast or unicast), any number of universes, 40 Hz from the main process with every universe re-sent each refresh; a dashboard Blackout; Panic holds the lights unless Settings ▸ Light says otherwise. Bytes tested against the specifications and on loopback; a test run sends nothing. **No fixture has been lit by it.** Not: USB (needs a native serial module; the Enttec frame is written and tested, the lighting spec §8), choosing a network interface, Art-Net unicast to subscribers, sACN sync and discovery.
- [~] **L2** Light patch (Settings ▸ Light): instruments with a universe and an address, groups of groups, eight generic fixtures (dimmer, RGB/RGBW/RGBA with or without a dimmer, a moving head in 8 or 16 bit) and your own written as text, kept in the show; clashes and bad addresses are reported. Not: a manufacturer library, GDTF or QLab definitions, CMY/HSI or pan/tilt pickers; renaming an instrument does not rename it in cues and groups.
- [~] **L3** Light cues hold levels as text (`front = 80`, `all = 0`, `cyc.red = 100`), fade to them, track, and can be a full state; pause, stop and a Fade of one; the Lights dashboard (⇧⌘D): live levels, a command line with a time, blackout, clear, revert, a new cue from changes or from everything, update the selected cue. Unit-tested and smoke-checked; never seen on a light. Not: fade curves, collate, `= cue A` pulls, park, subcontrollers, an audition tab, dashboard undo, MIDI control.
- [~] **L4** Lighting desk module reviewed against the published OSC documentation: the grandMA3 fire message changed to `Goto Cue n Sequence l` and its set-up notes corrected; Eos messages agree with what could be re-read. A step-by-step script for an Eos and a grandMA3 is in the lighting spec §10. **Not run at either desk.**

## From the usability runs of 2026-11-14 and 2026-11-15

Virtual users (`docs/internal/usability/<run>/summary.md`): three on the 14th, all four on the 15th. Fixed after the first run: a running row lost its columns, cues added to the show the app starts on were not drawn, a Fade left at its grey defaults faded to nothing, Save As stopped the sound, grouping threw the playhead to the top, a click imported silent with no note. After the second, the lines marked done here. Two things both runs reported were the test rig's, not the app's, and the rig is fixed: a field kept only on Enter (a hidden window sent no blur), and a window frozen after a drag (a native drag that never ended).

- [x] **U1** Holding a loop region holds the click with its track: a sound of the same length in the same group goes round with it (unit test; run in the app).
- [x] **U2** A region is held and let go with a key (L), a menu item and a chip in Active cues, not only its block; Time & Loops says a region does not loop by itself.
- [x] **U3** A Devamp aimed at a sound lets go of the region it is held in (or disarms the one armed).
- [x] **U4** Moving a cue: cut and paste (⌘X ⌘V) moves it, copy and paste makes it again; drag works (checked with the rig's drag events, not a hand on a mouse); the manual says how.
- [x] **U5** The first Save As records a version.
- [x] **U6** The ■ beside one active sound fades it out (again or Shift: stop dead).
- [x] **U7** A Fade can target a Group: every sound in it moves, and with "stop target" what was waiting in it is called off.
- [x] **U8** Show mode: V (audition) is off, with a message. Load to Time says to switch to Edit. Reset stands apart from Panic and asks first while anything sounds. (A click on a row moves the playhead, as in QLab: kept.)
- [x] **U9** A Help menu (the keys, the manual); the Loop switch is on Time & Loops too; the manual's keys match the app's (A arms, ⌘K assistant, ⌘J jump).
- [x] **U11** One copy of a sound in `media/` however many cues use it (compared by content). Sounds no cue uses are listed in Settings ▸ Show and moved to the Trash on request (never by themselves: an older version may use them).
- [x] **U12** The welcome card and the empty list's message do not overlap.
- [x] **U14** Learn keeps a trigger's arguments (`/sensor/door 1`, so its 0 does not fire the cue).
- [x] **U15** The lighting desk is set up once: with no address of its own the module sends to the desk's patch; standing by on a Light cue says whether it is sent.
- [x] **U16** A new Fade, Stop… is aimed at the selected cue, and a new top-level cue takes the next number.
- [x] **U17** The countdown on a cue with an End at counts to it; standing by says when the next cue follows by itself; Load to Time takes the selected cue's top-level cue; rename starts from the name shown; version notes name an unnumbered cue in full; the OSC control module lists its addresses; the monitor shows a sender's address.
- [x] **U18** A new sound's bus: a sound half a minute long or longer is added on Music, and a message says so (run in the app).
- [x] **U19** The monitor is a drawer beside the cue list (Tools menu, ⇧⌘N, the sidebar's Monitor), with MIDI in it too; `f:1 i:1 s:1` force an argument's type and a float arriving shows as 1.0.
- [x] **U20** A fade out with an End at was never applied (the sound cut dead): it now lands on the End at, and shows in the level readout (tested). Load to Time opens on the cue's last time.
- [x] **U21** The web remote's key is written to the show file when it is made.
- [~] **U22** A Light cue whose send failed (no address, a bad number, a socket error) is flagged on the cue until it next goes. Not run against a failing desk. UDP cannot tell a dead port from a quiet desk.

Third run, 2026-11-15-b (after routing, MIDI, counted loops and playlists were built):

- [x] **U23** A loop region's count and a play count can be typed while the sound plays (the box was redrawn under the typing); a region can be set to go round until let go (∞) with no key pressed to start it. Tested; run in the app.
- [x] **U24** Show mode: a click on an active cue's progress bar no longer skips the sound.
- [x] **U25** Adding a second network patch leaves cues that sent to "the only patch" on that patch, and says so (run in the app).
- [x] **U26** The monitor and the Network strip show a patch's address and port; what arrives on the input port is shown by its sender, not credited to a patch that shares its address; long messages wrap; the toolbar wraps beside an open drawer.
- [x] **U27** Undo survives the first Save (Save As carried on with an empty undo list). Run in the app.
- [x] **U28** Deleting a cue selects the one after it (the list stays where it was). Run in the app.
- [x] **U29** Time & Loops has Start and End, and a marker can be added at a typed time; a click on the waveform there picks a time and changes nothing by itself.
- [x] **U30** A Number is not typed onto several selected cues at once (Renumber is named instead); the MIDI cue's box shows examples; Load to Time says "this GO only" and remembers the time after ⌘T on a selected cue; a sound of half a minute or more goes on Music.
- [x] **U31** The manual says which computers the app has and has not been run on.
- [x] **U32** A QLab MIDI cue's message, a playlist's settings, slices with their counts, the group start modes, a hotkey and a MIDI trigger are read on import, from the field names in a workspace QLab 5.6.3 itself saved (kept outside the repository in `reference/qlab/`; the fixture uses the same names). A Mic cue comes across as one. Not: a Timecode cue (no such cue here).
- [x] **U33** The monitor says "did nothing" beside an incoming message that nothing acted on (the mark is on the kept entry; a message being learned is only learned, never also acted on).
- [x] **U34** Show feedback sends no GO when it is switched on, and names an unnumbered cue by its name.
- [x] **U35** Group modes "start first and enter" (each GO fires the next child; the playhead waits on the group), "start first" and "start one at random", with the children's continue modes running inside them (tested); ungroup; hotkey triggers.
- [x] **U36** The Target column shows a named Audio cue's file name (its bus in the tooltip).
- [~] **U37** The app launched on Windows and on Linux: still not launched; see I5.

From a test on real music (the mixes of a show, 5 to 15 minutes each), 2026-11-15:

- [x] **U38** The deck's loop buttons armed a loop that never went round on a sound with no regions of its own (it was streaming, never decoded): it is decoded when the loop is armed. Smoke-checked.
- [x] **U39** Find tempos says how many it found and which sounds it did not; Save As says how much it copied into the show; markers and regions read to the hundredth; the marker boxes stay put as markers are added.
- [~] **U40** Tempo finding on real tracks: half time and the dotted reading are now decided on the evidence (176 and 114 found where 88 and 76 were), the likelier reading is offered first, and the view says which parts of a file the grid fits. Still: no choice made on one soft track (64 offered first); a shuffle is read as the straight tempo; one grid per file (M8).
- [x] **U42** The audio process held 1–2 GB after long tracks: a dropped voice kept its buffer, and garbage was never collected. Measured 843 MB → 36 MB with nothing playing after five 8-minute tracks.
- [ ] **U43** The Time & Loops waveform on a short window; P pausing the next cue after a GO. Not done.

From a test of the assistant (its tools run directly, and one live turn through Claude Code), 2026-11-15:

- [x] **U44** A proposal no longer undoes an edit the person made while the assistant worked (its draft is rebuilt on the show as it is now); operations that did nothing are refused instead of reported as applied; bad settings are refused; a second proposal builds on the one waiting. `test/assistant-tools.test.ts`.
- [x] **U45** The assistant's outline and reference are generated from the cue-type table and the settings (every new type and field is in them); long shows get a short outline; an edit says what it broke.
- [x] **U46** A duplicate carries no cue numbers (its children kept theirs); a loop region that cannot be is refused, not dropped along with the cue's other regions; a draft never proposed does not carry into the next request.
- [x] **U47** The checks on an operation's shape and on a setting's value are in `core/show/ops.ts` (`applyOps`), for the inspector, the assistant and the new `ec apply`. Tested.
- [x] **U48** A turn that fails after replacing a waiting proposal puts the waiting one back (`ShowDocument.withdraw`). Tested.
- [ ] **U49** The assistant's key-based providers and Codex against a live service (as before).

## Design and defaults (asked for 2026-11-15)

- [~] **D1** A design pass on the whole app (tabs Edit · Rig · Show replace the toggles; seven Settings sections; type, height, spacing and radius tokens in 07; words cut everywhere; the after pictures and the inline font sizes in JS left): one written design system (type scale, spacing scale, control heights, radii, the colour tokens and what each means), every surface checked against it, text wrapping and truncation checked everywhere (long cue names, long file names, narrow windows, every drawer and dialog), sizes made consistent. A thorough design QA with a picture of every surface before and after.
- [x] **D2** Simple by default: a new show is a plain cue list. Ducking, tempo and beat analysis, every network listener and module, and anything else that acts on its own are off until switched on; a new sound's bus is not guessed from its length. Every such behaviour, its default and its switch are listed in `specs/00-defaults.md` (`test/defaults.test.ts`, `test/kinds.test.ts`, `app/main/smoke-defaults.ts`). Left for the owner: the safety limiter (on), double-GO protection (0.3 s), OSC control (off).
- [~] **D3** The mark (the buck mask, a shadow puppet from Endless Forms, dark on the lit screen) as the app icon, the document icons, the favicon and the site's wordmark. Done: one source (`build/mark.ts`, `docs/brand.md`), the app icon (checked in an unpacked Mac build), the start screen and Settings ▸ About (the SVG mark, the name in one colour; smoke-checked), the site's favicons, header, footer and link card, and a document icon for `.ecshow` (`build/document.icns` / `.ico`, declared in `build.fileAssociations`; seen in an unpacked Mac build's Info.plist and Resources). Not: the document icon seen in Finder (a show is a folder, and a folder takes a document icon only once it is registered as a package, which is not decided: `specs/10-cross-platform.md`), the mark in the window's title bar, any icon seen on Windows or Linux.
- [~] **D4** Sound design on a cue: a chain of tools per Audio, Mic and Video cue (filters, four-band eq, gate, compressor, drive, crush, pitch shift, chorus, tremolo, auto-pan, stereo, delay, reverb with an impulse-response file), presets, bypass, a tail that rings out, a Fade that sweeps a tool. Measured offline and in unit tests; never listened to. Not built: the chain on a bus, reverse, a gain-reduction meter, reordering.
- [~] **D5** Kinds of sound: a bus's kind as a label; ducking by kind with look-ahead for a recorded voice, a stop that fades, one at a time, never ducked, sorting new sounds by a guessed kind: all off by default, each behind a named switch. A voice-over's transcript in the masthead. The guess has met only synthesised signals; nothing heard.
- [ ] **D6** Overlapping plays of one cue (an effect retriggered over itself): a cue is one voice everywhere.
- [x] **D8** The rescue tools are the cue list's own, in the Playing strip: go round the next 1, 2, 4 or 8 bars from the beat the track is on (1 or 2 beats, or 2 to 16 seconds for a sound with no tempo, under More) until Let go or L, with no region drawn; bar lines on the playing waveform and the bar.beat count; "+ here" and a button per marker to skip or (Shift) crossfade to it, on the track's next bar line when "on the bar" is ticked (`engine.moveOnGrid`); Find the tempo in the strip; a found tempo corrected on Time & Loops (typed, ÷2, ×2, the other readings, beats in a bar, "1 is here", nudge). `test/rescue.test.ts`, `app/main/smoke-rescue.ts`. Checked by position and timing on a click track; not heard.

## The assistant and the rig (spec 15)

Built from [`specs/15-assistant-and-rig.md`](specs/15-assistant-and-rig.md) in three packages and joined; the walk of its section 8 was done in the window, with the built-in helper and once more with Claude Code ([`try-the-assistant.md`](try-the-assistant.md) is that walk, for a person). Everything here has met only a stand-in prop on the same computer.

- [x] **AR1** Devices: equipment as part of the show (`settings.rig.devices`): an address, named commands with typed values, a way of telling it is there, what it reports. Three edit operations, started from a model or empty, a patch made a device in one edit with its id kept. Unit-tested; added, edited and removed in the window by the smoke run.
- [x] **AR2** Device cues: a cue that sends one of a device's commands, with its values in the inspector and a fade for a command that has one; broken and skipped when its device or command is gone. Engine tests; fired in the smoke run and, in a `--net` session, received by the stand-in prop (once, though sent three times with one id).
- [x] **AR3** The check: one function that says whether the show is ready, a row for each thing the show uses, four states, and what to do about each row that is not ready (`core/rig/check.ts`; `ec check`). Unit-tested row by row; a test holds that every button a row is given is one the page carries out.
- [x] **AR4** Liveness: a device that can be asked is asked every two seconds, quietly; one that stops is a problem with its fix, a dot on the Rig tab and one notice, and is ready again when it is back. Unit-tested on a fake clock and against the stand-in on loopback; watched in a `--net` session (stopped: a problem within six seconds; restarted: ready).
- [x] **AR5** The Rig page: the rows, the devices and their editor (commands with Try and +cue, the exact message under each), Look for props, the operator's own checklist with ticks for one sitting, what was heard on the network, Show mode. Smoke-checked against the real rows; pictures in three themes.
- [x] **AR6** The assistant's tools for the rig: the folder, a text file, the Rig's state, the monitor, "are you there?" to a device or a model's test message to a private address, look for props, firmware and the hand-over as files on a proposal; never a command, never in Show mode. Unit-tested with scripted providers; seven turns through Claude Code in a test session.
- [x] **AR7** The assistant's first screen: one true line about this show, asks made from it as buttons, the next rung as a quiet line, and with nobody answering the four ways to have somebody (one click for Claude Code or the built-in helper). Offered again under a conversation. Unit-tested for every state; smoke-checked in the window, each of the helper's asks pressed.
- [x] **AR8** The built-in helper: with no model, cues from a folder, a device, look for props, a cue for a command, "is everything ready?", "why is it not answering?", firmware, the hand-over, and says plainly what it does not do. Each turn unit-tested; the whole walk done in the window.
- [x] **AR9** Start from a folder: any folder becomes the show (a `show.json` beside the sounds, nothing copied), the drawer opens and says what is in it, and cues are made only when asked. Smoke-checked.
- [~] **AR10** The prop kit: firmware for a light or a switch on an ESP32, set up from a form or by the assistant, reviewed file by file and written into `props/`; `secrets.h` never replaced. The generator is unit-tested and the files reach the disk in the smoke run; the sketches compile for `esp32` and `esp32c3` and **have never been flashed or run on a board**.
- [x] **AR11** The hand-over: `AGENTS.md` and `CLAUDE.md` in the show folder, generated from the show, with command lines for this computer (from an installed app they run the app's own program as Node). Unit-tested; accepted to disk in the window; the installed-app lines run once against an unsigned test build.
- [~] **AR12** Everything above against real equipment: a real prop, a lighting desk or mixer as a device, Look for props through a real router, a signed build's Local Network permission, a MIDI device, a heartbeat device, `resend` on Wi-Fi. None tried (`CLAUDE.md`, "Not verified yet").
- [~] **AR13** The script (rung 3): a script file named in the show, `@cue` marks read, a row for marks with no cue, the assistant reading it. Unit-tested; not walked in the window, and no way in the window to name the script but the assistant or Settings' raw path.
- [ ] **AR14** HTTP devices (`via: 'http'`): WLED, Shelly and the like. Until then the answer is the hand-over.
- [ ] **AR15** Flashing a board from the app.
- [ ] **AR16** A test tone per output, as a row action on "Sound goes to …".
- [x] **AR17** Tempo sections on Time & Loops ▸ Tempo: **+ Change here** and **Remove change** (smoke-checked).
- [ ] **AR18** `.ecshow` as a package in the Finder (one icon, opened by a double click).
