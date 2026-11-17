# Priya: The Glass Orchard

**Verdict: with-workarounds.** I could run tonight's tech on it: the import told me the truth cue by cue, my hands mostly still worked, and in Show mode I always knew what was playing and what GO would do. But the lighting desk will not get its MSC GO, my preshow playlist is a bodge that started walk-in music under act 1 until I caught it, and I rebuilt a cue because nothing can leave a group. I would take it into tech, not yet in front of a paying house without a full run first.

Ratings (1 to 5): learn 4, speed 3, clarity 5, trust 3.

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| bring | done | Import from QLab on the first screen; one dialog listed the seven things that did not come across, by cue number, in plain words, and the footer said '1 broken'. |
| verify | done | Space on cues 2 to 5: rain loops at -12 dB, dips to -22 under the thunder, comes back after 6 s over 3 s, phone stops on cue 5. Matches the QLab show. |
| repair | done-with-trouble | Preshow fade: two fades, auto-continued (works). Playlist: pre-wait on the second track (plays in order, does not loop, and is not cancelled by the fade-out). MSC: cannot be done. Act 2 group: could not take a cue out of a group, rebuilt 'Thunder, close' as cue 12.5 and disarmed the one inside. Blackout: wrapped in a group with fade & stop others 3 s (works). The window stopped answering once after a right-click and I had to save from the menu bar and reopen (probably the rig). |
| notes | done | All six done in the inspector with N, Q, Cmd+D and typed values. D did not disarm cue 4 as the manual says; used the Armed switch. |
| save | done | Save Show As made 'Glass Orchard EC.ecshow' with show.json, versions/ and media/ holding every sound, including letter v2.wav. Checked in the folder; the app itself does not list what it copied. Five identical copies of thunder.wav in there. |
| run | done-with-trouble | Show mode is clear and locked. Walk-in 2 started 40 s in, under act 1 (my playlist workaround); stopped it from Active cues. Fired cue 7 early on purpose: stopped it with its ■ (a hard cut, no fade), Up twice put the playhead back, and the second GO restarted its follow-on fade correctly. |
| undo | done | Versions shows every save described in words, but restore is the whole version, which would have lost the other notes. Deleted 6.5 by hand and saved; v3 reads '6.5 Door again (memory) removed' and the other notes are intact. |

## Findings, worst first

### No MIDI or MSC: the lighting desk's GO cannot be sent

*major, missing, network, task repair*

- Expected: A MIDI cue type, as in QLab, so cue 9 fires the LX desk by MIDI Show Control.
- Happened: Import said '9 LX console GO (MSC): was a MIDI cue: kept as a Memo that does nothing.' The toolbar has Network ('Sends one OSC message') and Light; the manual does not mention MIDI. The desk in this theatre takes MSC only, so the LX operator has to take the GO by hand.
- Steps: Import a workspace with a MIDI cue; look for any cue type that sends MIDI.
- Evidence: shots/002.png
- Suggestion: Say in the import report what to use instead (OSC to the desk, if it has it) or add an MSC GO.

### A group child waiting on its pre-wait still fires after the scene has moved on

*major, confusing, transport, task run*

- Expected: The import report sent me to pre-waits as the only way to play a playlist in order ('here every group fires all its children together'). I expected fading out the preshow to be the end of the preshow.
- Happened: With Walk-in 2 on a 40 s pre-wait inside group 0.5, I fired Preshow out at about 10 s. Active cues kept '◷ Walk-in 2 −0:25' and at 40 s it played at −10 dB over the rain in act 1. I stopped it with its ■. Not sure whether this is a bug or just what a timeline group does; either way the playlist workaround is a trap. The proper fix (a Stop on the group) I did not get to.
- Steps: Group with two Audio children, second with pre-wait 40. GO the group, at 10 s fire a Fade (stop when done) on the first child, wait 30 s.
- Evidence: shots/076.png
- Suggestion: Let a Fade or Stop target the group, or import a Playlist group as an auto-follow chain.

### No playlist: a preshow cannot play in order and loop round

*major, missing, cue-list, task repair*

- Expected: QLab's Playlist group: tracks one after another, looping until faded.
- Happened: '0.5 Preshow music: was a Playlist group: here every group fires all its children together.' Both walk-ins play on top of each other unless I add pre-waits by hand; then it plays 80 s and goes silent. The Group tab offers only 'Fade & stop others'.
- Steps: Import the workspace, GO cue 0.5, hear both tracks at once.
- Evidence: shots/002.png

### A cue cannot be taken out of a group

*minor, missing, cue-list, task repair*

- Expected: Drag the child below the group, or Ungroup, or cut and paste, as in QLab.
- Happened: To make cue 12 'Start first and enter' I needed 'Thunder, close' after the group. Dragging the row out did nothing (three tries), Cmd+X did nothing to a cue, there is no Ungroup in any menu. I added a new Audio cue after the group, retyped its number, name and start time, and disarmed the original. A new Audio cue added while a child is selected also lands inside the group.
- Steps: Import; drag 'Thunder, close' from group 12 to below it.
- Evidence: shots/050.png

