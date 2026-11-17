# Usability run 2026-11-15

Four virtual users, each an agent standing in for a person with a show of their own, using the app through its window (`test/users/README.md`). A virtual user is not a person: read this as a list of things to look at, not as a measure of how usable the app is.

## Verdicts

| Person | Would run their show on it | Learn | Speed | Clarity | Trust | Blockers | Major | Minor | Polish | Praise | Actions |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [dana](dana.md) | with-workarounds | 4 | 4 | 4 | 3 | 0 | 2 | 8 | 4 | 6 | 173 |
| [marcus](marcus.md) | no | 4 | 4 | 4 | 2 | 1 | 6 | 1 | 3 | 5 | 107 |
| [priya](priya.md) | with-workarounds | 4 | 3 | 5 | 3 | 0 | 3 | 5 | 3 | 4 | 184 |
| [theo](theo.md) | with-workarounds | 4 | 4 | 3 | 3 | 0 | 4 | 5 | 3 | 4 | 209 |

**dana:** I built the whole evening in one sitting with nobody to ask, and it ran from house music to bows exactly as the notes say, so yes, I would stop borrowing the Mac. What holds me back is that a time I typed was quietly dropped because I pressed Tab instead of Enter, and that in Show mode a stray V still plays a track; I would tape over that key and check every number in the list before a performance.

**marcus:** No. The click has one place to go here, the same stereo output as the tracks, so I cannot keep it out of the house and the band gets no click at all. The vamp itself loops and leaves cleanly, but only by a mouse click on a small block every night, the click track does not go round with it, and my Devamp cue does nothing to it. Rehearsal tools (load to time, renumber, panic) are as fast as QLab; it is the routing and the vamps that send me back.

**priya:** I could run tonight's tech on it: the import told me the truth cue by cue, my hands mostly still worked, and in Show mode I always knew what was playing and what GO would do. But the lighting desk will not get its MSC GO, my preshow playlist is a bodge that started walk-in music under act 1 until I caught it, and I rebuilt a cue because nothing can leave a group. I would take it into tech, not yet in front of a paying house without a full run first.

**theo:** The bytes are right: every message I checked on the wire matched what the screen said, the ramp ended on exactly 1.0, and the show file is plain JSON I can diff. I'd bench it further for The Cellar, but three things would have bitten me at load-in: the lighting desk is configured in two places and the cue ignores the one I edited, Learn threw away the sensor's argument so a closing door fired the sequence, and a failed send looks the same as a good one. I also saw nothing here that tells me it runs on the Linux or Windows box under the staircase; that still has to be proven.

## Tasks

