# QLab completeness tracker

What is done and what is next between Endless Cues and QLab 5, area by area. The feature-by-feature comparison is [`specs/09-qlab-parity.md`](specs/09-qlab-parity.md); this file is the working list.

`npm run tracker` prints the counts per area.

**Marks.** `[x]` done, with a test or a smoke check · `[~]` partly done or done but not yet run in the app (the note says which) · `[ ]` next, not started. An item is only `[x]` when something checks it.

**Rule.** When a change lands, its line here changes in the same commit.

---

## The cue list and editing

- [x] Load to Time: Tools ▸ Load to Time (⌘T), a field and a slider in the toolbar's place; a negative time counts back from the end; it counts through a pre-wait, for a top-level cue and for a group's children; it opens on the cue's last time and says "this GO only". Tested; smoke-checked.
- [x] Jump to cue by number (⌘J), in any list, in Show mode too; it takes a section's name. Smoke-checked.
- [x] Renumber selected cues (⌘R): start, step, prefix, suffix; numbers other cues have are passed over. A Number is never typed onto several selected cues at once. Tested; run in the app.
- [x] New top-level cues take the next number, with a setting for it and its step (Settings ▸ Show); Delete numbers (Renumber strip, Tools menu). Smoke-checked.
- [x] Cue lists: add, rename, remove, show (Settings ▸ Show); a cue added while a second list shows lands in that list. Run in the app.
- [x] Single keys: E pre-wait, D duration, W post-wait (typed in the list), C continue, F flag, O notes, T target, A arm / disarm, H hold. Smoke-checked for E, C and O; D, W, F and T run in the app.
- [x] Pre-wait, duration and post-wait editable in the list by double-click. Run in the app.
- [x] GO is red while double-GO protection would ignore it, and flashes on an ignored GO. Double-GO protection covers every way of GO. Smoke-checked.
- [x] Waveform: drag handles for Start and End; ⇧I ⇧O at the playing position; zoom to ×64 (buttons, ⌘-scroll, pinch). The zoomed view does not follow the playhead.
- [x] Flagged cues listed with the problems (the footer's counts, ⇧⌘F); a hollow flag on a collapsed group that holds one. Smoke-checked.
- [x] Notes editable in the masthead, in Edit mode. Smoke-checked.
- [x] Ungroup (⇧⌘G); move the selected cue with ⌥⌘↑↓; fold / unfold every group (`<` `>`, View ▸ Fold All Groups). Run in the app; smoke-checked.
- [~] S: fade and stop the selected cue; again, stop dead. Written; not run.
- [x] Sections: a heading row that never plays (GO, continues and auto-follow pass over it; Jump and Load to one land on its first cue); fold by click, ⌥-click for all, ← →, View ▸ Fold All Sections; a folded heading shows the cue standing by; Show mode opens the section the playhead is in; folds kept per show on this computer; a strip of section names above the list. `test/sections.test.ts`, `app/main/smoke-sections.ts`.
- [~] Cut, copy, paste of cues within and between shows: the clipboard is the host's; in another show sounds are copied in, lost targets dropped, numbers in use not pasted. Cut and paste moves a cue, copy and paste makes it again; drag works (checked with synthetic drag events). Unit-tested and run by hand between two shows; only the same-show paste is in the smoke run.
- [~] Find (⌘F): names, numbers, notes, files, messages, triggers; Enter next, Shift+Enter previous; select all found; each match is unfolded, brought to the middle and flashed. Smoke-checked for a name. No replace.
- [~] Right-click menu on a cue (stand by here, audition, arm, rename, number, flag, cut/copy/paste, duplicate, group, ungroup, delete, colour, run from here). Written; a test run has no screen to show it on, so it has not been seen.
- [~] Drag a cue onto a cue to set its target (smoke-checked); drop one sound file on an Audio cue to replace its file (the host command is smoke-checked; the drop from the desktop has not been done by hand).
- [x] A new targeting cue (Fade, Stop…) takes the selected cue as its target; Go to a cue's target (⌘E); the selected cue's target and the cues aimed at it are marked. Smoke-checked.
- [x] Paste Cue Properties (⌥⌘V): a chooser of which fields. Tested; smoke-checked.
- [x] Cue templates per type, per show ("Start like this one" in the inspector; listed in Settings ▸ Show). Tested; smoke-checked.
- [x] "Lock the playhead to the selection" as a show setting; off, a click on a cue's left edge moves the playhead. Smoke-checked.
- [~] Keys remappable: every single key (GO, Panic, the playhead, the letters) can be changed, given a second key, or reset, in Settings ▸ Keys; kept on this computer, not in the show. Smoke-checked. The ⌘ shortcuts are the menus' and are fixed.
- [x] Six colours offered first and any other from a colour wheel; a second colour once a cue has played, until Reset. Tested; smoke-checked.
- [~] Row sizes: compact, normal, large (Settings ▸ General; smoke-checked). A cue type dragged from the toolbar to a place in the list: run in the app, no smoke check.
- [x] Deleting a cue selects the one after it; undo survives a save and Save As. Run in the app.
- [x] Check the show: one list of what would go wrong, found without playing anything; a click goes to the cue. Tested; smoke-checked.
- [~] Run from here: a rehearsal at a cue, with what would be going on there had the show run. Unit-tested on small made shows, smoke-checked on one; not tried on a long show or real equipment.
- [x] The show log: every GO and what it started, in the show's `logs/` folder; View ▸ Show Log. Rotation and keeping are unit-tested.

## Sequencing

- [x] A cue started by a trigger, a Start cue or `/cue/n/start` runs its sequence (auto-continue, auto-follow); the playhead stays. A Stop cue ends what was to follow the cue it stops. Tested.
- [x] Group modes: timeline, Start First and Enter, Start First, Start Random (every child plays once before any plays again), with the children's continue modes running inside them. Tested; run in the app.
- [x] Playlist groups (shuffle, repeat, crossfade; "next" in Active cues; a stop ends it). Tested; run in the app.
- [x] Each list keeps its own playhead and runs on when another is shown (the selector marks it ▶); a Start cue aimed at a list is its GO. Tested; smoke-checked.
- [~] Second trigger on any cue: starts it again / nothing / fades it out / stops it / devamps (tested). On release: a hotkey's key-up and a MIDI note's end are written, not run in the window or on hardware. No separate "hard stop". Not read from a QLab workspace.
- [x] Fade & stop others on any cue, kept to all / the cue's list / its peers. Tested.
- [~] Duck or boost others while a cue runs; they come back when it ends; shown in Active cues. Tested; smoke-checked on the audio window's gains. Not heard.
- [~] Skip if disarmed; auto-load (a standing-by cue's sounds decoded ahead, so its GO plays from memory). Tested in the engine; not run in the app.
- [x] Reset cue (stopped, unloaded, armed as written, re-aimed, a Fade undone) and Target cue (re-aims another cue until Reset). Tested.
- [x] Load cue on any cue, with a negative time (from the end). Tested.
- [x] Fade a group or a whole cue list: every sound in it moves, and with "stop target" what was waiting in it is called off. Tested.
- [~] Next / previous sequence (`=` `-`, remappable). Tested; smoke-checked. Not: open and close cues.
- [~] Devamp: acts on a held region (or disarms the one armed); can start the next cue when the loop ends. Tested on a fake clock; a region's end is met by a timer, not to the sample, and has not been measured against real audio. Not yet: a Devamp on a Start–End loop.
- [x] Script cue: a list of show commands as text (the OSC control addresses, and `wait`), run in order by the engine; not code, by design. Bad lines are errors on the cue. Tested; smoke-checked.
- [ ] Timeline view of a group (drag to set pre-waits).
- [ ] Record Cue Sequence.
- [ ] Overlapping plays of one cue (an effect retriggered over itself): a cue is one voice everywhere.

## Triggers and show commands

- [x] Hotkey trigger on a cue (a letter, digit or F-key, with shift+ or alt+; the app's own keys are refused, with a reason). Run in the app.
- [~] Wall-clock trigger, by day of week (`19:25 fri sat`). Parsing and firing are tested with a handed-in time and fired in the smoke run; nobody has watched the real clock reach a time.
- [x] A Triggers tab in the inspector (hotkey, OSC, MIDI, clock, timecode; it says what else each would set off), and Settings ▸ Triggers: every trigger in the show in one table, shared ones marked. Run in the app.
- [x] Learn keeps a trigger's arguments (`/sensor/door 1`, so its 0 does not fire the cue).
- [~] Any incoming OSC message assigned to a show command (GO, Panic, Pause all, Resume all, playhead down and up), with Capture; obeyed with OSC control off and without a passcode. Tested. No real controller has sent one.
- [x] The monitor: a drawer beside the cue list (Tools menu, ⇧⌘N), OSC and MIDI, each message by its sender, "did nothing" beside one nothing acted on; `f:1 i:1 s:1` force an argument's type.

## Sound

- [~] Fade curve shapes: linear, S-curve and custom points, separate up and down on Fade cues, and on an Audio cue's fade in and fade out. Applied in dB only; not on a Mic cue's fade in; a trim during a shaped fade finishes it linearly.
- [~] Play count; a loop region with a count goes round that many times, the click with it (tested; run in the app); a count can be typed while the sound plays, or ∞ until let go. Not yet: markers read from the file.
- [x] Loop regions: typed in (from, to) on Time & Loops, made from markers, or drawn by dragging across the waveform; held and let go with L, a menu item and a chip in Active cues; holding one holds a sound of the same length in the same group with it. Smoke-checked.
- [~] Rate 0.25–4 on Audio cues, with or without keeping pitch; a Fade cue fades the rate. Keeping pitch needs a streamed sound, so such a sound has no exact loop regions (the cue warns). End at, fade-out tails, counted loops, playlist crossfades and a Devamp's "start next" are counted at the sound's rate (tested). Not applied to a Video cue. Positions checked, not listened to; Jump cues on a track at a rate other than 1 untried.
- [ ] Bus mute and solo.
- [x] Pan per cue (Audio and Mic) and as a line over a sound. Not per bus.
- [~] Lines over a sound: the Volume line, Pan, and any effect setting that can glide, followed 30 times a second (not sample-exact). Checked by gains and meters in the smoke run; not heard.
- [~] An absolute fade lets go of a held voice-band dip; "Set level from target" and "Revert fade" on a Fade cue. Not done: live fade preview off.
- [x] Min / max level limits as a show setting (Settings ▸ Audio): cues, fades and trims are held and a cue above the maximum is flagged; mixer faders are not.
- [~] Kinds of sound: a bus's kind as a label; ducking by kind (which kinds dip under voice and live buses, each by its own depth and times, the voice band or everything), with look-ahead for a recorded voice; a stop that fades, one at a time, never ducked; sorting new sounds by a guessed kind. All off by default, each behind a named switch; a DUCK light in the mixer. Smoke-checked with a stand-in signal and a synthesised voice; the guess has met only synthesised signals; nothing heard.
- [~] Sound design on a cue: a chain of tools per Audio, Mic and Video cue (filters, four-band eq, gate, compressor, drive, crush, pitch shift, chorus, tremolo, auto-pan, stereo, delay, reverb with an impulse-response file), presets, bypass, a tail that rings out, a Fade that sweeps a tool. Measured offline and in unit tests; never listened to. Not built: the chain on a bus, reverse, a gain-reduction meter, reordering.
- [x] Formats checked end to end by the smoke run (duration, waveform, seek, loop region): WAV, MP3, M4A, FLAC, Ogg Vorbis, Opus as they are; AIFF and PCM CAF from a WAV copy, because Chromium reads neither. One bit depth of each; compressed AIFF-C / CAF refused with a reason.
- [x] One copy of a sound in `media/` however many cues use it (compared by content). Sounds no cue uses are listed in Settings ▸ Show and moved to the Trash on request (never by themselves: a saved version may use them).
- [x] The audio process lets go of a sound's memory when it is dropped, and asks for garbage collection (measured 843 MB → 36 MB with nothing playing after five 8-minute tracks).
- [x] Show recording: ● Rec in the mixer writes what outputs 1–2 get to `recordings/` in the show folder (smoke-checked: the file and its length). Not listened to.
- [~] The native audio engine (`native/`, Settings ▸ Audio ▸ Audio engine; off until chosen): plays to the device itself; what it cannot do yet stays with Web Audio. See `specs/18-native-audio.md`.

## Tempo and the Playing strip (ours, not QLab's)

- [~] Beat grids: a cue's `tempo` (found from its sound when asked, or typed) gives the engine its beats and bars, so quantise has something to read (tested). Not yet: the Jump blends' match scores.
- [~] Tempo found from a sound (`core/audio/tempo.ts`), kept in the cue as `tempo`; typed, halved, doubled, nudged, "1 is here"; half time and the dotted reading decided on the evidence, the likelier reading offered first, and the view says which parts of a file the grid fits. Tested on made tracks and nine real ones; run through the audio window in smoke. Still: a shuffle is read as the straight tempo; one soft track gets no choice.
- [~] Tempo that changes within a track: a section per tempo (own bpm, bar line, beats in a bar), found where a tempo lasts 16 s or more and edited by hand (**+ Change here**, **Remove change**, "1 is here", beats in a bar 1–16); grid, quantise, beat-loops and the bar counter read the section the track is in. Tested on synthesised tracks only; a gradual change is not found; beat one is never guessed.
- [x] The rescue tools are the cue list's own, in the Playing strip: go round the next 1, 2, 4 or 8 bars from the beat the track is on (or 2 to 16 seconds for a sound with no tempo) until Let go or L; bar lines on the playing waveform and the bar.beat count; "+ here" and a button per marker to skip or (Shift) crossfade to it, on the track's next bar line when "on the bar" is ticked; Find the tempo in the strip. `test/rescue.test.ts`, `app/main/smoke-rescue.ts`. Checked by position and timing on a click track; not heard.
- [ ] The Time & Loops waveform on a short window; P pausing the next cue after a GO.

## Routing and outputs

- [ ] More than one output device. Two devices are two unlocked clocks and Web Audio gives no way to measure or correct the drift; the design that would work (a bus belongs to a device) and what to build first (audition on a second device) are in `specs/05-audio.md`.
- [~] Output routing: each bus goes to a pair of the device's outputs (Settings ▸ Audio), its own master and limiter per pair; a pair the device lacks is silent and flagged, never moved to 1–2. Each output can be named and trimmed down (after the limiter), with a meter each. Smoke-checked on a pretended eight-output device; not heard on a real multi-output interface. Not: a bus to a single output, output patches.
- [~] A cue's own outputs: an Audio or Mic cue can be sent to chosen outputs instead of its bus's pair, a level per channel × output, mono outputs included; its bus's fader, mute, solo and ducking still move it. Smoke-checked by meters; not heard. Not: gangs; a change is heard from the cue's next play.
- [~] Multichannel files: with outputs of its own, each channel of a file is routed (checked with a four-channel WAV, by meters); on a bus it is folded to two. Channel count is read from WAV headers only. Not heard.
- [~] Sends and returns: one reverb and one delay per show as bus sends (Settings ▸ Audio). Returns are metered in the test run; nobody has listened to them. Not: plugins, effects on a device output, pre-delay or tempo sync.
- [~] Mic cue: a live input (device, channel) onto a bus, with a level and a fade in; Fade and Stop cues work on it. Smoke-checked with a stand-in signal; not opened on a real input; latency unmeasured.
- [~] Audition to other outputs: V can play to a pair of its own on the same device, the cue alone and not in the house; off in Show mode. Smoke-checked by meters. Not: always-audition, a second device, audition for anything but sound.
- [~] The monitor feed: a mono copy of outputs 1–2 on another output, with its own level and meter. Metered only on the test run's pretended outputs.
- [~] Device loss: the show falls back to the system default with a notice and returns when the device is back (decision unit-tested, smoke-fed device lists). Not tried by unplugging an interface.
- [ ] A test tone per output, as a row action on the Rig's "Sound goes to …".

## OSC and the network

- [~] Read and write cue properties over OSC (`/cue/{n}/name`, `/preWait`, `/continueMode`, `/armed`…), with `+` `-` and toggle. Tested against the module; no real remote.
- [~] `/cue_id/`, `/cue/selected` (= the cue standing by), `/cue/playhead`, `/cue/active`; patterns in numbers. Tested; no real remote.
- [~] `/cueLists`, `/runningCues`, `/runningOrPausedCues`, `/selectedCues`, `/valuesForKeys`. Tested. A long show's `/cueLists` is refused over UDP and answered over TCP. Not: the `/shallow` and `/uniqueIDs` forms.
- [~] `/updates` push; `/version`, `/workspaces`. Tested; no real remote.
- [~] OSC in over TCP on the input port (SLIP, and length-prefixed), beside UDP; UDP answers to port 53001, `/udpReplyPort`, `/alwaysReply`. Tested on loopback and in the app; no real remote.
- [~] Passcodes with view / edit / control, a no-passcode row (never edit), the delay after wrong tries; a table in Settings ▸ Integrations ▸ Modules. Tested. Which permission each address needs is by what it does (QLab's per-method table was not to hand).
- [~] `/cue/{n}/preview`, `/panic`, `/loadAt`, `/panicInTime`, `/playhead/nextSequence`, `/playhead/active`; `/cue/{n}/load` and `/loadAt` on a cue not standing by, `/cue/{n}/reset` and `/playhead/none`. The module is tested with a fake host and the host's own ops in the smoke run; not run end to end over a socket, and no real remote has sent one.
- [~] `/showMode`, `/undo`, `/redo`, `/save`, `/new`, `/move`, `/delete`, `/renumber` (edits: Show mode refuses them). Tested; no real remote. `/renumber` numbers the cue standing by; the shape of `/move`'s reply is ours.
- [~] Show control broadcast in QLab's form: `/listen`, `/ignore`, `/qlab/event/workspace/…` (go, cue/start, cue/stop, playhead, and the six "All" events), `/eventFormat`. Tested; written from the manual, not compared with QLab. Not: MSC broadcast.
- [x] Show feedback sends no GO when it is switched on, and names an unnumbered cue by its name.
- [ ] Tried against QLab Remote, the Stream Deck plugin and Companion (needs the equipment; the script is `specs/06-control-surfaces.md` section 6.6).
- [~] Network cues: plain text and hex (UDP and TCP, with escapes); `\T \F \I \N`; resend; fade curves (four named shapes) and integer values; 2D fades along a typed path, with loop; several destinations per patch; interface choice. Tested on loopback. Not: a curve or path drawn by hand, smooth paths, live preview, OSC queries inside a message.
- [x] Network patches: a second patch leaves cues that sent to "the only patch" on that patch, and says so; the monitor and the Network strip show a patch's address and port.
- [ ] More device descriptions, each checked against the device (needs the equipment; the method is in spec 06 section 6.6 D).

## MIDI and timecode

- [~] MIDI in: a MIDI trigger on any cue, with Learn; notes, programs, controllers, pressure and pitch bend (tested with messages handed to the host; no MIDI hardware has been connected).
- [~] Show commands from MIDI notes and controllers: GO, Panic, Pause, Resume, playhead up and down (Settings ▸ Integrations ▸ Network ▸ MIDI). Reviewed against the specification; no hardware. A controller written with no value fires on every value.
- [~] MSC in: GO and TIMED_GO (with a cue number), LOAD, STOP, RESUME, ALL OFF, RESET, for the app's device ID or all-call, any command format. Tested to the byte; not run against a desk. Group device IDs are not answered.
- [~] MIDI cue: note on/off (with a length), program change, controller, key and channel pressure, pitch bend, MSC (with LOAD and TIMED_GO), raw SysEx, written as text; a controller, pressure or bend faded over a time. Tested to the byte. Not sent to hardware.
- [~] MIDI File cue: a standard MIDI file played out with its tempo changes, a rate, pause and stop (sounding notes ended). Parsing and playout tested; messages are stamped with their time and handed to Web MIDI. Not sent to hardware.
- [~] Timecode cue: MTC out (full frame and quarter frames) and LTC out as sound on a chosen output, at 24 / 25 / 29.97 drop / 30. MTC tested to the byte and by its stamped times; LTC decoded by the app's own reader through the real audio worklets. MIDI is stamped 100 ms ahead (timers wake 1–5 ms late, measured); neither has been read by timecode equipment.
- [~] Chase incoming timecode (MTC on any MIDI input; LTC on an audio input): a timecode trigger on any cue, a located time starts a cue part way in, the playhead follows. Tested on a fake clock and, for LTC, against the app's own output. Not yet: stopping cues when timecode stops, chase per list, capturing a trigger from the incoming time, a real LTC input.

## Video

- [~] Video cues on one display. Video files and stills play on a stage window (Settings ▸ Video: a display or a window, test pattern), sound through the cue's bus with every Audio transport; tested offscreen by pixels. Left: a run on a real projector (focus, menu bar, unplug/replug, lip sync by eye); playback rate, play counts and slices; a stage monitor in the operator's window.
- [~] Geometry, opacity, layers; fades of them. Size, opacity, position, scale, rotation (one axis) and layer per cue; a Fade moves opacity, position, scale and rotation linearly. Left: crop, anchor, 3D rotation, blend modes, fade curves and paths, relative geometry fades.
- [~] Text and Camera cues. Text: one font, size, colour, alignment. Camera: a webcam-class device by name, mirror, no sound. Left: rich text, a Camera cue's own sound, a real camera tried.
- [~] Stages, regions, warping, masks, edge blending. One stage with a four-corner pin (typed, not dragged), a blackout and a test pattern. Left: several stages and regions, masks, edge blending, mesh warps (what each takes: `specs/13-video.md`).
- [ ] NDI, Syphon, Blackmagic. Needs native code (an SDK or GPU texture sharing per platform); why, and the route, are in `specs/13-video.md`.

## Lighting

- [~] DMX out over the network: Art-Net (ArtDmx; answers ArtPoll, lists nodes) and sACN (multicast or unicast), any number of universes, 40 Hz from the main process with every universe re-sent each refresh; a dashboard Blackout; Panic holds the lights unless Settings ▸ Light says otherwise. Bytes tested against the specifications and on loopback; a test run sends nothing. **No fixture has been lit by it.** Not: USB (needs a native serial module; the Enttec frame is written and tested, the lighting spec §8), choosing a network interface, Art-Net unicast to subscribers, sACN sync and discovery.
- [~] Light patch (Settings ▸ Light): instruments with a universe and an address, groups of groups, eight generic fixtures (dimmer, RGB/RGBW/RGBA with or without a dimmer, a moving head in 8 or 16 bit) and your own written as text, kept in the show; clashes and bad addresses are reported. Not: a manufacturer library, GDTF or QLab definitions, CMY/HSI or pan/tilt pickers; renaming an instrument does not rename it in cues and groups.
- [~] Light cues hold levels as text (`front = 80`, `all = 0`, `cyc.red = 100`), fade to them, track, and can be a full state; pause, stop and a Fade of one; the Lights dashboard (⇧⌘D): live levels, a command line with a time, blackout, clear, revert, a new cue from changes or from everything, update the selected cue. Unit-tested and smoke-checked; never seen on a light. Not: fade curves, collate, `= cue A` pulls, park, subcontrollers, an audition tab, dashboard undo, MIDI control.
- [~] Lighting desk module: Eos and grandMA3 (`Goto Cue n Sequence l`) messages from the published OSC documentation; with no address of its own it sends to the desk's patch; standing by on a Light cue says whether it is sent; a Light cue whose send failed is flagged until it next goes. A step-by-step script for an Eos and a grandMA3 is in the lighting spec §10. **Not run at either desk.**

## Import, files and versions

- [x] Open a QLab 5 workspace (`.qlab5`) directly: File ▸ Import a QLab Workspace…, drop it on the window, or `ec import-qlab`. Read from the file itself (no QLab needed, any platform); opens as a new unsaved show with a report of what did not come across; a Mic cue comes across as one. Compared field by field with what QLab 5.6.3 itself reports for about fifty workspaces, QLab 4.0 to 5.6, built and public (`test/qlab-compare/compare.ts`, findings in [`internal/qlab-compare.md`](internal/qlab-compare.md)); the window side is smoke-checked.
- [~] QLab 4 (`.qlab4`) workspaces: checked on a real QLab 4.7 workspace of Audio, Fade and Group cues (every sound found, the levels, waits, continues and fades right; an End at that is only the file's end is dropped once the file is measured). Its Network and MIDI cues are read by QLab 5's names and have not met a real QLab 4 file. Video, Text and Camera cues come across (their file, text and style, geometry and layer, checked against QLab). Light cues come across with their commands (checked on workspaces QLab saved; the patch is not read). MIDI File and Timecode cues come across (checked against QLab 5.6.3). Script cues are AppleScript, kept as Memos with their script in the notes.
- [x] Saved versions: every save is a version, with a note; compare one with now or with another; restore one (undoable). Smoke-checked.
- [x] Timed backups of the working show (unsaved changes and all) every `settings.backup.minutes` while it changes, pruned (newest `keep`, then one a day for two weeks); listed and restored under Versions ▸ Backups as an undoable edit. Tested; smoke-checked. Not watched over a long sitting.
- [~] Show templates (File ▸ Save as a Template…, New Show from Template) and settings import / export, with no passcodes in either. Tested; smoke-checked.
- [x] Media playback log: every sound that played, when and for how many seconds, in `logs/playback.csv`; File ▸ Export the Playback Log…. Tested; smoke-checked. Mics are not logged.
- [x] Unknown fields in a cue are kept on save, and not played. Tested.
- [~] Opening from the desktop: a `.ecshow` folder or its `show.json` opens; a `.qlab5` is imported into a new show. Refused while the show is sounding. Written; not run from Finder in a packaged build.
- [ ] `.ecshow` as a package in the Finder (one icon, opened by a double click).

## Carts, windows, remotes, backup

- [~] Cue carts: a list drawn as a grid of buttons (to 15×15), each starting its cue while the list being run keeps its playhead; mouse, arrows and Enter, drag to move or swap; a QLab cart imports as one. Tested; smoke-checked. Not: hold-to-play / second trigger, cell sizes, a touch screen, positions checked against a cart QLab itself saved.
- [~] A list, a cart or the inspector in a window of its own (Window menu). Smoke-checked for a cart and the inspector. Not: a plain list window checked, several inspectors, a status window.
- [~] Override controls: OSC out, MIDI out, timecode out and DMX out each held back for rehearsal (Tools ▸ Hold Back …), said in the monitor and by one red chip in the title bar; kept through a restart. Tested (DMX on loopback); smoke-checked. No equipment connected to see nothing arrive; no input overrides.
- [~] Main and backup: a module on the main says its transport again to the backup in OSC control's addresses, with a heartbeat; the backup says when the main goes quiet. Tested with two engines, including a lost message. Never run on two computers; nothing fails over by itself; edits, the mixer and trigger-fired cues are not mirrored (06 lists what take-over needs).
- [~] Web remote: GO and the transport; a fader per bus and the master, and Load to Time, behind a Levels button; its key is in the show file. Tested, and drawn in an offscreen browser; not on a phone. Not: editing cues. HTTPS: not done; what it would take is in spec 06 section 7.
- [ ] Collaboration (several editors).

## The assistant and the rig (spec 15)

Built from [`specs/15-assistant-and-rig.md`](specs/15-assistant-and-rig.md); [`try-the-assistant.md`](try-the-assistant.md) is its walk, for a person. Everything here has met only a stand-in prop on the same computer.

- [x] Proposals: the assistant works on a draft and hands over one change; a person's own edits made meanwhile are kept (the draft is rebuilt on the show as it is); operations that do nothing and bad settings are refused; a second proposal builds on the one waiting; a turn that fails puts the waiting one back. `test/assistant-tools.test.ts`.
- [x] The assistant's outline and reference are generated from the cue-type table and the settings; long shows get a short outline; an edit says what it broke. The checks on an operation are in `core/show/ops.ts` (`applyOps`), for the inspector, the assistant and `ec apply`. Tested.
- [x] The assistant knows the window: where something is, what a key does, and rings the place on the screen. Smoke-checked with the built-in helper; no real model asked yet.
- [x] Devices: equipment as part of the show (`settings.rig.devices`): an address, named commands with typed values, a way of telling it is there, what it reports. Three edit operations, started from a model or empty, a patch made a device in one edit with its id kept. Unit-tested; added, edited and removed in the window by the smoke run.
- [x] Device cues: a cue that sends one of a device's commands, with its values in the inspector and a fade for a command that has one; broken and skipped when its device or command is gone. Engine tests; fired in the smoke run and, in a `--net` session, received by the stand-in prop.
- [x] The check: one function that says whether the show is ready, a row for each thing the show uses, four states, and what to do about each row that is not ready (`core/rig/check.ts`; `ec check`). Unit-tested row by row.
- [x] Liveness: a device that can be asked is asked every two seconds, quietly; one that stops is a problem with its fix, a dot on the Rig tab and one notice, and is ready again when it is back. Unit-tested on a fake clock and against the stand-in on loopback; watched in a `--net` session.
- [x] The Rig page: the rows, the devices and their editor (commands with Try and +cue, the exact message under each), Look for props, the operator's own checklist with ticks for one sitting, what was heard on the network, Show mode. Smoke-checked; pictures in three themes.
- [x] The assistant's tools for the rig: the folder, a text file, the Rig's state, the monitor, "are you there?" to a device or a model's test message to a private address, look for props, firmware and the hand-over as files on a proposal; never a command, never in Show mode. Unit-tested with scripted providers; seven turns through Claude Code in a test session.
- [x] The assistant's first screen: one true line about this show, asks made from it as buttons, the next rung as a quiet line, and with nobody answering the four ways to have somebody. Unit-tested for every state; smoke-checked in the window.
- [x] The built-in helper: with no model, cues from a folder, a device, look for props, a cue for a command, "is everything ready?", "why is it not answering?", firmware, the hand-over, and says plainly what it does not do. Each turn unit-tested; the whole walk done in the window.
- [x] Start from a folder: any folder becomes the show (a `show.json` beside the sounds, nothing copied), the drawer opens and says what is in it, and cues are made only when asked. Smoke-checked.
- [~] The prop kit: firmware for a light or a switch on an ESP32, set up from a form or by the assistant, reviewed file by file and written into `props/`; `secrets.h` never replaced. The generator is unit-tested and the files reach the disk in the smoke run; the sketches compile for `esp32` and `esp32c3` and **have never been flashed or run on a board**.
- [x] The hand-over: `AGENTS.md` and `CLAUDE.md` in the show folder, generated from the show, with command lines for this computer (from an installed app they run the app's own program as Node). Unit-tested; accepted to disk in the window; the installed-app lines run once against an unsigned test build.
- [~] Everything above against real equipment: a real prop, a lighting desk or mixer as a device, Look for props through a real router, a signed build's Local Network permission, a MIDI device, a heartbeat device, `resend` on Wi-Fi. None tried (`CLAUDE.md`, "Not verified yet").
- [~] The script: a script file named in the show, `@cue` marks read, a row for marks with no cue, the assistant reading it. Unit-tested; not walked in the window, and no way in the window to name the script but the assistant or Settings' raw path.
- [ ] The assistant's key-based providers and Codex against a live service.
- [ ] HTTP devices (`via: 'http'`): WLED, Shelly and the like. Until then the answer is the hand-over.
- [ ] Flashing a board from the app.

## Platforms and design

- [~] Signed and notarised macOS build; Windows and Linux run by a person. Read for and fixed without being run there: one copy of the app, a show opened by its `show.json`, shortcut labels, About, `npm install`, closing the main window quits. `specs/10-cross-platform.md` lists what a person must check.
- [~] Updates from inside the app: the daily check, the title bar's line, install on quit or Restart now. Unit-tested and smoke-checked against a stand-in updater; no update installed over a signed build yet.
- [x] Simple by default: a new show is a plain cue list. Ducking, tempo and beat analysis, every network listener and module, and anything else that acts on its own are off until switched on; a new sound's bus is not guessed from its length unless Settings ▸ Show says so. Every such behaviour, its default and its switch are listed in `specs/00-defaults.md` (`test/defaults.test.ts`, `test/kinds.test.ts`, `app/main/smoke-defaults.ts`).
- [~] One design system (`specs/07-design-system.md`: type scale, spacing scale, control heights, radii, the colour tokens and what each means); tabs Edit · Rig · Show; seven Settings sections. Left: every surface checked against it, text wrapping and truncation checked everywhere (long cue names, long file names, narrow windows, every drawer and dialog), the inline font sizes in JS.
- [~] The mark (`build/mark.ts`, `docs/brand.md`) as the app icon, the start screen and Settings ▸ About, the site's favicons and a document icon for `.ecshow`. Seen in an unpacked Mac build. Not: the document icon seen in Finder (see the package line above), the mark in the window's title bar, any icon seen on Windows or Linux.
- [x] Help: a Help menu (the keys, the manual), Report a Problem, and the manual says which computers the app has and has not been run on.
