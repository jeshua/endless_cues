# Usability run 2026-11-15-b

Four virtual users, each an agent standing in for a person with a show of their own, using the app through its window (`test/users/README.md`). A virtual user is not a person: read this as a list of things to look at, not as a measure of how usable the app is.

## Verdicts

| Person | Would run their show on it | Learn | Speed | Clarity | Trust | Blockers | Major | Minor | Polish | Praise | Actions |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [dana](dana.md) | yes | 4 | 4 | 5 | 4 | 0 | 1 | 4 | 4 | 5 | 127 |
| [marcus](marcus.md) | with-workarounds | 4 | 4 | 3 | 3 | 0 | 3 | 5 | 2 | 5 | 130 |
| [priya](priya.md) | with-workarounds | 4 | 4 | 5 | 3 | 0 | 1 | 6 | 2 | 4 | 176 |
| [theo](theo.md) | with-workarounds | 4 | 4 | 3 | 3 | 0 | 3 | 6 | 4 | 6 | 204 |

**dana:** Yes, I would run the tour on this. I built the whole evening in one sitting with nobody to ask, the screen told me in big letters what each GO would do, and the saved folder carries its own music. What I would watch is my own hand in Show mode: a click on the progress bar or on a row still changes things.

**marcus:** It vamps and it leaves the vamp at the end of the pass, with the click going round in step on 3-4 only, and that was the thing I came to find out. But the vamp only happens if I remember to press L after every GO, I could not get a counted vamp to take its count at all, and timecode and the Mic cue are just memos. As a backup machine I would rehearse on it this week; I would not call it show-ready until the vamp holds by itself.

**priya:** The sound side I would run tonight: the import told me the truth cue by cue, the rain, the dip and the phone behaved exactly as in QLab, and the standby line always said what GO would do. What stops it being a plain yes is the one cue that leaves the computer: I had to retype the MSC GO by hand in a syntax I guessed, and the manual itself says MIDI has not been checked against real equipment, so the LX operator takes that cue on their own GO until I have seen the desk respond. About an hour of my evening, not the whole of it.

**theo:** Every message I asked for arrived byte-for-byte as the screen said, the ramp ended on exactly 1.0, and the show file is clean JSON that diffs to one line. I would bench it further. What stops a plain yes: nothing in the app or the manual tells me it runs on Linux or Windows, a tested cue lost its patch when I added a second device, and a dead port looks exactly like a live one everywhere I looked.

## Tasks