| Person | Task | Outcome | Actions | Refused | Minutes | Notes |
|---|---|---|---|---|---|---|
| dana | build | done | 36 | 1 | 0.6 | Add Sounds… took all seven in order; Renumber and Enter-to-rename did the rest. Names had to be typed whole because the rename box opens empty. |
| dana | house | done-with-trouble | 46 | 1 | 2.7 | Looked for Loop under Time & Loops; it is on the Audio tab. First fade ran 3 s, not 8: the Duration I typed and tabbed out of was dropped. With Enter it was right: 8 s fade, then stopped. |
| dana | trim | done-with-trouble | 15 | 1 | 1.6 | Start at 12, End at 0:40, Fade out 5 went in easily and it played 0:12 to 0:40. The countdown counted to the file's end, and I could not confirm the fade out from the level readout. |
| dana | follow | done | 9 |  | 0.9 | auto-follow and Post-wait 3 on Driftwood; Lantern waited 3 s and played. Standing by does not mention it. |
| dana | level | done | 8 |  | 0.1 | Level −4 on the Audio tab; plays at −4.0 dB. The level is not visible in the cue list. |
| dana | save | done | 7 |  | 0.4 | Save asked for a place, copied the music into the show folder; after quit and reopen everything was as left. |
| dana | rehearse | done | 14 |  | 0.3 | Tools ▸ Load to Time… 0:30, GO; and again (retyping 0:30). Show stayed Saved. |
| dana | perform | done-with-trouble | 30 |  | 2 | Show mode locked editing and the evening ran correctly end to end. But V still plays the selected cue and a click moves the playhead; Reset does ask first. |
| dana | help | done-with-trouble | 8 |  | 0.4 | No Help menu. Found Settings ▸ Keys: Space, Esc (twice: stop dead), ↑. The website's list differs on two keys. |
| marcus | bring | done | 3 |  | 0.2 | Import from QLab opened all 18 cues with levels, groups and targets, and a plain list of what did not come: click routing, slice counts, slice devamps, MIDI, Mic and Timecode cues. |
| marcus | click | not-possible | 4 |  | 0.3 | Settings > Audio has one output device and buses that are only faders. The click cues arrive at -inf on the same output as the tracks: silent, so nothing leaks, but there is no way to send click to 3/4 only. |
| marcus | vamp | done-with-trouble | 14 | 1 | 1.5 | Made a loop region from the imported markers, clicked it to hold, went round twice, clicked it again and it left at the end of the pass (0:24) cleanly. But GO on my Devamp cue did nothing, the click track ran on without looping, and the hold is a mouse click each time. |
| marcus | counted | not-possible | 13 |  | 1.4 | A loop region has no play count. The import report said so. I would count four passes and click the block myself. |
| marcus | rehearse | done-with-trouble | 31 | 1 | 0.7 | Cmd+T on the Ballad group, 25, Enter, Space: track and click both start at 0:25. Doing it again cost wrong steps: arrow keys left the playhead on a Memo and GO played silence, twice; the reliable way is click the group row, Cmd+T, 25, Enter, Space. |
| marcus | renumber | done | 7 |  | 0.2 | Shift-selected the Finale cues, Cmd+R, Start at 300: 300-305 including the two children, as QLab would. Targets followed the new numbers. |
| marcus | levels | done-with-trouble | 16 | 1 | 0.6 | Typed -9 in the track's Level while it played and heard it change at once; Cmd+S saved to a folder with the audio copied in; reopened and it was still -9. First try went into the wrong cue's Notes because the list had moved when playback started. |
| marcus | panic | done | 19 | 2 | 0.6 | Esc faded, second Esc was silence. Cmd+J, 300, Enter put the Finale standing by; GO started it from the top. |
| priya | bring | done | 3 |  | 0.2 | Import from QLab on the first screen; one dialog listed the seven things that did not come across, by cue number, in plain words, and the footer said '1 broken'. |
| priya | verify | done | 8 | 1 | 0.6 | Space on cues 2 to 5: rain loops at -12 dB, dips to -22 under the thunder, comes back after 6 s over 3 s, phone stops on cue 5. Matches the QLab show. |
| priya | repair | done-with-trouble | 113 | 6 | 6 | Preshow fade: two fades, auto-continued (works). Playlist: pre-wait on the second track (plays in order, does not loop, and is not cancelled by the fade-out). MSC: cannot be done. Act 2 group: could not take a cue out of a group, rebuilt 'Thunder, close' as cue 12.5 and disarmed the one inside. Blackout: wrapped in a group with fade & stop others 3 s (works). The window stopped answering once after a right-click and I had to save from the menu bar and reopen (probably the rig). |
| priya | notes | done | 33 |  | 0.9 | All six done in the inspector with N, Q, Cmd+D and typed values. D did not disarm cue 4 as the manual says; used the Armed switch. |
| priya | save | done | 1 |  | 0 | Save Show As made 'Glass Orchard EC.ecshow' with show.json, versions/ and media/ holding every sound, including letter v2.wav. Checked in the folder; the app itself does not list what it copied. Five identical copies of thunder.wav in there. |
| priya | run | done-with-trouble | 19 |  | 2.1 | Show mode is clear and locked. Walk-in 2 started 40 s in, under act 1 (my playlist workaround); stopped it from Active cues. Fired cue 7 early on purpose: stopped it with its ■ (a hard cut, no fade), Up twice put the playhead back, and the second GO restarted its follow-on fade correctly. |
| priya | undo | done | 7 |  | 0.2 | Versions shows every save described in words, but restore is the whole version, which would have lost the other notes. Deleted 6.5 by hand and saved; v3 reads '6.5 Door again (memory) removed' and the other notes are intact. |
| theo | bed | done-with-trouble | 11 | 1 | 1.1 | File > Add Sounds made both cues. Looked for Loop on the 'Time & Loops' tab first; the switch is on the Audio tab. hear confirmed 'looping'. |
| theo | desk | done-with-trouble | 67 |  | 1.6 | Made an ETC Eos patch, then a Light cue with desk cue 12. Nothing was sent until I found the Lighting desk module, which wanted the desk's address a second time. Then /eos/cue/1/12/fire arrived on 8001, correct. |
| theo | raw | done | 15 |  | 0.3 | Resolume patch, Network cue, typed the message. Arrived as /composition/layers/1/clips/2/connect 1 with an int argument. |
| theo | ramp | done | 14 |  | 0.4 | The Resolume 'Layer opacity' command with 'Fade it' wrote '/composition/layers/1/video/opacity #v#'. 127 float messages over 5.0 s (about 29 ms apart), first 0, last exactly 1. |
| theo | sensor | done-with-trouble | 19 |  | 0.5 | Learn captured '/sensor/door' without the 1, so '/sensor/door 0' started heartbeat too. Typing '/sensor/door 1' by hand fixed it: 1 fires, 0 does not. |
| theo | buttons | done-with-trouble | 22 | 1 | 0.9 | OSC control module on; /go, /cue/5/start and /panic all worked. Cues have no numbers by default, so I had to renumber first, and a stuck rename box got in the way of numbering one cue. |
| theo | tally | done-with-trouble | 32 | 1 | 1 | Show feedback module to a Generic OSC patch on 9100. GO sent /endlesscues/go, /cue/1/start, /running 1, /playhead 2. My first two Space presses did nothing because a click on the selected row had opened a rename box. |
| theo | tablet | done | 4 |  | 0.2 | Web remote module: port 8137 with a key in the address. curl on 127.0.0.1 returned 200 and a page titled 'Endless Cues remote'; without the key, 403. The LAN address shown timed out from my terminal (rig, I think). |
| theo | file | done | 3 |  | 0 | 'The Cellar.ecshow' is a folder: show.json (135 lines, indented, defaults left out, media paths relative) plus media/. Yes, I'd keep it in git and review a diff of it. |
| theo | wrong | done-with-trouble | 22 | 1 | 0.5 | Changing the Eos patch to a dead port changed nothing: the cue still reached 8001, because Light cues use the module's own address. With the module on a dead port the cue fired with no error; the only sign is a red 'Lighting desk' chip saying 'desk not answering', which was also there when the message was arriving. |

## Findings

### Blocker (1)

- **Click cannot be sent to its own outputs: one stereo output for everything** (marcus, audio, missing, task click)
  - Expected: Per-cue or per-bus output routing, as QLab's level matrix: tracks to 1/2, click to 3/4 of an eight-output interface.
  - Happened: Settings > Audio: 'Output device: Where the show's sound goes on this computer' (one device) and 'Buses: ... each bus has a fader in the mixer'. No channel choice anywhere. Import says: 'played only on outputs of its own, with its main level down: there is no output routing here yet, so it is silent until you raise its level.' Click cues arrive at -inf; raising them would put click in the house.
  - Steps: Import Songbook.qlab5; select Opening click > Audio tab (Level -inf, Bus Effects); open the mixer's gear (Buses and output).
  - Suggestion: Let a bus choose which device channels it feeds.
  - Pictures: [002.png](shots/marcus-002.png), [006.png](shots/marcus-006.png)

### Major (15)

- **MIDI, Mic and Timecode cues become Memos** (marcus, import, missing, task bring)
  - Expected: The Keys 2 patch change and timecode to the lighting desk to work.
  - Happened: '21 Keys 2 patch change: was a MIDI cue: kept as a Memo that does nothing.' Same for 22 (Mic) and 40 (Timecode). Each Memo's note repeats it: '(QLab MIDI cue: not in Endless Cues yet. It does nothing here.)' Said plainly, which I appreciate, but the show needs them.
  - Steps: Import Songbook.qlab5.
  - Pictures: [002.png](shots/marcus-002.png)
