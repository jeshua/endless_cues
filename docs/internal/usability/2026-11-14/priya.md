# Priya: The Glass Orchard, from QLab to Endless Cues

**Verdict: with-workarounds.** The import told me the truth, cue by cue, and everything it said had come across did: the rain looped at its level, dipped under the thunder and the phone stopped on Q5. I rebuilt the five broken things in under an hour and Space, Esc, arrows, Q, N and Cmd+D sat where my hands expect. I would run tonight's tech on it, but the LX desk gets no MSC from me, the cue list draws wrongly on the rows that are playing, and I could not move a cue anywhere, so I am not yet calm about a paying house.

Ratings (1 to 5): learn 4, speed 3, clarity 3, trust 3

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| bring | done | Import from QLab on the start card opened the workspace and showed a list of exactly seven things that did not come across, each named by cue number and by its QLab type. '1 broken' in the status bar took me straight to the broken fade. |
| verify | done | Rain bed looped at -12 dB, Q3 took it to -22 under the thunder and back after 6 s over 3 s, Q5 stopped the phone. Matches what I built. |
| repair | done-with-trouble | Preshow: Walk-in 2 given a 40 s pre-wait, two fades and a Stop on the group (playlist loop is gone). Blackout: Cmd+G then 'Fade & stop others 3 s'. Act 2: could not move the child out of the group by drag, cut/paste or right-click; rebuilt it as a new cue and deleted the old one. MSC: cannot be done (MIDI is 'planned'); the LX op takes their own GO. The window stopped responding once and I had to save from the menu and restart. |
| notes | done-with-trouble | All six done. D did not disarm Q4 (used the Armed switch). File swap kept the level and copied the new file into the show folder. |
| save | done | Save Show As made 'The Glass Orchard.ecshow' on the desk with show.json, media/ (every sound, referenced by relative path) and versions/. Some files were copied more than once. |
| run | done | Show mode locks editing and says so. Ran 0.5 to 7; the disarmed Q4 was announced ('DISARMED — this GO will skip it'). Fired Q7 early, stopped it with its ■ in Active cues (a hard cut), Up Up to put the playhead back, and the real GO ran clean. |
| undo | done | No version existed from before 6.5 and Undo is in order, so undoing back to it would have taken the letter swap and the disarm with it. Deleted the cue and saved; the version note read '6.5 Door, a memory removed' and the other notes were intact. |

## Findings, worst first

### [major, missing, network] No MIDI Show Control: the cue that fires the lighting desk becomes a Memo

- Task: repair
- Expected: Q9 sends an MSC GO to the lighting desk, as in QLab.
- Happened: Import said '9 LX console GO (MSC): was a MIDI cue: kept as a Memo that does nothing.' Settings ▸ Modules lists 'MIDI … planned: Note, CC, Program Change and MSC in and out'. Only OSC to an Eos-family desk exists. The import was honest about it; the show loses the link.
- Evidence: shots/002.png, shots/035.png
- Steps: Import a workspace with a MIDI cue; open Settings ▸ Modules.
- Suggestion: Until MIDI exists, let the import offer to turn the cue into a Light cue or a Network cue to the desk.

### [major, bug, cue-list] Rows of running cues lose their columns in the cue list

- Task: run
- Expected: A running cue stays a normal row (number, name, target, times) with a running mark, as in QLab.
- Happened: As soon as a cue runs, its row collapses: the name jumps to the far left edge, the number, icon, target and duration disappear, and the row is a different height from its neighbours. With the thunder group running, four rows in a row looked broken. Seen in Show mode (095.png) and in Edit mode (102.png).
- Evidence: shots/095.png, shots/102.png
- Steps: Import the workspace, click cue 2 Rain bed, press Space, look at row 2.
- Suggestion: Keep the row's columns when it is running.

### [major, missing, cue-list] A cue cannot be moved: no drag, no cut and paste, nothing on right-click

- Task: repair
- Expected: Drag a cue out of a group or to another place, or Cmd+X / Cmd+V it, as in QLab.
- Happened: Dragging 'Thunder, close' out of its group did nothing (twice). Cmd+X then Cmd+V on another row did nothing. Right-click showed nothing. The manual says nothing about reordering. I rebuilt the cue from its file and deleted the original, and lost its trimmed length (0:07.5 became 0:08.0). The drag may be the test rig; cut and paste are in the Edit menu and did nothing to cues.
- Evidence: shots/043.png
- Steps: Import the workspace, select the child 'Thunder, close' in cue 12, press Cmd+X: the row stays.
- Suggestion: Make cut, copy and paste work on cues, and say in the manual how to reorder.

### [major, bug, cue-list] The window stopped taking clicks and keys after a right-click on a cue

- Task: repair
- Expected: A context menu, or nothing.
- Happened: After closing Settings and right-clicking the row 'Thunder, close', no row could be selected, Versions would not open, the arrow keys and typing went nowhere, Esc did nothing. The menu bar still worked: File ▸ Save Show As… saved everything, and after restarting the app the show was whole. Seen once; it may be an OS context menu the test rig cannot see or dismiss, so I am not sure this is the app.
- Evidence: shots/049.png, shots/054.png
- Steps: Not repeated. Open Settings (Cmd+,), close it, right-click a child cue row.
- Suggestion: Check what right-click on a row opens.

### [minor, missing, import] Playlist group has no equivalent: the walk-in music cannot loop or run in order by itself

- Task: repair
- Expected: Preshow plays one track after another and goes round until I fade it.
- Happened: '0.5 Preshow music: was a Playlist group: here every group fires all its children together.' Both walk-ins would have played on top of each other. I gave the second a 40 s pre-wait by hand; a Group has no loop, so the preshow is 80 s long and then silent.
- Evidence: shots/002.png
- Steps: Import a workspace with a Playlist group and fire it.
- Suggestion: On import, set each child's pre-wait to the sum of the ones before it, and say so.

