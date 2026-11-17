# Theo: show-control programmer, *The Cellar*

**Verdict: with-workarounds.** The bytes are right: every message I checked on the wire matched what the screen said, the ramp ended on exactly 1.0, and the show file is plain JSON I can diff. I'd bench it further for The Cellar, but three things would have bitten me at load-in: the lighting desk is configured in two places and the cue ignores the one I edited, Learn threw away the sensor's argument so a closing door fired the sequence, and a failed send looks the same as a good one. I also saw nothing here that tells me it runs on the Linux or Windows box under the staircase; that still has to be proven.

Ratings (1 bad, 5 good): learn 4, speed 4, clarity 3, trust 3.

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| bed | done-with-trouble | File > Add Sounds made both cues. Looked for Loop on the 'Time & Loops' tab first; the switch is on the Audio tab. hear confirmed 'looping'. |
| desk | done-with-trouble | Made an ETC Eos patch, then a Light cue with desk cue 12. Nothing was sent until I found the Lighting desk module, which wanted the desk's address a second time. Then /eos/cue/1/12/fire arrived on 8001, correct. |
| raw | done | Resolume patch, Network cue, typed the message. Arrived as /composition/layers/1/clips/2/connect 1 with an int argument. |
| ramp | done | The Resolume 'Layer opacity' command with 'Fade it' wrote '/composition/layers/1/video/opacity #v#'. 127 float messages over 5.0 s (about 29 ms apart), first 0, last exactly 1. |
| sensor | done-with-trouble | Learn captured '/sensor/door' without the 1, so '/sensor/door 0' started heartbeat too. Typing '/sensor/door 1' by hand fixed it: 1 fires, 0 does not. |
| buttons | done-with-trouble | OSC control module on; /go, /cue/5/start and /panic all worked. Cues have no numbers by default, so I had to renumber first, and a stuck rename box got in the way of numbering one cue. |
| tally | done-with-trouble | Show feedback module to a Generic OSC patch on 9100. GO sent /endlesscues/go, /cue/1/start, /running 1, /playhead 2. My first two Space presses did nothing because a click on the selected row had opened a rename box. |
| tablet | done | Web remote module: port 8137 with a key in the address. curl on 127.0.0.1 returned 200 and a page titled 'Endless Cues remote'; without the key, 403. The LAN address shown timed out from my terminal (rig, I think). |
| file | done | 'The Cellar.ecshow' is a folder: show.json (135 lines, indented, defaults left out, media paths relative) plus media/. Yes, I'd keep it in git and review a diff of it. |
| wrong | done-with-trouble | Changing the Eos patch to a dead port changed nothing: the cue still reached 8001, because Light cues use the module's own address. With the module on a dead port the cue fired with no error; the only sign is a red 'Lighting desk' chip saying 'desk not answering', which was also there when the message was arriving. |

## Findings, worst first

### [major] The lighting desk is set up in two places, and Light cues ignore the patch

*confusing, network, task wrong*

- **Expected:** One definition of the desk. I made an 'ETC Eos family' patch under Settings > Network at 127.0.0.1:8001; a Light cue should send there, as a QLab Network cue sends to its patch.
- **Happened:** The Light cue sent nothing until I turned on Settings > Modules > Lighting desk, which said 'no desk address set' and asked for Desk address and Desk OSC port again. Later I changed the patch's port to 8055 and fired LQ 12: /eos/cue/1/12/fire still arrived on 8001. The patch said 'not used yet' throughout. show.json holds both: modules.lighting-desk.host/port and settings.network.patches[0].
- **Steps:** New show. Settings > Network > Add a patch > ETC Eos family, address 127.0.0.1, port 8001 (Enter after each). Settings > Modules > Lighting desk on, address 127.0.0.1, port 8001. Add a Light cue, desk cue 12. Change the patch port to 8055. Fire the cue: it still arrives on 8001.
- **Evidence:** shots/014.png, shots/064.png
- **Suggestion:** Have the Lighting desk module point at a patch, as Show feedback already does.

### [major] Learn stores the OSC trigger without its argument, so /sensor/door 0 fires the cue

*bug, network, task sensor*