| Person | Task | Outcome | Actions | Refused | Minutes | Notes |
|---|---|---|---|---|---|---|
| dana | build | done | 44 |  | 0.6 | New show, Audio, chose all seven files; numbered and named each in the inspector. Puzzled by the Music/Effects bus message. |
| dana | house | done | 12 |  | 1.3 | Whole sound loop switch on Time & Loops; a Fade cue targeted and named itself; 8 s and stop when done. Heard it loop past 0:40 and fade to silence. |
| dana | trim | done-with-trouble | 13 |  | 1 | Looked for Start at / End at on Time & Loops, where the text mentions them; they are on the Audio tab. Then right first time. |
| dana | follow | done | 8 |  | 1 | auto-follow plus Post-wait 3 on Driftwood, a guess that proved right on playing it. |
| dana | level | done | 7 |  | 0.2 | Level -4 on Salt's Audio tab; Audition played at -4.0 dB. Not visible in the list. |
| dana | save | done | 5 |  | 0.3 | Saved to the desk as Autumn tour.ecshow; reopened by itself with everything intact. |
| dana | rehearse | done-with-trouble | 17 |  | 0.7 | Found Load to Time… in the Tools menu. First take fine; the second played from the top until I loaded again. |
| dana | perform | done | 18 |  | 1.8 | Show mode, Reset, then Space through the evening; every GO sounded what Standing by said. Skipped ahead with the Active cues bar. |
| dana | help | done | 3 |  | 0.1 | Help > Keyboard Shortcuts: Space, Esc, and ↑ ('Move the playhead'). |
| marcus | bring | done | 3 |  | 0.3 | Import from QLab on the first screen; 18 cues, groups, fades, devamps and targets came across with the audio. The report said plainly what did not: click levels, slice counts, MIDI, Mic, Timecode. |
| marcus | click | done | 28 |  | 0.9 | Imported click cues were silent on the Effects bus (1-2). Added a bus, named it Click, sent it to Outputs 3-4, set bus and level on all three click cues in one multi-select. hear reports the click 'on outputs 3-4 only (Click)'. What happens on a machine with only two outputs was not answerable from the screen. |
| marcus | vamp | done-with-trouble | 19 | 2 | 2.1 | Make from markers gave a 0:16-0:24 region, but the first run played straight through it. It only vamps if L (hold next) is pressed after GO. With L: three passes, click in step, and GO on '11 Out of the vamp' finished the pass and played on. |
| marcus | counted | gave-up | 42 |  | 2.2 | The app says a region takes a count, but the count box on the Finale's region would not take '4' in seven tries and a run went straight through 0:30. Also could not place a marker at 0:38 for the bows vamp. |
| marcus | rehearse | done | 14 |  | 0.5 | Cmd+T, 25, Enter, Space: track and click both from 0:25, header says LOADED TO 0:25.0. Again: Esc Esc, Up, Cmd+T, 25, Enter, Space; the time is not remembered. |
| marcus | renumber | done | 7 |  | 0.1 | Select Finale to Finale button, Cmd+R, Start at 300, Renumber: 300-305, targets followed ('301 · Finale track'). The two children got numbers too, as QLab would. |
| marcus | levels | done | 11 |  | 0.3 | Typed -9 in the Ballad track's Level while it played: heard at -9 at once, Active cues shows -9 dB, '11 unsaved' chip. Cmd+S saved to a folder with the audio copied in, without interrupting playback. First click after GO landed on the click cue because the list had scrolled. |
| marcus | panic | done | 6 |  | 0.2 | Esc fades, Esc again is silence. Up puts 20 Ballad back on standby; GO plays it from the top at -9. Three presses. |
| priya | bring | done | 5 |  | 0.3 | Import from QLab on the start screen, one file dialog, and a report listing six things that did not come across, by cue number, each with what to do. 24 cues in 2 lists; all sound files found. |
| priya | verify | done | 16 | 3 | 0.9 | Rain bed loops at -12 dB; cue 3 plays thunder, dips rain to -22 and brings it back after the 6 s wait; cue 5 stops the phone. The Active cues panel and what I heard agreed. |
| priya | repair | done-with-trouble | 73 |  | 2.5 | Playlist: set Shuffle, Repeat and Crossfade again (three fields). Preshow fade: it had come across and worked as it was (fades the group over 6 s and stops it). MSC: made a MIDI cue, guessed 'msc go 9', then read the manual to be sure; cannot know it reaches the desk. Act 2 group: dragged 'Thunder, close' out of the group as its own cue 12.5 (first drop landed one row too low). Blackout: replaced the memo with an empty Group with 'Fade & stop others' 3 s; it took wind and thunder out in 3 s. Hotkey on 11 and the cue cart: not possible, lived without. |
| priya | notes | done-with-trouble | 53 |  | 1.3 | All six done. Level, fade time, file swap (level kept, new duration shown), disarm and the blackout were a field each. The 6.5 copy-paste went wrong once: a Cmd+A outside a field selected every cue and I numbered all 23 of them -10; one Undo put it right. |
| priya | save | done | 2 |  | 0.2 | Cmd+S asked where once and wrote a .ecshow folder with show.json and media/ holding all ten sounds in use, including letter v2.wav. Nothing to collect by hand. |
| priya | run | done | 17 |  | 1.2 | Show mode locks editing and says so. Ran 0.5 to 6.5. The disarmed phone showed 'DISARMED — THIS GO WILL SKIP IT'. Fired 6.5 a cue early; Up arrow put the playhead back on it and the rain bed never flinched. The door is 2 s long so it had finished before I could stop it. |
| priya | undo | done-with-trouble | 10 |  | 0.4 | Undo was greyed out because I had saved, and Versions held only v1 with every note in it, so there was nothing to go back to that kept the other five. Deleted 6.5 by hand and saved v2 with the note '6.5 cut'. |
| theo | bed | done | 8 |  | 2.6 | File > Add Sounds made both cues; 'Whole sound' loop switch under Time & Loops; hear confirmed room tone still playing and 'looping' after 42 s of a 40 s file. |
| theo | desk | done | 67 | 4 | 7.2 | Settings > Network > Add a patch > ETC Eos family, then a Network cue with the 'Fire cue' command builder wrote /eos/cue/1/12/fire. The desk stand-in received exactly that, no arguments. |
| theo | raw | done-with-trouble | 21 |  | 1 | Typed message arrived as /composition/layers/1/clips/2/connect 1 with an int argument. But adding the Resolume patch un-patched the LX 12 cue I had just tested, and the Monitor does not show argument types. |
| theo | ramp | done | 27 | 1 | 0.9 | First try sent one bare message; the app warned 'A duration is set but the message has no #v# to fade'. With #v#: 126 float messages over 5.03 s (about every 34 ms), first 0.0, last exactly 1.0. |
| theo | sensor | done | 17 |  | 0.7 | OSC trigger is under 'More (2)' at the bottom of Basics, below the fold. Learn captured '/sensor/door 1'. door 1 and door 1.0 start heartbeat; door 0 does not. |
| theo | buttons | done | 12 |  | 0.7 | Settings > Modules > OSC control, one switch. /go, /cue/2/start and /panic all did what they say. I had to give heartbeat a number first; added sounds have none. |
| theo | tally | done-with-trouble | 22 |  | 0.6 | Show feedback needs a patch, so I made a Generic OSC one for 9100. GO sent /endlesscues/go, /cue/<n>/start, /running, /playhead. Choosing the patch also sent a stale /go, and a cue with no number is reported by an internal id. |
| theo | tablet | done | 3 |  | 0 | Web remote module: one switch, shows http://<ip>:8137/?k=<key>. curl got 200 text/html with the key, 403 without it or with a wrong one. |
| theo | file | done | 3 |  | 0.2 | Saves a folder 'The Cellar.ecshow' with show.json (139 lines, one field per line, relative media paths), media/ and versions/. Changing one port was a one-line diff. Yes, I would keep show.json in git. |
| theo | wrong | done | 24 | 1 | 0.8 | The app told me nothing. GO on the cue showed '→ /eos/cue/1/12/fire (ETC Eos family)' exactly as when it worked, and the patch's Test said 'sent (no answer heard)', the same words it used when the ping did arrive. |

## Findings

### Major (8)

- **Timecode and Mic cues come across as memos that do nothing; the MIDI message is not read** (marcus, import, missing, task bring)
  - Expected: Timecode to the lighting desk, a Mic cue for the reverb return and a program change to Keys 2, as in the QLab file.
  - Happened: '40 Timecode to the lighting desk: was a Timecode cue: kept as a Memo that does nothing.' '22 Reverb return up: was a Mic cue: kept as a Memo that does nothing.' '21 Keys 2 patch change: was a MIDI cue: its message is not read from QLab yet; kept as a Memo, to be made again as a MIDI cue.' Said plainly at import and again on the cue's notes at standby, which is right. But the backup would not drive the lighting desk, and I did not see a Timecode cue type in the toolbar.
  - Steps: Import Songbook.qlab5 and read the report.
  - Pictures: [003.png](shots/marcus-003.png), [062.png](shots/marcus-062.png)
