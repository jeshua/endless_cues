# Usability run 2026-11-14

Four virtual users, each an agent standing in for a person with a show of their own, using the app through its window (`test/users/README.md`). A virtual user is not a person: read this as a list of things to look at, not as a measure of how usable the app is.

## Verdicts

| Person | Would run their show on it | Learn | Speed | Clarity | Trust | Blockers | Major | Minor | Polish | Praise | Actions |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [dana](dana.md) | with-workarounds | 3 | 4 | 4 | 3 | 0 | 2 | 7 | 3 | 3 | 206 |
| [marcus](marcus.md) | no | 3 | 3 | 3 | 1 | 2 | 5 | 2 | 1 | 4 | 108 |
| [priya](priya.md) | with-workarounds | 4 | 3 | 3 | 3 | 0 | 4 | 6 | 2 | 4 | 196 |

**dana:** I built the whole evening in one sitting and the run went as the notes ask, so yes, I could tour on this. But twice it frightened me: my tracks vanished until I saved, and the house fade showed no fade until I typed in a level it already seemed to have. I would rehearse every cue before trusting it in front of an audience.

**marcus:** I can't put this on the backup machine for Songbook. The click has nowhere to go but the same output as the tracks, and it came across from QLab silent, so the band would have no click at all. The track will vamp and leave the vamp on the bar, but the click doesn't go round with it and my Devamp cues do nothing, so the vamp is a mouse job with the band out of time. Load to Time, renumber and panic are as good as QLab; fix outputs and slices and I'd look again.

**priya:** The import told me the truth, cue by cue, and everything it said had come across did: the rain looped at its level, dipped under the thunder and the phone stopped on Q5. I rebuilt the five broken things in under an hour and Space, Esc, arrows, Q, N and Cmd+D sat where my hands expect. I would run tonight's tech on it, but the LX desk gets no MSC from me, the cue list draws wrongly on the rows that are playing, and I could not move a cue anywhere, so I am not yet calm about a paying house.

## Tasks