- **Expected:** Learn to capture what the sensor sent, '/sensor/door 1', or to ask whether the argument matters. The field does accept an argument when typed.
- **Happened:** After Learn and sending '/sensor/door 1' the field read '/sensor/door'. '/sensor/door 0' then started heartbeat. Typing '/sensor/door 1' by hand made 0 stop firing it. (Learn itself run once; the firing on 0 seen once before the manual fix.)
- **Steps:** Audio cue > Basics > scroll to OSC trigger > Learn. Send /sensor/door 1 to UDP 53000. Field shows '/sensor/door'. Send /sensor/door 0: the cue plays.

### [major] A Light cue fired with the module off, or at a dead port, gives no sign on the cue that nothing reached the desk

*confusing, network, task wrong*

- **Expected:** Something where I'm looking, on the cue or by the GO button, when a cue that should send produced no message, and a status that differs between 'sending fine' and 'nothing there'.
- **Happened:** With the Lighting desk module off, auditioning LQ 12 sent nothing and the screen said nothing; only the grey description 'with the Lighting desk module on, fired on the desk' hints at it. With the module on, the title bar shows a red 'Lighting desk' chip, hint 'desk not answering'. That chip read the same while /eos/cue/1/12/fire was arriving on 8001 (my stand-in does not answer pings) and while the port was 8055 and nothing arrived.
- **Steps:** New show, Light cue with desk cue 12, press V with the module off: no message, no warning. Turn the module on at a port nothing listens on, press V: same chip as with a correct port and a desk that does not answer /eos/ping.
- **Evidence:** shots/014.png, shots/025.png, shots/065.png
- **Suggestion:** Mark a Light cue as 'not sent' when the module is off, and show the last sent message on the chip so 'sent, no answer' differs from 'off'.

### [major] Clicking the already-selected row opens a rename box that swallows Space, so GO does nothing

*bug, cue-list, task tally*

- **Expected:** Click the cue I want standing by, press Space, it goes. That is what I do all night in QLab.
- **Happened:** Twice. On room tone: clicked the selected row, Space, Space: no GO, nothing on the tally, playhead still on 1; GO with the mouse then worked. On heartbeat: the row showed an empty name box that stayed open while the selection moved to another row, and the number I typed in the inspector did not land. I am not certain a single click (rather than my two clicks in a row) is what opens it.
- **Steps:** Select a cue. Click the same row again. Press Space: no GO; the keystroke goes into an inline name field.
- **Evidence:** shots/043.png, shots/057.png

### [minor] Settings fields kept a typed value only after Enter

*bug, settings, task desk*

- **Expected:** Type an address, Tab to the port, type it, close: both kept.
- **Happened:** Patch address and port (twice) and the Lighting desk module's three fields (once) showed what I typed after Tab or after clicking another field, but were blank or back to 8000/8001 when I reopened Settings; the module still said 'no desk address set'. With Enter after each field they stuck. This may be the test rig's typing rather than the app: I could not tell.
- **Steps:** Settings > Network > add an ETC Eos patch. Click Address, type 127.0.0.1, Tab, type 8001, click the heading. Go to Modules and back to Network: Address empty, Port 8000.

### [minor] Incoming messages in the Monitor are labelled with the wrong device

*confusing, network, task tally*

- **Expected:** The sender's address and port, or 'unknown', for a message from something that is not a patch.
- **Happened:** The door sensor's '/sensor/door 1' and the button box's '/go', '/panic', '/cue/5/start' are all listed as '← ETC Eos family'. Everything is 127.0.0.1 on this bench, so it probably matched by IP; on the real rig a sensor with no patch would still need its IP shown.
- **Steps:** Make a patch at 127.0.0.1. Turn on OSC control. Send /go to UDP 53000 from the same machine. Settings > Network > Monitor.
- **Evidence:** shots/052.png

### [minor] The Monitor is only inside the Settings dialog

*missing, network, task tally*

- **Expected:** To watch messages while pressing GO, as with a console window beside the cue list.
- **Happened:** The Monitor is at the bottom of Settings > Network, a dialog over the cue list. I fired, then opened Settings and scrolled to read it.
- **Steps:** Fire a Network cue, then try to see the sent message without leaving the cue list.
- **Evidence:** shots/052.png

