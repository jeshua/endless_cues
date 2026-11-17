# Marcus, playback operator: Songbook

**Verdict: no.** No. The click has one place to go here, the same stereo output as the tracks, so I cannot keep it out of the house and the band gets no click at all. The vamp itself loops and leaves cleanly, but only by a mouse click on a small block every night, the click track does not go round with it, and my Devamp cue does nothing to it. Rehearsal tools (load to time, renumber, panic) are as fast as QLab; it is the routing and the vamps that send me back.

Ratings (1-5): learn 4, speed 4, clarity 4, trust 2

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| bring | done | Import from QLab opened all 18 cues with levels, groups and targets, and a plain list of what did not come: click routing, slice counts, slice devamps, MIDI, Mic and Timecode cues. |
| click | not-possible | Settings > Audio has one output device and buses that are only faders. The click cues arrive at -inf on the same output as the tracks: silent, so nothing leaks, but there is no way to send click to 3/4 only. |
| vamp | done-with-trouble | Made a loop region from the imported markers, clicked it to hold, went round twice, clicked it again and it left at the end of the pass (0:24) cleanly. But GO on my Devamp cue did nothing, the click track ran on without looping, and the hold is a mouse click each time. |
| counted | not-possible | A loop region has no play count. The import report said so. I would count four passes and click the block myself. |
| rehearse | done-with-trouble | Cmd+T on the Ballad group, 25, Enter, Space: track and click both start at 0:25. Doing it again cost wrong steps: arrow keys left the playhead on a Memo and GO played silence, twice; the reliable way is click the group row, Cmd+T, 25, Enter, Space. |
| renumber | done | Shift-selected the Finale cues, Cmd+R, Start at 300: 300-305 including the two children, as QLab would. Targets followed the new numbers. |
| levels | done-with-trouble | Typed -9 in the track's Level while it played and heard it change at once; Cmd+S saved to a folder with the audio copied in; reopened and it was still -9. First try went into the wrong cue's Notes because the list had moved when playback started. |
| panic | done | Esc faded, second Esc was silence. Cmd+J, 300, Enter put the Finale standing by; GO started it from the top. |

## Findings, worst first

### [blocker] Click cannot be sent to its own outputs: one stereo output for everything
*missing · audio · task click*

- Expected: Per-cue or per-bus output routing, as QLab's level matrix: tracks to 1/2, click to 3/4 of an eight-output interface.
- Happened: Settings > Audio: 'Output device: Where the show's sound goes on this computer' (one device) and 'Buses: ... each bus has a fader in the mixer'. No channel choice anywhere. Import says: 'played only on outputs of its own, with its main level down: there is no output routing here yet, so it is silent until you raise its level.' Click cues arrive at -inf; raising them would put click in the house.
- Steps: Import Songbook.qlab5; select Opening click > Audio tab (Level -inf, Bus Effects); open the mixer's gear (Buses and output).
- Evidence: shots/002.png, shots/006.png
- Suggestion: Let a bus choose which device channels it feeds.

### [major] GO on a Devamp cue does nothing to a track held in a loop region
*bug · transport · task vamp*

- Expected: The imported cue '11 Out of the vamp' (Devamp, target Opening track) leaves the vamp at the end of the pass, as in QLab. The toolbar says Devamp: 'A looping sound finishes its current pass and ends.'
- Happened: With the track showing 'holding' I pressed GO on 11. The playhead moved to 12, the track stayed 'held in a loop' and went round again. Same with 31 on the Finale. The import report does say 'a Devamp here ends a whole-file loop after its pass; slices are not here yet', but once the app has made me a loop region from those slices, the cue sitting under GO looks like the way out. I may be asking for something it never promised; in a show it is a dead GO in the middle of a vamp.
- Steps: Import Songbook.qlab5. Opening track > Time & Loops > Make from markers. GO cue 10, click the 'Slice 2' block on the waveform, wait past 0:24 ('holding'), GO cue 11. The track keeps looping. Run twice (Opening with 11, Finale with 31).
- Evidence: shots/012.png, shots/027.png
- Suggestion: A Devamp aimed at a track that is holding a region should let go of it.

### [major] The click does not go round with the track: after one vamp pass they are 8 s apart
*missing · transport · task vamp*

- Expected: Track and click are one number; in QLab both have the same slices and vamp together.
- Happened: Holding the Opening track's region looped the track only. hear: 'Opening click ... 0:31.4 of 0:48.0' against 'Opening track ... 0:23.4 of 0:48.0, held in a loop'. The click then ended while the track was still vamping. Only the Opening track and Finale track got markers on import, the clicks did not.
- Steps: As above; after the first loop pass compare the two times in Active cues.
- Evidence: shots/012.png
- Suggestion: Let a hold apply to every Audio cue in the group, or carry the click's slices across too.

### [major] A vamp has to be switched on by mouse during the number, every performance; no key and no cue for it
*missing · transport · task vamp*

- Expected: The vamp is the default: the track loops when it gets there and I press one key to leave.
- Happened: The region's block says 'Click to hold the track in this section'. If I do not click it before 0:24 the track runs on. After letting go it is back to not holding. Settings > Keys lists no key for hold or let go, and the manual does not mention vamps or loop regions at all.
- Steps: Make a loop region, GO the cue, do nothing: it plays straight through.
- Suggestion: An 'always hold' switch on a region and a key (or the Devamp cue) to let go.

