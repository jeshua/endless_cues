# Marcus: Songbook on Endless Cues

**Verdict: with workarounds.** It vamps, and it leaves the vamp at the end of the pass with the click going round in step on 3-4 only. That was what I came to find out. But the vamp only happens if I press L after every GO, I could not get a counted vamp to take its count, and timecode and the Mic cue are memos. I would rehearse on it as the backup this week. I would not call it show-ready until a vamp holds by itself.

Ratings (1 bad, 5 good): learn 4, speed 4, clarity 3, trust 3.

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| bring | done | Import from QLab is on the first screen. 18 cues, groups, fades, devamps, targets and audio came across; the report named what did not. |
| click | done | Click cues arrived silent on a 1-2 bus. Added a bus "Click" on Outputs 3-4 and moved all three in one multi-select. Heard "on outputs 3-4 only (Click)". |
| vamp | done with trouble | First run played straight through the vamp. With L pressed after GO: three passes, click in step, cue 11 left at the end of the pass and played on. |
| counted | gave up | The region's count box would not take "4" in seven tries; the Finale ran straight through. Could not place a 0:38 marker for the bows vamp either. |
| rehearse | done | Cmd+T, 25, Enter, Space. Again costs eight presses because the time is not remembered. |
| renumber | done | Cmd+R, start at 300: 300 to 305, targets followed. |
| levels | done | -9 typed while playing, heard at once, saved with Cmd+S without a dropout. |
| panic | done | Esc, Esc, Up: silence and the Ballad back on standby. |

## Findings, worst first

**Major**

1. **A vamp with no count does not vamp unless L is pressed after every GO.** In QLab an infinite slice holds by itself until the Devamp. Here the track played through 0:24 to 0:28; a "⟳ hold next" chip was the only hint. The text that explains it ("With no count it does not loop by itself: in the show, press L …") is below the fold of the inspector. A forgotten L in a show means the track leaves the stage behind. (023.png)
2. **The loop region's count box would not take a number.** Clicked it, typed 4, Enter or Tab, seven ways; it stayed empty and the Finale did not loop (heard at 0:33.3). Level, bus name and the marker box took the same typing. Tried on one region only, so it may be the test rig. The box is about three letters wide: the placeholder reads "hol". (031.png)
3. **Timecode and Mic cues are memos that do nothing; the MIDI message is not read.** Said plainly at import and on the cue's notes at standby, which is right. But the backup would not drive the lighting desk. (003.png, 062.png)

**Minor**

4. **The import report and the Devamp tooltip say devamp will not do what it does.** "a Devamp here ends a whole-file loop after its pass; slices are not here yet" and "finishes its current pass and ends". In fact cue 11 released the held region and the track played on. I nearly did not try it.
5. **One click on the inspector waveform moves where a number starts.** I was trying to place a marker at 0:38; it set the Finale's Start at instead, with only a small ↺ on another tab to show it. The playing view's waveform says "Click the waveform to mark a place"; the inspector's means something else.
6. **No way found to put a marker at a typed time.** "Bows end, at 0:38" in the box marked "name, at 0:00.0" made a marker at 0:00.0 with the time in its name.
7. **Load to Time does not remember the last time.** Each repeat is Esc Esc, Up, Cmd+T, 2, 5, Enter, Space.
8. **Imported click cues are silent and on a 1-2 bus until three things are done by hand.** Silent is the safe way to fail, but raising the level before making the bus would put the click in the house. Tracks landed on "Effects", not "Music".

**Polish**

9. The cue list shows "bus4" for the bus I named Click.
10. The text explaining loop counts and L is cut off at the bottom of the inspector.

## What worked well

- **Click out of the house in one drop-down**, and the mixer says "Click ›3–4".
- **The click goes round the vamp with the track** and leaves with it, with no loop built on the click cue.
- **Cmd+T, Cmd+R and Esc Esc are where QLab has them.** Load to Time takes the whole group and the header says "LOADED TO 0:25.0". Renumbered cues keep their targets.
- **A live level change is heard at once, counted as unsaved, and saved without a dropout**, with the audio copied into the show folder.
- **The import report names every loss by cue number.**

## Rig

- The list scrolled after GO, so one click by remembered position hit the wrong row.
- The count-box failure may be the rig's typing.
- Could not test the Click bus on a two-output device: the rig pretends to have eight.
