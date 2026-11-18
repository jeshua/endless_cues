# What QLab plays, against what Endless Cues plays

The same cue sequences played by QLab 5.6.3 and by Endless Cues on each of its two audio engines (Web Audio and the
native engine), each recorded digitally off BlackHole 2ch, and the recordings read the same way. The structural
comparison that came first (what the importer makes of a workspace, field by field) is [`qlab-compare.md`](qlab-compare.md).

## How

The scripts are in [`../../test/sound-compare/`](../../test/sound-compare/qlab.ts), run by hand on a Mac with QLab and
BlackHole, never by `npm test`:

| Script | What it does |
|---|---|
| `scenes.ts` | Nine small workspaces, each written as the cues QLab should have (type, number, file, `setLevel` levels, any AppleScript property) and the steps to play it with (GO, a cue started, a panic, at their moments). |
| `signals.ts` | The files they play: tones at multiples of 200 Hz at −12 dBFS (so over a 5 ms window each is a whole number of cycles and none leaks into another), bursts that count their plays, a file of three tones for slices. 48 kHz float. |
| `qlab.ts build` | Each scene built in QLab by AppleScript, in a copy of an empty workspace QLab saved, and saved. What AppleScript cannot set (a Fade's curve shape, a trim on a level) is written into the saved file afterwards through `plutil`. |
| `on-blackhole.sh` | Runs a command with the speakers at volume 0 and muted, and BlackHole as the system output (QLab's default patch plays to the system output); puts the output, the volume and the mute back on exit, whatever happens, and checks them. `default-output.swift` reads and sets the default output through CoreAudio. |
| `qlab.ts play` | Each workspace opened in QLab, its steps sent as OSC (`/go`, `/cue/N/start`, `/panic`), BlackHole's input recorded by `ec-audio listen --record`, the workspace closed. |
| `ec.ts` | Electron: the app's own host (`app/main/host.ts`) with its settings in a temporary folder, the chosen engine on BlackHole by name, each workspace imported as the app imports it and played with the same steps at the same moments (a cue started again as an OSC start, through the double-GO guard). |
| `analyse.ts` | Every recording placed on the wall clock by its `.blocks.csv` (each buffer's moment as the input stamped it), so a time is seconds from the scene's first step. Each tone's amplitude on each output every millisecond (a 5 ms window); from that each stretch a tone sounds (its start and end at half its level, its level on each output), level traces every 10 ms over the fades and ducks, and how late each start is against what the workspace says. |

The scenes: levels (main, output, input levels, crosspoints, a mono file left on QLab's default), timing (pre- and
post-waits, auto-continue, auto-follow, a Start cue, groups as timeline, start first and enter, start first, random),
fades (down, up, relative, to silence stopping its target), shapes (each of QLab's curve shapes, down and up), trim,
loops (a play count, an infinite loop stopped, slices with counts, Devamps), stops (fade and stop others, a Stop cue, a
panic), duck, and second (a running cue started again with QLab's default, stop, and hard stop and restart). Every
scene was played in all three; the scenes the fixes touched were played again on both engines afterwards.

Levels are given in dB of the file's own; a time is from the moment the step was sent.

## Matched

| What | Tolerance | QLab | Web Audio | Native |
|---|---|---|---|---|
| Main level, output level, input level, crosspoints (stereo and mono), +6 dB | 0.06 dB | exact | +0.17 dB on everything (below) | within 0.06 |
| A crosspoint matrix read as a pan and a level (equal power) | 0.06 dB | | the same | the same |
| A trim on a main level (written into a QLab 5 file) | 0.01 dB | level × trim (−6 and −6: −12) | the same | the same |
| Pre-wait, post-wait, auto-continue, auto-follow, a Start cue starting its target with the target's pre-wait | ±60 ms of when the workspace says | 17–85 ms late | 25–40 ms late | 8–29 ms late |
| Groups: timeline (children by their pre-waits), start first and enter (and the next GO inside it), start first, random (one child) | as above | | the same | the same |
| A play count; an infinite loop, stopped by a Stop cue; slices with play counts | to the ms, every pass | | the same | the same |
| Fade cue with QLab's default S-curve and its linear curve, down and up, ±20 dB, relative −10 dB, and to silence stopping its target | 0.2 dB at every moment (0.43 on the fade to silence, below −35 dB) | | the same, after fix 3 | the same, after fix 3 |
| A Stop cue's declick | 4–6 ms to silence | 4 ms | 4 ms | 6 ms |
| Second trigger: QLab's default ("nothing"), stop, hard stop and restart | what it does | | the same, after fix 2 | the same, after fix 2 |
| A cue that ducks the others: depth, when it starts and when it is down, and the way back | 0.2 dB at its depth; on time | at −10 dB at 1 s | after fix 4 | after fix 4 |

**GO to sound.** The first sound of a GO is heard 40–90 ms after QLab is sent `/go` over OSC (it varies from GO to
GO), 22–39 ms after the app's GO on Web Audio, and 8–15 ms on the native engine. A cue QLab starts from a wait (a
pre-wait, a post-wait, a child's pre-wait) lands 17–30 ms after its written time; so in QLab the gap from a GO's first
sound to the next cue is 30–60 ms shorter than written, where both engines here keep it to within 15 ms.

## Differed, and fixed

1. **A mono file on QLab's default crosspoints** plays on output 1 alone in QLab (0 dB left, nothing right). The
   import left it in the middle of the bus (0 dB both sides). It is now panned hard left with the pan's 3 dB taken off
   its level: 0.01 dB of QLab's on output 1, nothing on 2. The report says so once for the show
   (`core/import/qlab.ts`; `test/import.test.ts`). The structural compare (`test/qlab-compare/compare.ts`) now compares
   these like any other routing.
2. **The second trigger.** QLab's default, "nothing", leaves a running cue playing when it is started again (it ran to
   its end, 3.0 s). The import left it at this app's default, restart (it restarted and ran 4.0 s). It now comes across
   as `nothing`, on every cue but a Memo (`test/import-qlab-built.test.ts`).
3. **Fade curves.** QLab's fades move along its "slider" domain, a fader's travel, not along the dB: a fade down holds
   up and falls away at its end, a fade up rises and settles. The import took every Fade cue as a straight line in dB:
   2.1 dB from QLab's at the worst moment of a 20 dB fade, 4.4 dB on a fade to silence (mid-fade, a fade from 0 dB to
   silence is at −15 dB in QLab and −30 dB in a straight line in dB). A fader's travel fits the gain to the power 0.36
   to within 0.1 dB from 0 to −20 dB, for both QLab's S-curve and its linear curve, and to 0.23 dB from −10 dB to
   silence (QLab's travel ends at −60 dB). Two shapes are new: `fader` (an S-curve on a fader: QLab's default) and
   `fader-linear`; the engine turns either into points for the two levels of the fade it starts, so neither backend
   changed (`core/audio/curves.ts` `faderPoints`, `core/engine/cue-engine.ts` `fadeAudio`; the inspector offers and draws
   them). A QLab Fade imports with its rising and falling curves (QLab 5 and QLab 4 keep them in the same form).
   Afterwards every fade of both scenes matched QLab's to 0.08–0.18 dB, 0.43 on the fade to silence
   (`test/audio-depth.test.ts` holds the arithmetic to QLab's measured fade). New Fade cues made here keep the straight
   line in dB.
4. **A cue that ducks the others** moved by an exponential approach (`setTargetAtTime` with a third of its time, and
   the same in the native engine): 0.9 dB short of a 10 dB duck when its time was up, within 0.2 dB only after twice
   that. QLab's is at its depth on time. Both engines now move it straight in dB and land on `duckTime`
   (`app/audio/audio.ts` `glide`, `native/audio` a `Level` for `others`; `native/audio/tests/mixer.rs`). The comments
   that said the exponential approach lands within 0.5 dB (true only for small moves) now say what it does; it still
   moves the buses and the master.

## Differed, and left (decisions for the owner)

| What | How much | Why it is left |
|---|---|---|
| Web Audio plays everything 0.17 dB louder | +0.17 dB on every level | The limiter's make-up gain in Chromium (already in [`native-qa.md`](native-qa.md)). The native engine matches QLab to 0.01 dB. |
| **Fade and stop others, and a panic,** fade along QLab's curve there and straight in dB here | at half their time, QLab −3 to −5 dB, here −23 dB; 24 dB at the worst moment | They have no shape of their own here. Giving them the fader's curve for an imported show needs a show setting (or making it the default); not decided. |
| A duck's curve | 1.5 dB at its worst moment of a 10 dB duck | QLab's moves along its S-curve on a fader; here it is straight in dB (and lands on time). The fader shape could be used for it too. |
| QLab's parametric and custom fade curves | 4 dB from the S-curve they come across as | Rare (none in the 53 workspaces of Phase A); the report notes each. |
| A domain other than QLab's slider domain (dB, linear) | not measured | Every workspace seen uses the slider domain; the report notes another. |
| QLab's hard stop and restart leaves a 24 ms gap | 24 ms of silence | Here it restarts without one. |
| An auto-follow here waits for the sound's end and then starts the next | 10–15 ms more than an ordinary start, each time | QLab starts the cue after an auto-follow 30 ms late but times what follows from the written moment; here what follows is timed from the start. Twenty auto-follows in a row drift 0.2–0.3 s. |
| A matrix read as a pan is rounded to a whole pan and a tenth of a dB | up to 0.06 dB | Within what anyone hears. |
| Native engine: a sound's own outputs (a matrix that is not a pan) | the second output missing | Not in the native engine yet; it says so (`operror`). |

## Not compared

- **Devamp cues.** QLab in free mode reports a Devamp cue as broken (`/cue/N/isBroken` is true; Devamp needs a licence),
  and it does nothing, by GO, OSC or AppleScript, with either of its devamp types. Here a Devamp lets a held slice go
  at the end of its pass and starts the next cue on time (17.5 s, the end of the pass). That half is checked; QLab's
  is not.
- **MSC and MIDI.** The IAC bus is offline on this computer and QLab's MIDI patch device cannot be set by AppleScript;
  enabling one is a change to the computer's set-up, not made. MSC's bytes were compared as data in Phase A.
- Pictures (a Fade on a picture, Text sizes) and timecode (LTC, MTC at 29.97 drop): not done.
- A real QLab 4 workspace played in QLab 5 (the trim was written into a QLab 5 file instead; QLab 5 plays the main
  level times the trim, which is what the import does, though QLab's AppleScript reports the level without it).