- **The MIDI Show Control cue is not read from QLab, and the manual says MIDI has not been tried on real equipment** (priya, import, missing, task repair)
  - Expected: The one cue that fires the lighting desk to come across with its device ID, command and cue number, as the audio cues did; or at least to be told what the QLab message was so I can retype it.
  - Happened: Import report: "9 LX console GO (MSC): was a MIDI cue: its message is not read from QLab yet; kept as a Memo, to be made again as a MIDI cue." The memo does not carry the original message's fields, so I rebuilt it from memory. The manual then says "MIDI is new and has been checked against the specification, not yet against equipment." The Network panel did show "→ msc go 9 [F0 7F 7F 02 01 01 39 F7] (MIDI)" when I auditioned it, which is the only evidence I have.
  - Steps: Import a .qlab5 with an MSC MIDI cue; read the report and the cue's notes.
  - Suggestion: Put the QLab message's fields (type, command, Q number, device ID) in the memo's notes even when the cue itself cannot be built.
  - Pictures: [003.png](shots/priya-003.png), [022.png](shots/priya-022.png), [064.png](shots/priya-064.png)
- **The loop region's count box would not take a number** (marcus, inspector, bug, task counted)
  - Expected: The text says 'Give a region a count (3) and the track goes round it that many times by itself, then plays on.' I clicked the box, typed 4, pressed Enter.
  - Happened: The box stayed empty and the Finale played straight through 0:30 (hear: 0:33.3, not held). Tried click, double click, Cmd+A first, Enter, Tab, a single key press: seven attempts on the Finale's 'Slice 2' region. The same typing worked in Level, the bus name and the marker box, so it looks like this box, but I tried it on one region only and cannot rule out the test rig. The box is also about three letters wide: its placeholder reads 'hol'.
  - Steps: Import Songbook.qlab5. Finale track ▸ Time & Loops ▸ Make from markers. Click the small box after 'Slice 2 · 0:20.0 – 0:30.0 ·', type 4, Enter. Look: value is empty. GO the Finale and wait 32 s: no loop.
  - Pictures: [031.png](shots/marcus-031.png)
- **A vamp with no count does not vamp unless L is pressed after every GO** (marcus, audio, missing, task vamp)
  - Expected: A QLab slice with an infinite count goes round by itself until a Devamp. After 'Make from markers' with the count left empty ('Empty: it waits for…') I expected the track to hold at 0:16-0:24 until cue 11.
  - Happened: GO, and the track played through 0:24 to 0:28 with nothing holding it. A chip '⟳ hold next' was in Active cues. The explanation is below the fold of the inspector: 'With no count it does not loop by itself: in the show, press L …'. So every performance needs GO and then L before bar 13, and a forgotten L means the track leaves the stage behind.
  - Steps: Import Songbook.qlab5. Select Opening track ▸ Time & Loops ▸ Make from markers. Select 10 Opening, Space. Wait 26 s: hear says 0:26+, not held.
  - Suggestion: Let a region be set to hold every time until a Devamp or L, as an infinite slice does.
  - Pictures: [023.png](shots/marcus-023.png)
- **Adding a second network patch un-patches every cue that was on 'the only patch'** (theo, network, bug, task raw)
  - Expected: A cue I had fired and checked stays valid when I add unrelated equipment. In QLab a Network cue keeps its patch number.
  - Happened: With one patch the cue's Patch reads 'ETC Eos family (the only patch)' and it sends. After adding a second patch the same cue reads '— choose —', the row gets a ✕ and the footer says 'LX 12: no network patch chosen'. Nothing told me at the moment I added the patch; I only saw it because the footer count went up. Seen twice, in two shows.
  - Steps: New show. Settings > Network > Add a patch > ETC Eos family, address 127.0.0.1. Add a Network cue (Patch shows '(the only patch)'). Settings > Network > Add a patch > Generic OSC. Look at the cue: 'No network patch chosen.'
  - Suggestion: Write the patch id into the cue when there is only one, so it survives a second.
  - Pictures: [028.png](shots/theo-028.png), [079.png](shots/theo-079.png)
- **A send to a dead port looks the same as a good one, and the patch status reads 'sent (no answer heard)' either way** (theo, network, confusing, task wrong)
  - Expected: UDP cannot confirm delivery, I know that. But I expected the patch's Test to tell a live Eos port from a dead one, and the place I look after GO to show me where the message went (host:port), so a wrong port is at least visible.
  - Happened: Port changed to 8099, GO: Network strip and Monitor show '→ /eos/cue/1/12/fire (ETC Eos family)', no port, row not marked. Test: 'sent (no answer heard)' with a grey dot. That is word for word what Test said earlier when my stand-in on 8001 did receive /eos/ping. The Resolume and Tally patches, which I never tested, show 'sent (no answer heard)' too. My stand-in does not answer pings, so I could not see what a real desk's answer looks like.
  - Steps: Eos patch at 127.0.0.1 with a port nothing listens on. Fire a Network cue on it; press Test in Settings > Network.
  - Suggestion: Show host:port on each monitor line, and make 'no answer' look like a warning on device kinds that are known to answer.
  - Pictures: [066.png](shots/theo-066.png), [063.png](shots/theo-063.png)
- **In Show mode one click on a playing cue's progress bar jumps the music, with no confirmation** (dana, show-mode, confusing, task perform)
  - Expected: With the show locked ('SHOW MODE — editing is locked'), nothing I brush with the mouse should change what the audience hears, short of GO and the stop buttons.
  - Happened: In Show mode the bar under the running cue in Active cues ('Click to skip there') moved Tide from 0:01 to 0:45 on a single click. Handy for me in this test, but it sits a few pixels above the pause and stop buttons and beside the mixer. The big waveform at the bottom says 'Click the waveform to mark a place' while the small bar skips; two bars, opposite meanings.
  - Steps: New show, add a sound, switch to Show, GO, click near the right end of the thin bar under the cue's name in Active cues. The sound jumps there.
  - Suggestion: In Show mode, make skipping need a modifier or a second click.
  - Pictures: [044.png](shots/dana-044.png)
- **Neither the app nor the manual says whether it runs on Linux or Windows** (theo, help, missing, task file)
  - Expected: The show lives four months on a small PC under a staircase. I expected the manual or the About page to list the platforms.
  - Happened: Searched the getting-started manual for 'Linux' and 'Windows': no mention. The menus I used are macOS ones (Show in Finder, ⌘ keys). I could not answer the question that brought me here.
  - Steps: Open site/docs/index.html and search for Linux or Windows.
  - Suggestion: State the supported platforms on the first page of the manual.
  - Pictures: [001.png](shots/theo-001.png)