### [minor, confusing, audio] A Fade cannot target a group, and fading the playing child leaves the group's later children waiting to start

- Task: repair
- Expected: Fading out and stopping the preshow ends the preshow.
- Happened: The imported fade was marked 'Targets a Group cue; needs Audio.' I pointed it at Walk-in 1 with 'Stop target when done'. After the fade, hear still showed 'Walk-in 2 is waiting (0:09.5 of 0:40.0)': it would have started on its own half a minute into act 1. It took a second fade and a Stop cue on the group, with a 6 s pre-wait, to make it safe.
- Evidence: shots/019.png, shots/024.png
- Steps: Give Walk-in 2 a 40 s pre-wait, target fade 1 at Walk-in 1, GO 0.5, GO 1, wait 7 s, listen.
- Suggestion: Let a Fade target a Group (all its children, and stop the group).

### [minor, bug, cue-list] D does not disarm the selected cue

- Task: notes
- Expected: The manual's key table says 'D: Arm or disarm it'.
- Happened: Clicked cue 4, pressed D: the row did not dim, no unsaved dot, the Armed switch in Basics stayed on. Tried again with the cue selected: the same. The Armed switch itself worked.
- Evidence: shots/086.png
- Steps: Import the workspace, click cue 4, press D, look at Basics ▸ Armed.

### [minor, bug, cue-list] Grouping with Cmd+G throws the selection and the playhead to the top of the list

- Task: repair
- Expected: The new group is selected so I can set it up at once.
- Happened: After Cmd+G on cue 13 (and naming the group), the inspector showed '0.5 Preshow music' and Standing by was 0.5. I had to scroll back down and find the new group. Happened both times I grouped.
- Evidence: shots/067.png, shots/070.png
- Steps: Select cue 13, press Cmd+G, type a name, Enter; look at the inspector.

### [minor, missing, transport] Stopping one running cue is a hard cut; there is no fade-out for a single active cue

- Task: run
- Expected: A way to fade just the wrong cue out quickly when I have fired it early.
- Happened: Active cues offers ❙❙ and ■ per cue. ■ on the early underscore cut it dead. 'Fade all' and Esc would have taken the rain with it. The follower cue (8, Underscore out) carried on waiting after its target was stopped, though the real GO restarted it correctly.
- Evidence: shots/097.png
- Steps: GO cue 2, then GO cue 7; press ■ on 'Underscore: the letter' in Active cues.
- Suggestion: Make ■ a short fade, or add a per-cue fade-and-stop.

### [minor, confusing, files] The first Save As records no version

- Task: undo
- Expected: The manual says 'Every save records a version', so there would be one from before tonight's notes.
- Happened: After File ▸ Save Show As… into a new folder and a later Cmd+S, Versions listed only the Cmd+S. With no earlier version and Undo strictly in order, there was no way back to 'before 6.5' except deleting the cue by hand. (The Save As was made while the window was stuck, see above; that may matter.)
- Evidence: shots/093.png
- Steps: Import, change something, File ▸ Save Show As…, change something, Cmd+S, open Versions.

### [polish, bug, files] The same sound is copied several times into the show folder

- Task: save
- Expected: One thunder.wav, one door.wav.
- Happened: media/ holds thunder.wav, thunder-2.wav and thunder-3.wav (same size) and door.wav and door-2.wav, one per cue that used the file. The replaced letter.wav also stays in media/.
- Steps: Import the workspace, Save Show As, list media/.

### [polish, bug, other] Welcome card overlaps the empty list's own message

- Task: bring
- Expected: One message on an empty show.
- Happened: 'No cues yet / Drop sound files here…' shows through behind the Endless Cues card and its picture; both are half readable.
- Evidence: shots/001.png
- Steps: Start the app with no show.

## What worked well

- **The import report names every loss by cue and in QLab's own words.** Seven lines, e.g. '12 Act 2: the storm returns: was a Start First and Enter group: here every group fires all its children together.' and '13 Blackout: … only a Group can do that here (put it in one).' It is kept in the show's notes, and the status bar's '✕ 1 broken' selects the broken cue. Everything not on the list worked when I ran it. (shots/002.png)
- **QLab hands mostly work.** Space, Esc (fade, then stop), Up/Down, Q, N, Cmd+D, Cmd+G, Cmd+S, Backspace all did what QLab does. A click puts the playhead on the cue. Standing by shows number, name, notes and 'then 8 · Underscore out'; a disarmed cue says 'DISARMED — this GO will skip it'. (shots/095.png)
- **Unsaved changes and versions are described in plain words.** '8 unsaved' chip, a yellow dot on each changed row and field with '↺ Put back to media/letter.wav', and version notes written for me: 'Thunder: level −6 dB · … · 6.5 Door, a memory added'. Save copied the new composer file into the show folder without being asked. (shots/086.png, shots/100.png)
- **Active cues says what is playing, how long is left and at what level.** Each running cue has its name, time remaining, a bar, its level in dB (the rain showed −22 dB while dipped) and its own pause and stop; a waiting fade is listed with its countdown. (shots/095.png)

## Test rig

- After one right-click the window took no more input until the app was restarted; possibly an OS context menu the rig cannot show or dismiss. Cost about 15 actions.
- A click by name straight after a scroll landed on the wrong row once (cue 14 instead of 13).
- Dragging a row could not be judged: it may not be deliverable by the rig.
- Went over the action budget (about 165 actions) because of the restart.