| Person | Task | Outcome | Actions | Refused | Minutes | Notes |
|---|---|---|---|---|---|---|
| dana | build | done-with-trouble | 81 |  | 2.1 | Seven files added in one go, but the list stayed empty until I saved the show; numbers typed then Tab were lost and had to be redone with Enter. |
| dana | house | done-with-trouble | 52 |  | 2.5 | Loop found on the Audio tab after looking in Time & Loops. The fade cue needed its target chosen and its To level typed before it reported a real fade. |
| dana | trim | done | 11 |  | 0 | Start at 12, End at 40, Fade out 5 on one line; duration became 0:28.0 and it played from 0:12. I could not check the fade-out itself (rig). |
| dana | follow | done | 6 |  | 0 | auto-follow plus Post-wait 3; confirmed in the run: 3 seconds of silence, then Lantern with no GO. |
| dana | level | done | 9 |  | 0 | Level -4 on the Audio tab; plays at -4.0 dB. Not visible in the list. |
| dana | save | done | 1 |  | 0.2 | Saved as Tides tour.ecshow on the desk (it copies the music in). Reopening the app brought the show back exactly. |
| dana | rehearse | done | 15 |  | 0.4 | Load to Time 0:30, GO, stop, and again. Works only in Edit mode. |
| dana | perform | done | 27 |  | 2.4 | Show mode locked delete and rename. House loop, 8 s out, Tide, Salt at -4, Undertow from 0:12, Driftwood into Lantern, Bows all sounded as expected; moved on with the Active cues bar "Click to skip there". |
| dana | help | done-with-trouble | 4 |  | 0.2 | No Help menu; found Settings > Keys: GO Space, Panic Esc (again: stop dead), playhead ↑ ↓. |
| marcus | bring | done | 3 |  | 0.2 | Import from QLab opened all 18 cues with a plain list of what did not come across: slices kept as markers without counts, Devamp only for whole-file loops, MIDI/Mic/Timecode turned into Memos that do nothing. It said nothing about output routing or the click's level. |
| marcus | click | not-possible | 13 | 2 | 0.6 | There is one output device for the whole app and buses are only faders; no cue or bus can be sent to outputs 3 and 4. The click cues came in at -inf dB, so the rule is kept only because the click is silent everywhere. Raise it and it goes to the house with the track. |
| marcus | vamp | done-with-trouble | 15 |  | 2.3 | Made a loop region 0:16-0:24 from the imported markers; it does not loop until you click its block in a strip that appears while the track plays. The track then went round three times and left cleanly at the end of the pass when I clicked the block again. But the click cue kept running straight on, and GO on the Devamp cue did nothing. |
| marcus | counted | not-possible | 5 |  | 0.3 | A loop region has no play count: it is hold until clicked. The import report said the counts were dropped, so I knew before a run. |
| marcus | rehearse | done | 15 |  | 0.5 | Cmd+T, 25, Enter, Space: track and click both from 0:25, 'LOADED TO 0:25.0' beside GO. Repeating is Esc, select 20, Cmd+T, 25, Enter, Space; the time is not remembered. |
| marcus | renumber | done | 8 |  | 0.3 | Select 30 to 33, Cmd+R, Start at 300: 300-305 in one go, targets of the Devamp/Load/Fade followed. |
| marcus | levels | done-with-trouble | 26 |  | 1.3 | Typed -9 in the Level field while it played; heard at -9 at once, '8 unsaved' chip appeared, and it was -9 after saving and playing again. Trouble: could not select the running row by clicking it where it normally is, and the first save into a folder stopped the track. |
| marcus | panic | done | 23 |  | 1.5 | Esc fades over 2 s, Esc again is silence. Playhead is left on the next cue, so back to the top of the number is Up three times (through the group's children), then Space. |
| priya | bring | done | 3 |  | 0.2 | Import from QLab on the start card opened the workspace and showed a list of exactly seven things that did not come across, each named by cue number and by its QLab type. '1 broken' in the status bar took me straight to the broken fade. |
| priya | verify | done | 11 | 1 | 0.9 | Rain bed looped at -12 dB, Q3 took it to -22 under the thunder and back after 6 s over 3 s, Q5 stopped the phone. Matches what I built. |
| priya | repair | done-with-trouble | 115 | 7 | 5.4 | Preshow: Walk-in 2 given a 40 s pre-wait, two fades and a Stop on the group (playlist loop is gone). Blackout: Cmd+G then 'Fade & stop others 3 s'. Act 2: could not move the child out of the group by drag, cut/paste or right-click; rebuilt it as a new cue and deleted the old one. MSC: cannot be done (MIDI is 'planned'); the LX op takes their own GO. The window stopped responding once and I had to save from the menu and restart. |
| priya | notes | done-with-trouble | 38 |  | 0.8 | All six done. D did not disarm Q4 (used the Armed switch). File swap kept the level and copied the new file into the show folder. |
| priya | save | done | 2 |  | 0.2 | Save Show As made 'The Glass Orchard.ecshow' on the desk with show.json, media/ (every sound, referenced by relative path) and versions/. Some files were copied more than once. |
| priya | run | done | 17 |  | 1.6 | Show mode locks editing and says so. Ran 0.5 to 7; the disarmed Q4 was announced ('DISARMED — this GO will skip it'). Fired Q7 early, stopped it with its ■ in Active cues (a hard cut), Up Up to put the playhead back, and the real GO ran clean. |
| priya | undo | done | 10 |  | 1.3 | No version existed from before 6.5 and Undo is in order, so undoing back to it would have taken the letter swap and the disarm with it. Deleted the cue and saved; the version note read '6.5 Door, a memory removed' and the other notes were intact. |

## Findings

### Blocker (2)

- **No output routing: the click cannot be sent to outputs 3 and 4, away from the house** (marcus, audio, missing, task click)
  - Expected: A device patch with outputs per cue, as QLab has: tracks on 1-2, click on 3-4 of the eight-output interface.
  - Happened: Settings > Audio has one 'Output device' ('Where the show's sound goes on this computer') and buses that are faders only ('Every Audio cue plays on a bus; each bus has a fader in the mixer'). The cue's Audio tab has Level and Bus, nothing about outputs. Nowhere does it say in words that routing is not there; I worked it out by not finding it. The manual says nothing either.
  - Steps: Import Songbook.qlab5, select 'Opening click', Audio tab; then the mixer's gear (Settings > Audio).
  - Suggestion: Until buses can be patched to device outputs, say so on the Audio settings page and in the import report.
  - Pictures: [011.png](shots/marcus-011.png)
- **Holding a loop region loops the track but not the click in the same group, so they drift apart** (marcus, audio, bug, task vamp)
  - Expected: Track and click in one group vamp together; in QLab both cues have the same slices and one Devamp releases both.
  - Happened: With 'Slice 2' held on Opening track, hear gave 'Opening track ... 0:17.3 of 0:48.0, held in a loop' and 'Opening click ... 0:41.3 of 0:48.0'. Same in the Finale: track 0:26.8 held, click 0:36.8. The click cue had no markers or region of its own and there is no way to hold two cues with one action. (The click was also silent, see the import finding, but its position is what matters.)
  - Steps: Import Songbook.qlab5. Opening track > Time & Loops > Make from markers. Select 10, Space. Click the running 'Opening track' row on its name, click the 'Slice 2' block in the strip, wait past 0:24, compare the two times in Active cues.
  - Pictures: [021.png](shots/marcus-021.png), [057.png](shots/marcus-057.png)

### Major (11)

- **Sounds added to a new, unsaved show do not appear in the cue list until the show is saved** (dana, import, bug, task build)
  - Expected: After New show > Audio > choosing seven files, seven cues in the list, as QLab does on an untitled workspace.
  - Happened: The top bar said "7 unsaved" and Undo read "Undo add 7 sounds", but the list still said "No cues yet" and the footer "0 cues". A second try with one file gave "8 unsaved", still "No cues yet". Only after Save (to a folder on the desk) did all eight rows appear at once, including the duplicate "01 Tide-2" I then had to delete. Nothing on screen said a save was needed.
  - Steps: Start the app. New show. Click ♪ Audio, choose any wav. Look at the list: "No cues yet", chip says "1 unsaved". Save the show to a folder: the cue appears. (Seen twice in one session: 7 files, then 1 file.)
  - Suggestion: Show the cues at once in an unsaved show, or ask for a folder before the first sound is added.
  - Pictures: [004.png](shots/dana-004.png)
- **An imported click cue arrives at -inf dB and the import report does not mention it** (marcus, import, bug, task click)
  - Expected: The click was at level on outputs 3-4 in QLab. Either it comes in audible, or the report tells me its routing was dropped and it is now silent.
  - Happened: All three click cues have Level '-inf'; Active cues shows '−∞' and hear shows '-60.0 dB'. The import report lists slices, Devamp, MIDI, Mic and Timecode but nothing about outputs or levels. A band would have started the Opening with no click. I cannot tell whether this is the importer reading the level of outputs 1-2 or something in my workspace.
  - Steps: Import Songbook.qlab5, OK, Space on cue 10, look at Active cues: 'Opening click' shows −∞.
  - Suggestion: Add a line to the import report for every cue whose output routing was dropped.
  - Pictures: [003.png](shots/marcus-003.png)
- **Rows of running cues lose their columns in the cue list** (priya, cue-list, bug, task run)
  - Expected: A running cue stays a normal row (number, name, target, times) with a running mark, as in QLab.
  - Happened: As soon as a cue runs, its row collapses: the name jumps to the far left edge, the number, icon, target and duration disappear, and the row is a different height from its neighbours. With the thunder group running, four rows in a row looked broken. Seen in Show mode (095.png) and in Edit mode (102.png).
  - Steps: Import the workspace, click cue 2 Rain bed, press Space, look at row 2.
  - Suggestion: Keep the row's columns when it is running.
  - Pictures: [095.png](shots/priya-095.png), [102.png](shots/priya-102.png)
- **A cue cannot be moved: no drag, no cut and paste, nothing on right-click** (priya, cue-list, missing, task repair)
  - Expected: Drag a cue out of a group or to another place, or Cmd+X / Cmd+V it, as in QLab.
  - Happened: Dragging 'Thunder, close' out of its group did nothing (twice). Cmd+X then Cmd+V on another row did nothing. Right-click showed nothing. The manual says nothing about reordering. I rebuilt the cue from its file and deleted the original, and lost its trimmed length (0:07.5 became 0:08.0). The drag may be the test rig; cut and paste are in the Edit menu and did nothing to cues.
  - Steps: Import the workspace, select the child 'Thunder, close' in cue 12, press Cmd+X: the row stays.
  - Suggestion: Make cut, copy and paste work on cues, and say in the manual how to reorder.
  - Pictures: [043.png](shots/priya-043.png)
- **The window stopped taking clicks and keys after a right-click on a cue** (priya, cue-list, bug, task repair)
  - Expected: A context menu, or nothing.
  - Happened: After closing Settings and right-clicking the row 'Thunder, close', no row could be selected, Versions would not open, the arrow keys and typing went nowhere, Esc did nothing. The menu bar still worked: File ▸ Save Show As… saved everything, and after restarting the app the show was whole. Seen once; it may be an OS context menu the test rig cannot see or dismiss, so I am not sure this is the app.
  - Steps: Not repeated. Open Settings (Cmd+,), close it, right-click a child cue row.
  - Suggestion: Check what right-click on a row opens.
  - Pictures: [049.png](shots/priya-049.png), [054.png](shots/priya-054.png)
- **A Fade cue with To level left as the grey "-inf" does not fade: it holds the level, then cuts** (dana, audio, bug, task house)
  - Expected: The To level box shows "-inf", so I took it as already set to fade to silence over my 8 seconds.
  - Happened: With target House music, Duration 0:08.00, Stop target when done on, and To level untouched, `hear` reported "House music at 0.0 dB (fading to NaN dB)" through the whole 8 seconds, then "Silence." After I typed -inf into the box myself it reported "fading to -60 dB". I cannot hear the rig, so I am not certain the sound really stays at full level, but the target is "NaN" until the box is typed in.
  - Steps: Add an audio cue, add a Fade, choose the audio cue as Target, set Duration 8, leave To level alone. GO the audio, GO the fade, hear: "fading to NaN dB". (Run three times.)
  - Suggestion: Make the shown -inf the real default value.
  - Pictures: [020.png](shots/dana-020.png)
- **No counted vamp: a loop region cannot play four times and go on** (marcus, audio, missing, task counted)
  - Expected: A play count per slice, as in QLab.
  - Happened: Time & Loops shows 'Slice 2 · 0:20.0 – 0:30.0' with only a × beside it. The import report said plainly 'had 3 slices: kept as markers, without their play counts'. There was also no marker at 0:38 for the end of the bows vamp.
  - Steps: Import, select Finale track, Time & Loops, Make from markers.
  - Pictures: [003.png](shots/marcus-003.png)
- **A Devamp cue does nothing to a held loop region, and says nothing** (marcus, transport, missing, task vamp)
  - Expected: GO on 'Out of the vamp' ends the vamp at the end of the pass. It is the cue the MD's whole Opening depends on.
  - Happened: With the track 'HOLDING', Space on 11 'Out of the vamp' moved the playhead to 12 and the track stayed 'held in a loop' and went round again. Same with 303 in the Finale. The import report did warn 'a Devamp here ends a whole-file loop after its pass; slices are not here yet', but at the moment of GO nothing on screen says the cue had no effect.
  - Steps: As the finding above, then press Space with 11 standing by while the region is held.
  - Suggestion: Let Devamp release a held region on its target.
  - Pictures: [023.png](shots/marcus-023.png)
- **Leaving a vamp is a mouse click on a small block, not a GO** (marcus, transport, missing, task vamp)
  - Expected: Vamp starts by itself when the track reaches it and I leave with the space bar, hands near the keyboard.
  - Happened: The region only loops if I click its block before the track gets there ('Click to hold the track in this section'), and I let go by clicking '⟳ Slice 2' again ('Holding here: click to let go'). The block only shows when that track is the one selected; when the selection moved to the click, the strip showed the click and the block was gone. Miss the click before bar 9 and the track plays straight through, which is what happened on my first pass.
  - Steps: Make a region, GO the group without clicking anything: the track plays through 0:24.
  - Pictures: [021.png](shots/marcus-021.png), [057.png](shots/marcus-057.png)
- **No MIDI Show Control: the cue that fires the lighting desk becomes a Memo** (priya, network, missing, task repair)
  - Expected: Q9 sends an MSC GO to the lighting desk, as in QLab.
  - Happened: Import said '9 LX console GO (MSC): was a MIDI cue: kept as a Memo that does nothing.' Settings ▸ Modules lists 'MIDI … planned: Note, CC, Program Change and MSC in and out'. Only OSC to an Eos-family desk exists. The import was honest about it; the show loses the link.
  - Steps: Import a workspace with a MIDI cue; open Settings ▸ Modules.
  - Suggestion: Until MIDI exists, let the import offer to turn the cue into a Light cue or a Network cue to the desk.
  - Pictures: [002.png](shots/priya-002.png), [035.png](shots/priya-035.png)
- **Saving the show into a new folder stops everything that is playing** (marcus, files, bug, task levels)
  - Expected: Saving never touches playback. I changed a level during the number and pressed Cmd+S.
  - Happened: First Cmd+S on the imported show (it asks for a folder): the Ballad was at 0:29, afterwards hear said 'Silence.', Active cues 'Nothing is running', playhead back on 10. Did it again with File > Save Show As… at 0:16: silence again. A plain Cmd+S on an already-saved show did not stop the sound.
  - Steps: Import Songbook.qlab5, select 20, Space, Cmd+S, give a folder. Or on a saved show: play, File > Save Show As…, give a new folder.
  - Pictures: [040.png](shots/marcus-040.png), [046.png](shots/marcus-046.png)

### Minor (15)

- **Playlist group has no equivalent: the walk-in music cannot loop or run in order by itself** (priya, import, missing, task repair)
  - Expected: Preshow plays one track after another and goes round until I fade it.
  - Happened: '0.5 Preshow music: was a Playlist group: here every group fires all its children together.' Both walk-ins would have played on top of each other. I gave the second a 40 s pre-wait by hand; a Group has no loop, so the preshow is 80 s long and then silent.
  - Steps: Import a workspace with a Playlist group and fire it.
  - Suggestion: On import, set each child's pre-wait to the sum of the ones before it, and say so.
  - Pictures: [002.png](shots/priya-002.png)
- **The row of the cue that is playing shrinks to a small tag at the left edge of the list** (dana, cue-list, bug, task perform)
  - Expected: The playing cue stays a full row, marked as playing, so I can see where I am in the running order.
  - Happened: With Bows playing in Show mode its row was a small box reading only "Bows" at the far left, with no number or time, where the other rows are full width. Seen in one picture; in the text the live row always sat at x=17 instead of with the others, so it may be every time.
  - Steps: Open a show in Show mode, GO the last cue, look at its row.
  - Pictures: [045.png](shots/dana-045.png)
- **Clicking the middle of a Fade row with no name does not select it; the inspector stays on the previous cue** (dana, cue-list, confusing, task house)
  - Expected: A click anywhere on a row selects that cue and the inspector shows it.
  - Happened: I clicked the Fade row in its name area and went to the inspector to type the level. The inspector was still Tide's, and my "-inf" went into Tide's File box: "Its file is missing." Clicking the row near its left edge did select it. The unnamed Fade row shows an open name box that swallows the click.
  - Steps: Add a Fade and leave it unnamed. Select another cue. Click the Fade row around the NAME column. The inspector does not change.
  - Pictures: [030.png](shots/dana-030.png)
- **Rows of running cues collapse in the list and cannot be clicked where they were** (marcus, cue-list, bug, task levels)
  - Expected: A running cue's row looks like the others with a countdown, and clicking it selects it.
  - Happened: While a group plays, its row and its children lose number, icon and time columns; only the name shows, pushed to the far left ('▾ Ballad', 'Ballad track', 'Ballad click'). Clicking the row in the middle selects nothing and the inspector says 'Select a cue to see its settings.' Clicking on the name at the left works. Seen on the Opening, the Ballad and the Finale. The list also scrolls when the group starts, so the row I aimed at had moved.
  - Steps: Import, select 20, Space, look at rows 20 and its children; click 'Ballad track' at the middle of the row.
  - Pictures: [021.png](shots/marcus-021.png), [037.png](shots/marcus-037.png), [057.png](shots/marcus-057.png)
- **D does not disarm the selected cue** (priya, cue-list, bug, task notes)
  - Expected: The manual's key table says 'D: Arm or disarm it'.
  - Happened: Clicked cue 4, pressed D: the row did not dim, no unsaved dot, the Armed switch in Basics stayed on. Tried again with the cue selected: the same. The Armed switch itself worked.
  - Steps: Import the workspace, click cue 4, press D, look at Basics ▸ Armed.
  - Pictures: [086.png](shots/priya-086.png)
- **Grouping with Cmd+G throws the selection and the playhead to the top of the list** (priya, cue-list, bug, task repair)
  - Expected: The new group is selected so I can set it up at once.
  - Happened: After Cmd+G on cue 13 (and naming the group), the inspector showed '0.5 Preshow music' and Standing by was 0.5. I had to scroll back down and find the new group. Happened both times I grouped.
  - Steps: Select cue 13, press Cmd+G, type a name, Enter; look at the inspector.
  - Pictures: [067.png](shots/priya-067.png), [070.png](shots/priya-070.png)
- **A cue Number typed and left with Tab is thrown away, and the old text stays in the box for the next cue** (dana, inspector, bug, task build)
  - Expected: Type the number, Tab to Name, type the name: both kept. That is how every form works.
  - Happened: Typed 0, Tab, typed "House music", Enter. The name was kept, the NUMBER column stayed blank though the box still read "0". Selecting the next cue and typing 1 made the box read "01"; again nothing in the list. Typing the number and pressing Enter does keep it.
  - Steps: Select a cue, click Number in Basics, type 1, press Tab. The list shows no number. Select another cue: the Number box still shows the 1. (Twice: cue 0 and cue 1.)
  - Suggestion: Keep a field's value when it loses the keyboard.
  - Pictures: [011.png](shots/dana-011.png)
- **Loop is on the Audio tab, not on the tab called Time & Loops** (dana, inspector, confusing, task house)
  - Expected: The loop switch under "Time & Loops".
  - Happened: Time & Loops has a waveform, Markers and "Loop regions: None. A region is a stretch that loops cleanly…" with no button to make one and no plain loop switch. The Loop switch is on the Audio tab. Once on, the row gets a clear "loop" tag.
  - Steps: Select an audio cue, open Time & Loops.
  - Pictures: [016.png](shots/dana-016.png)
- **A loop region does not say that it will not loop until clicked during playback** (marcus, inspector, confusing, task vamp)
  - Expected: Having made 'Loop regions: Slice 2 · 0:16.0 – 0:24.0', I expected GO to vamp there.
  - Happened: The track played through. The explanation ('the operator can hold the track there') is shown only while there are no regions, and does not say where. The hold strip appeared only after I happened to click a running row.
  - Steps: Opening track > Time & Loops > Make from markers; select 10, Space; wait to 0:30.
  - Pictures: [014.png](shots/marcus-014.png)
- **A Fade cannot target a group, and fading the playing child leaves the group's later children waiting to start** (priya, audio, confusing, task repair)
  - Expected: Fading out and stopping the preshow ends the preshow.
  - Happened: The imported fade was marked 'Targets a Group cue; needs Audio.' I pointed it at Walk-in 1 with 'Stop target when done'. After the fade, hear still showed 'Walk-in 2 is waiting (0:09.5 of 0:40.0)': it would have started on its own half a minute into act 1. It took a second fade and a Stop cue on the group, with a 6 s pre-wait, to make it safe.
  - Steps: Give Walk-in 2 a 40 s pre-wait, target fade 1 at Walk-in 1, GO 0.5, GO 1, wait 7 s, listen.
  - Suggestion: Let a Fade target a Group (all its children, and stop the group).
  - Pictures: [019.png](shots/priya-019.png), [024.png](shots/priya-024.png)
- **Stopping one running cue is a hard cut; there is no fade-out for a single active cue** (priya, transport, missing, task run)
  - Expected: A way to fade just the wrong cue out quickly when I have fired it early.
  - Happened: Active cues offers ❙❙ and ■ per cue. ■ on the early underscore cut it dead. 'Fade all' and Esc would have taken the rain with it. The follower cue (8, Underscore out) carried on waiting after its target was stopped, though the real GO restarted it correctly.
  - Steps: GO cue 2, then GO cue 7; press ■ on 'Underscore: the letter' in Active cues.
  - Suggestion: Make ■ a short fade, or add a per-cue fade-and-stop.
  - Pictures: [097.png](shots/priya-097.png)
- **The first Save As records no version** (priya, files, confusing, task undo)
  - Expected: The manual says 'Every save records a version', so there would be one from before tonight's notes.
  - Happened: After File ▸ Save Show As… into a new folder and a later Cmd+S, Versions listed only the Cmd+S. With no earlier version and Undo strictly in order, there was no way back to 'before 6.5' except deleting the cue by hand. (The Save As was made while the window was stuck, see above; that may matter.)
  - Steps: Import, change something, File ▸ Save Show As…, change something, Cmd+S, open Versions.
  - Pictures: [093.png](shots/priya-093.png)
- **Load to Time does nothing in Show mode and says nothing** (dana, show-mode, confusing, task rehearse)
  - Expected: Picking a track up from a time is a rehearsal thing I do with the show locked; or else a word saying it is not available.
  - Happened: In Show mode ⌘T and Tools > Load to Time… opened no bar and showed no message; only the footer "SHOW MODE — editing is locked". In Edit mode the same command works.
  - Steps: Switch to Show. Select an audio cue. Tools > Load to Time…. Nothing appears. (Tried by key and by menu.)
  - Suggestion: Allow it in Show mode, or grey the menu item.
- **In Show mode a click on a row still moves the playhead, and Reset sits beside Panic** (dana, show-mode, confusing, task perform)
  - Expected: Locked means a stray click cannot change what GO does next.
  - Happened: Show mode did stop Backspace deleting and double-click renaming. But one click on Undertow made it the standing-by cue, and "Reset" ("Stop everything; playhead to the top") is one button below Panic with no confirm that I saw. The mixer knobs stay live too.
  - Steps: Show mode; click any row.
  - Pictures: [041.png](shots/dana-041.png)
- **There is no Help menu; the keys are under Settings > Keys** (dana, help, missing, task help)
  - Expected: A Help menu, or a ? on the window, with the keys and a link to the manual.
  - Happened: The menu bar is App, File, Edit, View, Tools, Window. I found the list by opening the ⚙ and trying "Keys". The list itself is good: "GO Space", "Panic (again: stop dead) Esc", "Move the playhead ↑ ↓". There is no entry called "back one cue"; I took ↑ to be it.
  - Steps: Look through the menu bar for help.
  - Suggestion: Add a Help menu with Keys and the getting-started page.

### Polish (6)

- **The toolbar offers 17 kinds of cue, drawn so dim they look switched off** (dana, cue-list, confusing, task build)
  - Expected: The three or four I know (Audio, Fade, Stop) easy to see.
  - Happened: Group, Audio, Fade, Stop, Start, Pause, Devamp, Load, GoTo, Arm, Disarm, Wait, Memo, Network, Light, Mix, Jump in dark grey on dark brown. "Devamp", "Arm", "Network" and "Jump" are not my words.
  - Steps: New show; look at the toolbar.
  - Pictures: [002.png](shots/dana-002.png)
- **A cue's level is not shown in the list, and a follow is only a small arrow** (dana, cue-list, missing, task level)
  - Expected: To see from the list that Salt is at -4 and that Driftwood goes on by itself.
  - Happened: Salt's -4 dB is only in the inspector's Audio tab (and in Active cues once it plays). Driftwood shows "0:03.0" and a ⤓; standing by on it says "then 5 · Lantern" with no word that Lantern follows without a GO.
  - Steps: Set a level and an auto-follow; look at the list in Show mode.
  - Pictures: [041.png](shots/dana-041.png)
- **A new Fade has no target though it was added with the sound selected** (dana, inspector, confusing, task house)
  - Expected: QLab targets the cue I had selected.
  - Happened: The Fade came in with ✕ and "No target."; I chose "0 · House music" from the list. Clear enough, one extra step. Choosing it also moved every field up a line, so my next click missed.
  - Steps: Select an audio cue, click ◢ Fade.
- **Load to Time forgets the last time** (marcus, transport, slow, task rehearse)
  - Expected: Twenty times a rehearsal from 0:25: the box could offer the last time used for that cue.
  - Happened: Cmd+T opens with an empty box each time ('0:00' placeholder). It is the same count of presses as QLab, no worse.
  - Steps: Select 20, Cmd+T, 25, Enter, Esc, Cmd+T.
  - Pictures: [030.png](shots/marcus-030.png)
- **The same sound is copied several times into the show folder** (priya, files, bug, task save)
  - Expected: One thunder.wav, one door.wav.
  - Happened: media/ holds thunder.wav, thunder-2.wav and thunder-3.wav (same size) and door.wav and door-2.wav, one per cue that used the file. The replaced letter.wav also stays in media/.
  - Steps: Import the workspace, Save Show As, list media/.
- **Welcome card overlaps the empty list's own message** (priya, other, bug, task bring)
  - Expected: One message on an empty show.
  - Happened: 'No cues yet / Drop sound files here…' shows through behind the Endless Cues card and its picture; both are half readable.
  - Steps: Start the app with no show.
  - Pictures: [001.png](shots/priya-001.png)

### Praise (11)

- **The import report is plain about what did not come across** (marcus, import, praise, task bring)
  - One box, five lines, cue numbers and names: 'kept as markers, without their play counts', 'slices are not here yet', 'was a MIDI cue: kept as a Memo that does nothing'. The standing-by line repeats it: '(QLab MIDI cue: not in Endless Cues yet. It does nothing here.)'.
  - Pictures: [003.png](shots/marcus-003.png), [037.png](shots/marcus-037.png)
- **The import report names every loss by cue and in QLab's own words** (priya, import, praise, task bring)
  - Seven lines, e.g. '12 Act 2: the storm returns: was a Start First and Enter group: here every group fires all its children together.' and '13 Blackout: … only a Group can do that here (put it in one).' It is kept in the show's notes, and the status bar's '✕ 1 broken' selects the broken cue. Everything not on the list worked when I ran it.
  - Pictures: [002.png](shots/priya-002.png)
- **Renumber is one step and targets follow** (marcus, cue-list, praise, task renumber)
  - Cmd+R, 'Renumber 6 cues', Start at 300, Step 1: 300 to 305, and the Devamp, Load and Fade then read '301 · Finale track'.
- **Load to Time is exactly what a dancer's "from 0:30" needs** (dana, transport, praise, task rehearse)
  - Tools > Load to Time… (⌘T), typed 0:30, Enter: "LOADED TO 0:30.0" by Standing by; GO played Salt from 0:30 at -4 dB. The second time took four keys. It does not remember 0:30 from the last time.
- **The standing-by line and the save chip say what will happen** (dana, transport, praise, task perform)
  - "Standing by 0 House music — then House out" in large type; "9 unsaved" with the list of what; after saving "Saved v2 — … House out added …"; reopening the app brought the show back as left, playhead at the top. The ↺ "Put back to media/01 Tide.wav" rescued a field I had wrecked.
  - Pictures: [041.png](shots/dana-041.png)
- **Auto-follow with a post-wait did what the choreographer asked, first time** (dana, transport, praise, task follow)
  - Continue: auto-follow, Post-wait 3 on Driftwood. In the run: Driftwood ended, "Lantern is waiting (0:02.3 of 0:03.0)", then Lantern played. Start at / End at / Fade out for Undertow were three boxes on one line and the row's duration became 0:28.0.
  - Pictures: [030.png](shots/dana-030.png)
- **Load to Time works as in QLab, on a group, with the same key** (marcus, transport, praise, task rehearse)
  - Cmd+T, type 25, Enter: 'LOADED TO 0:25.0' beside GO, and Space started track and click together at 0:25. Typing works straight after Cmd+T.
  - Pictures: [030.png](shots/marcus-030.png)
- **Panic, live level and the unsaved chip behave as their labels say** (marcus, transport, praise, task panic)
  - Esc: 'fading to -60 dB' over 2 s; Esc again: silence. Level typed as -9 was heard at -9 at once, a '↺ Put back to −6 dB' appeared beside it, the title bar showed 'N unsaved', and after Save it played at -9. The 'HOLDING — click the block to let go' badge and yellow block are easy to read.
  - Pictures: [057.png](shots/marcus-057.png)
- **QLab hands mostly work** (priya, transport, praise, task run)
  - Space, Esc (fade, then stop), Up/Down, Q, N, Cmd+D, Cmd+G, Cmd+S, Backspace all did what QLab does. A click puts the playhead on the cue. Standing by shows number, name, notes and 'then 8 · Underscore out'; a disarmed cue says 'DISARMED — this GO will skip it'.
  - Pictures: [095.png](shots/priya-095.png)
- **Unsaved changes and versions are described in plain words** (priya, files, praise, task notes)
  - '8 unsaved' chip, a yellow dot on each changed row and field with '↺ Put back to media/letter.wav', and version notes written for me: 'Thunder: level −6 dB · … · 6.5 Door, a memory added'. Save copied the new composer file into the show folder without being asked.
  - Pictures: [086.png](shots/priya-086.png), [100.png](shots/priya-100.png)
- **Active cues says what is playing, how long is left and at what level** (priya, show-mode, praise, task run)
  - Each running cue has its name, time remaining, a bar, its level in dB (the rain showed −22 dB while dipped) and its own pause and stop; a waiting fade is listed with its countdown.
  - Pictures: [095.png](shots/priya-095.png)

## The test rig got in the way

- dana: `hear` shows a cue's set level, not where a fade-out inside the cue has got to, so Undertow's 5-second fade out could not be checked.
- dana: I ran well over the 150 actions (about 390 journal lines with looks, waits and hears): several clicks were sent in batches by position and missed after the layout moved, and had to be redone.
- dana: The run was stopped and restarted once before the first task (the show's own app was open; the owner's go-ahead was relayed).
- marcus: After Space and Esc keys, the first Up arrow once seemed to do nothing; later Up presses worked. Probably keyboard focus in the rig, not reported.
- marcus: Clicking a row by coordinates right after GO sometimes hit the neighbouring row because the list scrolls when a group starts; partly the rig's fixed coordinates, partly the app (noted in the running-rows finding).
- priya: After one right-click the window took no more input until the app was restarted; possibly an OS context menu the rig cannot show or dismiss. Cost about 15 actions.
- priya: A click by name straight after a scroll landed on the wrong row once (cue 14 instead of 13).
- priya: Dragging a row could not be judged: it may not be deliverable by the rig.
- priya: Went over the action budget (about 165 actions) because of the restart.
