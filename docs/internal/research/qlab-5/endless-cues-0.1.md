# Endless Cues Public Alpha: what the code does today

Audited 2026-11-13 at commit `dad5c9e` (v0.1.0). Read from the code, not the docs. `reference/` and `site/` ignored. `npm test`: 47 tests, 47 pass. The app was not launched; anything in `app/audio/audio.html` and `app/renderer/` is read, not run (only `npm run smoke` exercises them, and it was not run here).

Status key
- **WORKS**: the whole path exists (show file → engine → host → UI where a UI is needed). "(tested)" means a unit test in `test/` covers it.
- **PARTIAL**: exists with a stated hole.
- **UI-ONLY** / **ENGINE-ONLY**: one side exists without the other. ENGINE-ONLY also covers engine fields that `show.normalise` strips (it keeps only keys in `cue-types.js`, `core/show/show.js:137-143`), so no show file, inspector or assistant edit can reach them.
- **CLAIMED-NOT-BUILT**: a doc, comment or UI string says it; the code does not do it.

Paths are relative to the repo root.

## 1. Cue types (the table is `core/show/cue-types.js:36-144`)

- **WORKS (tested)** Group: fires all children at once, each after its own pre-wait (timeline group, the only mode). `core/engine/cue-engine.js:994-1019`, `test/engine.test.js:39`
- **WORKS (tested)** Audio: plays a file on a bus. `cue-engine.js:1020-1038`, `app/audio/audio.html:225-268`
- **WORKS (tested)** Fade: moves one running Audio cue's level over a duration, optional stop-target. `cue-engine.js:1042-1065`, `test/engine.test.js:28`
- **WORKS** Stop: stops the target and everything under it, cancels its waits. `cue-engine.js:1066-1068, 1369-1378`
- **WORKS (tested)** Start: fires the target, or resumes it if paused. `cue-engine.js:1082-1086`, `test/engine.test.js:97`
- **WORKS (tested)** Pause: pauses a running target. `cue-engine.js:1087-1089`
- **PARTIAL** Load: sets where an Audio cue starts next time. Audio targets only, no negative time, no group targets. `cue-engine.js:1122-1124`
- **WORKS (tested)** GoTo: moves the playhead to the target's top-level cue, switching list if needed. `cue-engine.js:1090-1096`
- **WORKS (tested)** Arm / Disarm cues. `cue-engine.js:1097-1103`, `test/engine.test.js:84`
- **PARTIAL (tested)** Devamp (engine type `release`): a whole-file loop finishes its pass and ends. Does nothing to a Start–End loop or a held region (`r.loop` is already false there). `cue-engine.js:1069-1081`, `test/engine.test.js:141`
- **WORKS (tested)** Wait: live for its duration, so an auto-follow waits for it. `cue-engine.js:1104-1115`, `test/engine.test.js:54`
- **WORKS** Memo: does nothing. `cue-engine.js:1156-1158`
- **WORKS (tested)** Network: one OSC message to a patch; with `#v#` a faded value. `cue-engine.js:1129-1152`, `test/modules.test.js:99`
- **WORKS (tested)** Light: a desk cue number; calls the host's lights hook unless light cues are off or `follows` is set. `cue-engine.js:1116-1121`, `test/engine.test.js:54`
- **PARTIAL** Mix: ramps bus faders over a duration. The mixer UI and the show file do not follow it (knobs keep showing the saved level), and Reset puts the saved levels back. `cue-engine.js:1153-1155`, `app/main/host.js:71, 365`. Untested.
- **PARTIAL** Jump (type `music`): moves a playing track to another place in itself. Logic complete in the engine and audio window, but no unit test covers it. `cue-engine.js:1176-1303`, `audio.html:286-363`
- **ENGINE-ONLY** `visuals` cue type and the `visuals` hook (start/pause/seek/stop/look). Not in the type table; the host passes no hook. `cue-engine.js:1125-1128, 1036`
- Absent cue types (no entry in `TYPES`): Mic, Video, Camera, Text, MIDI, MIDI File, Timecode, Script, Target, Reset, Cart. See "Absent".
- **WORKS** An unknown type in a hand-edited file is kept as a Memo with a note, not dropped. `show.js:133`

## 2. Fields every cue has (`cue-types.js:19-32`)