### Minor (21)

- **Six of seven music tracks were put on the Effects bus, and the message about it uses words I don't know** (dana, import, confusing, task build)
  - Expected: All seven files are music; I expected them treated alike, or to be asked.
  - Happened: A message appeared briefly: '1 of 7 added on the Music bus (a sound over a minute long is taken for music; the Bus is on the cue's Audio tab).' Only Salt (1:00) shows 'music' in the TARGET column; the others are on 'Effects'. So the Music knob in the Mixer would turn down only Salt, and the Effects knob the rest of my music. I do not know what a bus is. I left it as it was.
  - Steps: New show, Audio, pick files of which one is 60 s or longer and the others shorter.
  - Suggestion: Ask once on import, or put everything added together on the same bus.
  - Pictures: [004.png](shots/dana-004.png)
- **The import report and the Devamp tooltip say devamp will not do what it does** (marcus, import, wording, task vamp)
  - Expected: To be told whether cue 11 gets me out of the vamp.
  - Happened: The report says '2 cues (11 Out of the vamp; 31 Out of the bows vamp): a Devamp here ends a whole-file loop after its pass; slices are not here yet', one line after saying markers can be made into loop regions. The Devamp tooltip says 'A looping sound finishes its current pass and ends.' In fact GO on cue 11 released the held region at the end of its pass and the track played on. I expected the track to stop or the cue to do nothing, and nearly did not try it.
  - Steps: Import Songbook.qlab5 and read the fourth line of the report; hover Devamp in the toolbar.
  - Pictures: [003.png](shots/marcus-003.png)
- **Imported click cues are silent and on a house bus until three things are done by hand** (marcus, import, confusing, task click)
  - Expected: QLab had the click on outputs 3-4 only; I expected it to arrive on 3-4, or at least on a bus called Click.
  - Happened: Each click cue came in at -inf on the Effects bus, which plays on Outputs 1-2. The report explains it ('silent until you raise its level… give it a bus of its own'), and silent is the safe way to fail, but raising the level before making the bus would put the click in the house. Tracks also landed on Effects, not Music.
  - Steps: Import Songbook.qlab5, select Opening click ▸ Audio: Level -inf, Bus Effects.
  - Pictures: [003.png](shots/marcus-003.png)
- **Hotkey triggers and cue carts are not there** (priya, import, missing, task repair)
  - Expected: Interval music on its hotkey; the rehearsal stings as a cart of buttons.
  - Happened: "11 Interval music: had a hotkey: triggers of that kind are not here yet." and "Rehearsal stings: was a cue cart: imported as a list (carts are not here yet)." Both are said plainly; I can run the interval from the list, and the stings from the second list in the drop-down.
  - Steps: Import the show; read the report.
  - Pictures: [003.png](shots/priya-003.png)
- **After deleting a cue the list jumps to the top and nothing is selected** (priya, cue-list, bug, task repair)
  - Expected: QLab selects the next cue and stays where I am working.
  - Happened: Deleted memo 9, memo 13 and cue 6.5 at different times; each time the list scrolled back to the top rows (Walk-in 1 at the top of the view), the inspector said nothing selected, and after the last one the playhead was on 0.5. I had to scroll back down to find my place each time.
  - Steps: Import the show, scroll so cue 13 is in view, click it, press Delete. The list shows the top of the show again. Seen three times.
  - Suggestion: Select the cue after the deleted one and keep the scroll position.
  - Pictures: [032.png](shots/priya-032.png)
- **No 'Start first and enter' group; the act 2 group fires everything at once** (priya, cue-list, missing, task repair)
  - Expected: QLab's group mode where GO fires the first child and the playhead goes inside the group.
  - Happened: Report: "12 Act 2: the storm returns: was a Start First and Enter group: here a group fires all its children together, or plays them one after another (a playlist)." Left alone, wind and the close thunder would have started together. I dragged "Thunder, close" out and numbered it 12.5; the first drop went one row too far (below 13) and needed a second drag. There is no right-click menu on a cue and no ungroup command that I found.
  - Steps: Import the show; GO on cue 12.
  - Suggestion: On import, flatten such a group into the cues it would have fired, or offer to.
  - Pictures: [003.png](shots/priya-003.png)
- **With the Monitor open the cue toolbar loses Network, MIDI, Light, Wait, Memo and Mix** (theo, cue-list, confusing, task ramp)
  - Expected: To add a Network cue while watching the monitor.
  - Happened: With the Monitor panel open the toolbar ends at Disarm; the rest is cut off with no overflow sign. I thought I had added a cue and typed its name into nothing. Seen once.
  - Steps: View > Network and MIDI Monitor at a 1480-wide window. Look for the Network tool.
  - Suggestion: Wrap the toolbar or add a 'more' menu.
  - Pictures: [028.png](shots/theo-028.png)
- **Time & Loops talks about 'Start at' and 'End at' but those boxes are on the Audio tab** (dana, inspector, confusing, task trim)
  - Expected: A tab named Time & Loops, with a waveform and the sentence 'goes round from Start at to End at', to hold the start and end times.
  - Happened: I scrolled the tab looking for them (only Markers, Loop regions, Whole sound, Play count). They are on the Audio tab, next to Level and Bus, with Fade in and Fade out. Once found they worked first time: 12, 40 and a 5 s fade out gave Duration 0:28.0 and it played from 0:12.1 and faded at 0:35.
  - Steps: Select an Audio cue, open Time & Loops, look for Start at.
  - Suggestion: Show Start at / End at on Time & Loops too, or have the waveform show them.
  - Pictures: [015.png](shots/dana-015.png)
