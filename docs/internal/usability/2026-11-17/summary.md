# Usability run 2026-11-17

Virtual users, each an agent standing in for a person with a show of their own, using the app through its window (`test/users/README.md`). A virtual user is not a person: read this as a list of things to look at, not as a measure of how usable the app is.

## Verdicts

| Person | Would run their show on it | Learn | Speed | Clarity | Trust | Blockers | Major | Minor | Polish | Praise | Actions |
|---|---|---|---|---|---|---|---|---|---|---|---|
| [dana](dana.md) | with-workarounds | 4 | 4 | 4 | 3 | 0 | 1 | 3 | 2 | 4 | 112 |
| [june](june.md) | with-workarounds | 3 | 3 | 3 | 3 | 0 | 2 | 8 | 3 | 3 | 139 |
| [marcus](marcus.md) | with-workarounds | 4 | 4 | 3 | 3 | 0 | 2 | 3 | 2 | 4 | 129 |
| [priya](priya.md) | with-workarounds | 4 | 4 | 4 | 3 | 0 | 1 | 4 | 2 | 3 | 134 |
| [theo](theo.md) | with-workarounds | 4 | 4 | 3 | 3 | 0 | 2 | 6 | 1 | 4 | 177 |

**dana:** I built the whole evening in an afternoon without asking anyone, and the top of the screen always told me what GO would do next, including 'then, when it ends: 6 · Lantern'. What holds me back is Show mode: I could pull the Master fader to silence with a small slip, and then the app refused to let me put it back until I left Show mode. I'd tour with it, but I'd be nervous with my hand near that fader.

**june:** One GO does fire the sound, the desk's cue 12 and the lantern, and the Rig page tells me at a glance what is there and what is not. But the assistant I came for knew a short list of sentences, and for the desk, the lantern's breathing and the second lantern I ended up doing it by hand in the inspector. I would run The Lighthouse on it, once a friend has checked my cues.

**marcus:** It vamps, counts a section and leaves the vamp at the end of the pass, track and click together, so the thing that matters works. But the clicks came in sitting on the house bus at -inf instead of on 3 and 4, and I only caught it by digging to the bottom of the Audio tab. I'd run the backup on it once I've checked every click's outputs by hand and rebuilt the keys patch change.

**priya:** Yes, I'd run tonight's tech on it on the Windows box, and probably the run after it. The import was honest about the MSC cue, the rain, thunder dip and phone stop played exactly as in QLab, and my notes took minutes. The lighting GO is the risk: I rebuilt it as a MIDI cue I've never heard reach a desk, and the blackout coming across as a 'Memo that does nothing' made me trust it less than it deserved.

**theo:** Every byte I checked matched what the screen said, the device models saved me typing, OSC control and the tally feed worked first time, and the show file is the best I have seen for git: renaming a cue was a one-line diff. What holds me back: a Network fade silently sent 146 messages with no value until I found #v# in the manual, and a desk on the wrong port looks fine everywhere except a small dot on the Rig tab. I'd bench it further before I bolt it under a staircase for four months.

## Tasks