- **WORKS** `number`: any text, may be empty; duplicates are a warning, not refused. `show.js:176-180`
- **WORKS** `name`, with a default name derived from the target/file when empty (shown dimmer). `cue-types.js:224-240`, `app/renderer/CueList.js:132-133`
- **WORKS** `notes`: plain text, shown in the masthead when standing by. `app/renderer/app.js:47`
- **WORKS** `color`: 9 colours + none; a swatch in the status column. `cue-types.js:16`, `CueList.js:120`
- **PARTIAL** `flagged`: stored and drawn as ⚑. Not listed, filtered or counted anywhere. `CueList.js:124`
- **WORKS (tested)** `armed`: a disarmed cue is skipped when fired but a continue still passes on. `cue-engine.js:829, 164-167`
- **WORKS (tested)** `preWait`. `cue-engine.js:840-855, 989`
- **PARTIAL** `postWait`: applied before auto-continue and before auto-follow. Top-level cues only (see Sequencing). `cue-engine.js:265-276`
- **PARTIAL** `continue` none / auto-continue / auto-follow: top-level cues only; ignored on cues inside a group. `cue-engine.js:265-276` (uses `steps()`, the top level)
- **WORKS** `oscTrigger`: address (OSC patterns allowed) plus optional exact args; fires the cue without moving the playhead. `host.js:86-101`, `core/net/osc.js:93-97`. Unit tests cover the hub and `matches`, not the trigger path itself.

## 3. Per-type fields

Group (`cue-types.js:40-48`)
- **WORKS (tested)** `fadeOthers`: fades and stops everything outside the group, cancels outside waits and follows. Skipped when the group has `blend`. `cue-engine.js:1001-1011`
- **PARTIAL** `onBeat` beat / bar: waits for the next beat/downbeat of the newest running audio cue that has a grid. Works only if that Audio cue carries `beats`/`downbeats`, and nothing in the app makes a grid (see Audio). Untested. `cue-engine.js:860-897`
- **UI-ONLY** `onBeat: best`: selectable, but it needs `landings` scores that `normalise` strips, so it behaves exactly like `bar`. `cue-engine.js:921, 948`
- **WORKS** `beatLead`. `cue-engine.js:892, 1169`
- **PARTIAL** `blend` cut / fade / dj and `blendSecs`: the plan for a child Jump cue. Untested; `dj` bass swap is `audio.html:346-352`. The ambient fallback never triggers because it too needs `landings`. `cue-engine.js:904-969`
- A group with `onBeat` ignores its own pre-wait. `cue-engine.js:982`

Audio (`cue-types.js:54-67`)
- **WORKS** `file`: relative to the show folder or absolute. `core/show/document.js:241-245`
- **WORKS** `gainDb`; an edit to a playing cue's level is heard at once. `host.js:132-138`, `cue-engine.js:403-413`
- **WORKS** `bus`; an unknown bus falls back (warning). `show.js:170, 206`
- **WORKS** `from` (Start at). `cue-engine.js:1025`
- **WORKS** `cutAt` (End at): sample-placed cut with a 4 ms ramp. `cue-engine.js:697-714`, `audio.html:430-440`
- **WORKS** `loop`: whole file, or Start–End when `cutAt` is set (needs the file decoded to a buffer; until then it plays straight on). `cue-engine.js:553-562, 1028`
- **WORKS** `fadeIn`. `cue-engine.js:1031-1034`
- **WORKS** `fadeOut`, `fadeAt` (tail fade landing on the last sample, or early and then stop; a loop fades only at `fadeAt`). `cue-engine.js:718-747`. Untested.
- **PARTIAL** `markers`: named places drawn on the waveform; add (at the pin or playhead) and remove. No rename, no drag, no "go to marker", not cue-able. `app/renderer/Inspector.js:147-158`
- **PARTIAL** `loops` (loop regions): drawn as a lane; click to hold/let go while playing. The only ways to create one are "Make from markers", the assistant, or editing JSON; no start/end editor. `Inspector.js:159-162`, `cue-engine.js:596-638`
- **PARTIAL** `beats`, `downbeats`: hidden fields, no UI, and no analyser anywhere in the repo; only the demo generator writes them (`examples/make-demo.js:54-57`). Every quantise/blend feature depends on them.

Fade (`cue-types.js:73-80`)
- **WORKS** `target` (Audio only), `db`, `duration`, `stopTarget`.
- **WORKS** `relative`: dB from the target cue's own level; a later fade cancels another cue's still-waiting fade on the same sound. `cue-engine.js:1043-1054`
- **WORKS** `range: voice`: dips a 1.2 kHz peaking band instead of the level. `cue-engine.js:1057-1062`, `audio.html:48-56, 397`. Untested.

Network (`cue-types.js:103-108`)
- **WORKS** `patch` (optional when the show has exactly one), `message`.
- **WORKS (tested)** `fadeFrom`, `fadeTo`, `duration`: `#v#` runs linearly at 30 messages/s, always sent as a float; pausable and stoppable. `cue-engine.js:1133-1151`