- **No playlist: a preshow cannot play in order and loop round** (priya, cue-list, missing, task repair)
  - Expected: QLab's Playlist group: tracks one after another, looping until faded.
  - Happened: '0.5 Preshow music: was a Playlist group: here every group fires all its children together.' Both walk-ins play on top of each other unless I add pre-waits by hand; then it plays 80 s and goes silent. The Group tab offers only 'Fade & stop others'.
  - Steps: Import the workspace, GO cue 0.5, hear both tracks at once.
  - Pictures: [002.png](shots/priya-002.png)
- **Clicking the already-selected row opens a rename box that swallows Space, so GO does nothing** (theo, cue-list, bug, task tally)
  - Expected: Click the cue I want standing by, press Space, it goes. That is what I do all night in QLab.
  - Happened: Twice. On room tone: clicked the selected row, Space, Space: no GO, nothing on the tally, playhead still on 1; GO with the mouse then worked. On heartbeat: the row showed an empty name box that stayed open while the selection moved to another row, and the number I typed in the inspector did not land. I am not certain a single click (rather than my two clicks in a row) is what opens it.
  - Steps: Select a cue. Click the same row again. Press Space: no GO; the keystroke goes into an inline name field.
  - Pictures: [043.png](shots/theo-043.png), [057.png](shots/theo-057.png)
- **A time typed into an inspector box is thrown away unless you press Enter** (dana, inspector, bug, task house)
  - Expected: Typing 8 in Duration and pressing Tab or clicking the next control keeps it, as in QLab and every other form.
  - Happened: I typed 8 in the fade's Duration, pressed Tab and clicked the 'Stop target when done' switch. The box went on showing '8', but the cue list still said 0:03.0, and on GO the house music was gone within 4 seconds instead of 8. Coming back to the cue, Duration was empty again (grey 0:03.00). No warning. Repeated with 9 after it was set to 8: the box showed '9', the list stayed 0:08.0, and reselecting the cue showed 0:08.00. With Enter it is kept and reformatted ('0:08.00').
  - Steps: New show, File ▸ Add Sounds… one file, click Fade in the toolbar, choose the target, click Duration, type 8, press Tab (or click another control). The DURATION column still says 0:03.0; click another cue and back, Duration is empty.
  - Suggestion: Keep the value when the box loses the keyboard, or visibly put the old value back.
- **No counted loop: a section cannot play four times and go on** (marcus, audio, missing, task counted)
  - Expected: A play count on the slice, as QLab.
  - Happened: A loop region shows only 'Slice 2 · 0:20.0 – 0:30.0'; no count, nothing on right-click. Import said plainly: 'had 3 slices: kept as markers, without their play counts.'
  - Steps: Finale track > Time & Loops > Make from markers; look for a count.
  - Pictures: [002.png](shots/marcus-002.png)
- **GO on a Devamp cue does nothing to a track held in a loop region** (marcus, transport, bug, task vamp)
  - Expected: The imported cue '11 Out of the vamp' (Devamp, target Opening track) leaves the vamp at the end of the pass, as in QLab. The toolbar says Devamp: 'A looping sound finishes its current pass and ends.'
  - Happened: With the track showing 'holding' I pressed GO on 11. The playhead moved to 12, the track stayed 'held in a loop' and went round again. Same with 31 on the Finale. The import report does say 'a Devamp here ends a whole-file loop after its pass; slices are not here yet', but once the app has made me a loop region from those slices, the cue sitting under GO looks like the way out. I may be asking for something it never promised; in a show it is a dead GO in the middle of a vamp.
  - Steps: Import Songbook.qlab5. Opening track > Time & Loops > Make from markers. GO cue 10, click the 'Slice 2' block on the waveform, wait past 0:24 ('holding'), GO cue 11. The track keeps looping. Run twice (Opening with 11, Finale with 31).
  - Suggestion: A Devamp aimed at a track that is holding a region should let go of it.
  - Pictures: [012.png](shots/marcus-012.png), [027.png](shots/marcus-027.png)
- **The click does not go round with the track: after one vamp pass they are 8 s apart** (marcus, transport, missing, task vamp)
  - Expected: Track and click are one number; in QLab both have the same slices and vamp together.
  - Happened: Holding the Opening track's region looped the track only. hear: 'Opening click ... 0:31.4 of 0:48.0' against 'Opening track ... 0:23.4 of 0:48.0, held in a loop'. The click then ended while the track was still vamping. Only the Opening track and Finale track got markers on import, the clicks did not.
  - Steps: As above; after the first loop pass compare the two times in Active cues.
  - Suggestion: Let a hold apply to every Audio cue in the group, or carry the click's slices across too.
  - Pictures: [012.png](shots/marcus-012.png)
- **A vamp has to be switched on by mouse during the number, every performance; no key and no cue for it** (marcus, transport, missing, task vamp)
  - Expected: The vamp is the default: the track loops when it gets there and I press one key to leave.
  - Happened: The region's block says 'Click to hold the track in this section'. If I do not click it before 0:24 the track runs on. After letting go it is back to not holding. Settings > Keys lists no key for hold or let go, and the manual does not mention vamps or loop regions at all.
  - Steps: Make a loop region, GO the cue, do nothing: it plays straight through.
  - Suggestion: An 'always hold' switch on a region and a key (or the Devamp cue) to let go.
- **The block that lets go of a vamp is off screen while another cue's waveform is showing** (marcus, transport, confusing, task vamp)
  - Expected: The way out of a vamp is always in front of me while it is vamping.
  - Happened: With track and click both running, the waveform panel showed '30 · Finale click', which has no region block. The track's row in Active cues showed a 'holding' chip; clicking it and clicking the track's name did nothing. The 'HOLDING — click the block to let go' strip only came back when the click cue had finished.
  - Steps: Finale track > Make from markers. GO 30, click the Slice 2 block, wait until holding. Look at the waveform panel's title.
  - Suggestion: Make the 'holding' chip in Active cues the let-go button.
  - Pictures: [027.png](shots/marcus-027.png)