### [major] The block that lets go of a vamp is off screen while another cue's waveform is showing
*confusing · transport · task vamp*

- Expected: The way out of a vamp is always in front of me while it is vamping.
- Happened: With track and click both running, the waveform panel showed '30 · Finale click', which has no region block. The track's row in Active cues showed a 'holding' chip; clicking it and clicking the track's name did nothing. The 'HOLDING — click the block to let go' strip only came back when the click cue had finished.
- Steps: Finale track > Make from markers. GO 30, click the Slice 2 block, wait until holding. Look at the waveform panel's title.
- Evidence: shots/027.png
- Suggestion: Make the 'holding' chip in Active cues the let-go button.

### [major] No counted loop: a section cannot play four times and go on
*missing · audio · task counted*

- Expected: A play count on the slice, as QLab.
- Happened: A loop region shows only 'Slice 2 · 0:20.0 – 0:30.0'; no count, nothing on right-click. Import said plainly: 'had 3 slices: kept as markers, without their play counts.'
- Steps: Finale track > Time & Loops > Make from markers; look for a count.
- Evidence: shots/002.png

### [major] MIDI, Mic and Timecode cues become Memos
*missing · import · task bring*

- Expected: The Keys 2 patch change and timecode to the lighting desk to work.
- Happened: '21 Keys 2 patch change: was a MIDI cue: kept as a Memo that does nothing.' Same for 22 (Mic) and 40 (Timecode). Each Memo's note repeats it: '(QLab MIDI cue: not in Endless Cues yet. It does nothing here.)' Said plainly, which I appreciate, but the show needs them.
- Steps: Import Songbook.qlab5.
- Evidence: shots/002.png

### [minor] Arrow keys leave the playhead on a different cue from the one selected, and Load to Time then loads a Memo
*confusing · cue-list · task rehearse*

- Expected: Up arrow moves the playhead back to the Ballad group, as Settings > Keys says ('Move the playhead ↑ ↓'), then Cmd+T loads it.
- Happened: After Esc the playhead was on 21/22. Clicked 22, Up, Up: the inspector showed the Ballad click (a child of the group) while Standing by still said '21 Keys 2 patch change'. Cmd+T said 'the cue standing by starts this far in; its length is not known', took 25, and GO played silence. Happened on two tries. Clicking the group row first works.
- Steps: GO cue 20, Esc Esc, click cue 22, press Up twice, Cmd+T, 25, Enter, Space.
- Suggestion: Load to Time on a cue with nothing to load should say so instead of accepting a time.

### [polish] The cue list jumps when playback starts, so a click aimed at a row lands on another
*confusing · cue-list · task levels*

- Expected: Rows stay where they are when I press GO.
- Happened: When a cue starts, the waveform panel opens and the list scrolls; the Ballad track row moved from y=301 to y=228. My click for the track's Level landed in cue 21's Notes and I typed '-9' there (undone with the undo button). A person watching the screen would see it move; I was going fast.
- Steps: Scroll so cue 20 is near the top, GO it, watch the rows.
- Evidence: shots/040.png

### [polish] Output device list is drawn empty
*bug · settings · task click*

- Expected: The chosen device's name in the box.
- Happened: Settings > Audio > Output device box is blank in the picture, while the bottom bar says 'System default output'. Seen once; may be the test rig's doing since the output is muted.
- Steps: Open the mixer's gear.
- Evidence: shots/006.png

### [polish] Unsaved counter stayed at '2 unsaved' after a third change
*confusing · files · task levels*

- Expected: 3 after two loop regions and a level.
- Happened: Chip read '2 unsaved' before and after the level change (undo button read 'Undo level'). Not sure what it counts; seen once.
- Steps: Make loop regions on two tracks, change a level, read the chip.
- Evidence: shots/044.png

## What worked well

- **Import report says exactly what did not come across, before I find out in a run.** One sentence each for click routing, slice counts, devamps, MIDI, Mic, Timecode; 'The QLab file is not changed'; the list is kept in the show's notes.
- **Load to Time works on a group with QLab's key and loads track and click together.** Cmd+T, 25, Enter: 'LOADED TO 0:25.0' beside Standing by; GO started both at 0:25.1. Five presses.
- **A loop region leaves at the end of the pass, cleanly.** 'Make from markers' built the 0:16-0:24 region from the QLab slices in one click; let go at 0:18 and it played to 0:24 and on to 0:27 without a jump.
- **Renumber, panic and jump-to-cue are where a QLab hand expects them.** Cmd+R with Start/Step, targets shown as '301 · Finale track' afterwards; Esc fades, Esc again stops dead; Cmd+J 300 Enter is back at the top of the number.
- **A level typed while the cue plays is heard at once, and Save brings the audio into the show folder.** hear went from -6.0 to -9.0 dB on Enter; Cmd+S asked for a place once, copied the six wavs into Songbook.ecshow/media; reopened: -9.

## Rig

- Clicking a row by its place from an older look missed twice after the list had scrolled; I could not see it move as a person would.
- The first Up key press without clicking a row first appeared to go nowhere (window not in front).
