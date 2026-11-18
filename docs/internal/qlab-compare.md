# The QLab importer against QLab itself

What `core/import/qlab.ts` makes of a workspace, compared field by field with what QLab 5.6.3 says about the same file, and how long importing takes. No sound was played: what the differences sound like is the next phase's.

## How

- `test/qlab-compare/compare.ts` (run by hand on a Mac with QLab, not by `npm test`): `node test/qlab-compare/compare.js <workspace>`. QLab's side is read by `qlab-dump.jxa` through QLab's AppleScript dictionary: the file is opened, every cue's properties, target, file, slices and level matrix are read, and it is closed without saving. Nothing is fired. QLab 4 workspaces are opened in QLab 5 (the question it asks is answered Open; it is never saved). The cues are matched by place, which holds because the importer keeps every cue; a shuffled playlist and a cart, which QLab lists in their play and button order, are matched by number and name.
- For each cue it prints each field that differs (QLab's value, then ours), whether the import's report said anything about that cue, and the report's notes on cues where nothing compared differed. Then `ec validate`, `ec outline` and `ec simulate` on the show written to a temporary folder, and the time and memory of each step.
- 53 workspaces: 5 built with QLab 5.6.3 by AppleScript for the purpose (one of every cue type with settings off their defaults, an empty one, an awkward one, a 2,900-cue one, and an earlier one of the same kind), 38 public workspaces from GitHub (19 QLab 4, from 4.0 to 4.7, and 19 QLab 5, from 5.0 to 5.6), and 10 private ones. 7,668 cues and lists in all. Neither the public nor the private workspaces are in the repository, and nothing here names or quotes them.
- What QLab says is its own reading, not ground truth for what it plays (that is the sound phase), and a few of its readings are derived rather than saved: it reports a Wait cue's post-wait as its duration, a Start First and Enter group's continue as auto-continue, and a level for a file it cannot find as no matrix at all. The compare allows for each.

## Fidelity

Cues by QLab's type, after the fixes below. *Same*: every field compared matched. *Other type*: became another kind of cue here. *Memo by design*: Script cues (AppleScript, which nothing here runs), kept as Memos with their script in their notes.

| QLab cue type | cues | same | differ | other type | lost | memo by design | fields compared | fields differ |
|---|---|---|---|---|---|---|---|---|
| Audio | 1206 | 651 | 555 | 0 | 0 | 0 | 19839 | 556 |
| Group | 1172 | 1172 | 0 | 0 | 0 | 0 | 12035 | 0 |
| Network | 1000 | 900 | 99 | 1 | 0 | 0 | 10133 | 100 |
| Memo | 873 | 873 | 0 | 0 | 0 | 0 | 7880 | 0 |
| Fade | 634 | 619 | 15 | 0 | 0 | 0 | 8936 | 15 |
| Start | 611 | 611 | 0 | 0 | 0 | 0 | 6110 | 0 |
| Arm | 333 | 333 | 0 | 0 | 0 | 0 | 3330 | 0 |
| Script | 322 | 0 | 0 | 0 | 0 | 322 | 3335 | 2 |
| Stop | 297 | 297 | 0 | 0 | 0 | 0 | 2970 | 0 |
| MIDI | 264 | 262 | 0 | 2 | 0 | 0 | 2640 | 0 |
| Wait | 243 | 243 | 0 | 0 | 0 | 0 | 2187 | 0 |
| Video | 170 | 161 | 9 | 0 | 0 | 0 | 3506 | 11 |
| Load | 157 | 157 | 0 | 0 | 0 | 0 | 1727 | 0 |
| Disarm | 156 | 156 | 0 | 0 | 0 | 0 | 1560 | 0 |
| Cue List | 116 | 101 | 1 | 14 | 0 | 0 | 116 | 1 |
| Text | 71 | 65 | 6 | 0 | 0 | 0 | 1072 | 6 |
| Camera | 10 | 10 | 0 | 0 | 0 | 0 | 140 | 0 |
| Light | 8 | 4 | 0 | 4 | 0 | 0 | 86 | 7 |
| GoTo, Cart, Timecode, Mic, Pause, Devamp, Target, MIDI File, Reset | 25 | 24 | 1 | 0 | 0 | 0 | 211 | 1 |
| **all** | **7668** | **6639** | **686** | **21** | **0** | **322** | **87813** | **699** |

Before the fixes, the same comparison: 6,213 cues the same, 1,107 differing, 26 of another type, 1,530 fields differing. No cue was ever lost.

What still differs, most first:

| Count | What | Why, and what the report says |
|---|---|---|
| 456 | A mono file on QLab's default crosspoints | QLab sends a mono file to cue output 1 alone. Now panned hard left on import, as measured in [`sound-compare.md`](sound-compare.md); the report says so once, with the count. |
| 99 | A Network cue for a device whose message QLab itself cannot show | QLab names the cue "status:error"; ours sends the message its device template makes. Not known which is right without the device. |
| 49 | A QLab 4 Audio cue with a trim | QLab 4 kept a trim beside each level. QLab 5.6.3 reports the level without it, but plays the level times the trim, as the import does ([`sound-compare.md`](sound-compare.md)). |
| 43 | A sound file that has moved | QLab follows a moved file through its bookmark; the import uses the path saved and lists the file as missing. |
| 14 | A group in "cue list" mode inside a list | QLab shows it as a cue list within the list; here a group that fires all its children, with a note. |
| 13 | A Fade aimed at an output patch or audio map, or with no main level | Noted; only a cue's main level is faded here. |
| 11 | An integrated fade envelope | Where QLab keeps it in the file is still unknown (AppleScript cannot set one, so none was built). Noted. |
| 6 | A Text cue with no text | QLab's is empty; here the name stands in. Noted. |
| 4 each | A Video cue's rate; a Video cue scaled differently across and down; a Light cue with no commands (fade time) | Noted. |
| 3 | A Light cue whose commands do not all read here (a colour as `rgbw(…)`) | Kept as a Memo with the commands in its notes. |
| 2 | Crosspoint levels faded by a Fade | Only the main level is kept. Noted. |
| 1 each | A Timecode cue at 29.97 non-drop; a cue list's notes; a list's number | Not kept here (no such rate; lists have no notes or numbers here). Only the rate is noted. |

A Fade's video geometry, a Text cue's words and style, Timecode cues, triggers, ducking, the second trigger, auto-load and the reach of "fade and stop others" all match now.

## Bugs fixed (each with a test in `test/import-qlab-built.test.ts`)

The tests read `test/fixtures/qlab-built/fields.qlab5`, a made-up workspace in which every value is written under the key and in the form QLab 5.6.3 saved it in the built workspaces (`test/fixtures/make-qlab-built-fixture.py`), and `few.qlab5`, saved by QLab itself (no file targets, so no path of the computer it was made on).

1. **"Played only on outputs of its own, with its main level down"** fired for any cue with its main level down, because every QLab cue's output levels sit at unity. It now fires only when the crosspoints send the cue somewhere other than QLab's default (`cue.outputs` is set). Checked on QLab-saved cues of both kinds.
2. **A MIDI cue with no readable message** was described as "MIDI timecode, or an empty SysEx" whatever it held. It now says what was found: an empty SysEx (which QLab does not send either), a voice message of an unknown kind, an MSC command MSC does not have, or no MIDI fields at all.
3. **MSC**: SET, a cue path, and formats with no words here are sent as their bytes (MSC laid out as its specification has it); a timed GO keeps its time (it was dropped).
4. **Timecode cues**: QLab 5 saves the start as an `F53Timecode` (frames over the frames counted a second, in 48 million ticks a second, with its rate beside it) and the LTC output counted from 0. Every one was imported as 01:00:00:00 at 30 on output 1.
5. **Text cues**: QLab 5 keeps the words in `titlesAttributedString`; they were never found, so the cue's name stood in. Now the words, and the first run's font family, size, colour and alignment.
6. **Triggers**: wall-clock (with its days) and timecode triggers came across as "not carried over", though the app has both. A MIDI trigger dropped QLab's condition on its second byte: QLab saves `byte2Operator` 0 for "equal to" (1 any, 2 below, 3 above), so a controller trigger at one value fired on every value here (about 130 cues in one public workspace, one per value).
7. **Ducking others, the second trigger (and on release), auto-load**: all "not carried over"; the app has each. Ducking's level is a gain in the file.
8. **"Fade and stop others"**: its reach (peers 1, list 2, all 3) was ignored, so a cue that stopped its peers stopped everything (56 cues).
9. **Colours**: names QLab 5.6 saves (crimson, lavender, plum, sky blue, midnight, chartreuse, mauve, hot pink) and older ones QLab 4 saved (vermilion, celadon, sage, maize and others) had no match, and several that have a colour of their own here (magenta, indigo, lime, forest, coral, sky, brown) were folded into another; the second colour ("colour once played") was ignored.
10. **A Fade that moves a picture** (opacity, position, scale, rotation) lost all of it (94 cues in the public workspaces) and, with no main level, faded the picture's sound too.
11. **Reset and Target cues** became Memos; the app has both (a Target cue's new target is kept by number in the file). **Devamp**'s "start the next cue" and a **Load** cue's time from the end were dropped; the app has both.
12. **Keep pitch** (`doPitchShift` 0), a **MIDI File cue's rate** (`playbackRate`): saved under names the importer did not read.
13. **A playlist's cues** kept their own continue modes, which QLab ignores in a playlist and which here would start the next one at once.
14. **A QLab 4 Video cue's level** is on an Audio cue inside it (`audioCue`): read as 0 dB, so a muted video's sound would play.
15. **A cue with its main level down and an input level up** came across a few dB above silence; it stays silent.
16. **Script cues** are kept as Memos with their AppleScript in their notes (it was dropped); **Light cues** whose commands do not all read here keep them in their notes (they were dropped); a Network cue with no message and a Light cue with no commands are said to be that.
17. **The report**: a MIDI trigger was noted "check it" on every cue that had one (131 notes on cues that came across exactly); it is said only when something was left out. A Video cue's geometry is no longer called unchecked.

## Is the report honest now

Cues that differ with no word in the report: 99 (the device-message cues above) and one list's notes. Before: the mono default (449) and most of the bugs above were silent. The notes on cues where nothing compared differed are advice (look at a picture on the stage, choose a camera, a relative fade's amount), true losses the compare does not measure (skip if disarmed: 203), or the broken targets and missing files that `ec validate` also reports. The summary's per-cue lines are grouped by kind; a show-level line counts the mono sounds.

## Stress

The 2,900-cue workspace (19 MB; four lists of 620 cues with groups nested eight deep, two carts of 50), on the Mac that ran the comparison:

| Step | Time | Heap |
|---|---|---|
| Import (read the archive, map, normalise) | 0.43 s | 127 MB |
| Save (stringify, write: 1.7 MB) | 4 ms | |
| Open (parse, normalise) | 19 ms | |
| `show.problems`, the whole-show check | 9 ms, 12 ms | |
| Engine document | 24 ms | |
| Simulate 400 GOs | 43 ms | |
| `ec validate`, `ec outline`, `ec simulate` (whole process) | 0.11 s, 0.10 s, 0.15 s | |
| The app (drive harness, silent): open on the workspace; Check; Save to a folder | about 2 s; 0.23 s; 0.53 s | |

The window stayed responsive with it (switching lists, selecting all, End). Every other workspace imports in under 0.13 s. QLab took about four minutes to answer the dump of this workspace through AppleScript.

## What QLab and its dictionary did not allow

QLab's free mode refused nothing here: every cue type (Network, MIDI, Timecode, Script, Target, Arm and Disarm included) was made, set and saved. QLab refused a group cue inside a cart (its rule, not the licence's). AppleScript cannot set a hotkey's key, an integrated fade's envelope, audio effects, a network patch of another kind than OSC, the light patch or a stage, so none of those were built and their keys in the file are still known only from public workspaces, where they occur. Nothing was played.

## For the sound phase

- A mono file on QLab's default crosspoints: output 1 alone in QLab, the middle here (456 cues in the built workspaces alone). Meter both. If QLab plays it on output 1 only, the import should pan it hard left.
- QLab 4 trim: whether QLab 5 plays a converted cue at its level or at level × trim.
- The second trigger: QLab's default is "nothing" (0); a cue here defaults to restart. Fire a running cue's hotkey in both.
- Levels and pans the import worked out from crosspoints (equal-power pan, masters multiplied in), a relative Fade, Fade shapes (QLab's `fadeType` and curves are not compared), ducking's level and time, "fade and stop others" by reach.
- A Fade on a picture's opacity and position, a Video cue's rate (not here), and Text cue sizes (QLab's points taken as stage pixels).
- Timecode out (LTC on the output QLab named, MTC at 29.97 drop) and MSC SET and timed GO as sent bytes, against a reader.