Light (`cue-types.js:114-115`)
- **WORKS** `lightCue`, `follows` (do not fire from here).

Mix (`cue-types.js:122-123`)
- **WORKS** `levels` ({bus: dB}), `duration`.

Jump (`cue-types.js:130-140`)
- **PARTIAL** `target`, `to`, `loop`, `end`, `hold`, `level`, `fadeIn`, `stop`, `stay`, `letGo`: all read by `moveTrack`. None unit-tested. `cue-engine.js:1176-1303`
- **ENGINE-ONLY** `loopFrom`, `withScene` on a Jump cue. `cue-engine.js:1182, 1216, 1250`

Wait: `duration`. Load: `target`, `at`. Stop/Start/Pause/GoTo/Arm/Disarm/Devamp: `target`.

## 4. Sequencing, groups, continue modes

- **WORKS (tested)** Auto-continue after post-wait; the wait shows in Active Cues. `cue-engine.js:279-291`, `test/engine.test.js:115`
- **WORKS (tested)** Auto-follow when nothing under the cue is waiting, sounding or fading (Audio, Group, Wait, Fade). `cue-engine.js:294-305, 1675-1680`, `test/engine.test.js:54, 183`
- **PARTIAL** A cue fired by V/Audition, an OSC trigger, `/cue/n/start` or a Start cue does not run its continue mode: only `go()` and a chained continue call `continueAfter`. `cue-engine.js:256, 284`, `host.js:92, 382`
- **PARTIAL** Stop by the operator (S, Active Cues) cancels a pending auto-follow; a Stop *cue* does not clear it, so the next cue fires when the stopped one goes quiet. Read from the code, not run. `cue-engine.js:327-331` vs `1066-1068`
- **PARTIAL** Group modes: timeline only. No start-first, start-first-and-enter, random, playlist; the playhead cannot enter a group. `cue-engine.js:200`
- **WORKS** Nested groups (children may be groups). `core/show/ops.js:90-102`
- **ENGINE-ONLY** `after` / `afterWait` / `afterVoice`: a child that fires when a sibling sound ends. Stripped by `normalise`. `cue-engine.js:1411-1428`
- **ENGINE-ONLY** `preWait: 'audio'` (wait for the longest sibling sound). The field is `seconds`, so the value cannot be stored. `cue-engine.js:983-988`
- **ENGINE-ONLY** Stanza chains (`stanza`, `afterGap`, `ring`, `words`; gapHold / gapShift / gapNow / chainJump; `poem()`): about 170 lines, unreachable; the host even deletes `poem` from what it sends. `cue-engine.js:1430-1590`, `host.js:285`
- **ENGINE-ONLY** `lq` light-cue groups. `cue-engine.js:997, 1724`

## 5. GO, playhead, transport