### [minor] Loop is not on the tab called 'Time & Loops'

*confusing, inspector, task bed*

- **Expected:** The loop switch under 'Time & Loops'.
- **Happened:** That tab has the waveform, Markers and 'Loop regions: None. A region is a stretch that loops cleanly…' with no control to make one. The plain 'Loop' switch is on the Audio tab.
- **Steps:** Add a sound, select it, open Time & Loops and look for a way to loop the file.
- **Evidence:** shots/004.png

### [minor] New cues have no number, so /cue/<number>/start has nothing to address

*confusing, cue-list, task buttons*

- **Expected:** Cues numbered as they are made, as in QLab.
- **Happened:** All five cues had an empty NUMBER. I selected all and used Tools > Renumber Selected Cues… (which worked well) before the button box could call a cue.
- **Steps:** New show, add any cues: NUMBER is empty.

### [polish] The OSC control module does not list the addresses it accepts

*missing, settings, task buttons*

- **Expected:** A short list of addresses, or a link, next to the switch.
- **Happened:** It says 'QLab-compatible addresses' and offers a passcode. /go, /panic and /cue/5/start happened to be what my button box sends.
- **Steps:** Settings > Modules > OSC control.

### [polish] No visible way to force an argument's type on a typed message

*missing, network, task raw*

- **Expected:** A note by the OSC message field on how to send 1 as a float or as a string.
- **Happened:** '1' went as an int (right for this clip trigger) and '#v#' as a float. The placeholder elsewhere is '/address 1 2.5 word'; nothing says how to send a float 1.0 or a quoted string. Not tried further.
- **Steps:** Network cue > OSC message field.

### [polish] The web remote's key is empty in show.json while the address shows a key

*confusing, files, task tablet*

- **Expected:** To know whether the stage manager's bookmark survives a restart of the PC.
- **Happened:** Settings shows 'http://192.168.1.x:8137/?k=<key>' with the Key field empty, and show.json has "key": "". I did not restart to see whether the key changes.
- **Steps:** Turn on Web remote, save, read modules.web-remote in show.json.

## What worked well

- **Sent and received bytes matched the screen every time.** /eos/cue/1/12/fire; /composition/layers/1/clips/2/connect 1 (int); a 5 s ramp of 127 floats from 0 to exactly 1; tally messages /endlesscues/go, /cue/1/start, /running, /playhead. The Monitor showed the same lines with times and direction, and shows a float 1 as '1.0'.
- **Device kinds know their equipment.** The Eos patch gives the desk's own menu path ('Setup ▸ System ▸ Show Control ▸ OSC…'), the Resolume patch defaults to 7000, and the Network cue offers 'Layer opacity' with 'Fade it', which wrote exactly the address I was going to type, with #v# as in QLab.
- **The show file is small, readable, diffable JSON.** show.json: 135 indented lines, one field per line, only non-default fields on each cue, patches referred to by id, media as relative paths inside the .ecshow folder. The unsaved chip counts changes before a save.
- **Modules page answers 'can it do X' in one screen.** OSC control, Lighting desk, Web remote and Show feedback are four switches with one line each, their status shows as chips in the title bar ('listening on UDP 53000 · 3 received, last /panic'), and what is not built yet is listed as 'planned'. The web remote refuses a request without its key (403).

## The rig

- The web remote's LAN address (192.168.1.x:8137) timed out from the terminal though the app listens on all interfaces; 127.0.0.1 worked. Probably the test shell's network limits.
- The stand-in desk never answers /eos/ping, so 'desk not answering' showed even when sending was correct; this colours the 'wrong' task.
- Possibly the rig: typed text in Settings fields is committed only by Enter, not by Tab or clicking away (reported as a finding with that caveat).
- Operator error outside the app: early in the run my command wrapper was overwritten by another session's, so one note ('Looked for Loop under Time & Loops…'), one failed click and two looks went to the dana session instead of mine. Nothing in dana's app changed, but dana's journal has a stray note from Theo.