| Person | Task | Outcome | Actions | Refused | Minutes | Notes |
|---|---|---|---|---|---|---|
| dana | build | done | 5 |  | 0.5 | Start from a folder, then 'Make cues from these 7 sounds' in the side drawer, then Accept. The cues came out numbered 1 to 7 and named from the files with the numbers stripped. I didn't expect the step through the assistant drawer. |
| dana | house | done | 15 | 1 | 0.7 | Time & Loops ▸ Whole sound switch turned the loop on. A Fade cue added under House music already targeted it, went to -inf and had 'Stop target when done' on, so I only typed 8. hear confirmed it was still looping after 43 s and was silent after the fade. |
| dana | trim | done | 16 |  | 0.5 | Start · End 0:12 to 0:40 on Time & Loops, Fade out 5 on the Audio tab. In Show mode it started at 0:12, the fade began at 0:35 and it was silent at 0:40. |
| dana | follow | done | 14 |  | 0.8 | Driftwood set to auto-follow and Lantern given a 3 s Pre-wait (Post-wait's help says it only works with auto-continue). In the run Lantern waited 3 s and then started on its own. |
| dana | level | done | 13 | 1 | 0.5 | Audio tab ▸ Level -4. hear said 'Salt at -4.0 dB'. My first try went wrong: my click missed the field, so Cmd+A selected all 8 cues. Nothing changed. |
| dana | save | done-with-trouble | 7 | 1 | 0.5 | Save worked straight away and everything was there after reopening. But the show had been saved inside the music folder, called 'tour music', and I never chose where it went or what it was called. |
| dana | rehearse | done | 12 |  | 0.6 | Tools ▸ Load to Time (Cmd+T): 0:30, Load, GO. The screen said 'LOADED TO 0:30.0 · this GO only'. Esc stopped it, and the second time the field still had 0:30 in it. |
| dana | perform | done-with-trouble | 28 |  | 3.3 | The Show button locked editing and the whole evening ran right. Clicking a waveform and then Skip moved me through each track. But the Master fader still moves in Show mode and its reset button is refused there. |
| dana | help | done | 2 |  | 0.2 | Help ▸ Keyboard Shortcuts: GO is Space, Panic is Esc (press again to stop dead), and Playhead up ↑ or 'Previous cue that needs a GO' is '-'. |
| june | folder | done | 5 |  | 0.6 | Start from a folder, then the helper's one button proposed 6 cues and said exactly what it guessed (file order, dropped FINAL/v2, did not loop the lamp hum, did not read script.md). Accepted. |
| june | talk | gave-up | 11 |  | 1 | Helper said plainly it has no model and listed what it knows. 'fade out cue 1 over 3' adds a separate Fade cue after the sound, not an ending fade. Settings > Assistant shows the choices but I could not find how many steps a real model takes; picking Anthropic left the drop-down saying Built-in helper and gave a raw SDK error. |
| june | script | gave-up | 19 | 2 | 1.4 | Found nowhere to tell the show script.md is its script: not in the menus, Settings > Show, the Rig page or the helper's list. A 'Make cues from script.md' button appeared once (with the wrong provider) and then disappeared. |
| june | desk | done-with-trouble | 37 |  | 2.1 | My own sentence got the canned list. 'add an ETC Ion at 127.0.0.1' worked but named it 'N ETC Ion'. The helper's suggested 'Fire cue' cue failed ('list must be a number'). Made the Device cue by hand plus auto-continue on Foghorn; one GO sent /eos/cue/1/12/fire. |
| june | lantern | done | 7 |  | 0.5 | 'look for props' found lantern_a, Accept gave a Rig row 'answering · 1 ms · firmware 1.0 · signal'. Try: Identify made the stand-in print '/ec/identify blinks white for 2 s'. |
| june | cue | done-with-trouble | 23 |  | 0.7 | Helper said 'Lantern a has no command breathe. It has: ... Effect ...' but did not offer to use Effect. By hand: Device cue, Lantern a, Effect (breathe by default), auto-continue on Lamp hum; GO sent /ec/effect breathe. |
| june | ready | done | 6 |  | 1.4 | Assistant and Rig page agreed (6 of 7, desk not answering on the bench). After stopping the lantern the Rig row turned red in about 35-40 s: 'not answering (last heard 44 s ago) ... Check its power, and that it is on the show's network.' In Edit view only a dot on the Rig tab. |
| june | firmware | done-with-trouble | 23 |  | 1.2 | Helper could not ('no device called my second lantern...'). Rig > Add a device > From a model > Prop light, renamed Lantern B, Write firmware... A clear dialog; README is good. Wi-Fi password only in secrets.h, never asked for. But it is written to props/prop_light and answers as 'prop_light', not Lantern B. |
| june | more | not-possible | 8 |  | 0.4 | Helper gave its standard list. Its next suggestion, 'hand the show over', writes AGENTS.md and says to open a terminal and type 'claude'. Nothing says whether a sensor is possible with the kit at all. |
| marcus | bring | done-with-trouble | 8 |  | 10.2 | The import came in with a clear summary. But the click routing was not brought across, the summary described it wrongly, and the keys patch change became a Memo without its program number. |
| marcus | click | done-with-trouble | 36 |  | 1.6 | The clicks came in on the Effects bus (outputs 1-2) at -inf, even though the summary said 'outputs of its own'. I fixed it with Own outputs > 3-4 and Level 0 on all three clicks; multi-select made two of them one edit. With 'On its bus' off it doesn't reach the house pair. |
| marcus | vamp | done | 18 |  | 2.9 | The 0:16-0:24 slice came in as an endless loop region. Track and click went round in step. GO on 11 Devamp mid-pass played to 0:24 and went on, tested twice. |
| marcus | counted | done | 10 |  | 2.1 | The Finale's Slice 1 plays 4 times by itself ('pass 2 of 4 of a counted section'), then holds Slice 2. The bows vamp came in as 0:20-0:30, where the MD says 0:30-0:38. I couldn't tell whether that is the QLab file or the import. |
| marcus | rehearse | done | 13 |  | 0.5 | Cmd+T as in QLab. '25' means 0:25 and the time is remembered. To go again: click the Ballad row, Cmd+T, Enter, Space, so four presses. Track and click both start at 0:25. |
| marcus | renumber | done | 7 |  | 0.3 | I selected 30 to 33 and pressed Cmd+R with Start at 300. It numbered all six, children included, 300-305, and the Devamp and Fade targets followed. |
| marcus | levels | done-with-trouble | 19 |  | 1 | Double-clicking '-6' and typing -9 was silently ignored, twice. Click, Cmd+A, -9 worked and the playing track dropped at once. Save then kept it. |
| marcus | panic | done | 18 |  | 0.9 | Esc fades over 2 s and a second Esc stops dead. Clicking the number's group row puts it back on standby, in Show mode too. Reset is two presses while something plays, and I missed the confirm the first time. |
| priya | bring | done | 13 |  | 1 | Import from QLab… on the start screen; a summary named the two things lost (MSC cue kept as a Memo, a hotkey with no key). Everything else came across: playlist, group modes, loops, fades, the blackout's fade-and-stop-others. |
| priya | verify | done | 9 |  | 0.8 | Rain loops at -12 dB; Q3 dips it to -22 and brings it back; Q5 stops the phone. Active cues panel and row meters show it all. |
| priya | repair | done-with-trouble | 45 |  | 3.4 | Preshow playlist, its fade, the act 2 group and the blackout already worked when fired. Rebuilt the MSC GO as a MIDI cue 'msc go 9' (+ ▸ MIDI), deleted the Memo, renumbered and set auto-continue. A Reset that needed several clicks got in the way. |
| priya | notes | done | 41 | 3 | 1.7 | All six: thunder -6, rain returns 5 s (double-click in the list), 6.5 via Cmd+D, Q7 file swapped with level kept, Q4 disarmed, Q13 already fades all over 3 s. |
| priya | save | done | 2 |  | 0.3 | Cmd+S asked where; the .ecshow folder holds all ten sounds in use in media/ (letter v2 in, the old letter out). |
| priya | run | done | 17 |  | 1.4 | Show mode, ran 0.5 to 7. Early GO on 7: stopped 7 and the waiting 8 with their row ■ buttons (fade), clicked 7 to stand by again, GO'd on cue. Three clicks. |
| priya | undo | done | 7 |  | 0.4 | Selected 6.5, Delete, Save. The other notes stayed; the save note said 'Saved v2 — 6.5 Door, memory removed'. |
| theo | bed | done-with-trouble | 14 |  | 0.6 | Audio added both files in one dialog; loop is a 'Whole sound' switch on Time & Loops (had to scroll). The two cues came in with no numbers although 'Number new cues' is on; numbered them by hand. |
| theo | desk | done | 21 |  | 1.1 | Rig > Add a device > From a model > ETC Eos family; set 127.0.0.1:8001, typed 12 in Fire cue's second (unlabelled) field, +cue. Fired: /eos/cue/1/12/fire arrived exactly as shown. |
| theo | raw | done | 17 |  | 0.7 | Resolume model exists; Trigger clip with clip 2 -> /composition/layers/1/clips/2/connect 1, arrived with an int argument. Monitor showed the line but not the type. |
| theo | ramp | done-with-trouble | 31 |  | 1.2 | Network cue with Fade from 0, Fade to 1, 5 s sent 146 messages with no argument at all. Manual: the message must contain #v#. With it: 146 floats over 5.03 s, last exactly 1.0. |
| theo | sensor | done | 16 |  | 1.1 | OSC trigger '/sensor/door 1' on the heartbeat cue. /sensor/door 1 started it; /sensor/door 0 did not, and the monitor said 'did nothing'. /sensor/door 1.0 also started it. |
| theo | buttons | done | 11 |  | 0.9 | /go first 'did nothing'; switched on Settings > Integrations > Modules > OSC control. Then /go, /cue/5/start, /cue/2/start, /panic all worked. |
| theo | tally | done-with-trouble | 32 |  | 1.2 | Show feedback module needs a patch; the Rig devices are not offered, so made a Generic OSC patch for 127.0.0.1:9100. GO sent /endlesscues/go 2 heartbeat, /cue/2/start, /running 1, /playhead 3 ... |
| theo | tablet | done | 7 |  | 0.2 | Web remote module, one switch, URL with key shown. curl with the key: 200 text/html, 11 KB; without: 403. |
| theo | file | done | 8 |  | 0.4 | Saved as The Cellar.ecshow (a folder). show.json is pretty JSON, stable ids, defaults omitted; renaming a cue gave a one-line diff. Web remote key is stored in it; versions/ and logs/ live beside it. |
| theo | wrong | done-with-trouble | 20 |  | 1.1 | Port 8009: the monitor shows the send like any other; the cue row, standby line and Show mode show nothing. Only a red dot on 'Rig', and the Rig page says 'not answering', which it also said on the right port. |

## Findings

### Major (8)

- **Click routing to outputs 3-4 is not imported; clicks land on a house bus at -inf** (marcus, import, bug, task click)
  - Expected: The QLab workspace sends the clicks to outputs 3 and 4 only. I expected them to come across on 3-4, or at least to be on outputs of their own as the import summary says.
  - Happened: The summary says the clicks are 'played only on outputs of its own, with its main level down'. Opening click's Audio tab shows 'On its bus' lit and 'On its bus's pair.', an empty output matrix, Level '-inf' and Bus 'Effects', which is outputs 1-2. Raising the level, as the summary says to, would put the click in the house.
  - Steps: Import Songbook.qlab5, select 'Opening click', Audio tab, More, scroll to Own outputs.
  - Suggestion: Carry QLab's output routing across, or say plainly that the clicks are now on a house bus.
  - Pictures: [001.png](shots/marcus-001.png), [008.png](shots/marcus-008.png)
- **A MIDI program change is imported as a Memo described as 'MIDI timecode, or an empty SysEx', and its program number is lost** (marcus, import, bug, task bring)
  - Expected: A keys patch change is a plain program change, which the app's own MIDI cue sends ('pc 3 ch 2' is its placeholder). It should come across as a MIDI cue.
  - Happened: '21 Keys 2 patch change: was a MIDI cue whose message this does not send (MIDI timecode, or an empty SysEx): kept as a Memo.' The memo's notes do not keep the program number or the channel, so I can't rebuild it without opening the QLab file.
  - Steps: Import Songbook.qlab5 and read the summary, then select 21 and read Notes.
  - Suggestion: Import program changes, and when a cue is turned into a Memo, keep its message in the notes.
  - Pictures: [001.png](shots/marcus-001.png)
- **The MSC GO to the lighting desk did not import, and the reason given doesn't fit an MSC cue** (priya, import, missing, task bring)
  - Expected: A QLab MIDI cue sending MSC GO comes across as a MIDI cue sending the same MSC, since the app's MIDI cue accepts 'msc go 12'.
  - Happened: Summary: '9 LX console GO (MSC): was a MIDI cue whose message this does not send (MIDI timecode, or an empty SysEx): kept as a Memo.' The cue is named MSC and the app does send MSC, so I rebuilt it by hand and had to supply the cue number from memory. I can't see inside the QLab file, so I can't tell if the importer misread it or the cue really was odd.
  - Steps: Import from QLab… > The Glass Orchard.qlab5; read the summary line for cue 9.
  - Suggestion: When it can't be carried over, say which MIDI message the QLab cue held (bytes or kind) so I can retype it.
  - Pictures: [002.png](shots/priya-002.png), [016.png](shots/priya-016.png)
- **A Network cue fade without #v# sends the bare address over and over, with no warning** (theo, inspector, confusing, task ramp)
  - Expected: Filling in Fade from, Fade to and Duration would send the value, as QLab's Network cue fade does, or the inspector would say the message needs a placeholder.
  - Happened: With message '/composition/layers/1/video/opacity', Fade from 0, Fade to 1, Duration 5 s, the media server got 146 messages of '/composition/layers/1/video/opacity' with no argument. The monitor showed the same. Nothing on the cue or in Check said the fade fields were unused. Only the manual says 'A Network cue whose message contains #v# sends that value'.
  - Steps: Add a Network cue, choose a patch, type an address without #v#, set Fade from 0, Fade to 1, Duration 5, Audition, and watch the receiving port.
  - Suggestion: When Fade from/to are set and the message has no #v#, say so on the cue (or append the value).
  - Pictures: [ramp.txt](shots/theo-ramp.txt), [ramp2.txt](shots/theo-ramp2.txt)
- **A device that is not answering is shown only on the Rig page, not on its cues or in Show mode** (theo, network, missing, task wrong)
  - Expected: A warning where he is looking: on the cue row, in the standby line, or in Show mode, since a cue aimed at a dead desk is the thing that bites in a show.
  - Happened: After setting the desk to port 8009 and firing cue 3, the monitor listed '→ ETC Eos family 127.0.0.1:8009 /eos/cue/1/12/fire' like a success; the cue row and Show mode looked identical to the others. The only sign was a small red dot by 'Rig'; the Rig page said 'not answering · Check its power, and that it is on the show's network.' It said the same on the correct port (the stand-in cannot answer /eos/ping), so a wrong port and a silent desk look the same.
  - Steps: Add an ETC Eos device on a port nothing listens on, +cue Fire cue, fire it, go to Show mode.
  - Suggestion: Mark cues whose device is not answering, in the list and the standby line.
  - Pictures: [082.png](shots/theo-082.png), [090.png](shots/theo-090.png)
- **Settings shows 'Built-in helper, ready' while the assistant is really switched to a provider with no key, and the error is raw SDK text** (june, settings, bug, task talk)
  - Expected: If I choose Anthropic (Claude), the drop-down shows it and asks for a key; if it snaps back, nothing changed.
  - Happened: The drop-down went back to 'Built-in helper' and Status said 'ready', but the panel header then said 'anthropic' and my next message was answered with 'Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set. Or for the "Authorization" header to be explicitly omitted', plus 'Something went wrong. Report it?' in the status bar for the rest of the session. Run once; the drop-down not holding a choice may be the test rig's lock, but the header and the error are the app's.
  - Steps: Open Settings > Assistant, choose 'Anthropic (Claude)' in Who answers with no key set, close Settings, send any message to the assistant.
  - Suggestion: Say 'Anthropic needs a key: Settings > Keys' instead of the SDK's message, and never show one provider while another answers.
  - Pictures: [012.png](shots/june-012.png), [015.png](shots/june-015.png)
- **In Show mode the Master fader can be dragged to silence, but its reset button is refused** (dana, show-mode, bug, task perform)
  - Expected: When the footer says 'SHOW MODE — editing is locked', I expect a stray drag not to change the show's levels. If the fader is meant to stay live, I expect its own reset button to work too.
  - Happened: With Bows playing, an 84 px drag on the Master fader took it to '−∞' and a 34 px drag took it to '−20'. The Save button changed to 'Save · 1', so this was a change to the show. Clicking '↺' ('Put back to 0') only brought up a toast, 'Show mode: editing is locked', and the fader stayed at −20. I had to switch to Edit to reset it.
  - Steps: Open any show with sounds, click Show, GO a sound, drag the Master fader at the bottom right to the left a little, then click ↺ next to 'Master'.
  - Suggestion: Either lock the mixer in Show mode the same way the cue list is locked, or let ↺ work there.
  - Pictures: [069.png](shots/dana-069.png)
- **No way to tell the show which file is its script** (june, other, missing, task script)
  - Expected: Somewhere (Settings > Show, the Rig page, or the assistant) to say script.md is the script and see which @cue marks have no cue.
  - Happened: Nothing in the menus, Settings > Show or the Rig page mentions a script. The helper answered 'use script.md as the script' with its standard list, which has no script line. Its first reply had said 'I did not read script.md', so it knows the file is there.
  - Steps: Start from a folder holding a script.md; look for any place to set it as the script.
  - Suggestion: If this needs a model, have the helper say so in words when the folder holds a script.
  - Pictures: [019.png](shots/june-019.png), [020.png](shots/june-020.png)

### Minor (24)

- **Start from a folder makes no cues; they are offered in the Assistant drawer** (dana, import, confusing, task build)
  - Expected: The button's hint says 'A folder of sounds becomes the show', so I expected seven cues to appear.
  - Happened: The list said 'No cues yet / Drop sound files here.' Over on the right the Assistant drawer said '7 sounds not in a cue yet.' with 'Make cues from these 7 sounds', followed by a proposed change I had to Accept. It worked, but 'Assistant' made me wonder if I was using a paid AI feature.
  - Steps: Welcome ▸ Start from a folder… ▸ choose a folder.
  - Pictures: [003.png](shots/dana-003.png), [004.png](shots/dana-004.png)
- **The Finale bows vamp is 0:20-0:30 here, while the MD's notes say 0:30-0:38** (marcus, import, confusing, task counted)
  - Expected: The bows vamp from 0:30 to 0:38.
  - Happened: Loop regions show 'Slice 1 · 0:00.00 – 0:20.00' (4) and 'Slice 2 · 0:20.00 – 0:30.00' (∞), with markers at 0:20 and 0:30. I can't tell if the workspace was like that or the slices were shifted on import.
  - Steps: Import, select Finale track, Time & Loops, Loop regions.
  - Pictures: [038.png](shots/marcus-038.png)
- **Check says 'Nothing wrong' straight after an import that turned a cue into a Memo** (priya, import, confusing, task bring)
  - Expected: Check, the 'without checking every cue by hand' tool, would list the imported cues that need attention.
  - Happened: Check: 'Nothing wrong. Nothing was played to find out.' The lost MSC cue appears only in the dismissed summary, the show's notes and the Memo's own notes.
  - Steps: Import the workspace, OK the summary, click Check in the bottom bar.
  - Suggestion: Flag imported cues that lost something so Check and the Flagged list show them.
  - Pictures: [005.png](shots/priya-005.png)
- **The cue list scrolls by itself after GO and a click lands on the wrong cue, moving the standby** (marcus, cue-list, confusing, task levels)
  - Expected: The row I aimed at a moment ago would still be under the mouse.
  - Happened: I pressed GO on 20 Ballad and then clicked where 'Ballad track' was. The list had scrolled, the click hit '22 Reverb return up', and standby moved to 22.
  - Steps: Scroll so the Ballad group is mid-list, GO it, then click where Ballad track was within a second.
  - Suggestion: Don't scroll under the pointer right after GO.
  - Pictures: [054.png](shots/marcus-054.png)
- **The first cues added to a new show get no numbers although 'Number new cues' is on** (theo, cue-list, bug, task bed)
  - Expected: 1 and 2, as QLab does, and as Settings > Show > Number new cues (on, counting by 1) says.
  - Happened: Adding room tone and heartbeat in one Add sounds dialog to a new show gave two cues with blank Number. Later cues (the Device and Network cues) were numbered 3, 4, 5 after I typed 1 and 2.
  - Steps: New show, Audio, pick two sound files at once, look at the Number column.
  - Pictures: [003.png](shots/theo-003.png)
- **The inspector is a short strip, so most fields need scrolling** (dana, inspector, confusing, task house)
  - Expected: To see a cue's settings without scrolling, since most of the window above was an empty cue list.
  - Happened: On Time & Loops the waveform fills the strip and the loop switch is below it, out of sight. On Audio I had to scroll to reach Level. Opening '▸ More' rearranged the Basics fields, so Pre-wait was in a different place on the next cue I selected.
  - Steps: Select an Audio cue ▸ Time & Loops: the 'Whole sound' loop switch only shows after you scroll the inspector.
  - Pictures: [006.png](shots/dana-006.png), [030.png](shots/dana-030.png)
- **'fade out cue 1 over 3' adds a separate Fade cue instead of a fade at the sound's end** (june, inspector, confusing, task talk)
  - Expected: The sound ends with a 3 second fade, as I asked.
  - Happened: Proposal 'Add a 3 s fade-out after 1' with a new cue 'fade Sea wash out': another GO for every sound.
  - Steps: Built-in helper: 'fade out cue 1 over 3'.
- **Double-clicking a negative level and typing a new one is silently ignored** (marcus, inspector, bug, task levels)
  - Expected: Double-click selects the value and typing replaces it, as in QLab's fields.
  - Happened: Level showed '-6'. I double-clicked, typed -9 and pressed Enter, and it stayed '-6' with no message. It did the same from -9 to -10. I think the double-click selects only the digits, leaving '--9'. Click, Cmd+A, type works.
  - Steps: Select Ballad track, Audio tab, double-click the Level field showing -6, type -9, press Enter. It still shows -6.
  - Suggestion: Select the whole number on double-click, or say when an entry is refused.
  - Pictures: [054.png](shots/marcus-054.png)
- **The blackout imports as a Memo whose inspector says 'A note. Does nothing.', but it fades everything** (priya, inspector, confusing, task repair)
  - Expected: A cue that takes everything out shows as something that acts, or the Memo says it acts.
  - Happened: Row: '✎ 13 Blackout: everything out' with a 'fade others 3s' badge; inspector header '✎ A note. Does nothing.' Under More it has 'Fade & stop others 3 s, Others are: all', and firing it did fade wind and thunder to silence in 3 s. I almost rebuilt it.
  - Steps: Import, select cue 13, read the inspector header; fire 12 then 13 and listen.
  - Suggestion: When a Memo has fade & stop others, say so in its header.
  - Pictures: [010.png](shots/priya-010.png)
- **Reset took several clicks over about ten seconds to stop anything** (priya, transport, bug, task repair)
  - Expected: Reset (or 'Sure? Reset' on the second click) stops everything and goes back to the top.
  - Happened: First click changed it to 'Sure? Reset' and the button grew to the left. Over the next clicks it kept showing 'Sure? Reset' while Rain bed and Underscore played on. A later click finally gave silence. Seen once; I may have clicked at the moment it reset its confirm, so not sure it's a bug.
  - Steps: With sounds playing in Edit mode, click Reset, then click 'Sure? Reset'. Not run twice.
  - Suggestion: Keep the button the same size when it asks 'Sure?'.
  - Pictures: [016.png](shots/priya-016.png)
- **The helper's own suggestion 'Add a cue: Fire cue to N ETC Ion' fails with 'list must be a number'** (june, network, bug, task desk)
  - Expected: A button the assistant offers works, or asks me for the cue number.
  - Happened: Clicking it, and 'add a cue that sends fire cue 12 to N ETC Ion', and '... fire cue list 1 cue 12 ...' all replied 'That would not send: list must be a number.' In the inspector the same command shows Cue list '1' as a grey placeholder and sends /eos/cue/1/12/fire without my typing a list.
  - Steps: Built-in helper: 'add an ETC Ion at 127.0.0.1', Accept, then click the suggestion 'Add a cue: Fire cue to N ETC Ion'. Run three times with different wording.
  - Suggestion: Use the same default list as the inspector, or ask for the cue number.
  - Pictures: [027.png](shots/june-027.png), [048.png](shots/june-048.png)
- **'add an ETC Ion' names the device 'N ETC Ion'** (june, network, bug, task desk)
  - Expected: A device called 'ETC Ion'.
  - Happened: Proposal: 'Add the device N ETC Ion'. The n of 'an' became part of the name, and it then shows on every Rig row, suggestion and drop-down. Run once.
  - Steps: Built-in helper: type 'add an ETC Ion at 127.0.0.1'.
  - Pictures: [027.png](shots/june-027.png)
- **Firmware for a renamed prop is still called prop_light, folder and answering name** (june, network, confusing, task firmware)
  - Expected: Renamed to Lantern B, the files go in props/lantern_b and the board answers as lantern_b, like my first lantern answers as lantern_a.
  - Happened: The dialog said 'Written to props/prop_light/'; config.h has PROP_NAME "prop_light". A third lantern from the same model would get the same folder and name.
  - Steps: Rig > Add a device > From a model > Prop light; rename it; Write firmware...
  - Pictures: [081.png](shots/june-081.png)
- **Incoming messages from 127.0.0.1 are labelled as coming from the lighting desk** (theo, network, bug, task sensor)
  - Expected: The monitor would say the sender's address, or 'unknown'.
  - Happened: /sensor/door 1, /go and /panic (sent by the controllers) appear in the monitor as '← ETC Eos family (127.0.0.1:64239)'. The sender is matched to a device by IP alone. On a bench test where everything is local this misleads; on a real rig any second program on the desk's IP would too.
  - Steps: Add an Eos device at 127.0.0.1, then send any OSC to 53000 from the same computer and read the monitor.
  - Suggestion: Match on port too, or show the IP:port without a name when it is not the device's reply port.
  - Pictures: [046.png](shots/theo-046.png), [082.png](shots/theo-082.png)
- **Device command fields on the Rig page have no labels** (theo, network, confusing, task desk)
  - Expected: 'Cue list' and 'Cue' next to Fire cue's two boxes; the show file has these labels.
  - Happened: Fire cue showed two boxes both reading '1' with no label. I guessed the second was the cue; the 'sends' preview only updates after leaving the box, so typing gave no feedback. The cue's inspector does label them (Layer, Clip).
  - Steps: Rig > Add a device > From a model > ETC Eos family; look at Fire cue.
  - Pictures: [012.png](shots/theo-012.png)
- **The monitor does not show OSC argument types** (theo, network, missing, task raw)
  - Expected: 'connect 1 (i)' or similar, since int vs float is the commonest Resolume/Eos mistake and the Send box already talks about i:/f:/s:.
  - Happened: Monitor line: '/composition/layers/1/clips/2/connect 1'. My listener showed it was an int; the app gave no way to tell. A float ramp shows '1.0' at the end, so you can partly infer it.
  - Steps: Fire a Resolume Trigger clip cue and read the monitor line.
  - Pictures: [033.png](shots/theo-033.png)
- **Start from a folder puts the show inside the music folder, named after it, without asking** (dana, files, confusing, task save)
  - Expected: To pick a name and a place the first time I save, as QLab does.
  - Happened: After 'Start from a folder…' the title read 'tour music' and Save showed 'Saved' right away. show.json and a logs folder were added among the WAVs. Save never asked where or under what name.
  - Steps: Welcome screen ▸ Start from a folder… ▸ choose a folder of sounds and look at the title and the Save button.
  - Pictures: [003.png](shots/dana-003.png)
- **The web remote's key is saved in show.json** (theo, files, confusing, task file)
  - Expected: Since he keeps shows in git, nothing that grants control would be in the show file (the manual says exported settings never hold a remote's key).
  - Happened: show.json has "web-remote": { ... "key": "b1eb1b5adc7c154e" }. Committing the show publishes the key to control the show.
  - Steps: Switch on Web remote, save, read show.json.
- **Rig devices and Network patches are two separate lists; Show feedback and the monitor's Send see only patches** (theo, settings, confusing, task tally)
  - Expected: The two devices he just added would be the show's network equipment everywhere.
  - Happened: Settings > Integrations > Network said 'Patches: none' while the Rig had two devices (and a Network cue's Patch list offered both). Show feedback's 'Send to' had only '— choose a patch —', and the monitor's Send drop-down said 'no patches'. Had to make a separate Generic OSC patch.
  - Steps: Add a device on the Rig page, then open Settings > Integrations > Modules > Show feedback and open Send to.
  - Suggestion: Offer Rig devices wherever a patch is chosen.
  - Pictures: [067.png](shots/theo-067.png)
- **Recovering from an early GO takes three clicks** (priya, show-mode, missing, task run)
  - Expected: One move to undo the last GO: fade what it started and put the playhead back.
  - Happened: Had to click the row ■ on 7, the row ■ on the waiting 8 (auto-continued), then click row 7 to stand it by again. It worked cleanly and the rain was untouched.
  - Steps: Show mode, stand by 7, GO; then stop 7 and 8 and re-select 7.
  - Pictures: [067.png](shots/priya-067.png)
- **The firmware steps leave out the USB driver, finding the port and the BOOT button** (june, help, missing, task firmware)
  - Expected: Steps I can follow tonight from the Arduino IDE.
  - Happened: README step 3 says 'Choose the board and the port' but not how to tell which port is the board, nor that some boards need a CP210x/CH340 driver or BOOT held down to upload. 'esptool.py read_flash 0 ALL before.bin' is given with no word on where esptool comes from. Otherwise the steps, the wiring notes (separate 5 V supply, 1.8 A) and the 2.4 GHz warning are good.
  - Steps: Write firmware for any kit light; read props/<name>/README.md.
- **When the helper can't do something it lists its sentences but doesn't point to the screen that can** (june, help, confusing, task cue)
  - Expected: 'I cannot; do it with Effect > breathe on a Device cue' or 'add the lantern on the Rig page first'.
  - Happened: 'Lantern a has no command breathe. It has: Look, Colour, Level, Effect...' (breathe is under Effect). 'write firmware for my second lantern' gave 'The show has no device called my second lantern...' with no hint to add one. The distance sensor got the standard list.
  - Steps: Built-in helper with a kit light added: 'add a cue that sends breathe to Lantern a'.
  - Pictures: [070.png](shots/june-070.png)
- **First opening of the assistant does not say what it can do** (june, help, confusing, task folder)
  - Expected: On first open, the list of things to ask.
  - Happened: It said 'An empty show.' and one button 'Start from a folder of sounds…'. I only saw the list of sentences after a failed request.
  - Steps: Fresh start, click Ask the assistant.
  - Pictures: [002.png](shots/june-002.png)
- **The hand-over for coding agents is the dead end for a non-programmer** (june, help, confusing, task more)
  - Expected: Can the kit read a distance sensor or not; if not, plainly.
  - Happened: The suggested 'hand the show over' proposes AGENTS.md and CLAUDE.md and says to cd into a path (cut off at the bubble's right edge) and type 'claude'. Nothing about sensors.
  - Steps: Built-in helper: 'hand the show over'.
  - Pictures: [087.png](shots/june-087.png)

### Polish (10)

- **A lost lantern is shown only on the Rig page; the cue that uses it says nothing** (june, cue-list, missing, task ready)
  - Expected: The 'Lantern breathes' row marked when its lantern is gone.
  - Happened: In Edit view the only sign was a small red dot on the Rig tab. It took about 35-40 s to turn red, which is fine.
  - Steps: Device cue to a kit prop; stop the prop; look at the cue list after a minute.
  - Pictures: [070.png](shots/june-070.png)
- **Output routing is buried at the bottom of the Audio tab under More** (marcus, inspector, confusing, task click)
  - Expected: Output routing at the front, as QLab's Audio Levels tab has it.
  - Happened: Own outputs is under 'More (11)', below fade shapes and Rate, and you have to scroll the inspector twice to reach it.
  - Steps: Select any Audio cue, Audio tab, More, scroll down.
  - Pictures: [008.png](shots/marcus-008.png)
- **An Audio cue's Level is below the waveform; the tab has to be scrolled** (priya, inspector, confusing, task notes)
  - Expected: Level near the top of the Audio tab, like QLab's Audio Levels.
  - Happened: The Audio tab opens on the waveform; File and Level are only reached by scrolling the inspector. A 'Choose…' click landed on the wrong place once while it scrolled.
  - Steps: Select any Audio cue, click the Audio tab.
- **Music files go on a bus called 'Effects' by default** (dana, audio, wording, task trim)
  - Expected: Music tracks on the Music bus, or no bus I need to think about.
  - Happened: Each of the seven cues' Audio tab showed 'Bus: Effects'.
  - Steps: Start from a folder of music ▸ make cues ▸ Audio tab ▸ Bus.
- **A running fade is described as 'waiting'** (priya, audio, wording, task verify)
  - Expected: 'fading' while a fade runs.
  - Happened: During Rain returns' 3 s fade: '… "Rain returns" is waiting (0:01.3 of 0:03.0)', with Rain bed 'fading to -12 dB'. Same for stops: '"fade out" is waiting (0:00.9 of 0:02.0)'.
  - Steps: Fire 2 then 3; watch the active list during Rain returns' fade.
- **Reset's 'Sure?' confirm is easy to miss** (marcus, transport, confusing, task panic)
  - Expected: Reset to do what its tooltip says, 'Stop all, back to the top', or to make the confirm obvious.
  - Happened: The first press only changed the label to 'Sure? Reset'. I didn't notice and pressed GO, which fired the next cue. It was my mistake, but it is easy to make under pressure.
  - Steps: GO the Opening, press Reset once, look at the standby.
- **The firmware dialog's Pin shows 5 as a grey placeholder, not a value** (june, network, confusing, task firmware)
  - Expected: Either 5 is filled in, or the box is empty.
  - Happened: Pin showed a grey '5' next to LEDs with a white '30'; I could not tell if 5 would be used, so I typed it. The same grey placeholders (Cue list '1', Look '1') are in the Device cue inspector.
  - Steps: Open Write firmware... for a Prop light device.
  - Pictures: [081.png](shots/june-081.png)
- **Assistant's readiness says '(checked 15:49:31)' long after** (june, network, confusing, task ready)
  - Expected: The time of this answer.
  - Happened: Every 'is everything ready?' said 'checked 15:49:31', even 7 minutes later when it included the lantern that had just stopped. The content was current; the time made me doubt it.
  - Steps: Ask 'is everything ready?' twice a few minutes apart.
  - Pictures: [070.png](shots/june-070.png)
- **Monitor messages wrap one character per line when a row has a note** (theo, network, bug, task sensor)
  - Expected: '/sensor/door 0   did nothing' on one or two lines.
  - Happened: The address column wraps to one letter per line ('/ s e n s o r / d o o r 0') next to 'did nothing', taking a dozen lines. The narrow monitor also wraps every address over 3-4 lines and is hard to scroll to the newest entry.
  - Steps: Open the monitor, send an OSC message that matches no trigger.
  - Pictures: [046.png](shots/theo-046.png), [082.png](shots/theo-082.png)
- **Show mode leaves Edit one click away with no confirmation, and Reset is hidden** (dana, show-mode, confusing, task perform)
  - Expected: Leaving Show mode during a running show to be slightly harder than one click. 'Back to the top' to still be available.
  - Happened: Clicking 'Edit' while Bows was playing unlocked straight away. The 'Reset' button ('Stop all, back to the top') is not shown in Show mode, so I clicked row 1 to go back to the top.
  - Steps: Click Show, GO a cue, click Edit.
  - Pictures: [050.png](shots/dana-050.png)

### Praise (18)

- **The assistant says what it guessed and what it did not do** (june, import, praise, task folder)
  - '6 cues in file-name order ... without words like FINAL or v3. Lamp hum loop is called a loop. I did not make it loop. I did not read script.md.' And for the desk: 'I took that from your words, so reject this if it is something else.' Every change waited for Accept.
  - Pictures: [005.png](shots/june-005.png)
- **Import summary up front, and unsaved changes listed on the Save button** (marcus, import, praise, task bring)
  - The import sheet lists every cue that changed and says 'The QLab file is unchanged.' The Save button shows 'Save · 3' with the changes in its hint.
  - Pictures: [001.png](shots/marcus-001.png)
- **Import came across truthfully and the QLab hands work** (priya, import, praise, task verify)
  - Playlist, Start-first-and-enter group, loops, levels, fade dips, Stop cue, blackout's fade-others all came across and played right. Space GO, Esc panic (twice dead), Cmd+D duplicate, double-click a duration in the list, Cmd+S: all as in QLab. 'THIS GO: 2 OF 2 · Thunder, close' tells me what the next GO does inside a group.
  - Pictures: [015.png](shots/priya-015.png)
- **A Fade cue added under a sound is already set up as a fade-out and stop** (dana, cue-list, praise, task house)
  - It was numbered 1.5, targeted '1 · House music', went to -inf and had 'Stop target when done' on.
- **Disarmed cue is unmistakable in the standby header** (priya, cue-list, praise, task notes)
  - Header: 'STANDING BY DISARMED · GO SKIPS IT 4 Phone rings', row greyed, and unsaved edits get a dot on their row. Save · N lists each change.
  - Pictures: [059.png](shots/priya-059.png)
- **Vamp and devamp leave at the end of the pass, with track and click in step** (marcus, audio, praise, task vamp)
  - The slice came in as an endless loop region. The click looped with the track. GO on the Devamp mid-pass played to 0:24 and went straight on.
  - Pictures: [026.png](shots/marcus-026.png)
- **Counted section shows which pass it is on** (marcus, audio, praise, task counted)
  - 'pass 2 of 4 of a counted section', then on by itself into the held vamp, with a yellow HOLDING and a Let go button.
  - Pictures: [038.png](shots/marcus-038.png)
- **Load to Time is clear and remembers the time** (dana, transport, praise, task rehearse)
  - The screen showed 'LOADED TO 0:30.0 · this GO only' over the GO button, and Cmd+T came back with 0:30 already filled in.
- **The 'Standing by' line says what GO will do, including auto-follow** (dana, transport, praise, task perform)
  - With Driftwood standing by it said 'then, when it ends: 6 · Lantern'. Every other cue showed 'then N · name'.
  - Pictures: [054.png](shots/dana-054.png)
- **Load to Time is Cmd+T, remembers the time and says 'LOADED TO 0:25.0 · this GO only'** (marcus, transport, praise, task rehearse)
  - Same key, '25' read as 0:25, and the next time the field already holds 0:25.
- **Rig page and props: found, identified and checked in plain words** (june, network, praise, task lantern)
  - 'look for props' found the lantern at once; the row says 'answering · 1 ms · firmware 1.0 · signal -52 dBm', Try: Identify blinked it, and a stopped lantern turns red with 'last heard 44 s ago'. Exactly what I want before the house opens.
  - Pictures: [048.png](shots/june-048.png), [070.png](shots/june-070.png)
- **Firmware: the Wi-Fi password stays out of the app** (june, network, praise, task firmware)
  - The dialog says 'The Wi-Fi password goes in secrets.h, never in the show'; the app never asked for it; secrets.h has CHANGE-ME and a .gitignore. The README says honestly it has never run on a board.
  - Pictures: [081.png](shots/june-081.png)
- **Device models send exactly what the screen says** (theo, network, praise, task desk)
  - Eos and Resolume models list every command with the literal OSC it 'sends', +cue makes the cue, and /eos/cue/1/12/fire and /composition/layers/1/clips/2/connect 1 (int) arrived byte for byte.
  - Pictures: [012.png](shots/theo-012.png)
- **Incoming OSC that matches nothing is marked 'did nothing'** (theo, network, praise, task buttons)
  - /go before OSC control was on and /sensor/door 0 showed in the monitor with 'did nothing'. The title bar chip 'OSC control' says '4 received, last /panic'.
  - Pictures: [046.png](shots/theo-046.png)
- **Saving carries the sounds** (priya, files, praise, task save)
  - The saved .ecshow folder has media/ with exactly the ten sounds in use, including the replacement letter v2.wav.
- **Show file is readable, stable JSON that diffs to one line per change** (theo, files, praise, task file)
  - show.json is pretty-printed, ids are stable, cue defaults are left out, sounds are relative (media/heartbeat.wav). Renaming one cue and saving changed exactly one line.
- **Show feedback and web remote work with one switch each** (theo, settings, praise, task tally)
  - GO produced /endlesscues/go 2 heartbeat, /endlesscues/cue/2/start heartbeat, /endlesscues/running 1, /endlesscues/playhead 3 '...'. Web remote served its page with the key and refused without it (403).
- **Skipping ahead in Show mode needs a deliberate second click** (dana, show-mode, praise, task perform)
  - Clicking the waveform only set a mark ('◆ 0:48.3') and offered 'Skip', 'Fade to' and 'Clear'. Nothing moved until I clicked Skip.

## The test rig got in the way

- dana: The app menu's Quit is not available in a test session, so I closed it with the rig's stop and started it again.
- dana: hear reports a cue's own level and ignores the Master fader: with Master at −∞ it still said 'Bows at 0.0 dB'. I could not confirm the silence with my ears.
- dana: During a fade, hear shows the starting level ('at 0.0 dB (fading to -60 dB)') and calls the fade cue 'waiting'.
- dana: Windows, the reason Dana came, could not be tried: the session runs on a Mac.
- june: The assistant is the canned built-in helper, so the tasks that lean on it (talk, script, desk, cue, more) mostly test its fixed sentence list.
- june: Help > Manual opens a website the rig cannot show, and the manual file named in the brief was not on disk.
- june: The Who answers drop-down did not keep my choice, perhaps the rig's lock on the demo assistant.
- june: The bench desk stand-in (osc listen) does not answer /eos/ping, so the desk always showed 'not answering'.
- marcus: The output device is the MacBook speakers, but the test run pretends eight outputs, so I could not see whether a 2-output device would warn about clicks routed to 3-4.
- marcus: hear does not say which outputs a sound is on, so 'never reaches the house' was checked only from the inspector's routing, not from what came out.
- marcus: The Reset confirm timed out between my look and my click (the rig's delay between commands).
- priya: The QLab workspace's true contents (the MSC cue number, act 2's original group mode) were not knowable to me, so I guessed 'msc go 9' and accepted 'Start first and enter' as right.
- priya: Clicks while an inspector was still scrolling sometimes landed on the old position.
- theo: The brief's manual path (.claude/worktrees/endless_cues_service/site/docs/index.html) does not exist; I read /Users/jeshua/workspace/repos/endless_cues_service/site/docs/index.html instead.
- theo: The osc stand-in cannot answer /eos/ping, so the Eos device read 'not answering' even on the correct port, which blurred the 'wrong' task.
- theo: The ⋯ title-bar menu seems to be an OS menu; clicking it showed nothing in look.
- theo: Layouts shift after a drop-down choice or when a settings section expands, so clicks at coordinates from the previous look landed on the wrong field twice (Network cue fade fields, Settings modules) and once closed the Settings sheet. That was my stale coordinates, not the app.
- theo: Reset's 'Sure? Reset' confirm once seemed not to stop a playing cue; I could not reproduce it (the second try worked), so it is not reported.