- **WORKS (tested)** GO fires the standing-by cue and advances. `cue-engine.js:244-259`
- **WORKS** Double-GO protection, per show (default 0.3 s), applied to every source in the host. Only GO is guarded, not V/fire. `host.js:355-362`, smoke only.
- **CLAIMED-NOT-BUILT** A visible locked/red GO state: `.go-btn.locked` is in the CSS and nothing sets it. `app/renderer/styles.css:186`
- **WORKS** One playhead; ↑/↓, click a top-level row, selection follows the playhead (always on). `app.js:113-127, 161-166`
- **PARTIAL** Multiple cue lists: one active at a time, picked from a title-bar select that only appears when there are two or more. Switching resets the playhead to the top (no per-list playhead). No UI to add, rename or remove a list (ops exist). `app.js:212`, `cue-engine.js:223-228`, `ops.js:171-190`
- **PARTIAL** Jump to a cue by number: engine + host op `jump`, reachable only over OSC (`/playhead/n`, `/go/n`). No UI. `cue-engine.js:437-446`, `host.js:374`
- **WORKS (tested)** Panic: fade over the show's panic fade (default 1 s); again within 1.5 s (fixed) stops dead and hard-stops the audio window. Esc, button, OSC, web remote. `cue-engine.js:308-324`, `host.js:364`
- **WORKS** Fade all (5 s fixed in the UI). `cue-engine.js:416-425`, `app.js:53`
- **WORKS** Pause all / Resume all (`[` `]`, button), pause/resume one cue (P), stop one cue (S, always a hard stop). `cue-engine.js:334-392`, `app.js:175-179`
- **WORKS** Reset: stops everything, clears loads and the show clock, playhead to top, mixer back to saved; asks twice if sound is playing. Live arm toggles are kept. `cue-engine.js:449-466`, `app.js:37`
- **ENGINE-ONLY** Load to Time: `engine.loadToTime` and host op `load` exist and are tested for a top-level Audio cue; no key, menu or button calls it. On a cue with a pre-wait the offset is lost (`act(cue)` is called without it). No negative values. `cue-engine.js:469-473, 847-854`, `host.js:375`, `test/engine.test.js:183`
- **WORKS** Skip (seek) a playing sound: click the Active Cues bar or mark the waveform and press Skip. No drag-scrub. `app/renderer/Sidebar.js:93, 195`, `cue-engine.js:752-790`
- **WORKS (tested)** Fade to: crossfade inside the track to the marked place over 1.5 s (fixed in the UI); a not-yet-decoded track jumps with a 30 ms dip. `cue-engine.js:795-814`, `Sidebar.js:94`, `test/engine.test.js:153`
- **WORKS** Preview / Audition: V or the inspector button fires the selected cue without moving the playhead, on the main output. `app.js:180`, `Inspector.js:186`
- **WORKS** Live arm/disarm (D); survives a reload of the list. `cue-engine.js:428-434`
- **ENGINE-ONLY** Hold (H) as a transport toggle (`setHold`, `holdTarget`): no host command. Holding is only by clicking a loop block. `cue-engine.js:478-503`
- **ENGINE-ONLY** `debugLoop` (loop any dragged stretch). `cue-engine.js:535-549`
- **WORKS** Hold a section from the loop lane: arm, disarm, let go; several armed in order; refused if not a known region. `cue-engine.js:596-638`, `host.js:383`, `Sidebar.js:66-71`. Untested.
- **WORKS** Show clock since the first GO after Reset. `app.js:38, 50`
- **WORKS** Masthead: GO, standing-by number/name/notes, "then …", DISARMED and LOADED badges, "CALL LQ n GO" for a Light cue. `app.js:26-57`
- **WORKS** Active Cues: sounds with time left, level, pause/stop each; waits and fades with countdowns. `Sidebar.js:183-205`
- **WORKS (tested)** Light cues as stops, or skipped by the playhead (per computer). `cue-engine.js:200-219`, `host.js:384`, `Settings.js:30`
- Absent: second-trigger behaviours (a re-fired Audio cue always restarts, `cue-engine.js:1022`), auto-load, skip-if-disarmed.

## 6. Audio

- **PARTIAL** File formats: importer accepts wav, aif/aiff, mp3, m4a, aac, flac, ogg, opus; playback is whatever Chromium decodes. No CAF. Not verified per format. `host.js:30`, `app/main/main.js:27`
- **PARTIAL** Output: one device, stereo, chosen per computer (`setSinkId`), remembered in `config.json`. No channel routing, no multichannel files, no second device. `audio.html:465-475`, `host.js:236-239`
- **WORKS** Buses: named, add/rename/remove in Settings; each has a fader (knob, −60…+12 dB) and a peak meter; all sum to one master. `Settings.js:34-52`, `audio.html:68-83`, `Sidebar.js:149-181`
- **WORKS** Master fader with L/R RMS meter. `Sidebar.js:217-219`, `audio.html:623-646`
- **WORKS** Safety limiter on the master (−0.3 dBFS, 20:1), on/off per show, LIMIT indicator. `audio.html:39-44, 564`, `Settings.js:42`
- **WORKS** Mixer moves are heard live and are pending edits until Save, each with a "put back" mark; "Defaults" zeroes everything. Allowed in Show mode. `host.js:394-403`, `Sidebar.js:212-216`
- Absent on buses: mute, solo, pan, EQ, sends, per-bus output.
- **WORKS** Per-cue level: one dB value. No per-output matrix, no pan, no gangs.
- **PARTIAL** Fade shape: one, linear in dB (cue fades); bus and band ramps are exponential approaches. No curve editor. `audio.html:394-408, 536-552`
- **WORKS** Whole-file loop; Start–End loop to the sample (decoded buffer); held loop regions. `audio.html:220-223, 504-510`
- **WORKS** Streaming playback with a move to a decoded buffer when ready (30 ms crossfade); only looping/marked tracks are decoded ahead. `audio.html:369-390`, `host.js:107-124`
- **WORKS** Waveform: peaks + RMS, playhead cursor, markers, loop lane, dimmed outside Start/End; WAV read in main (PCM 16/24/32, float 32), other formats decoded in the audio window. `core/engine/waveform.js:15-83`, `Sidebar.js:7-80`, `audio.html:519-533`
- **WORKS** "Now playing" strip under the list with waveform, pin, Skip / Fade to, Pause, Stop. `Sidebar.js:99-122`
- **WORKS** File probing: durations measured, unreadable files reported missing. `audio.html:445-456`, `host.js:153-160`
- **UI-ONLY / dead code** Recording the show output (worklet tap): in `audio.html:573-605`; the host never sends `record` and drops the `rec` events.
- **UI-ONLY / dead code** Mono monitor feed on a third output: `audio.html:90-129`; never sent.
- **CLAIMED-NOT-BUILT** Ducking from the Mix cue: the engine header says Mix "turns ducking on or off" (`cue-engine.js:49-51`) and the audio window has a `duck` op (`audio.html:556-561`), but the host's mix hook only sets bus levels (`host.js:71`). Ducks are built by hand from relative Fade cues.
- **PARTIAL** Output device loss: the context state is logged; no fallback or notice beyond a failed `sink`. `host.js:242`
- Absent: rate/pitch, effects/EQ/plugins on cues, slices with play counts, live/mic inputs, trim as a separate value, audition bus.