- **A group child waiting on its pre-wait still fires after the scene has moved on** (priya, transport, confusing, task run)
  - Expected: The import report sent me to pre-waits as the only way to play a playlist in order ('here every group fires all its children together'). I expected fading out the preshow to be the end of the preshow.
  - Happened: With Walk-in 2 on a 40 s pre-wait inside group 0.5, I fired Preshow out at about 10 s. Active cues kept '◷ Walk-in 2 −0:25' and at 40 s it played at −10 dB over the rain in act 1. I stopped it with its ■. Not sure whether this is a bug or just what a timeline group does; either way the playlist workaround is a trap. The proper fix (a Stop on the group) I did not get to.
  - Steps: Group with two Audio children, second with pre-wait 40. GO the group, at 10 s fire a Fade (stop when done) on the first child, wait 30 s.
  - Suggestion: Let a Fade or Stop target the group, or import a Playlist group as an auto-follow chain.
  - Pictures: [076.png](shots/priya-076.png)
- **No MIDI or MSC: the lighting desk's GO cannot be sent** (priya, network, missing, task repair)
  - Expected: A MIDI cue type, as in QLab, so cue 9 fires the LX desk by MIDI Show Control.
  - Happened: Import said '9 LX console GO (MSC): was a MIDI cue: kept as a Memo that does nothing.' The toolbar has Network ('Sends one OSC message') and Light; the manual does not mention MIDI. The desk in this theatre takes MSC only, so the LX operator has to take the GO by hand.
  - Steps: Import a workspace with a MIDI cue; look for any cue type that sends MIDI.
  - Suggestion: Say in the import report what to use instead (OSC to the desk, if it has it) or add an MSC GO.
  - Pictures: [002.png](shots/priya-002.png)
- **The lighting desk is set up in two places, and Light cues ignore the patch** (theo, network, confusing, task wrong)
  - Expected: One definition of the desk. I made an 'ETC Eos family' patch under Settings > Network at 127.0.0.1:8001; a Light cue should send there, as a QLab Network cue sends to its patch.
  - Happened: The Light cue sent nothing until I turned on Settings > Modules > Lighting desk, which said 'no desk address set' and asked for Desk address and Desk OSC port again. Later I changed the patch's port to 8055 and fired LQ 12: /eos/cue/1/12/fire still arrived on 8001. The patch said 'not used yet' throughout. show.json holds both: modules.lighting-desk.host/port and settings.network.patches[0].
  - Steps: New show. Settings > Network > Add a patch > ETC Eos family, address 127.0.0.1, port 8001 (Enter after each). Settings > Modules > Lighting desk on, address 127.0.0.1, port 8001. Add a Light cue, desk cue 12. Change the patch port to 8055. Fire the cue: it still arrives on 8001.
  - Suggestion: Have the Lighting desk module point at a patch, as Show feedback already does.
  - Pictures: [014.png](shots/theo-014.png), [064.png](shots/theo-064.png)
- **Learn stores the OSC trigger without its argument, so /sensor/door 0 fires the cue** (theo, network, bug, task sensor)
  - Expected: Learn to capture what the sensor sent, '/sensor/door 1', or to ask whether the argument matters. The field does accept an argument when typed.
  - Happened: After Learn and sending '/sensor/door 1' the field read '/sensor/door'. '/sensor/door 0' then started heartbeat. Typing '/sensor/door 1' by hand made 0 stop firing it. (Learn itself run once; the firing on 0 seen once before the manual fix.)
  - Steps: Audio cue > Basics > scroll to OSC trigger > Learn. Send /sensor/door 1 to UDP 53000. Field shows '/sensor/door'. Send /sensor/door 0: the cue plays.
- **A Light cue fired with the module off, or at a dead port, gives no sign on the cue that nothing reached the desk** (theo, network, confusing, task wrong)
  - Expected: Something where I'm looking, on the cue or by the GO button, when a cue that should send produced no message, and a status that differs between 'sending fine' and 'nothing there'.
  - Happened: With the Lighting desk module off, auditioning LQ 12 sent nothing and the screen said nothing; only the grey description 'with the Lighting desk module on, fired on the desk' hints at it. With the module on, the title bar shows a red 'Lighting desk' chip, hint 'desk not answering'. That chip read the same while /eos/cue/1/12/fire was arriving on 8001 (my stand-in does not answer pings) and while the port was 8055 and nothing arrived.
  - Steps: New show, Light cue with desk cue 12, press V with the module off: no message, no warning. Turn the module on at a port nothing listens on, press V: same chip as with a correct port and a desk that does not answer /eos/ping.
  - Suggestion: Mark a Light cue as 'not sent' when the module is off, and show the last sent message on the chip so 'sent, no answer' differs from 'off'.
  - Pictures: [014.png](shots/theo-014.png), [025.png](shots/theo-025.png), [065.png](shots/theo-065.png)
- **In Show mode the V key plays the selected cue on top of the show** (dana, show-mode, confusing, task perform)
  - Expected: Show mode says 'editing is locked', and I took it to mean nothing I press by accident can hurt. V is the key directly above the space bar.
  - Happened: In Show mode with house music playing I clicked the Salt row and pressed V: Salt started playing over the house music ('House music at 0.0 dB' and 'Salt at -4.0 dB' together). Done twice, same result. Nothing on screen in Show mode mentions V.
  - Steps: Open a show with two sounds, switch to Show, GO the first, click the second row, press V.
  - Suggestion: In Show mode, leave only GO, Panic, pause and the arrows on single keys, or make the others an option under GO and safety.
  - Pictures: [057.png](shots/dana-057.png)

### Minor (19)

- **Standing by does not say that this GO will carry on into the next cue** (dana, cue-list, confusing, task follow)
  - Expected: With Driftwood standing by, the big display to tell me that Lantern follows by itself after 3 seconds, since that is the one GO in the evening that does two things.
  - Happened: It says '5 Driftwood' and 'then 6 · Lantern', the same words as for any cue where 'then' means my next GO. The only sign is a small ⤓ at the far right of the row and 0:03.0 under POST-WAIT. After it ran, the playhead was correctly on 7 Bows.
  - Steps: Set a cue to auto-follow, put the playhead on it, read the standby area.
  - Suggestion: Say 'then follows into 6 · Lantern after 0:03'.
  - Pictures: [050.png](shots/dana-050.png)