- **One click on the inspector waveform moves where a number starts** (marcus, inspector, confusing, task counted)
  - Expected: Clicking the waveform at 0:38 would place the marker I was naming in the box beside it ('name, at 0:00.0'). The waveform in the playing view says 'Click the waveform to mark a place'.
  - Happened: It set the Finale track's Start at to about 0:38. The only signs were a small ↺ beside Start at on another tab and 'Undo start at'. The line 'Click the waveform to set where the cue starts' was on screen, but the same waveform means something different in the two places, and a stray click in an edit session would start the Finale thirty-eight seconds late.
  - Steps: Finale track ▸ Time & Loops, click the waveform two thirds along, then open the Audio tab: Start at has a ↺.
- **No way found to put a marker at a typed time** (marcus, inspector, confusing, task counted)
  - Expected: The box says 'name, at 0:00.0', so I typed 'Bows end, at 0:38' to mark the end of the bows vamp.
  - Happened: A marker appeared as '0:00.0 Bows end, at 0:38' (and '0:00.0 Bows end 0:38' for the other spelling): the time went into the name. The QLab file only had slices at 0:20 and 0:30, so without a 0:38 marker there is no bows vamp region.
  - Steps: Finale track ▸ Time & Loops, type 'Bows end, at 0:38' in the marker box, Add marker.
- **The MIDI cue's inspector is one empty text box with no example of what to type** (priya, inspector, confusing, task repair)
  - Expected: QLab's pop-ups: Message Type, Command Format, Command, Q Number, Device ID. Or at least a placeholder showing the text form.
  - Happened: A new MIDI cue shows the red bar "No midi message." over a blank field labelled "MIDI message" and a "Note length" field. No placeholder, no example. I guessed "msc go 9" and the red bar went away, then opened the manual to learn it defaults to every device and to lighting. Other fields in the app do have placeholders ("0:00.00", "media/sound.wav").
  - Steps: Select any cue, click ♬ MIDI in the toolbar, look at the MIDI tab.
  - Suggestion: Placeholder such as: msc go 12 dev 3 · note 60 100 · pc 12.
  - Pictures: [022.png](shots/priya-022.png)
- **With many cues selected, typing a Number gives every cue the same number without asking** (priya, inspector, confusing, task notes)
  - Expected: Cmd+A in what I took to be the Number field to select its text. If cues are multi-selected, I would not expect Number to be editable for all of them at once.
  - Happened: The warning bar "Number 6 is used twice." had pushed the inspector's fields down, my click missed the field, Cmd+A selected every cue ("23 cues selected"), and the value I then entered numbered all of them "-10", with "22 warnings" in the footer. One Undo ("Undo number") restored everything. Part of this was my hands working blind in the rig; I ran it once, so I am not sure a sighted user would get this far.
  - Steps: Click a cue, Cmd+A, type a value into the inspector's Number field, Enter.
  - Suggestion: Leave Number out of the multi-select inspector.
- **OSC trigger is hidden under 'More (2)' below the fold of Basics** (theo, inspector, confusing, task sensor)
  - Expected: Triggers on a tab of their own, as in QLab.
  - Happened: Basics shows Number, Name, Notes, Colour, Flagged, Armed, waits, Continue. '▸ More (2)' only appears after scrolling the inspector, and the trigger fields after opening it. I found it only because Settings > Network mentions 'a cue's OSC trigger, under More in its Basics'.
  - Steps: Select an audio cue. Look for where to set an OSC trigger.
  - Suggestion: A Triggers tab.
  - Pictures: [050.png](shots/theo-050.png)
- **Load to time is used up by one GO and nothing says so** (dana, transport, confusing, task rehearse)
  - Expected: 'Then again': select Salt, GO, and hear it from 0:30 again, since I had just loaded it there.
  - Happened: First take was right ('LOADED TO 0:30.0' beside Standing by, played from 0:31). For the second I selected Salt and pressed GO and it played from 0:01. I had to open Tools > Load to Time… again; the box did still hold 0:30.00, so it was Load, GO. The command is only in the Tools menu; nothing on the cue or the waveform offers it.
  - Steps: Select a sound, Tools > Load to Time…, 0:30, Load, GO, Esc, select the cue again, GO: it plays from the top.
  - Suggestion: Offer 'again from 0:30' after a loaded cue is stopped, or a button for it in the rehearsal view.
  - Pictures: [030.png](shots/dana-030.png)
- **Load to Time does not remember the last time** (marcus, transport, slow, task rehearse)
  - Expected: On the twentieth pass of the second verse, Cmd+T Enter Space.
  - Happened: Cmd+T opens empty each time; Enter with it empty loads 0:00. So each repeat is Esc Esc, Up, Cmd+T, 2, 5, Enter, Space. A Load cue would probably do it (the import brought one, disarmed, for the Finale); I did not build one.
  - Steps: Select 20 Ballad, Cmd+T, 25, Enter, Space, Esc Esc, Up, Cmd+T: the box is empty.
- **Monitor credits every incoming message to 'ETC Eos family'** (theo, network, confusing, task buttons)
  - Expected: Incoming control messages labelled by where they came from, or as 'OSC control' / 'cue trigger'.
  - Happened: /go, /panic, /cue/2/start and /sensor/door from the button box and sensor are all listed as '← ETC Eos family (127.0.0.1:52474)', and the Eos patch in Settings lists '← /sensor/window 1' as heard from the desk. On the bench everything is one IP, so it may be matching by address alone; on a real rig the button box would be another IP. Still, it took the first patch with that IP and said so with confidence.
  - Steps: One patch at 127.0.0.1. Turn on OSC control. Send /go to UDP 53000 from the same machine. Open View > Network and MIDI Monitor > Received.
  - Suggestion: When the source port does not match a patch, show the bare address.
  - Pictures: [066.png](shots/theo-066.png)