## 7. Video and lighting

- Absent: no video, camera, text or image output of any kind (the only "video" string is a Resolume OSC template, `core/net/devices.js:119`).
- Absent: no DMX, Art-Net, sACN, fixtures or patch.
- **WORKS (tested)** Lighting desk module: a Light cue fires a cue by number over OSC/UDP. ETC Eos (fire, 2 s ping, hears active/pending cue, "desk answering"), grandMA3 and generic (fire only). Its own host/port fields, separate from network patches, and its own socket (not in the OSC monitor). `app/main/modules/lighting-desk.js:20-127`, `test/modules.test.js:123`

## 8. Network out

- **WORKS (tested)** OSC 1.0 encode/decode, no dependency: int32, float32, string out from text; also d, h, b, T/F/N/I on decode; a bundle yields its first message only. `core/net/osc.js:17-85`
- **WORKS (tested)** Patches: name, host, port, UDP or TCP, TCP framing SLIP or length-prefix, device kind, optional reply port. `core/net/hub.js:122-159`, `Settings.js:92-129`
- **WORKS (tested)** TCP patches keep a connection and reconnect every 2 s. `hub.js:68-91`
- **WORKS (tested)** Per-patch status (idle / sent / answering / connecting / connected / error), Test button, last out / last in. `hub.js:178-191`
- **WORKS (tested)** OSC monitor (last 400, both ways, filter, pause, clear) and send-by-hand line. `hub.js:41-45`, `Settings.js:56-90`
- **WORKS (tested)** Device templates that write the message for you: Generic, ETC Eos, grandMA3, X32/M32, X Air, QLab, Endless Cues, REAPER, Resolume; "Fade it" inserts `#v#`. `devices.js:20-136`, `Inspector.js:22-47`. Unverified against hardware.
- **WORKS** Last four sends in the sidebar, failures in red with the reason. `Sidebar.js:207-208`
- **WORKS (tested)** Show feedback module: `<prefix>/go`, `/cue/<n>/start|stop`, `/playhead`, `/running` to one patch. `app/main/modules/show-feedback.js:26-46`
- Absent: plain-text or hex UDP/TCP payloads, 2D fades, non-linear value fades, OSC bundles out, HTTP, serial.

## 9. Network in, triggers, remote

- **WORKS (tested)** One UDP input port (default 53000), opened only when something needs it (OSC control on, any trigger, Learn, or "Always listen"). `hub.js:93-104`, `host.js:95-101`
- **WORKS (tested)** OSC control module. Accepted addresses, all with an optional ignored `/workspace/<id>` prefix (`app/main/modules/osc-control.js:43-63`):
  - `/go`; `/go/<number>` (jump then GO; a missing number does not GO)
  - `/panic`, `/panicInTime` (panic); `/stop`, `/hardStop` (hard stop all)
  - `/reset`; `/pause`, `/resume` (everything)
  - `/playhead/next`, `/playhead/previous`; `/playhead/<number>`, `/select/<number>`
  - `/cue/<number>/start`, `/cue/<number>/go` (fire, playhead stays)
  - `/cue/<number>/stop`, `/cue/<number>/hardStop`, `/pause`, `/resume`, `/togglePause`
  - `/connect <passcode>`, `/thump`
- **WORKS (tested)** Replies: `/reply<address>` with a JSON string `{status, address, data?}` to the sender. `osc-control.js:68`
- **PARTIAL (tested)** Passcode: one, all-or-nothing; trust lasts 61 s per sender and is renewed by `/thump`. `osc-control.js:69-82`
- **WORKS** OSC trigger per cue with Learn (15 s window). `host.js:410-414`, `Inspector.js:49-59`
- **WORKS (tested)** Web remote: HTTP page + server-sent events on port 8137, key in the URL (derived from the show id unless set), view-only switch. Shows top-level cues, standby, notes, running sounds; GO, ▲ ▼, tap a row to move the playhead, PANIC. Plain HTTP. `app/main/modules/web-remote.js:22-101`, `app/main/modules/remote.html:51-87`
- Absent: OSC property get/set, `/cue/selected`, `/updates`/`/listen`, `/version`, `/workspaces`, OSC over TCP in.
- Absent: hotkey triggers, MIDI triggers, timecode triggers, wall-clock triggers (the only per-cue trigger is OSC).