- **Arrow keys leave the playhead on a different cue from the one selected, and Load to Time then loads a Memo** (marcus, cue-list, confusing, task rehearse)
  - Expected: Up arrow moves the playhead back to the Ballad group, as Settings > Keys says ('Move the playhead ↑ ↓'), then Cmd+T loads it.
  - Happened: After Esc the playhead was on 21/22. Clicked 22, Up, Up: the inspector showed the Ballad click (a child of the group) while Standing by still said '21 Keys 2 patch change'. Cmd+T said 'the cue standing by starts this far in; its length is not known', took 25, and GO played silence. Happened on two tries. Clicking the group row first works.
  - Steps: GO cue 20, Esc Esc, click cue 22, press Up twice, Cmd+T, 25, Enter, Space.
  - Suggestion: Load to Time on a cue with nothing to load should say so instead of accepting a time.
- **A cue cannot be taken out of a group** (priya, cue-list, missing, task repair)
  - Expected: Drag the child below the group, or Ungroup, or cut and paste, as in QLab.
  - Happened: To make cue 12 'Start first and enter' I needed 'Thunder, close' after the group. Dragging the row out did nothing (three tries), Cmd+X did nothing to a cue, there is no Ungroup in any menu. I added a new Audio cue after the group, retyped its number, name and start time, and disarmed the original. A new Audio cue added while a child is selected also lands inside the group.
  - Steps: Import; drag 'Thunder, close' from group 12 to below it.
  - Pictures: [050.png](shots/priya-050.png)
- **New cues have no number, so /cue/<number>/start has nothing to address** (theo, cue-list, confusing, task buttons)
  - Expected: Cues numbered as they are made, as in QLab.
  - Happened: All five cues had an empty NUMBER. I selected all and used Tools > Renumber Selected Cues… (which worked well) before the button box could call a cue.
  - Steps: New show, add any cues: NUMBER is empty.
- **The tab called 'Time & Loops' has nowhere to make a cue loop** (dana, inspector, confusing, task house)
  - Expected: To loop the house music I went to the tab with Loops in its name and looked for a tick-box.
  - Happened: Time & Loops shows a waveform, 'Markers' and 'Loop regions: None. A region is a stretch that loops cleanly; the operator can hold the track there when a scene runs long.' with no button to add one. The plain 'Loop' switch is on the Audio tab. Once found it worked first time and the row shows a 'loop' tag.
  - Steps: Select an Audio cue, open Time & Loops.
  - Suggestion: Put the Loop switch (or a pointer to it) on the Time & Loops tab.
  - Pictures: [010.png](shots/dana-010.png)
- **A Fade cannot target a group, so one QLab fade becomes one fade per sound** (priya, inspector, missing, task repair)
  - Expected: Fade the group, as QLab does.
  - Happened: '1 Preshow out: targets a Group cue: a Fade here moves one Audio cue.' and the footer '✕ 1 broken'. The message was clear and the fix took a minute: retarget to Walk-in 1, Cmd+D, retarget the copy to Walk-in 2, auto-continue.
  - Steps: Import; select cue 1.
  - Pictures: [002.png](shots/priya-002.png)
- **Loop is not on the tab called 'Time & Loops'** (theo, inspector, confusing, task bed)
  - Expected: The loop switch under 'Time & Loops'.
  - Happened: That tab has the waveform, Markers and 'Loop regions: None. A region is a stretch that loops cleanly…' with no control to make one. The plain 'Loop' switch is on the Audio tab.
  - Steps: Add a sound, select it, open Time & Loops and look for a way to loop the file.
  - Pictures: [004.png](shots/theo-004.png)
- **Nothing shows or reports that a cue's own fade out is happening** (dana, audio, confusing, task trim)
  - Expected: During the last 5 seconds of Undertow the level beside the cue should be seen to fall, as it does for a Fade cue ('0 → −∞').
  - Happened: With Fade out 0:05.00 and End at 0:40.00, the level beside the running cue read '0 dB' and the rig's ear said 'Undertow at 0.0 dB' at 0:37.3, 0:38.1 and 0:40.0, then silence. I cannot tell whether the fade out is applied and simply not shown, or not applied; in a silent test session this is as far as I can check. A Fade cue, by contrast, reports 'fading to -60 dB'.
  - Steps: Sound with Fade out 5 and End at 0:40; GO; watch the level readout in Active cues over the last 5 seconds.
  - Pictures: [029.png](shots/dana-029.png)
- **Music tracks are put on the bus called Effects** (dana, mixer, confusing, task build)
  - Expected: Seven music tracks added to a new show to come up on Music, since the mixer has a knob called Music.
  - Happened: Every added sound has Bus 'Effects' (options Music / Effects / Vocals). During the run the meter moved on the Effects knob and the Music knob did nothing. If I had reached for Music to turn the show down, nothing would have happened.
  - Steps: New show, Add Sounds…, select a cue, Audio tab: Bus shows Effects.
  - Pictures: [050.png](shots/dana-050.png)
- **The countdown on a trimmed cue counts to the end of the file, not to its End at** (dana, transport, bug, task trim)
  - Expected: Undertow ends at 0:40, so with 0:38.5 on the clock the countdown should say about -0:01.5. The cue list's DURATION column does say 0:28.0.
  - Happened: While Undertow played, Active cues and the cue's row both said '−0:06.5' at '0:38.5 / 0:45.0', and the green bar was short of the end. The sound did stop at 0:40. The waveform in the playing strip does grey out the part after 0:40. Seen on one play (the second); I did not look at the countdown on the first.
  - Steps: Add a 45 s sound, Audio tab: End at 0:40, Enter. GO, and read the countdown near the end.
  - Pictures: [029.png](shots/dana-029.png)
- **Two quick GOs: only one seemed to take, with nothing on screen** (priya, transport, confusing, task run)
  - Expected: Each Space fires a cue, or the screen says a GO was ignored.
  - Happened: Pressed Space for cue 5 and at once for cue 6; afterwards the list was one cue behind where four presses should have put it. Seen once, not repeated; it may be a double-GO guard or my count.
  - Steps: Show mode, press Space twice within a fraction of a second, count the cues fired.
