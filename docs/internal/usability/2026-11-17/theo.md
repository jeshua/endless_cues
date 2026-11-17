# Theo: The Cellar, bench test

**Verdict: with workarounds.** Every byte I checked matched what the screen said. The device models saved me typing, OSC control and the tally feed worked first time, and the show file is the best I have seen for git: renaming a cue was a one-line diff. Two things hold me back. A Network fade sent 146 messages with no value until I found `#v#` in the manual. And a desk on the wrong port looks fine everywhere except a small dot on the Rig tab. I'd bench it more before I bolt it under a staircase for four months.

Ratings: learn 4 · speed 4 · clarity 3 · trust 3

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| bed | done with trouble | Both files went in from one dialog. Loop is the "Whole sound" switch on Time & Loops. The cues came in with no numbers, even though "Number new cues" is on. |
| desk | done | Picked the ETC Eos family model and set 127.0.0.1:8001. Typed 12 in Fire cue's second, unlabelled box, then pressed +cue. `/eos/cue/1/12/fire` arrived exactly as shown. |
| raw | done | Used the Resolume model's Trigger clip (clip 2). `/composition/layers/1/clips/2/connect 1` arrived as an int. The monitor does not show the type. |
| ramp | done with trouble | Without `#v#`: 146 messages with no argument. With `#v#`: 146 floats over 5.03 s, the last exactly 1.0. |
| sensor | done | OSC trigger `/sensor/door 1`. Sending 1 started the cue. Sending 0 did not, and the monitor said "did nothing". |
| buttons | done | Turned on the OSC control module. Then `/go`, `/cue/5/start`, `/cue/2/start` and `/panic` all worked. |
| tally | done with trouble | The Show feedback module needs a "patch", and the Rig devices are not offered. Made a Generic OSC patch. GO then sent `/endlesscues/go`, `/cue/2/start`, `/running`, `/playhead`. |
| tablet | done | Web remote is one switch. curl with the key got 200 (HTML page); without the key, 403. |
| file | done | Saved to a `.ecshow` folder. `show.json` is pretty, stable JSON and a rename is a one-line diff. The remote's key is stored in the file. |
| wrong | done with trouble | Port 8009: the monitor showed the send like a normal one. The cue row and Show mode showed nothing; the only sign was a red dot on "Rig". |

## Findings, worst first

1. **Major: a Network cue fade without `#v#` sends the bare address over and over, with no warning.** I filled in Fade from 0, Fade to 1 and Duration 5 s. The media server got 146 × `/composition/layers/1/video/opacity` with no argument, and the monitor showed the same. Nothing told me the fade boxes were unused; only the manual mentions `#v#`.
2. **Major: a device that is not answering shows only on the Rig page.** A cue aimed at a dead or mis-ported desk looks like every other cue in the list, the standby line and Show mode. The monitor shows the send as normal. Also, a wrong port and a desk that doesn't answer the ping both just read "not answering".
3. **Minor: Rig devices and Network patches are two separate lists.** Settings said "Patches: none" while the Rig had two devices. Show feedback's "Send to" and the monitor's Send box only list patches.
4. **Minor: incoming messages from 127.0.0.1 are labelled "ETC Eos family".** The sensor's and button box's messages showed up as coming from the lighting desk. The app seems to match the sender by IP alone.
5. **Minor: the first cues in a new show get no numbers,** even though "Number new cues" is on.
6. **Minor: the Rig's command boxes have no labels.** Fire cue showed two boxes, both reading "1". The "sends" preview only updates when you leave the box. The labels ("Cue list", "Cue") exist in the show file.
7. **Minor: the monitor does not show OSC argument types** (int, float or string).
8. **Minor: the web remote's key is saved in `show.json`.** If I commit the show to git, I publish the key that controls it.
9. **Polish: the monitor's text wraps badly.** When a row says "did nothing", the address wraps one letter per line (`/ s e n s o r ...`). The panel is narrow and hard to scroll to the newest message.

## What worked well

- **The show file.** It is readable JSON with stable ids, cue defaults left out and relative media paths. One edit changes one line of the diff.
- **The device models.** Each command shows the literal OSC it sends, and +cue makes the cue. The bytes on the wire matched the screen.
- **Unmatched incoming OSC is marked "did nothing".** The title-bar chip says how many messages arrived and which was last.
- **Show feedback and the web remote are one switch each.** Their output was clean and useful, and the remote refuses a request without its key.

## Rig notes

- The manual path in the brief does not exist; I read the copy in `endless_cues_service/site/docs/`.
- The stand-in listener cannot answer `/eos/ping`, so the desk always read "not answering".
- The layout shifts after a choice, so a few of my clicks used stale coordinates and landed in the wrong place. That was my mistake, not the app's.
- Once, Reset's "Sure?" confirm seemed not to stop a playing cue. I could not make it happen again, so it is not reported as a finding.