## 10. MIDI, MSC, timecode

- **CLAIMED-NOT-BUILT (as "planned")** The only occurrences are cards in Settings ▸ Modules ("On the way": MIDI, Timecode, Video, Microphones and ducking, Main/backup, Motion capture). `Settings.js:143-150`. No MIDI or timecode code exists.

## 11. Editing

- **WORKS** Edit / Show mode: Show hides the toolbar and inspector and the host refuses edit, undo, redo, import, accept, restore, revert, unset. Mixer rides, Save, arm toggles and module/audio device choices still work. `host.js:334, 352`, `styles.css:443`
- **WORKS** Toolbar: one button per type in table order; ⌘1…⌘0 add the first ten (Group … Arm); the Audio button opens the file picker. `app.js:172, 230`
- **WORKS** Drop sound files on the list: copied into `media/`, one Audio cue each. `CueList.js:75-81`, `host.js:451-478`
- **WORKS** Drag to reorder, multi-selection included, and into a group. `CueList.js:62-88`
- **WORKS** Group selection (⌘G). No ungroup. `app.js:136-141`
- **WORKS** Duplicate (⌘D): targets inside the copy follow the copy; number cleared. `ops.js:145-158`
- **WORKS** Delete (⌫). `app.js:135`
- **WORKS** Inline rename (Q, Enter, double-click) and number (N, double-click). `app.js:182`, `CueList.js:128-133`
- **WORKS** Click the continue column to cycle the mode. `CueList.js:144-145`
- **WORKS** Multi-select: click, shift-range, ⌘-click, ⌘A, shift-arrows; collapse/expand groups. `CueList.js:40-47`, `app.js:165, 169`
- **WORKS** Batch edit: the inspector edits every selected cue; type tab when all are one type; "(mixed)" shown. `Inspector.js:68-73, 171`
- **WORKS** Inspector tabs: Basics, the type's own tab, Time & Loops (one Audio cue); advanced fields under "More". `Inspector.js:168-197`
- **WORKS (tested)** Smart entry: `90`, `1:30`, `1:02:03`; a sign-less typed level is a cut, `+6` a boost, `-inf`/`off` silence. `cue-types.js:197-213`
- **WORKS** Target chosen from a list filtered by allowed type. No drag-to-target. `Inspector.js:90-97`
- **ENGINE-ONLY (tested)** Renumber (start, step, prefix, suffix): the op exists; no dialog, menu or key. The assistant can use it. `ops.js:159-170`
- **WORKS (tested)** Undo / redo: 200 whole-document steps, labelled; covers settings and mixer commits. `document.js:32, 144-154`
- Absent: copy / cut / paste of cues (the Edit menu roles act on text fields only, `main.js:192`), paste properties, find, context menus, cue templates, key remapping, row sizes.

## 12. Show file, saving, versions

- **WORKS (tested)** Show is a folder: `show.json` (two-space JSON, fixed key order), `media/`, `versions/`. `show.js:1-10, 215-232`
- **WORKS (tested)** Explicit save: edits are heard at once and pending until ⌘S, which writes the file and records a version. No autosave. `document.js:105-116`
- **WORKS** Every pending change is listed and marked on its control with the saved value and a put-back button; "n unsaved" chip. `host.js:292-297`, `Sidebar.js:142-145`, `Inspector.js:135-137`
- **WORKS (tested)** Revert to saved (undoable). `document.js:119-128`
- **WORKS (tested)** Crash recovery of edits: journal `show.unsaved.json`, offered back still unsaved. `document.js:83-91, 60-64`
- **WORKS (tested)** Versions: content-addressed whole snapshots with note (written for you from the diff) and author; list, compare with now, restore (undoable). Comparing two saved versions exists in the host only. `core/show/versions.js:42-61`, `app/renderer/Drawers.js:74-105`
- **WORKS (tested)** Diff in operator terms (added / removed / moved / changed field by field, lists, settings). `core/show/diff.js:40-89`
- **WORKS** Save As: copies `media/`, then pulls absolute-path sounds into the folder. `host.js:493-504`
- **WORKS** New, Open, Open Recent (8), demo show, reopen the last show at launch, Show in Finder. `main.js:137-160, 176-190, 253`
- **WORKS (tested)** Broken cues: missing required field, target gone or wrong type, patch gone, message not starting with `/`, no patch chosen among several, missing file → ✕ with reason; duplicate number, unknown bus, duration without `#v#`, bad trigger → ▲. Shown on the row, in the inspector and the footer; a broken cue never stops the list loading. `show.js:155-183`, `CueList.js:122`, `app.js:247-248`
- **PARTIAL** Missing media: flagged, fired as a logged no-op. No relink/search tool. `cue-engine.js:1021`, `host.js:158`
- **WORKS (tested)** A file saved by a newer format version is refused with a reason. `show.js:118`
- **PARTIAL** Unknown fields are dropped on load, so a hand-added key, or one from a newer app at the same version, is lost on the next save. `show.js:137-143`
- **CLAIMED-NOT-BUILT** `.ecshow` file association: declared in `package.json` (`fileAssociations`), but a show is a folder and `main.js` has no `open-file` handler; only a command-line argument opens one. `main.js:250`
- **WORKS** Quit guards: asks about unsaved changes; asks twice while sound is playing. `main.js:263-285`
- Absent: no run journal (playhead / what was playing) to resume after a crash; no QLab import; no export.