- **Incoming messages that do nothing are logged the same as ones that fired a cue** (theo, network, missing, task buttons)
  - Expected: When debugging a sensor I want to see 'no such cue' or 'no trigger matches' next to the message.
  - Happened: '/cue/99/start' (there is no cue 99) and '/sensor/window 1' (nothing listens for it) appear in the Monitor exactly like '/cue/2/start'. The OSC control chip says '4 received, last /cue/99/start'.
  - Steps: OSC control on. Send /cue/99/start to 53000. Read the Monitor.
  - Suggestion: Add what each incoming message did: '→ started 2 heartbeat', 'no cue 99', 'unhandled'.
- **Monitor cuts the message off and never shows argument types** (theo, network, missing, task raw)
  - Expected: The monitor is where I check the wire. I expected the whole message and the type of each argument (int, float, string).
  - Happened: The Monitor panel shows 'Resolume Arena /…  /composition/…': the address is cut and the argument is off the edge; the panel cannot be widened that I could find. The little Network strip beside the mixer shows more of the message than the Monitor does. Neither shows the type; I only know '1' went as an int because my listener said so. The Monitor's footer does explain the rule ('1 is an integer, 1.0 a float; force with f:1 i:1 s:1'), which is good.
  - Steps: Fire a Network cue with a long address. Open View > Network and MIDI Monitor.
  - Suggestion: Wrap long lines and print types, e.g. '1 (i)'.
  - Pictures: [028.png](shots/theo-028.png)
- **Turning on Show feedback sends a GO that is not happening** (theo, network, confusing, task tally)
  - Expected: A tally gets events as they happen, or a clearly named state dump on connect.
  - Happened: The moment I chose the Tally patch, the display received '/endlesscues/go "" "room tone"' and '/endlesscues/playhead 2 heartbeat'. That GO had been pressed about a minute earlier. A tally that lights a 'GO' lamp would have flashed. Seen once; it may be meant as a state dump.
  - Steps: Fire a cue. Then Settings > Modules > Show feedback on, choose a patch. Read what the patch's port received.
  - Suggestion: On connect send state (playhead, running) but not the go event.
- **Undo is emptied by Save** (priya, files, missing, task undo)
  - Expected: In QLab I save constantly and can still Cmd+Z back through the session. I expected to step back to before the 6.5 paste, or at least see the steps.
  - Happened: After Cmd+S the ↶ button reads "Undo (⌘Z)" and is disabled; seen after the first save and again when I came back to regret 6.5. Versions listed only "v1 … first version … 25 cues", which holds all six notes together, so Restore could not take out one of them. I deleted the cue by hand.
  - Steps: Open any show, change two things, Cmd+S, look at the Undo button. Run twice (first save of the imported show; later save).
  - Suggestion: Keep the undo history across a save, or let a version be compared and restored cue by cue.
  - Pictures: [069.png](shots/priya-069.png)
- **In Show mode a click on a cue row moves Standing by to it** (dana, show-mode, confusing, task perform)
  - Expected: A locked show to keep its place unless I use the arrow keys or Jump.
  - Happened: Clicking Salt after the run made 'Standing by 2 Salt'. In a show a stray trackpad click would change what the next GO does. The big Standing by text does tell me, which is how I would catch it. (QLab does the same.)
  - Steps: Show mode, click any row.
  - Pictures: [035.png](shots/dana-035.png)

### Polish (12)

- **A cue's level is not shown in the cue list** (dana, cue-list, missing, task level)
  - Expected: To see Salt's -4 dB at a glance when I check the show before the house opens.
  - Happened: The row for Salt reads the same as before; I have to select it and open the Audio tab to see '-4'. The Active cues panel shows it only once it is playing.
  - Steps: Set an Audio cue's Level to -4.
- **The cue list shows 'bus4' for a bus I named Click** (marcus, cue-list, wording, task click)
  - Expected: 'Click' in the Target column, as in the mixer ('Click ›3–4') and the inspector.
  - Happened: The column shows 'bus4' on all three click cues.
  - Steps: Settings ▸ Audio ▸ Add a bus, rename it Click, put a cue on it.
  - Pictures: [062.png](shots/marcus-062.png)
- **An audio cue's Target column is empty** (priya, cue-list, missing, task bring)
  - Expected: QLab shows the file name in Target, which is how I spot a wrong or missing file down the whole list at once.
  - Happened: Target is blank for every Audio cue; the file is only in the inspector's Audio tab, one cue at a time. Before the first save that field is a long absolute path.
  - Steps: Import the show; look at the Target column for cues 2, 4, 6, 7.
  - Pictures: [014.png](shots/priya-014.png), [055.png](shots/priya-055.png)
- **Added sounds get no cue number, and their Name field is empty though the list shows a name** (theo, cue-list, confusing, task buttons)
  - Expected: QLab numbers new cues, so /cue/<number>/start works at once.
  - Happened: room tone and heartbeat came in with a blank Number; /cue/<number>/start had nothing to address until I typed one. The inspector's Name field is empty while the row shows 'heartbeat' in grey. A Network cue added later in a fresh show did get number 1.
  - Steps: New show, File > Add Sounds, select a cue.
  - Pictures: [050.png](shots/theo-050.png)
- **Nothing says where the gap goes for an auto-follow** (dana, inspector, confusing, task follow)
  - Expected: A word of help beside Continue or Post-wait saying which of them makes the silence.
  - Happened: I guessed Post-wait 3 on Driftwood rather than Pre-wait on Lantern. It was right: Lantern 'is waiting (0:01.4 of 0:03.0)' then played. But I only knew by playing 35 seconds of track.
  - Steps: Select a cue, choose auto-follow.
  - Suggestion: A line under Continue: 'the next cue starts by itself when this ends, after the post-wait'.
- **The text that explains loop counts and L is below the fold** (marcus, inspector, confusing, task vamp)
  - Expected: To read how a region behaves beside the region.
  - Happened: 'Give a region a count (3)… With no count it does not loop by itself: in the show, press L…' is cut off at the bottom of the inspector once a region exists; I only read it after a run had gone wrong.
  - Steps: Opening track ▸ Time & Loops ▸ Make from markers at the default window size.
  - Pictures: [023.png](shots/marcus-023.png), [031.png](shots/marcus-031.png)