### D does not arm/disarm as the manual says

*minor, bug, help, task notes*

- Expected: Manual, keys table: 'D  Arm or disarm it'.
- Happened: Clicked the cue row, pressed D: a toast said 'A sound's length is its file's: set Start at and End at on its Audio tab' and the cue stayed armed. Same on the group child 'Thunder, close' and on cue 4 'Phone rings'. The Armed switch on Basics works.
- Steps: Open a show, click an Audio cue, press D, look at Basics ▸ Armed.
- Evidence: shots/051.png, shots/070.png

### A Fade cannot target a group, so one QLab fade becomes one fade per sound

*minor, missing, inspector, task repair*

- Expected: Fade the group, as QLab does.
- Happened: '1 Preshow out: targets a Group cue: a Fade here moves one Audio cue.' and the footer '✕ 1 broken'. The message was clear and the fix took a minute: retarget to Walk-in 1, Cmd+D, retarget the copy to Walk-in 2, auto-continue.
- Steps: Import; select cue 1.
- Evidence: shots/002.png

### Stopping one running cue is a hard cut; no way seen to fade just that cue

*minor, missing, show-mode, task run*

- Expected: After a GO too early, to fade the wrong cue out quickly while the rest keeps playing.
- Happened: Active cues gives each cue ❙❙ and ■ only. ■ on cue 7 cut it dead. Esc and Fade all take everything, including the rain bed.
- Steps: Show mode, two cues running, try to fade one of them out.
- Evidence: shots/076.png

### Two quick GOs: only one seemed to take, with nothing on screen

*minor, confusing, transport, task run*

- Expected: Each Space fires a cue, or the screen says a GO was ignored.
- Happened: Pressed Space for cue 5 and at once for cue 6; afterwards the list was one cue behind where four presses should have put it. Seen once, not repeated; it may be a double-GO guard or my count.
- Steps: Show mode, press Space twice within a fraction of a second, count the cues fired.

### The show's media folder collects identical copies of one sound

*polish, confusing, files, task save*

- Expected: One thunder.wav.
- Happened: media/ holds thunder.wav, thunder-2 to thunder-5.wav (all identical, one of them from a cue I undid) and door.wav, door-2.wav; the old letter.wav stays after the swap. A new cue from thunder.wav was named 'thunder-5'.
- Steps: Import the workspace, Save Show As, look in media/.

### Version notes shorten cue names oddly

*polish, wording, files, task undo*

- Expected: The cue's name.
- Happened: 'Rain: duration 00:05.00' is the cue 'Rain returns'; 'Thunder,: armed off' is 'Thunder, close'.
- Steps: Edit an unnumbered cue with a two-word name, save, open Versions.

### After Q on a new group, the name came out 'qBlackout'

*polish, bug, cue-list, task repair*

- Expected: Q opens the name for typing, as it did on other cues.
- Happened: Cmd+G on cue 13, then Q, typed 'Blackout', Enter: the group was named 'qBlackout'. Seen once; Q on existing cues worked every other time, so it may be the first Q after Cmd+G.
- Steps: Select a cue, Cmd+G, press Q, type a name, Enter.

## What worked well

- **The import report tells the truth, by cue number, and says what to do.** One dialog: '24 cues in 2 lists', then seven lines, each a cue number, what it was in QLab and what it is here ('13 Blackout … only a Group can do that here (put it in one)'). Every line was accurate when I checked, levels, loops, fades and waits were all right, and the list is kept in the show's notes.
- **QLab hands work: Space, Esc, N, Q, V, Cmd+D, Cmd+G, Cmd+S, arrows.** All of these did what they do in QLab without my reading anything. Selecting a cue stands it by.
- **The standby line and Active cues say exactly what is happening.** Big cue number, name and notes, 'then 8 · Underscore out'; for a disarmed cue 'DISARMED — this GO will skip it'; Active cues shows each sound's level in dB, time left, and waits counting down (which is how I caught the stray walk-in). After a wrong GO, Up moved the playhead back and re-firing restarted the follow-on fade's wait.
- **Unsaved changes are counted and marked, and each save is described in words.** '5 unsaved' in the top bar, a dot on each changed cue, and Versions reads 'Thunder: level −6 dB · … · 6.5 Door again (memory) added'. Save As carried every sound file into the show folder.

## The rig

- After a right-click on a cue row the whole window stopped taking clicks and keys (GO included) while the show clock kept running; the menu bar still worked, so I saved, stopped and restarted. A drag alone did not bring it back, so I take it for a native context menu the rig cannot answer. If it is not the rig, it is a blocker. Shots 027.png to 036.png.
- The cue list scrolls to follow the playhead, so coordinates from an earlier look went to the wrong row several times; clicking by name is safer.
- Dragging a row may not be something the rig can do; the 'cannot take a cue out of a group' finding rests also on there being no menu or key for it.
- I went over the action budget (about 230 actions), mostly from the restart and mis-aimed clicks.
