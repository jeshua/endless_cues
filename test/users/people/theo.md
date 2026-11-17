# Theo, show-control programmer on an immersive show

## Who

Freelance show-control programmer for immersive and site-specific theatre: audiences walk through rooms, and sensors, performers' button boxes and a stage manager's tablet fire the cues. Uses QLab as the hub: almost every cue is a Network cue or is fired by an incoming OSC message. Writes OSC by hand, reads protocol manuals, keeps shows in git when the tool allows it. Comfortable in a terminal.

Sceptical. Assumes a feature does not work until he has seen the bytes arrive.

## The show

*The Cellar*, a promenade piece in a basement. A sound bed per room, a lighting desk (ETC Eos family), a media server (Resolume), a door sensor that starts a sequence, a button box for the stage manager, and a tally display that shows what the show is doing. Nothing is built yet: this is the bench test before load-in.

## Why he is here

The show runs for four months on a small PC bolted under a staircase. It has to run on Linux or Windows, and he wants a show file he can diff.

## On the desk

- `sounds/`: four sounds
- `rig.txt`: the rig's addresses and ports, and how to stand in for each device on this computer

This session has real network ports. Stand in for the three devices with `osc listen` before you send anything to them.

## Tasks

1. **bed** Start a new show. Add `room tone` as a looping cue and `heartbeat` as a second cue.
2. **desk** Tell the app about the lighting desk (127.0.0.1, UDP 8001). Make a cue that fires lighting cue 12 on the desk, using the app's knowledge of the desk rather than a typed address if it has any. Fire it and check the exact message that arrived.
3. **raw** Tell the app about the media server (UDP 7000). Make a cue that sends `/composition/layers/1/clips/2/connect 1`. Fire it and check what arrived, including the type of the argument.
4. **ramp** Make a cue that moves a value on the media server from 0 to 1 over 5 seconds at `/composition/layers/1/video/opacity`. Fire it and look at how many messages arrived and whether the last one is exactly 1.
5. **sensor** Make the door sensor's message (`/sensor/door 1`) start the heartbeat cue. Send it and check. Then send `/sensor/door 0` and check that it does not.
6. **buttons** Make the stage manager's button box work: `/go`, `/cue/<number>/start` and `/panic` sent to UDP 53000. Check each one.
7. **tally** Make the app tell the tally display (UDP 9100) what it is doing. Press GO and read what arrived.
8. **tablet** Find out whether the stage manager can have the cue list and a GO button on a tablet's browser. If so, turn it on and fetch the page from a terminal to check it is served.
9. **file** Save the show to the desk. Read the saved file as text. Decide whether you could keep it in git and review a change to it.
10. **wrong** Give the lighting desk patch a port nothing is listening on, fire the cue, and see what the app tells you.

## What he judges it on

- Do the bytes on the wire match what the screen says was sent?
- Can he see every message in and out while debugging?
- When something on the network is wrong, does the app say so where he is looking?
- Is the show file something he can read, diff and trust?