- **A second GO pressed straight after the first does nothing and nothing says so** (priya, transport, confusing, task run)
  - Expected: QLab's double-GO protection is a setting I choose, and I know its length.
  - Happened: In Show mode I pressed Space twice with no pause, twice over; each time only one GO happened. I assume a double-GO guard, but I never set one and the screen gave no sign that a press was ignored. Could be the rig's timing; not confirmed.
  - Steps: Show mode, press Space twice within a fraction of a second.
- **Show feedback names an unnumbered cue by an internal id, sends numbers as strings, and its messages are not listed anywhere** (theo, network, missing, task tally)
  - Expected: A list of the feedback messages and their argument types on the module's card, as OSC control has for what it takes.
  - Happened: Received '/endlesscues/cue/c_1589d340/start "room tone"' for a cue without a number, and '/endlesscues/go 2 heartbeat' with 2 as a string. The card only says 'GO, cues starting and stopping, the playhead'. I learned the protocol by reading my listener.
  - Steps: Show feedback on. GO on a cue with no number.
  - Suggestion: List the addresses and types on the card.
- **After the first save the message at the bottom says 'Nothing to save'** (dana, files, wording, task save)
  - Expected: 'Saved to Autumn tour' or similar.
  - Happened: After choosing the folder, the button turned to 'Saved' and the title to 'Autumn tour', but the message at the bottom of the window read 'Nothing to save', which made me doubt it for a moment. Seen once; it may be a second message that replaced a first I did not see.
  - Steps: New show with unsaved cues, Save, choose a folder, read the message at the bottom.
  - Pictures: [024.png](shots/dana-024.png)
- **The show folder mixes what belongs in git with what does not** (theo, files, confusing, task file)
  - Expected: To commit the folder as it is.
  - Happened: Beside show.json there is versions/ (a full copy of the show per save) and media/ (the wavs, copied in), and show.json holds the web remote key ('key': 'ccabf7c3'). All fine, but I would need a .gitignore for versions/ and media/ and to remember the key is in the history.
  - Steps: Save a show with the Web remote on. List the folder.
  - Suggestion: A line in the manual on using git with a show folder.
- **File > New Show goes to the start screen, and Revert to Saved does not ask** (theo, files, confusing, task desk)
  - Expected: New Show gives an empty cue list; Revert asks before discarding.
  - Happened: File > New Show showed the 'Endless Cues public alpha' start page with a 'New show' button to press again. File > Revert to Saved dropped two unsaved edits with no question (undo may bring them back; I did not try). Each seen once.
  - Steps: With a saved show open and edited: File > Revert to Saved. Then File > New Show.
  - Pictures: [075.png](shots/theo-075.png)
- **The keys page says 'Move the playhead ↑ ↓' for going back a cue** (dana, help, wording, task help)
  - Expected: 'Previous cue / next cue'.
  - Happened: Help > Keyboard Shortcuts opened Settings > Keys at once and GO (Space) and Panic (Esc; 'again: stop dead') were the first two entries. Going back one cue I had to recognise as 'Move the playhead ↑ ↓'. Up did move Standing by from Salt to Tide.
  - Steps: Help > Keyboard Shortcuts.
  - Pictures: [047.png](shots/dana-047.png)

### Praise (20)

- **Adding all seven files at once keeps their order and takes names from the files** (dana, import, praise, task build)
  - Audio > pick seven files gave seven cues in running order with durations. Number, Tab, Name, Enter for each was quick.
  - Pictures: [004.png](shots/dana-004.png)
- **The import report says plainly what did not come across** (marcus, import, praise, task bring)
  - Every loss is named by cue number, and the memo that replaces a MIDI cue carries the reason on its notes where it shows at standby.
  - Pictures: [003.png](shots/marcus-003.png), [062.png](shots/marcus-062.png)
- **The import report says exactly what did not come across, by cue number, with what to do about it** (priya, import, praise, task bring)
  - Six lines, each "number name: was X: here it is Y", and "The QLab file is not changed." The same words are left in the cue's notes, so the standby line for cue 9 read "(QLab MIDI cue: its message was not read. Make a MIDI cue here in its place.)". Everything it did not list, I checked three of and they were right.
  - Pictures: [003.png](shots/priya-003.png)
- **A Fade cue made after a sound targets it, numbers itself and names itself** (dana, cue-list, praise, task house)
  - Fade, with House music selected, gave '0.5 · fade House music' targeting '0 · House music', fading to silence by default; setting 8 s and 'Stop target when done' renamed it 'fade House music out'. Three clicks and it was right, and hear confirmed silence after 8 s.
  - Pictures: [012.png](shots/dana-012.png)
- **Broken and warned cues are counted in the footer with the reason** (theo, cue-list, praise, task raw)
  - '✕ 1 broken' with 'LX 12: no network patch chosen' is how I caught the un-patched cue.
  - Pictures: [028.png](shots/theo-028.png)
- **The click goes round the vamp with the track and leaves with it** (marcus, audio, praise, task vamp)
  - The region is on the track only; holding it held the click too ('held in a loop' on both, same position), and the Devamp released both at the end of the pass.
- **Click kept out of the house, and the app says so** (marcus, mixer, praise, task click)
  - One bus, one drop-down ('Outputs 3–4'), and the mixer labels it 'Click ›3–4'. Three cues changed in one multi-select.
  - Pictures: [062.png](shots/marcus-062.png)
- **The Standing by line says what GO will do, including 'then, by itself when this ends: 5 · Lantern'** (dana, transport, praise, task follow)
  - Before every GO the screen named the cue in large type with what comes after. For Driftwood it said the next would start by itself. While Driftwood played, Standing by had already moved on to Bows, correctly.
  - Pictures: [044.png](shots/dana-044.png)
- **Load to Time, Renumber and panic are where a QLab hand expects them** (marcus, transport, praise, task rehearse)
  - Cmd+T loads the whole group (track and click) and the header says 'LOADED TO 0:25.0'. Cmd+R renumbers and targets follow. Esc fades, Esc again stops dead, Up is back at the top of the number.
