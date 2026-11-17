# 14 · Lighting

Two ways a show reaches its lights, and a show may use either or both:

- **A lighting desk runs the lights**, and the cue list calls its cues: a Light cue with a *desk cue number*, fired on the desk by the Lighting desk module ([06 · Control surfaces](06-control-surfaces.md#8-module-lighting-desk)).
- **The app runs the lights itself**: a Light cue with *levels*, faded by the app and sent as DMX over the network. This document is about that, and ends with the test scripts for both.

**No fixture has ever been lit by this code.** The packets are built from the published Art-Net 4 and ANSI E1.31 specifications and tested byte by byte and on loopback sockets; no node, dimmer or light has received one. Section 9 is the script for the first time.

## 1. The pieces

```
show.json  settings.light ─▶ core/light/patch.ts     names, fixtures, addresses, groups; what cannot work → problems
                              core/light/fixtures.ts  what a kind of light is: its channels, homes, default parameter
Light cue  levels (text)  ─▶ core/light/commands.ts  "front = 80" → { 'front.intensity': 80 }
cue engine (GO, pause…)   ─▶ core/light/lighting.ts  the glue, and the one timer (40 Hz)
                              core/light/rig.ts       every level now; moves between states; DMX per universe
                              core/light/output.ts    sockets: Art-Net (artnet.ts), sACN (sacn.ts)
```

Everything under `core/light/` is plain Node and tested with `node --test` (`test/light*.test.js`). The host (`app/main/host.ts`) makes one `createLighting`, hands it the engine, gives it `settings.light` whenever the show changes, and passes on Panic, Reset and the `light-…` commands.

## 2. The patch (`settings.light`)

```jsonc
"light": {
  "on": false,                 // Send DMX. Off: levels are kept and shown, nothing is put on the network
  "rate": 40,                  // refreshes a second (1–44)
  "panicBlackout": false,      // Esc also takes the lights out (section 6)
  "universes":   [ { "id": 1, "protocol": "artnet", "address": 0, "host": "" } ],
  "instruments": [ { "name": "front", "fixture": "dimmer", "universe": 1, "address": 1, "note": "" } ],
  "groups":      [ { "name": "wash", "members": ["front", "side L"] } ],
  "fixtures":    [ { "id": "wash7", "name": "Wash 7", "params": [ { "key": "intensity", "bits": 8, "home": 0 }, … ] } ]
}
```

- A **universe**'s `id` is the number instruments name. `address` is the universe as the protocol counts it: an Art-Net port address 0–32767 (Net × 256 + Sub-Net × 16 + Universe), an sACN universe 1–63999. `host` empty means broadcast on every network this computer is on (Art-Net) or the universe's multicast group `239.255.hi.lo` (sACN); with an address, that receiver only.
- An **instrument**'s name is how cues talk about it, compared without case, unique across instruments and groups. Not allowed: `all` and the other command words, anything that reads as a range (`1-3`), characters other than letters, digits, space, `_ ' -`. A number is a fine name. With no universe or address it is "not patched": it has levels and nothing is sent for it.
- A **group** lists instruments or other groups; it is flattened to instruments (a group that contains itself stops there). `all` is every instrument, always.
- It is edited with `show.set` on `settings.light.…` like any setting, so it is undoable, versioned and reviewable. `patch.compile` never throws: two instruments sharing a channel, an address that runs off 512, an unknown fixture, a universe that is not set up, a clashing name are `problems`, shown in Settings ▸ Integrations ▸ Light and in the dashboard, and the instrument concerned is left unpatched.

**Fixtures.** Every level is a percentage, 0–100, whatever the parameter. A parameter takes one channel, or two (coarse then fine) when it is 16-bit, and has a `home`. `intensity` is the default parameter (what `front = 80` sets) and what a blackout removes; a fixture without one uses its first parameter. A fixture of red, green and blue with no dimmer channel (`rgb`, `rgbw`, `rgba`) gets an intensity that is not a channel: it scales the colour channels on the way out, so `all = 0` is dark for every kind of light. Colours are at home at 100 and intensity at 0. Built in: `dimmer`, `rgb`, `rgbw`, `rgba`, `dimmer-rgb`, `dimmer-rgbw`, `mover` (intensity, pan, tilt), `mover-16` (16-bit pan and tilt). A show adds its own as text, one parameter a line in DMX order (`pan 16`, `iris home 100`), kept in `settings.light.fixtures`. There is no manufacturer library and no import of QLab's or GDTF definitions.

## 3. Light commands

One a line, top to bottom, the later line winning. The language follows QLab's so its users can read it.

| Line | Means |
|---|---|
| `front = 80` | an instrument's default parameter |
| `wash = 50`, `all = 0` | each instrument of a group; every instrument |
| `cyc.red = 100` | one parameter (on a group: the members that have it) |
| `cyc.colour = #ff8800` | red, green and blue at once (`color` is read too) |
| `1 - 6 = 75`, `1, 3, front = 75`, `[1 - 3] = 50` | instruments named by numbers as a range; a list |
| `spot.pan = home` | where that parameter rests |
| `front = pass` | drops what earlier lines of this cue said about it |
| `full`, `out` | 100, 0 |
| `# …`, `// …` | a note |

Not read: QLab's `= cue A` (a pull from another cue; reported as an error on that line), `pantilt(x,y)`. A line that cannot be read is reported with its number (`show.problems` gives the cue a warning) and left out; the rest of the cue still runs.

## 4. Light cues

The `light` type (`core/show/cue-types.ts`) has `levels` (the text), `duration` (the fade time, default 3 s), `block` ("Full state"), and the desk's `lightCue` and `follows`. A cue with neither levels nor a desk cue number is an error.

- **Tracking.** A level stays where it was put until something moves it: a cue says only what changes. A cue with **Full state** also sends every parameter it does not name home, so the stage is that cue whatever ran before. There is no "collate previous cues": jumping into the middle of a show gives whatever is live plus that cue, unless it is a full state.
- **The fade** is linear, one time for the whole cue. In the engine it is an entry in `fades` (`light: true`): it shows in Active Cues, an auto-follow waits for it, it pauses and resumes with its cue, and a Stop cue aimed at it (or S) leaves the lights where they have got to. The rig has no clock for it: every refresh, `lighting.step()` reads how far the engine's fade has got. That is why pause, resume and stop need no second timer.
- **Latest takes precedence**, parameter by parameter: a new move takes a parameter from an older one still running.
- **A Fade cue aimed at a Light cue** takes what that cue's text names back home over the Fade's time (To level at −60, the default), or back to the cue's levels (any higher level). It is the Fade's own move, so it too pauses and stops.
- **Light cues are stops** is this computer's switch for desk cues called by a board operator. A cue with levels is always a stop and always runs; with the switch off only its desk number is not fired.

## 5. The dashboard and recording

The **Lights** drawer (⇧⌘D, View ▸ Light Dashboard) sits beside the cue list. It shows every group and instrument at its level (a multi-parameter instrument unfolds; a colour-mixing one shows its colour as a swatch, which is data), takes a command line with an "over N s" time, and has Blackout, Clear (everything home), and Revert (what hands changed goes back to what cues set). A level a hand has moved is drawn in the standby colour until it is recorded: it is in no cue yet.

- **New cue: changes** records only the hand-moved levels (a tracking cue), after the selected cue.
- **New cue: everything** records every level, marked Full state.
- **Update** writes the hand-moved levels into the one Light cue selected: a line that set exactly that level is rewritten in place, anything else is added at the end.

Recording is an edit (`cue.add` / `cue.set` through `core/show/ops.ts`), so it is undoable and locked in Show mode. Host commands: `light-set { text, secs }`, `light-level { name, param, value, secs }`, `light-blackout { on }`, `light-clear { secs }`, `light-revert { secs }`, `light-record { mode: 'changes' | 'all', id?, after? }`, `light-fixture { id?, name, text }`. The pushed state has `light`: instruments with their parameters, groups, `blackout`, `changed`, universes with what was sent, Art-Net nodes heard, patch problems, the fixture list.

Not built: parking, subcontrollers, an audition (blind) tab, undo of dashboard changes, update-originating-cues, MIDI control of the dashboard, a DMX status window, fade curves.

## 6. Panic, Reset, Blackout

- **Panic (Esc) stops light fades where they are and holds the levels. It does not black out.** Esc is the key for sound gone wrong, pressed in a hurry; a stage that goes dark under people who are moving is a hazard that a wrong sound is not. A show that wants Esc to take the lights too sets `settings.light.panicBlackout` (Settings ▸ Integrations ▸ Light ▸ "Esc also takes the lights out"): then everything goes home over the panic time, at once on the second Esc.
- **Reset** stops the fades and leaves the lights as they are (going back to the top in a rehearsal should not put the room in the dark). Make the first Light cue of the show a full state.
- **Blackout** is its own control, in the dashboard, with a LIGHTS BLACKOUT chip in the title bar while it is on. It is applied at render only: each instrument's intensity goes out as 0 (a moving head goes dark and does not swing home), the levels underneath are untouched, and cues go on running behind it. It is not saved with the show.

## 7. On the wire

- One timer in the main process, at `rate` (40 Hz): moves advance, every universe is rendered and **sent whether it changed or not**. That steady stream is how the last frame is held; there is no "send on change" mode. With no instrument there is no timer; with Send DMX off or no universe there is no socket.
- **Art-Net** (`artnet.ts`): ArtDmx with a 1–255 sequence per universe, always 512 levels. One socket bound to UDP 6454: it answers another controller's ArtPoll with an ArtPollReply (style: controller; up to four universes of one Net and Sub-Net declared), and polls every 3 s itself so the nodes that answer can be listed in Settings ▸ Integrations ▸ Light. If 6454 is taken the levels are still sent from another port and nodes cannot be listed. A universe with no address is broadcast to every interface's broadcast address; it is not unicast to the nodes that subscribe to it (Art-Net 4's preferred way), and no interface can be chosen.
- **sACN** (`sacn.ts`): E1.31 data packets, priority 100, a CID made from the computer's name, multicast or unicast; three stream-terminated packets when a universe stops being sent. No synchronisation packets, no universe discovery, no per-address priority, and the multicast interface is the operating system's choice.
- **A test run sends nothing.** `createLighting({ dryRun })`, set by the host for `--smoke` and for a driven session without network ports, exactly as `core/net/hub.ts` takes it: every packet is built and the last one kept (`output.last(id)`), and no socket is opened. The unit tests use loopback sockets or bytes only.

## 8. USB DMX: what it would take

Not supported. A USB interface is a serial port, and Node has none of its own: it needs the native `serialport` module, built per platform and architecture, unpacked from the asar and signed with the app. That is the first native dependency in an app that has none, so it waits for a decision rather than being slipped in. What is ready: `core/light/usb.ts` builds the Enttec DMX USB Pro "send DMX" message (label 6; also spoken by the Pro Mk2 and DMXking's ultraDMX family), tested to the byte. What remains: the dependency and its packaging; listing ports and choosing one (this computer's setting, not the show's); a third `protocol` for a universe (`usb`); writing a frame only when it changes (the widget repeats the last one itself) and reopening the port when the cable comes back. The cheap "Open DMX" cables have no processor and need break timing JavaScript cannot give: they are out of scope.

## 9. Test script: the first real fixtures

Needs: an Art-Net or sACN node (or a fixture that takes either directly), one dimmer or LED fixture whose DMX chart you have, a network cable. Write down what happens at each step; a step that fails is a bug report with the step number.

1. Put the computer and the node on the same network (Art-Net nodes are usually 2.x.x.x or 10.x.x.x with mask 255.0.0.0; give the computer an address in the node's range). Close any other lighting software.
2. New show. Settings ▸ Integrations ▸ Light ▸ Add a universe. Leave it Art-Net, universe 0 (or what the node's port is set to), "Send to" empty.
3. Add an instrument: Dimmer, universe 1, the fixture's address. Rename it `test`.
4. Switch **Send DMX** on. Expect: the Output line says "sending, 40 times a second"; within about 5 s "Art-Net nodes answering:" names the node. *If the node is not listed but step 6 works, note it: polling is the least certain part.*
5. On the node (or its web page), look for its DMX/Art-Net activity light. Expect: active.
6. Open Lights (⇧⌘D). Drag `test` to 100. Expect: the light at full, no visible steps or flicker. Drag slowly from 0 to 100 and back.
7. Type `test = 50` and Enter; then set "over" to 5 and type `test = 0`. Expect: half, then a smooth five-second fade out.
8. Blackout on, off. Expect: dark at once, then back to where it was.
9. Add a Light cue `test = 100`, fade time 4; a second, `test = 20`, fade time 2. GO each. Expect smooth fades of those lengths. GO the first again and press P halfway: the light holds; P again: it carries on. GO it and press Esc halfway: the light **stays** where it is.
10. Leave it at 50 for ten minutes. Expect: steady, no flicker or dropouts. Pull the network cable: note what the node does (hold or dark is the node's own setting). Plug it back: the light returns to 50 by itself.
11. Quit the app with the light on. Note what the node does.
12. Set "Send to" to the node's address (unicast). Repeat step 6.
13. Change the universe to sACN, universe 1, the node set to sACN. Repeat steps 6, 9 and 11. Expect at 11: the node lets go at once (stream terminated) rather than after its timeout.
14. With an RGB fixture: patch it as RGB (or Dimmer + RGB, per its chart). `x = 100`, then `x.colour = #ff0000`, `#00ff00`, `#0000ff`. Expect red, green, blue: if the order is wrong the fixture's chart differs from the definition (make one under Fixtures).
15. With a moving head: patch as the 16-bit mover only if its chart is intensity, pan, pan fine, tilt, tilt fine in that order; otherwise write its definition. `x.pan = 0`, `x.pan = 100` over 10 s. Expect a smooth sweep with no stepping.
16. If another Art-Net controller or monitor is available (a desk, a node's diagnostic page, a monitoring program on a second computer): expect "Endless Cues" in its device list as a controller.

## 10. The Lighting desk module: review, and a test script at a desk

Reviewed against the manufacturers' published documentation (ETC's Eos family online help and community support pages; MA Lighting's grandMA3 manual, "OSC" and the Goto keyword). Not run against either desk.

| Message | Verdict |
|---|---|
| Eos fire: `/eos/cue/<list>/<n>/fire`, no arguments | Agrees with the manual ("/fire/ activates the specified cue regardless of sequencing"). Sent with no argument on purpose: with an argument Eos treats it as a button, down then up. |
| Eos ping: `/eos/ping` → `/eos/out/ping` | Agrees. |
| Eos heard: `/eos/out/active/cue/<list>/<n>`, `/eos/out/pending/cue/<list>/<n>` | Agrees with the manual's implicit output as quoted on ETC's forum; the active cue is re-sent about once a second while it runs. |
| Eos device template: `/eos/key/go_0`, `/eos/macro/<n>/fire`, `/eos/sub/<n>` 0–1, `/eos/chan/<n>` 0–100, `/eos/newcmd "…#"` | `go_0` agrees with third-party set-up sheets. `/eos/key/stop` and the argument ranges are as remembered from the manual and were **not** re-read: check them at the desk (step E7). |
| grandMA3 fire | **Changed.** It sent `Go+ Sequence <list> Cue <n>`; the manual's keyword for running a named cue with its own timing is Goto ("jump in a list using the original cue timing"), with the cue first: now `/gma3/cmd "Goto Cue <n> Sequence <list>"`. The device template's "Go to cue" was reordered to match. |
| grandMA3 set-up text | **Corrected.** The manual gives a new OSC line no prefix (the note said "default gma3"), and commands need the line's Receive and **Receive Command** set to Yes as well as Enable Input. The address is `/cmd` with one string; with the prefix, `/gma3/cmd`. |
| grandMA3 port | The manual states no default. The template's 8000 is only a starting value: use the port on the desk's OSC line. |

**At an Eos desk (or Nomad on a second computer).** Needs a show file with cue list 1 holding cues 1, 2, 2.5 and 3 with visibly different looks, and a cue list 2 with a cue 1.

- E1. Desk: Setup ▸ System ▸ Show Control ▸ OSC: OSC RX on, OSC TX on, UDP RX port 8000, UDP TX port 8001, TX IP address = this computer's. Note the desk's address.
- E2. App: Settings ▸ Integrations ▸ Network ▸ Add a patch ▸ ETC Eos family; its address; "Answers on port" 8001. Press Test. Expect the patch to say "answering". *If not: the desk's network interface may have OSC switched off (its shell's network settings); a firewall on this computer may be dropping UDP 8001.*
- E3. Settings ▸ Integrations ▸ Modules ▸ Lighting desk on, no address of its own. Expect its chip in the title bar: "desk answering".
- E4. Add Light cues with desk cue numbers 1, 2, 2.5, 3. Put the desk on cue 3. GO the first. Expect: the desk runs cue 1 in its own time, and the chip says "on cue 1".
- E5. GO through 2, 2.5, 3. Expect each on the desk. Fire cue 2 twice (select its row and press V twice, in Edit mode): expect cue 2 to run again, never cue 2.5.
- E6. Press GO on the desk itself to move it ahead. Expect: the chip follows the desk's active cue.
- E7. From a Network cue on the Eos patch, send each template command once and say what the desk did: GO, Stop/Back, Fire macro 1, Submaster 1 at 0.5, Channel 1 at 50, Command line `Chan 1 At Full#`.
- E8. Set the module's cue list to 2; a Light cue with desk number 1. Expect: list 2's cue 1.
- E9. Pull the cable. GO a Light cue. Expect within 5 s: "desk not answering" on the chip; the cue still marked as sent (UDP cannot know). Plug in: "desk answering" returns by itself.
- E10. A Light cue numbered `abc`. Expect: flagged on the cue, a notice that it is not a number this desk takes, nothing sent.

**At a grandMA3 (or onPC).** Needs Sequence 1 with cues 1, 2 and 3, assigned to an executor, and a Sequence 2.

- M1. Desk: Menu ▸ In & Out ▸ OSC. Enable Input on. New line: Destination IP this computer's, Mode UDP, a Port (note it), Prefix `gma3`, Receive Yes, Receive Command Yes.
- M2. App: Settings ▸ Integrations ▸ Network ▸ Add a patch ▸ grandMA3; the desk's address and that port. Modules ▸ Lighting desk on.
- M3. A Network cue: Command `Go+ Sequence 1`. GO. Expect: the sequence goes one cue. *If nothing: watch the desk's System Monitor for the incoming line; an error there about the command means Receive Command, about the address means the prefix.*
- M4. Light cues with desk numbers 1, 2, 3. GO each. Expect: the desk's System Monitor shows `Goto Cue <n> Sequence 1` and the sequence lands on that cue, using the cue's own fade. **This is the changed message: if the desk refuses it, write down the monitor's exact words, then try `Goto Sequence 1 Cue 2` and `Go+ Sequence 1 Cue 2` from a Network cue and say which the desk takes.**
- M5. GO the cue for 2 twice. Expect: cue 2 both times.
- M6. Module cue list 2. Expect: Sequence 2.
- M7. A cue number with a decimal (2.5), if the sequence has one.