## 13. Settings and appearance

- **WORKS** Panes: Show (title, notes, folder), GO and safety (double-GO, panic fade, light cues are stops), Audio (device, limiter, buses), Network (patches, input port, monitor), Modules, Assistant, Appearance, Keys (a static list), About (log viewer, last 300 lines). `app/renderer/Settings.js:254`
- **WORKS** Three themes, per computer: Lab, Ocean, Graphite. `main.js:29, 237`, `styles.css:82-89`
- **WORKS** Per-computer config kept apart from the show (`config.json`: last show, recents, device, theme, skipLights, assistant); assistant keys sealed with the OS keychain when available. `main.js:42-85`
- **WORKS** Module chips in the title bar with status; audio-output-problem chip. `app.js:214-215`

## 14. Assistant and MCP

- **WORKS (tested)** An agent loop (up to 40 steps) with seven tools: read_show, find_cues, list_media, edit_show, check_show, simulate, propose_changes. It edits a private draft; nothing lands until a person accepts the proposal. `core/assistant/tools.js:31-67, 188-258`, `core/assistant/assistant.js:283-371`
- **WORKS (tested)** Proposal review: diff card, Accept / Reject, refused if the show changed since; accepting is one undoable, unsaved edit; a save after it is authored "assistant". `document.js:190-238`, `Drawers.js:24-36`
- **WORKS (tested)** "Apply at once" option; never in Show mode. `assistant.js:328`, `host.js:440`
- **WORKS (tested with fakes)** Providers: Anthropic SDK, OpenRouter, OpenAI, custom OpenAI-compatible, Ollama, Claude Code and Codex as subprocesses, offline demo. No test talks to a real model. `assistant.js:45-281`
- **CLAIMED-NOT-BUILT** "Endless Cues account" provider: selectable, points at `https://api.endlesscues.com`; `cloud/worker.js` says "A SKETCH: never deployed, never run". `assistant.js:37`, `Settings.js:192`
- **WORKS (tested)** MCP server on stdio (`ec-mcp`): against the open app through a localhost bridge with a token, or against a show folder with no app (`--show`, `--save`). `core/assistant/mcp.js:38-172`, `bin/ec-mcp.js`
- **WORKS (tested)** Dry run: the real engine on a fake clock, reporting what each GO does second by second. `core/engine/dry-run.js:21-79`
- The assistant cannot GO, play or save (no such tool).

## 15. CLI, packaging, platforms, tests

- **WORKS** `ec validate | outline | diff | simulate | versions | demo`. `bin/ec.js:28-58`. Not unit-tested directly.
- **PARTIAL** Packaging: electron-builder config for macOS (dmg + zip, arm64 + x64, hardened runtime, `notarize: true`), Windows (NSIS x64 + arm64), Linux (AppImage, deb); CI builds and smoke-runs on all three. No signing credentials or built artefacts in the repo; no auto-update. `package.json` build block, `.github/workflows/ci.yml`
- **WORKS** Process split: engine and document in main, sound in a hidden window (remade if it dies), UI a reloadable view (reloaded if it dies); display sleep blocked. `host.js:202-217`, `main.js:129, 257`
- **WORKS** Tests: 47 unit tests (engine 14, show 11, assistant 12, modules 6, MCP 4) plus an Electron smoke run with screenshots. `test/`, `app/main/smoke.js`
- **PARTIAL** Test coverage holes: Jump/blend/dj, quantise, holds, seek, cutAt, fadeOut/fadeAt tails, voice-band fades, Mix, OSC triggers, and all of `audio.html` have no unit test.