- **The QLab hands work: Space, Esc, V, Up arrow, Cmd+C/V, Delete, Cmd+S** (priya, transport, praise, task run)
  - Every QLab key I reached for did the QLab thing. After a GO one cue early, Up arrow moved the playhead back and nothing that was playing changed. A group with "Fade & stop others" 3 s did the blackout exactly.
  - Pictures: [064.png](shots/priya-064.png)
- **Device-aware patches: the Eos command builder wrote the right address and the bytes matched** (theo, network, praise, task desk)
  - Choosing 'ETC Eos family' filled the port and printed where on the desk to turn OSC on. The cue offered Fire cue / GO / Stop / Macro / Submaster / Channel / Command line; 'Write the message' showed '/eos/cue/1/12/fire' before writing it, and exactly that arrived. Resolume has the same.
  - Pictures: [017.png](shots/theo-017.png)
- **OSC fades are right: the app warns when #v# is missing, and the ramp ends on exactly 1.0** (theo, network, praise, task ramp)
  - 'A duration is set but the message has no #v# to fade.' in the inspector and '1 warning' in the footer. With #v#: 126 floats, evenly about 34 ms apart, 0.0 first, 1.0 last.
- **OSC trigger Learn captures the address and the argument, and matches on the argument** (theo, network, praise, task sensor)
  - Learn said 'Waiting on 53000… (cancel)', then filled '/sensor/door 1'. door 1 and 1.0 fire, door 0 does not. The port opened by itself.
- **Save makes one folder with the music copied in, and the app reopens it as it was** (dana, files, praise, task save)
  - 'Autumn tour.ecshow' on the desk holds a media folder with all seven tracks. On reopening the app the show was there with the loop, the fade, the trim, the follow and the -4 dB intact. That is what a touring laptop needs.
  - Pictures: [025.png](shots/dana-025.png)
- **A level changed while playing is heard at once, counted as unsaved, and saved without a dropout** (marcus, files, praise, task levels)
  - -9 heard immediately, 'N unsaved' chip with the list of changes, Cmd+S wrote the show folder with the audio copied in while the Ballad kept playing.
- **Save makes one folder with the sounds in it, first time, without being asked** (priya, files, praise, task save)
  - Cmd+S, one place to choose, and "The Glass Orchard.ecshow" held show.json and media/ with the ten sounds in use, including the composer's new letter v2.wav and not the old letter.wav. The cue's File field changed to "media/letter v2.wav".
  - Pictures: [057.png](shots/priya-057.png)
- **The show file is plain, stable JSON: one changed port is a one-line diff** (theo, files, praise, task file)
  - show.json: 139 lines, one field per line, patches named once and referred to by id, media by relative path. diff between two saves: '<  "port": 8001,' / '>  "port": 8099,'. The version note wrote itself: 'network.patches.0.port 8099'. Saving back to the same content did not add a third version file.
- **OSC control, Web remote and Show feedback are one switch each, QLab-compatible, and say their state in the title bar** (theo, settings, praise, task buttons)
  - OSC control lists what it takes (/go · /panic · /stop · /cue/<number>/…) and shows 'listening on UDP 53000 · 4 received, last …' as a chip. The web remote refuses a request without its key (403).
  - Pictures: [050.png](shots/theo-050.png)
- **Show mode is plain and the lock is real** (dana, show-mode, praise, task perform)
  - One click on 'Show': toolbar and inspector go away, 'SHOW MODE — editing is locked' at the bottom, Delete does nothing. The whole evening ran right on Space alone.
  - Pictures: [035.png](shots/dana-035.png)
- **The standby line says what this GO will really do** (priya, show-mode, praise, task run)
  - "DISARMED — THIS GO WILL SKIP IT" on the cut phone cue; "and with it, on the same GO: 8 · Underscore out" on the auto-continue; "then 6.5 · Door, memory" otherwise. Active cues showed "−22 → −12 dB" on the rain while it came back, with the waiting fade counting down under it.
  - Pictures: [064.png](shots/priya-064.png), [055.png](shots/priya-055.png)

## The test rig got in the way

- dana: Could not judge the keys as they would appear on Dana's Windows laptop; the rig showed Mac keys (⌘).
- marcus: After GO the cue list scrolled, so a click by remembered position landed on the click cue instead of the track; a person looking at the screen would mostly not do this.
- marcus: The count-box failure may be the rig's typing rather than the app; other fields took the same typing.
- marcus: Could not test what the Click bus does on a device with only two outputs: the rig pretends to have eight.
- priya: Working from text coordinates, a warning bar or a different group mode moved the inspector's fields down a row and two of my clicks missed their field; a person looking at the screen would have seen it.
- priya: Clicking by name with --nth picked a different row than the one listed first, so I clicked rows by place.
- priya: hear reports a fading sound as 'at -10.0 dB (fading to -60 dB)' partway through the fade, so I could not hear the fade's shape, only that it ended in silence.
- priya: MIDI output could not be checked beyond the bytes shown in the app's own Network panel.
- priya: I could not see the app on Windows, which is the whole reason Priya is here.
- theo: I kept my ec-user command in a small wrapper script in the shared scratchpad, named 'e'. Another virtual user (priya's) wrote a wrapper with the same name over it. Three of my actions then went to PRIYA'S app: a click at (133,894), a Space (GO) and an Escape, plus four looks (pictures and journal lines in priya's folder, about 18:08:10 to 18:09:10 UTC). The click left 'Undo continue' and '1 unsaved' on her cue 0.5 Preshow music, so it changed a Continue setting there. Her run should be read with that in mind. Nothing of hers reached my session. I used a wrapper under my own name after that.
- theo: The device stand-ins do not answer pings, so a patch's Test can never show its 'answered' state here; I could not judge what a live desk looks like against a dead one.
- theo: After a restart the app reopened the last show rather than the start screen; I acted without looking and had to Revert. My mistake, not a finding.
- theo: The session ran a macOS build, so nothing here says anything about Linux or Windows.