- **Incoming messages in the Monitor are labelled with the wrong device** (theo, network, confusing, task tally)
  - Expected: The sender's address and port, or 'unknown', for a message from something that is not a patch.
  - Happened: The door sensor's '/sensor/door 1' and the button box's '/go', '/panic', '/cue/5/start' are all listed as '← ETC Eos family'. Everything is 127.0.0.1 on this bench, so it probably matched by IP; on the real rig a sensor with no patch would still need its IP shown.
  - Steps: Make a patch at 127.0.0.1. Turn on OSC control. Send /go to UDP 53000 from the same machine. Settings > Network > Monitor.
  - Pictures: [052.png](shots/theo-052.png)
- **The Monitor is only inside the Settings dialog** (theo, network, missing, task tally)
  - Expected: To watch messages while pressing GO, as with a console window beside the cue list.
  - Happened: The Monitor is at the bottom of Settings > Network, a dialog over the cue list. I fired, then opened Settings and scrolled to read it.
  - Steps: Fire a Network cue, then try to see the sent message without leaving the cue list.
  - Pictures: [052.png](shots/theo-052.png)
- **Settings fields kept a typed value only after Enter** (theo, settings, bug, task desk)
  - Expected: Type an address, Tab to the port, type it, close: both kept.
  - Happened: Patch address and port (twice) and the Lighting desk module's three fields (once) showed what I typed after Tab or after clicking another field, but were blank or back to 8000/8001 when I reopened Settings; the module still said 'no desk address set'. With Enter after each field they stuck. This may be the test rig's typing rather than the app: I could not tell.
  - Steps: Settings > Network > add an ETC Eos patch. Click Address, type 127.0.0.1, Tab, type 8001, click the heading. Go to Modules and back to Network: Address empty, Port 8000.
- **In Show mode one click on a row moves the playhead** (dana, show-mode, confusing, task perform)
  - Expected: Locked means the next GO stays what it was unless I move it on purpose.
  - Happened: With house music playing in Show mode I clicked the Salt row; Standing by changed from the fade to '3 Salt'. My next GO would have skipped the house fade and Tide. (QLab does the same in show mode, so this may be intended; it is the thing I would be most likely to do by accident on a trackpad.)
  - Steps: Show mode, GO, click any other row, read Standing by.
- **Stopping one running cue is a hard cut; no way seen to fade just that cue** (priya, show-mode, missing, task run)
  - Expected: After a GO too early, to fade the wrong cue out quickly while the rest keeps playing.
  - Happened: Active cues gives each cue ❙❙ and ■ only. ■ on cue 7 cut it dead. Esc and Fade all take everything, including the rain bed.
  - Steps: Show mode, two cues running, try to fade one of them out.
  - Pictures: [076.png](shots/priya-076.png)
- **There is no Help menu; the key list is inside Settings** (dana, help, missing, task help)
  - Expected: A Help menu in the menu bar, or a '?' on the window, with the keys.
  - Happened: The menu bar is Endless Cues / File / Edit / View / Tools / Window. I found the keys by opening ⚙ Settings and seeing 'Keys' in its list: GO 'Space', 'Panic (again: stop dead) Esc', 'Move the playhead ↑ ↓'. The page is clear and complete once found, and ↑ did go back one cue. The GO button also says SPACE on it; Esc shows only when you point at Panic.
  - Steps: Look through the menus for help; then ⚙ ▸ Keys.
  - Suggestion: Add Help ▸ Keyboard Shortcuts that opens this page.
  - Pictures: [060.png](shots/dana-060.png), [061.png](shots/dana-061.png)
- **The website's key list disagrees with the app's** (dana, help, wording, task help)
  - Expected: The Getting started page and the app to give the same keys.
  - Happened: The website says 'D: Arm or disarm it' and '⌘J: Open the assistant'. The app's Keys page says 'Arm / disarm A', 'Pre-wait · Duration · Post-wait E D W', 'Jump to cue ⌘J', 'Assistant ⌘K'. Someone who learned D from the website would open a Duration box instead.
  - Steps: Compare site/docs 'Keyboard' with Settings ▸ Keys.
  - Pictures: [061.png](shots/dana-061.png)
- **D does not arm/disarm as the manual says** (priya, help, bug, task notes)
  - Expected: Manual, keys table: 'D  Arm or disarm it'.
  - Happened: Clicked the cue row, pressed D: a toast said 'A sound's length is its file's: set Start at and End at on its Audio tab' and the cue stayed armed. Same on the group child 'Thunder, close' and on cue 4 'Phone rings'. The Armed switch on Basics works.
  - Steps: Open a show, click an Audio cue, press D, look at Basics ▸ Armed.
  - Pictures: [051.png](shots/priya-051.png), [070.png](shots/priya-070.png)

### Polish (13)

- **A new Fade arrives broken and unnumbered, and points at nothing** (dana, cue-list, confusing, task house)
  - Expected: A Fade added while the house music cue is selected to target that cue, as QLab does.
  - Happened: The Fade appeared under cue 1 with 'No target.', Target '— choose —', and '✕ 1 broken' at the bottom of the window, with no number. Choosing '1 · House music' from the list fixed it; I numbered it 1.5 with N. The words were clear enough to get me there.
  - Steps: Select an Audio cue, click Fade.
  - Pictures: [013.png](shots/dana-013.png)