## 16. Doc / comment vs code

- `docs/specs/09-qlab-parity.md` is mostly accurate and strict; its "Since this table was written" paragraph correctly supersedes its own Network row (TCP, fades, device descriptions now exist).
- **CLAIMED-NOT-BUILT** `09-qlab-parity.md` ("Edit operations and proposals"): "accepting saves a version on each side". Accept is an unsaved edit; no version is recorded. `document.js:208-231`
- **CLAIMED-NOT-BUILT** `core/show/versions.js:9`: "Every edit is already saved to show.json the moment it is made". The opposite is true since explicit save.
- **CLAIMED-NOT-BUILT** `cue-engine.js:49-51` and the Mix summary: Mix "turns ducking on or off". See Audio.
- **CLAIMED-NOT-BUILT** `cue-types.js:42-46` help text for Quantise `best` and the ambient-stretch fade: need `landings`, which cannot be stored.
- **CLAIMED-NOT-BUILT** `cue-types.js:64` "the operator can hold the track in one" is true, but nothing lets the operator draw one (see Loop regions).
- Docs behind the code (built, still listed as future in `12-roadmap.md`): the window reloading itself when its page dies (`main.js:129`); a device library for Network cues (`devices.js`).
- `09-qlab-parity.md` gap item 5 says auto-follow does not wait for a Fade; the code and `test/engine.test.js:183` do.
- `09-qlab-parity.md` calls the receive port a "module setting"; it is `settings.network.inputPort`.
- `web-remote.js:86` passes `guard: true` on GO; the host ignores it (double-GO protection applies to everyone anyway).

## Absent

Looked for and not found. Greps were run over `app/`, `core/`, `bin/` (case-insensitive where it matters).

- **MIDI of any kind** (notes, CC, PC, MSC, MIDI file, MIDI triggers, mapping): `midi|MIDI` matches only the "planned" card in `Settings.js`.
- **Timecode** (LTC/MTC in or out, chase, triggers): `timecode|LTC|MTC` matches only the same card.
- **Hotkey, wall-clock and timecode triggers on cues**: `hotkey|wall.clock|timeOfDay`, `globalShortcut`: nothing.
- **Video / camera / text / image cues, stages, projection mapping, NDI/Syphon**: `video`: only a Resolume OSC template.
- **DMX / Art-Net / sACN, fixtures, light dashboard**: no code; lighting is "call a desk cue over OSC".
- **Mic / live input cues**: `getUserMedia|audioinput`: nothing (the mac build declares a microphone usage string only so output devices have labels).
- **Multichannel output, per-cue routing matrix, output patches to device channels, pan**: `StereoPanner|crosspoint|matrix`: nothing; `channelCount` appears only in the unwired monitor/record code.
- **Rate / pitch**: `playbackRate|detune`: nothing.
- **Audio effects, EQ, plugins** on cues or buses: only the fixed limiter and the voice-band filter.
- **Bus mute / solo**: no control or op.
- **Fade curve shapes**: none.
- **Slices / play counts**: none; markers are labels.
- **Ducking as a feature** (side-chain or "duck others while running"): `'duck'` is never sent by the host.
- **Show recording and monitor feed**: `op: 'record'`, `op: 'monitor'` never sent.
- **Cue carts**: `cart`: nothing.
- **Group modes** other than timeline; **second triggers**; **auto-load**; **skip if disarmed**; **Reset / Target / Script cues**.
- **Per-list playheads; lists in their own windows; list management UI**: `list.add|rename|remove` appear only in ops, diff and the assistant's reference.
- **Load to Time UI** and **Jump-to-cue UI**: `op: 'load'`, `op: 'jump'` are sent by no renderer file.
- **Hold key / transport Hold**: `setHold` has no caller outside the engine.
- **Copy / cut / paste of cues, paste properties**: `clipboard|'copy'|'paste'`: only Electron's text-field menu roles.
- **Find / search in the list**: no UI (the assistant's `find_cues` is the only search).
- **Renumber dialog; context menus; drag-to-target; cue templates; key remapping; display sizes; ungroup**.
- **Audition to a separate output; override controls**.
- **Autosave** (deliberately not); **relink missing media**; **QLab workspace import**; **export**.
- **Run-state crash recovery** (resume where the show was).
- **Main / backup redundancy; collaboration**.
- **Scripting, variables, conditionals**.
- **OSC property get/set and event subscription; OSC in over TCP; plain-text / hex network messages; 2D fades**.
- **Auto-update**: `autoUpdater|electron-updater`: nothing.
- **Double-click a show to open it**: no `open-file` / `second-instance` handling.
- **Licensing / demo gating**: none (nothing is locked).