- **Renaming a cue that still has its file's name starts from an empty box** (dana, cue-list, confusing, task build)
  - Expected: Enter on '00 house music' to open the box with that text in it so I can fix it.
  - Happened: The box opens empty (the inspector's Name is empty too, though the list shows '00 house music'), so each of the seven names is typed from scratch.
  - Steps: Add a sound, select it, press Enter.
  - Pictures: [007.png](shots/dana-007.png)
- **The cue list jumps when playback starts, so a click aimed at a row lands on another** (marcus, cue-list, confusing, task levels)
  - Expected: Rows stay where they are when I press GO.
  - Happened: When a cue starts, the waveform panel opens and the list scrolls; the Ballad track row moved from y=301 to y=228. My click for the track's Level landed in cue 21's Notes and I typed '-9' there (undone with the undo button). A person watching the screen would see it move; I was going fast.
  - Steps: Scroll so cue 20 is near the top, GO it, watch the rows.
  - Pictures: [040.png](shots/marcus-040.png)
- **After Q on a new group, the name came out 'qBlackout'** (priya, cue-list, bug, task repair)
  - Expected: Q opens the name for typing, as it did on other cues.
  - Happened: Cmd+G on cue 13, then Q, typed 'Blackout', Enter: the group was named 'qBlackout'. Seen once; Q on existing cues worked every other time, so it may be the first Q after Cmd+G.
  - Steps: Select a cue, Cmd+G, press Q, type a name, Enter.
- **Inspector boxes jump when 'No target.' goes away; a label is cut off** (dana, inspector, confusing, task house)
  - Expected: Controls to stay where they are while I fill them in.
  - Happened: After choosing the Fade's target the 'No target.' line vanished and every control moved up a row, so my next click landed on the wrong thing. The switch label reads 'Stop target whe…' on screen.
  - Steps: Add a Fade, choose its target, watch the row of boxes.
  - Pictures: [013.png](shots/dana-013.png)
- **Load to time does not remember the last time** (dana, transport, missing, task rehearse)
  - Expected: For 'again from 0:30', the box to offer 0:30 again.
  - Happened: Second time, Tools ▸ Load to Time… opened empty and I typed 0:30 again. Otherwise fine.
  - Steps: Load to Time 0:30, GO, Esc, select the cue, Load to Time again.
- **No visible way to force an argument's type on a typed message** (theo, network, missing, task raw)
  - Expected: A note by the OSC message field on how to send 1 as a float or as a string.
  - Happened: '1' went as an int (right for this clip trigger) and '#v#' as a float. The placeholder elsewhere is '/address 1 2.5 word'; nothing says how to send a float 1.0 or a quoted string. Not tried further.
  - Steps: Network cue > OSC message field.
- **Unsaved counter stayed at '2 unsaved' after a third change** (marcus, files, confusing, task levels)
  - Expected: 3 after two loop regions and a level.
  - Happened: Chip read '2 unsaved' before and after the level change (undo button read 'Undo level'). Not sure what it counts; seen once.
  - Steps: Make loop regions on two tracks, change a level, read the chip.
  - Pictures: [044.png](shots/marcus-044.png)
- **The show's media folder collects identical copies of one sound** (priya, files, confusing, task save)
  - Expected: One thunder.wav.
  - Happened: media/ holds thunder.wav, thunder-2 to thunder-5.wav (all identical, one of them from a cue I undid) and door.wav, door-2.wav; the old letter.wav stays after the swap. A new cue from thunder.wav was named 'thunder-5'.
  - Steps: Import the workspace, Save Show As, look in media/.
- **Version notes shorten cue names oddly** (priya, files, wording, task undo)
  - Expected: The cue's name.
  - Happened: 'Rain: duration 00:05.00' is the cue 'Rain returns'; 'Thunder,: armed off' is 'Thunder, close'.
  - Steps: Edit an unnumbered cue with a two-word name, save, open Versions.
- **The web remote's key is empty in show.json while the address shows a key** (theo, files, confusing, task tablet)
  - Expected: To know whether the stage manager's bookmark survives a restart of the PC.
  - Happened: Settings shows 'http://192.168.1.59:8137/?k=<key>' with the Key field empty, and show.json has "key": "". I did not restart to see whether the key changes.
  - Steps: Turn on Web remote, save, read modules.web-remote in show.json.
- **Output device list is drawn empty** (marcus, settings, bug, task click)
  - Expected: The chosen device's name in the box.
  - Happened: Settings > Audio > Output device box is blank in the picture, while the bottom bar says 'System default output'. Seen once; may be the test rig's doing since the output is muted.
  - Steps: Open the mixer's gear.
  - Pictures: [006.png](shots/marcus-006.png)
- **The OSC control module does not list the addresses it accepts** (theo, settings, missing, task buttons)
  - Expected: A short list of addresses, or a link, next to the switch.
  - Happened: It says 'QLab-compatible addresses' and offers a passcode. /go, /panic and /cue/5/start happened to be what my button box sends.
  - Steps: Settings > Modules > OSC control.

### Praise (19)

- **Adding the tracks, numbering them and naming them took minutes** (dana, import, praise, task build)
  - File ▸ Add Sounds… brought all seven in in file order with their lengths; Tools ▸ Renumber Selected Cues… numbered them 1 to 7 in one go; Enter renames in the row.
  - Pictures: [010.png](shots/dana-010.png)
- **Import report says exactly what did not come across, before I find out in a run** (marcus, import, praise, task bring)
  - One sentence each for click routing, slice counts, devamps, MIDI, Mic, Timecode; 'The QLab file is not changed'; the list is kept in the show's notes.
  - Pictures: [002.png](shots/marcus-002.png)
- **The import report tells the truth, by cue number, and says what to do** (priya, import, praise, task bring)
  - One dialog: '24 cues in 2 lists', then seven lines, each a cue number, what it was in QLab and what it is here ('13 Blackout … only a Group can do that here (put it in one)'). Every line was accurate when I checked, levels, loops, fades and waits were all right, and the list is kept in the show's notes.
  - Pictures: [002.png](shots/priya-002.png)
- **Auto-follow with a post-wait did the Driftwood into Lantern gap first time** (dana, cue-list, praise, task follow)
  - Continue 'auto-follow' and Post-wait 3 on Driftwood: at the end of Driftwood, 'Lantern is waiting (0:01.5 of 0:03.0)', then Lantern played, and the playhead went on to Bows.
- **Renumber, panic and jump-to-cue are where a QLab hand expects them** (marcus, cue-list, praise, task renumber)
  - Cmd+R with Start/Step, targets shown as '301 · Finale track' afterwards; Esc fades, Esc again stops dead; Cmd+J 300 Enter is back at the top of the number.
  - Pictures: [047.png](shots/marcus-047.png), [050.png](shots/marcus-050.png)
- **QLab hands work: Space, Esc, N, Q, V, Cmd+D, Cmd+G, Cmd+S, arrows** (priya, cue-list, praise, task notes)
  - All of these did what they do in QLab without my reading anything. Selecting a cue stands it by.
- **Standing by, 'then', and the Active cues list say what is happening** (dana, transport, praise, task perform)
  - The big number and name beside GO, 'then 2 · Tide' under it, the running cue with its countdown and bar, and a fade shown as '0 → −∞' with its own countdown. Clicking the running cue's bar skips along it, which let me check each ending.
  - Pictures: [050.png](shots/dana-050.png)
- **Load to time is obvious and leaves the show untouched** (dana, transport, praise, task rehearse)
  - Tools ▸ Load to Time…, 0:30, Enter: 'LOADED TO 0:30.0' beside Standing by, GO played Salt from 0:30 at −4 dB, and the show stayed 'Saved'.
- **Load to Time works on a group with QLab's key and loads track and click together** (marcus, transport, praise, task rehearse)
  - Cmd+T, 25, Enter: 'LOADED TO 0:25.0' beside Standing by; GO started both at 0:25.1. Five presses.
  - Pictures: [030.png](shots/marcus-030.png)
- **A loop region leaves at the end of the pass, cleanly** (marcus, transport, praise, task vamp)
  - 'Make from markers' built the 0:16-0:24 region from the QLab slices in one click; let go at 0:18 and it played to 0:24 and on to 0:27 without a jump.
- **Sent and received bytes matched the screen every time** (theo, network, praise, task ramp)
  - /eos/cue/1/12/fire; /composition/layers/1/clips/2/connect 1 (int); a 5 s ramp of 127 floats from 0 to exactly 1; tally messages /endlesscues/go, /cue/1/start, /running, /playhead. The Monitor showed the same lines with times and direction, and shows a float 1 as '1.0'.
  - Pictures: [052.png](shots/theo-052.png)
- **Device kinds know their equipment** (theo, network, praise, task ramp)
  - The Eos patch gives the desk's own menu path ('Setup ▸ System ▸ Show Control ▸ OSC…'), the Resolume patch defaults to 7000, and the Network cue offers 'Layer opacity' with 'Fade it', which wrote exactly the address I was going to type, with #v# as in QLab.
- **Save put the music inside the show folder and the app reopened the show as I left it** (dana, files, praise, task save)
  - First Save asked where, wrote 'Tour evening.ecshow' with a media folder holding all seven files, and the cues now point at 'media/02 Salt.wav'. After quitting and opening, the show came straight back: loop, 8 s fade with stop, Undertow 0:12 to 0:40 with 5 s fade out, auto-follow + 3 s, Salt −4, all there.
- **A level typed while the cue plays is heard at once, and Save brings the audio into the show folder** (marcus, files, praise, task levels)
  - hear went from -6.0 to -9.0 dB on Enter; Cmd+S asked for a place once, copied the six wavs into Songbook.ecshow/media; reopened: -9.
  - Pictures: [044.png](shots/marcus-044.png)
- **Unsaved changes are counted and marked, and each save is described in words** (priya, files, praise, task undo)
  - '5 unsaved' in the top bar, a dot on each changed cue, and Versions reads 'Thunder: level −6 dB · … · 6.5 Door again (memory) added'. Save As carried every sound file into the show folder.
  - Pictures: [072.png](shots/priya-072.png)
- **The show file is small, readable, diffable JSON** (theo, files, praise, task file)
  - show.json: 135 indented lines, one field per line, only non-default fields on each cue, patches referred to by id, media as relative paths inside the .ecshow folder. The unsaved chip counts changes before a save.
  - Pictures: [061.png](shots/theo-061.png)
- **Modules page answers 'can it do X' in one screen** (theo, settings, praise, task tablet)
  - OSC control, Lighting desk, Web remote and Show feedback are four switches with one line each, their status shows as chips in the title bar ('listening on UDP 53000 · 3 received, last /panic'), and what is not built yet is listed as 'planned'. The web remote refuses a request without its key (403).
- **Reset asks 'Sure? Reset' while something is playing** (dana, show-mode, praise, task perform)
  - With a cue playing the button turned into 'Sure? Reset' and nothing stopped. With nothing playing it just goes to the top.
  - Pictures: [059.png](shots/dana-059.png)
- **The standby line and Active cues say exactly what is happening** (priya, show-mode, praise, task run)
  - Big cue number, name and notes, 'then 8 · Underscore out'; for a disarmed cue 'DISARMED — this GO will skip it'; Active cues shows each sound's level in dB, time left, and waits counting down (which is how I caught the stray walk-in). After a wrong GO, Up moved the playhead back and re-firing restarted the follow-on fade's wait.
  - Pictures: [072.png](shots/priya-072.png), [076.png](shots/priya-076.png)

## The test rig got in the way

- dana: Clicking by coordinates meant a control that had moved (the Fade tab after choosing a target) took a click meant for another; a person would have seen it move. One stray 'n1.5' got typed into a cue name during that muddle and I could not reproduce it, so it is not reported.
- dana: No sound, so whether an Audio cue's own fade out is audible could not be judged; the finding is about what the screen shows.
- marcus: Clicking a row by its place from an older look missed twice after the list had scrolled; I could not see it move as a person would.
- marcus: The first Up key press without clicking a row first appeared to go nowhere (window not in front).
- priya: After a right-click on a cue row the whole window stopped taking clicks and keys (GO included) while the show clock kept running; the menu bar still worked, so I saved, stopped and restarted. A drag alone did not bring it back, so I take it for a native context menu the rig cannot answer. If it is not the rig, it is a blocker. Shots 027.png to 036.png.
- priya: The cue list scrolls to follow the playhead, so coordinates from an earlier look went to the wrong row several times; clicking by name is safer.
- priya: Dragging a row may not be something the rig can do; the 'cannot take a cue out of a group' finding rests also on there being no menu or key for it.
- priya: I went over the action budget (about 230 actions), mostly from the restart and mis-aimed clicks.
- theo: The web remote's LAN address (192.168.1.59:8137) timed out from the terminal though the app listens on all interfaces; 127.0.0.1 worked. Probably the test shell's network limits.
- theo: The stand-in desk never answers /eos/ping, so 'desk not answering' showed even when sending was correct; this colours the 'wrong' task.
- theo: Possibly the rig: typed text in Settings fields is committed only by Enter, not by Tab or clicking away (reported as a finding with that caveat).
- theo: Operator error outside the app: early in the run my command wrapper was overwritten by another session's, so one note ('Looked for Loop under Time & Loops…'), one failed click and two looks went to the dana session instead of mine. Nothing in dana's app changed, but dana's journal has a stray note from Theo.
