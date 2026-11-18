# 15 · The assistant and the rig

Status: **built** (three packages, joined; the walk of section 8, step 4 was done in the window with the
built-in helper and again with Claude Code: [`docs/try-the-assistant.md`](../try-the-assistant.md)). **Nothing
here has met real equipment**: section 9 and `CLAUDE.md` say what that leaves unproven. Where the build departs
from the design, an "As built" note says so in place. This was the document three people built from at once;
section 8 says who built what. Where it says "decided", it is decided: build that, and put a disagreement in the hand-back, not in
the code. Sources read for it: `core/assistant/`, `core/show/`, `core/net/`, `app/main/host.ts`,
`app/renderer/{Drawers,Settings,app}.js`, `bin/`, specs 00 to 08, and (read only) the show app this project grew
from.

## 1. The idea

The show this app grew out of ran sound, a lighting desk, a projector, a prop with its own firmware and several
Wi-Fi lights from one window, and one person built all of it by asking an AI. What made that possible was not
code generation as such. It was three things kept in one place: **a show the AI could read and change safely, a
description of every piece of equipment, and a page that said whether each piece was alive.** This spec gives
those three things to everyone. Equipment becomes a first-class, readable part of the show (a **device**, with
named **commands**); one page, the **Rig**, lists everything the show depends on and says whether it is ready;
and the assistant grows from "edits cues" to "builds the show with you", along a ladder where each rung is
visible from the one below. It still proposes and a person still reviews. It still cannot play or save the show.
It writes no code that this app runs. When someone wants more than that, it hands the show folder to a coding
agent, with a generated guide so that the hand-over works.

### The ladder

| Rung | The person says | What exists after |
|---|---|---|
| 1. Start from a folder | "Here are my sounds: make me a show." | Cues in order, named, grouped by scene where the names say so, as one proposal that lists what was guessed. |
| 2. Edit by talking | "Every scene ends with a 3 s fade." | As today ([08](08-assistant.md)). |
| 3. Work from the script | "Put a cue at every mark in the script." | A script file named in the show; cues whose notes quote their line; a Rig row that says which marks have no cue. |
| 4. Connect a thing | "My lighting desk is an Ion at 10.0.0.20." | A device, with commands, a way to tell it is there, and a Try button; cues that say "Desk ▸ Fire cue 12". |
| 5. The rig | "Is everything ready?" | The Rig page: every part the show depends on, its state, what to do about it, and the operator's own checklist. |
| 6. Build a prop | "I have an ESP32 and a strip of 30 LEDs." | A folder of firmware in the show folder, tailored, with flashing steps; a device already describing it. |
| 7. Go further | "I need it to talk to this odd projector over HTTP." | An honest "not here", and a show folder a coding agent can open and work in. |

Rungs 1, 4 and 5 are the heart of v1 and are built whole. Rung 2 exists. Rungs 3, 6 and 7 are built small, and
this document says exactly how small.

### Three people

**A stage manager with a folder of sounds.** She has `Spring Concert/` on the desktop: eleven WAVs named
`01 Overture.wav` … and a page of notes. She chooses *Start from a folder…*, picks it, and the folder is now the
show (a `show.json` appears beside her sounds; nothing is moved or copied). The assistant drawer is open and
says: "11 sounds and 1 text file not in a cue yet." with one button, **Make cues from these 11
sounds**. She has no model set up, and it works anyway: the built-in helper proposes eleven Audio cues in the
order of the file names, named without the numbers, and says "I put them in file-name order and guessed nothing
else." She accepts. The drawer's quiet last line now reads: "Next: tell me how each one should end
(“fade out 3 seconds at the end of every piece”)." That one needs a model; the line says so and where to get one.

**A puppeteer with two ESP32 props and a lighting desk.** He opens the Rig page because its tab has a red dot
(a sound file is missing). Below the rows for his sound and files is **Equipment: none yet**, with *Add a device*
and *Look for props*. He asks the assistant: "the lighting desk is an ETC Ion at 10.0.0.20, and I have two
lanterns I am building with ESP32s and LED strips." The assistant proposes a device from the app's description
of that desk family (seven commands, asked "are you there?" every two seconds), and two prop devices, and stages
two firmware folders under `props/`. The review shows three devices and eight files. He accepts, flashes the
boards from the written steps, presses *Look for props*, and the two lanterns answer: the Rig rows turn ready and
show firmware 1.0 and −52 dBm. He presses **Try ▸ Identify** and a lantern blinks. "Make the lantern breathe when
cue 12 starts" becomes a Device cue in the group at 12: `Lantern A ▸ Effect (breathe)`.

**Someone importing a QLab show.** The import report is on screen. The drawer says: "Imported from QLab: 84
cues, 3 network patches, 6 things did not come across." Its asks are: **What did not come across?**, **Check the show for problems**, and **Make “Eos” a device** (so that
it has a Rig row, a Try button and an "are you there?"). Nothing about the import is changed unless asked.

## 2. What the first show taught

Read from the show app's repository (paths are in that private repository; nothing of the show itself is
repeated here).

| What the show did | Where | The general capability | v1 |
|---|---|---|---|
| A Pre-show page: one row per part of the rig, three states, and for every row that is not ok a sentence saying what to do with your hands | `visuals/stage-app/preshow.js`, `preshow.html` | The Rig page: items generated from the show, each `{ state, text, fix }` | **In** |
| Labels were assertions ("every strip is connected"), not nouns | `preshow.js` | Item labels are written as the thing that should be true | **In** |
| A check with no way to know said so ("check it by hand") instead of passing | `preshow.js` | A fourth state, `unknown`, never drawn as ready | **In** |
| A part the cue list does not use was a warning, not a failure | `preshow.js` | `needed` is worked out from the cues; an unused device can only be "to look at" | **In** |
| The check compared the cue names the show sends with the names the prop reports | `preshow.js`, `tower-link.js` | A Device cue naming a command its device does not have is a broken cue | **In** |
| "Run check" at the half, with a time stamp | `preshow.html` | *Check again*, "checked 19:02:11" | **In** |
| A show-day checklist with ticks, in the guide, not on the page | `showcontrol/guidebook.html` | The operator's own lines on the Rig page, ticked per sitting | **In** |
| A drawn diagram of booth and stage with coloured wires | `preshow.html` | A diagram needs a layout per show | **Out**: a list |
| Checks of this one show's router, camera, power and disk | `preshow.js` | Show-specific | **Out** (disk and mains power are worth adding later) |
| Each prop: a default look at power-on, and it carries on with its last look when the booth goes away | `making/props/led_controller/wifi_node/` | The prop kit's two rules | **In** (firmware written, not run) |
| The booth says hello; the prop answers whoever spoke last with its name, version and signal | `wifi_node.ino`, `tower-link.js` | The kit protocol's `/ec/hello` and `/ec/here`; liveness by "ask" | **In** |
| A command sent three times with one id, acted on once | `tower-link.js` | `resend` on a device | **In** |
| Link loss logged once, on the change, not every two seconds | `tower-link.js` | Liveness logs transitions only; asks stay out of the monitor | **In** |
| A lighting desk: fire by number (so a double GO is harmless), ping every 2 s, alive if it answered in 5 s, the human call stays | `visuals/stage-app/etc-desk.js` | Already the lighting-desk module; the same desk as a device gets a Rig row | **In** (module unchanged) |
| One stage address from which every route was derived | `visuals/stage-app/routing.js` | In practice only one route derived from it. The general form is: a device's address is written once, on the device, and cues name the device | **In** |
| A sweep of the network to find the stage computer; it once made a printer print | `visuals/stage-app/discover.js` | *Look for props*: one OSC hello to one port, only when a person asks, never while a cue runs | **In** |
| Fixed addresses, the show's own Wi-Fi, 2.4 GHz | `showcontrol/stage-router/` | Written advice in the kit's steps; a moved prop is offered its new address | **In** (as words) |
| Over-the-air firmware updates | `wifi_node/build.sh` | Optional in the kit's firmware, off as written | **In** (written, not run) |
| Back up a chip before writing to it | `making/props/tower/firmware/README.md` | A line in the flashing steps | **In** (as words) |
| The Wi-Fi password ends up inside built firmware | `wifi_node/build.sh` | `secrets.h` is the person's, never the show's, never sent to a model | **In** |
| The script was the source of truth: `@cue` lines generated every cue sheet, and the booth's edits were laid over by cue id | `script/build_cues.py`, `visuals/stage-app/cue-edits.js` | A generator and an overlay file are what a show needs when its cues live in two places. Here cues live in one place and every edit is an operation, so the small form is: marks in the script, and a check that each has a cue | **In**, small |
| A phone remote behind one door file, off until ticked, with a list of what to delete to remove it | `experimental/phone_remote/` | The web remote is this app's; the pattern (one door, off, removable) is how each part here is cut | — |
| Helper programs supervised by the app | `visuals/stage-app/service.js` | No helper programs in v1 | **Out** |
| macOS judges Local Network permission per signed app | `visuals/stage-app/local-network.js` | Goes in the "not verified" list: the first packaged build to reach a prop must be tried | **Noted** |
| One person, a coding agent, and a repository with its own instructions | the repository's `CLAUDE.md` files | Rung 7: a generated `AGENTS.md` in the show folder | **In**, small |

## 3. The data model

### 3.1 Where it lives (decided: in `show.json`)

The request was "a device as a small readable file in the show folder". **Devices live in `show.json`, under
`settings.rig`**, and not in files of their own. The reasons:

- A show changes only through `core/show/ops.ts`. Undo, the unsaved journal, versions, compare, restore, timed
  backups, templates, the assistant's draft and its review all work on one document. A device in a file of its
  own would need every one of those again, and the review would become two reviews.
- An untitled show has no folder yet, and must be able to have a device.
- It is still a small readable block of text, in a file that diffs line by line.
- Under `settings`, the app keeps what it does not know (`deepMerge` in `show.normalise`); an unknown top-level
  key is not kept.

Files in the show folder are for things that are not the show's state: the script, firmware, the agent guide.

```jsonc
"settings": {
  "rig": {
    "devices": [ /* 3.2 */ ],
    "checks":  [ { "id": "k1", "text": "Fresh batteries in both lanterns" } ],   // the operator's own lines
    "script":  "script.md"                                                        // relative to the show folder; "" none
  }
}
```

`defaultSettings()` has `rig: { devices: [], checks: [], script: '' }`, and a rig with nothing in it is not
written (`stringify`).

### 3.2 A device

```jsonc
{
  "id": "lantern_a",              // for life: cues name it. Lower-case letters, digits and _ ; unique among devices AND network patches
  "name": "Lantern A",
  "kind": "prop",                 // a label only: desk | prop | media | sound | computer | instrument | other
  "model": "ec-prop-light",       // optional: the description in core/net/devices.ts it was started from
  "via": "osc",                   // how it is spoken to: osc | text | hex | midi
  "host": "10.0.0.42", "port": 53100, "protocol": "udp",
  // also, exactly as a network patch has them: framing, listenPort, iface, destinations
  "commands": [
    { "id": "look",     "label": "Look",     "template": "/ec/look {n}",
      "params": [ { "key": "n", "label": "Look (0 is its own)", "kind": "number", "default": 1, "min": 0, "max": 8 } ] },
    { "id": "level",    "label": "Level",    "template": "/ec/level {level}", "fade": "level",
      "params": [ { "key": "level", "label": "Level (0–1)", "kind": "number", "default": 1, "min": 0, "max": 1 } ] },
    { "id": "effect",   "label": "Effect",   "template": "/ec/effect {name}",
      "params": [ { "key": "name", "label": "Effect", "kind": "enum", "options": ["steady", "breathe", "pulse", "flicker"], "default": "breathe" } ] },
    { "id": "identify", "label": "Identify", "template": "/ec/identify" }
  ],
  "test": "identify",             // the command that is safe to send at any time, to see it react
  "alive": { "how": "ask", "send": "/ec/hello", "reply": "/ec/here", "every": 2 },
  "reports": [
    { "key": "fw",      "label": "Firmware", "from": "/ec/here", "arg": 2 },
    { "key": "signal",  "label": "Signal",   "from": "/ec/here", "arg": 5, "unit": "dBm", "warnBelow": -70 },
    { "key": "battery", "label": "Battery",  "from": "/ec/here", "arg": 6, "unit": "%",   "warnBelow": 25 }
  ],
  "resend": 3,                    // optional: each command is sent this many times, 40 ms apart, with one id (6.1)
  "needed": true,                 // false: the show goes on without it
  "notes": "In the stage-left wing. Always-on power bank."
}
```

A lighting desk, started from a model (its commands are copied in, so they can be edited and a model changing
later never changes a show):

```jsonc
{ "id": "desk", "name": "Lighting desk", "kind": "desk", "model": "etc-eos", "via": "osc",
  "host": "10.0.0.20", "port": 8000, "protocol": "udp", "listenPort": 8001,
  "commands": [ { "id": "fire", "label": "Fire cue", "template": "/eos/cue/{list}/{cue}/fire",
                  "params": [ { "key": "list", "label": "Cue list", "kind": "number", "default": 1 },
                              { "key": "cue", "label": "Cue", "kind": "text", "default": "1" } ] } /* … */ ],
  "test": "", "alive": { "how": "ask", "send": "/eos/ping", "reply": "/eos/out/*", "every": 2 } }
```

A MIDI instrument (it uses the show's MIDI output, `settings.midi.output`; it has no address):

```jsonc
{ "id": "sampler", "name": "Sampler", "kind": "instrument", "via": "midi",
  "commands": [ { "id": "scene", "label": "Scene", "template": "pc {n} ch 10",
                  "params": [ { "key": "n", "label": "Program", "kind": "number", "default": 1, "min": 0, "max": 127 } ] } ],
  "alive": { "how": "none" } }
```

**Fields**, as one table in `core/rig/devices.ts` (`FIELDS`, `COMMAND_FIELDS`, `PARAM_FIELDS`, `ALIVE_FIELDS`,
`REPORT_FIELDS`), which validation, the device editor and the assistant's reference all read, as
`core/show/cue-types.ts` is read for cues:

| Field | Rule |
|---|---|
| `id` | Required. `/^[a-z][a-z0-9_]{0,31}$/`. Left out of a `device.add`, it is made from the name. Never changed afterwards. |
| `name` | Required text. |
| `kind` | One of the seven; default `other`. A label: nothing happens because of it. |
| `via` | `osc` (default), `text`, `hex`, `midi`. `osc`, `text` and `hex` are what the hub sends ([06](06-control-surfaces.md)); `midi` is a MIDI cue's text. |
| `host`, `port`, `protocol`, `framing`, `listenPort`, `iface`, `destinations` | As a patch's. `host` and `port` are required for a network device before it can be sent to; a device may be saved without them (its Rig row says "no address yet"). |
| `commands[]` | `id` (as a device id, unique in the device), `label`, `template`, `params[]`, `fade` (the key of one numeric param), `notes`. At most 64. |
| `params[]` | `key`, `label`, `kind` (`number` \| `text` \| `enum`), `default`, and for a number `min`, `max`, `whole`; for an enum `options`. Every `{key}` in the template must be a param, and every param must be in the template. |
| `test` | A command id of this device, or `''`. |
| `alive` | `how`: `ask` \| `heartbeat` \| `none` (default `none`). `ask`: `send` (a message in the device's own `via`), `reply` (an OSC address pattern; none: anything from it counts), `every` (seconds, 1 to 30, default 2). `heartbeat`: `hears` (an address pattern; none: anything), `within` (seconds, default 5). |
| `reports[]` | `key`, `label`, `from` (an address pattern), `arg` (which argument, from 0), `unit`, `warnBelow`, `warnAbove`. What the device says about itself, read out of what it sends. At most 12. |
| `resend` | 0 (default) to 5. |
| `needed` | Default true. |
| `notes` | Text. |

`devices.clean(raw)` is forgiving (the reading side: unknown keys kept, a field that does not parse dropped with
a warning); `devices.trouble(device, doc)` is strict (the writing side) and returns sentences: "the command
“look” has {n} in its message and no parameter called n", "an OSC message starts with /", "a device and a patch
both have the id desk".

**Composing.** `devices.compose(device, commandId, args = {}, { fade = false } = {})` returns
`{ ok: true, message }` or `{ ok: false, why }`. Each `{key}` in the template is replaced by that argument's
value, or the param's default; a number is checked against `min` and `max` and rounded when `whole`; an enum
against its options. With `fade`, the command's `fade` param becomes `#v#`. Values are inserted as written: a
template that needs quotes has them (`/eos/newcmd "{command}"`), as the templates in `core/net/devices.ts` do.
This is that file's `compose`, moved to work on a device in a show; the two share one function.

### 3.3 Devices and what is already there (decided: sit on top; nothing old breaks)

| Already there | What happens to it |
|---|---|
| **Network patches** (`settings.network.patches`) | Stay, unchanged: a show's patches open and play as they are. A network device is *also a patch to the hub*: the host gives the hub `devices` beside `patches`, and anything that sends to a patch id may name a device id (so a raw Network cue's `patch` may be a device: "a raw Network cue still works"). One thing differs on purpose: a Network cue with no patch chosen goes to "the only patch" counting **patches only**, so adding a device never re-aims an old cue. Settings ▸ Integrations ▸ Network keeps its patches and gains one line pointing at the Rig. A patch can be **made a device** in one edit (same id, so every cue that named the patch still does; its model's commands copied in): `device.add` with the patch's id plus `show.set` removing the patch, in one batch (the rule that a device and a patch may not share an id is checked on the batch as a whole, as `settingsTrouble` is, so the two may come in either order). |
| **Device templates** (`core/net/devices.ts`) | Become **models**: what a new device is started from. The table gains two entries (the kit's props) and each entry gains optional `kind`, `alive` and `reports`. A patch's `device` field and the inspector's "Write the message" keep working as they do. |
| **The lighting-desk module** and Light cues | Unchanged. It is how an operator *calls* light cues and has the desk follow. A desk may also be a device (for a Rig row, Try, and commands other than "fire"); the module's own status is a Rig row either way. Merging the two is not v1. |
| **The monitor** | Unchanged, plus: asks and their replies stay out of it (first reply after a silence excepted); an entry keeps who it came from as `from: { address, port }`; `core/rig/senders.ts` groups what unknown senders have sent, for "is this your prop?". |
| **Hold Back** (`overrides.osc`, `overrides.midi`) | Holds device commands, Try and asks as it holds everything else. A held device's row says "held back", not "not answering". |
| **Script cues** | Unchanged: still a list of transport commands, still not code. |

### 3.4 A cue that sends a command (decided: a new cue type, `device`)

A field on Network cues was the other choice. It loses: a Network cue's `message` is required and its
inspector is built around typing one, and a MIDI device is not "network". A new type reads as what it is.

```jsonc
{ "type": "device", "number": "12.1", "device": "lantern_a", "command": "effect", "args": { "name": "breathe" } }
{ "type": "device", "device": "lantern_a", "command": "level", "args": { "level": 0 }, "fadeTo": 1, "duration": 4 }
```

In `core/show/cue-types.ts`:

| Field | Kind | |
|---|---|---|
| `device` | `device` (new kind: a device id) | Required. |
| `command` | `command` (new kind: a command id of that device) | Required. |
| `args` | `args` (new kind: `{ key: value }`, checked against the command's params) | A param left out takes its default. |
| `fadeTo` | `number` | Only for a command with `fade`: the value moves from the argument's value to this. |
| `duration` | `seconds` | With `fadeTo`: how long. |
| `curve` | `enum` (as a Network cue's), advanced | |

Label **Device**, glyph `◈`, summary "Sends one of a device's named commands." It goes in `TYPE_ORDER` after
`network`. Its default name is `Lantern A ▸ Effect (breathe)`: device name, command label, and the argument
values in brackets when there are any.

**The engine does not change.** `show.toEngineDoc` resolves a Device cue into what the engine already plays:

- `via` `osc` / `text` / `hex` → an engine `network` cue with `patch` = the device id, `format` = `via`,
  `message` = `compose(...)` (with `#v#` in place of the fade param when `fadeTo` is set, `fadeFrom` = the
  argument's value), and `duration`, `curve` passed through.
- `via` `midi` → an engine `midi` cue with `midi` = the composed text, `fadeTo` and `duration` passed through.
- It also carries `sends: "Lantern A ▸ Effect (breathe)"` for the dry run and the monitor's label.

`show.problems` adds, as errors that make the cue broken (marked and skipped, never thrown): "its device is
gone", "Lantern A has no command “blink” (it has: look, level, effect, identify)", "level must be between 0 and
1", "its device has no address yet". And for a Network cue, `patch` may now be a device id. The dry run
(`core/engine/dry-run.ts`) says `⇄ Lantern A ▸ Effect (breathe)  /ec/effect breathe  → Lantern A`.

`resend` is the host's: `sendNetwork` in `app/main/host.ts`, for a message going to a device with `resend` > 0
and no `#v#` in flight, appends one argument `#<6 hex digits>` and sends it `resend` times 40 ms apart (the
repeats are not written to the monitor). A faded value is never resent.

### 3.5 Edit operations

Added to `core/show/ops.ts` (and so to `OP_KEYS`, the assistant's reference, `ec apply`, and the checks every
edit gets):

| Operation | |
|---|---|
| `{ op: "device.add", device: { name, …fields } }` | Adds a device. `id` may be given; otherwise it is made from the name. With `model` and no `commands`, the model's commands, `alive`, `reports`, `kind`, `port` and `protocol` are copied in. Refused if `devices.trouble` has anything to say. The result's `made` does not include it (that is for cues); the tool's answer names the id. |
| `{ op: "device.set", id, props: { field: value \| null } }` | Sets fields; `null` clears. `commands`, `reports` and `alive` are set whole. `id` cannot be set. |
| `{ op: "device.remove", id }` | Cues that named it become broken and are reported, as cues that lose a target are. |

`show.set` on `settings.rig.devices` is refused with a sentence naming these three. `settings.rig.script` and
`settings.rig.checks` are ordinary `show.set` paths (`checks` is set whole: a list of `{ id, text }`).

`core/show/diff.ts` reports devices as an operator reads them, not as a settings path: change kinds
`device-added`, `device-removed`, `device-changed` (`{ kind, id, label, fields: [{ field, label, from, to }] }`;
a changed command list is one field, "Commands: 4 → 5 (added Strobe)"), and `summary()` gains `devices`.

### 3.6 Is it there? (liveness)

`core/rig/liveness.ts`, plain Node, driven by the host. For each device:

| `alive.how` | What the app does | Ready when |
|---|---|---|
| `ask` | Sends `alive.send` every `every` seconds, through the hub, quietly (not in the monitor). | Something matching `reply` was heard from the device's address within 3 × `every` seconds. |
| `heartbeat` | Sends nothing. Opens the input port (as a cue with an OSC trigger does). | Something matching `hears` arrived from the device's address within `within` seconds, on the input port, the reply socket or its `listenPort`. |
| `none` | Nothing. | Never "ready" by itself. A TCP device is ready while connected. A MIDI device is ready while a MIDI output is present. Otherwise `unknown`: "It cannot be asked. Press Try and look at it." |

A device's live state, pushed to the window and given to the assistant:

```jsonc
{ "state": "ready",                       // ready | look | problem | unknown   (3.7)
  "text": "answering · 4 ms",
  "heardAt": 1731700000000, "ageMs": 420,
  "reports": [ { "key": "signal", "label": "Signal", "value": -52, "unit": "dBm", "warn": false } ],
  "lastOut": "/ec/effect breathe", "lastIn": "/ec/here lantern_a light 1.0 breathe 532 -52 87" }
```

Rules that came from the first show: asking starts only for a device that says `ask` (adding one is the switch);
a device that stops answering is logged **once**, when it stops; nothing here can delay a GO (a send is one
datagram, and never awaited); asks are held by Hold Back; in a test run the hub records and sends nothing, and
`hub.pretendHeard(id, text)` stands in for a reply.

**Looking for props** (`core/rig/scan.ts`): one `/ec/hello` to UDP 53100 on each network's broadcast address
and on 127.0.0.1, then 1.5 s of listening for `/ec/here`. Only when a person presses *Look for props* or the
assistant calls `find_devices`; never in Show mode, never while a cue is running. Each answer is
`{ name, kind, fw, host, port, known: <device id> | null, moved: true | false }`: `moved` when a device of that
name is in the show at another address, which the Rig offers to correct in one click.

### 3.7 The check

`core/rig/check.ts` exports one pure function, `items(doc, facts)`, which returns the Rig page. `facts` is what
only the running app knows (the output device, which files are on disk, the hub's status, liveness, MIDI ports,
modules, the stage, overrides, whether the show is saved). The host calls it with real facts; `ec check` calls
it with the facts a command line can know; a test calls it with invented ones.

```jsonc
{ "id": "device.lantern_a", "group": "equipment",
  "label": "Lantern A",                              // a device: its name; its state is the text
  "state": "problem",                                // ready | look | problem | unknown
  "text": "not answering (last heard 2 min ago)",
  "fix": "Check its power, and that it is on the show’s Wi-Fi.",    // empty when ready
  "needed": true,
  "actions": [ { "id": "ask", "label": "Ask again" }, { "id": "try", "label": "Try: Identify" } ] }
```

**States.** `ready` (a `--go` dot); `look` (`--standby`: it will work, look at it); `problem` (`--danger`: the
show is not whole without it); `unknown` (a hollow grey dot: cannot be told from here; never counted as ready).
`problem` is only for a thing the show needs; the same fault on a thing no cue uses, or a device with
`needed: false`, is `look`.

**The rows.** A row exists only when the show uses the thing, so an empty new show has three, and a show of
sounds has five.

| Group | Row (label when ready) | Exists when | Not ready when → fix |
|---|---|---|---|
| The show | "The show is saved" | always | unsaved changes → `look`, "Save (⌘S)." Untitled → `look`, "Save it to a folder." |
| | "Backups are on" | always | `settings.backup.minutes` 0 → `look` |
| | "Every cue can run" | always | broken cues → `problem`, "3 cues are broken: 4, 12, 31." (click selects the first) |
| | "Every script mark has a cue" | `settings.rig.script` set | file missing → `look`; marks with no cue → `look`, "12.5 (line 88) and 31 (line 204) have no cue." |
| Sound | "Sound goes to <device>" | any Audio, Mic or Video cue | fallen back to the default → `problem`, "Plug in <device>, or choose another in Settings ▸ Audio." |
| | "Every bus has its outputs" | a bus sent beyond 1–2 | `problem`, as the title bar says today |
| | "Every file is found (14)" | any cue with a file | `problem`, "2 files are missing: …" → action *Find them…* |
| | "The microphone input is there" | any Mic cue | `problem` |
| Picture | "The stage is on <display>" | any Video, Text or Camera cue | no display chosen → `look`; display gone → `problem` → action *Test pattern* |
| Lights | "DMX is going out" | `settings.light.on` with an instrument | output error → `problem`; held back → `look` |
| Equipment | one per **device**: its name, with its state as the text ("answering · 3 ms", "not answering", "cannot be asked: press Try", "no address yet") | each device | 3.6. No address → `look`, "Give it an address." |
| | one per **patch** that a cue uses: its name, with "answering", "nothing sent yet" or "cannot be asked" | each used patch | error → `problem`. Otherwise `unknown` unless it has answered. Action *Make it a device*. |
| | "Listening on port 53000" | the input port is wanted | cannot bind → `problem` |
| | "MIDI goes to <port>" | any MIDI cue or MIDI device | port absent → `problem` |
| Connections | one per **module** that is on | each | `status().ok` false → `problem`, with the module's own text |
| | "Timecode is arriving" | `timecode.source` not off | `look` until it has |
| Held back | "Nothing is held back" | any override on | `look`, "OSC out is held back: nothing reaches the equipment." → action *Let it go* |
| Before the show | one per line of `settings.rig.checks` | each | unticked → `look`. Ticks are this sitting's: kept by the host, not in the show, cleared by *Start again* and when a show is opened. |

**The summary**: `{ ready, total, look, problems, unknown, at, text }`, text as "All 9 are ready", or
"6 of 9 ready · 2 to look at · 1 problem". The Rig tab in the title bar carries a `--danger` dot when
`problems` > 0, else a `--standby` dot when `look` > 0, else nothing.

### 3.8 The script (rung 3, small)

- The show names one text file in its folder: `settings.rig.script`. The app never writes it.
- A **mark** is a line that is `@cue <number>` and optionally a name: `@cue 12 Thunder`. It may sit inside a
  comment (`<!-- @cue 12 Thunder -->`), so a Markdown script still reads cleanly. The line of text above it is
  the line it is called on.
- `core/rig/script.ts`: `read(showDir, file)` → `{ ok, why, lines, marks: [{ line, number, name, quote, section }], sections }`
  (a section is a Markdown heading, or a line beginning ACT or SCENE); `compare(doc, marks)` →
  `{ missing: [mark…] }`, the marks whose number no cue has.
- The assistant reads the script with `read_file`, proposes cues numbered and named from the marks with the
  called line quoted in each cue's notes (`On “…and the sky answered.”`, the form [03](03-show-file.md) already
  shows), and groups them by section. From a script with no marks it proposes from what the text says ("a clap
  of thunder") and says that it guessed; the check then reports nothing to compare.
- Not in v1: writing marks into a script; regenerating cues when the script changes (the check says what is
  missing and the assistant can be asked to add it); PDF. A `.docx` is read as text (3.9).

### 3.9 Files in the show folder

Two new things touch the folder, both small.

**Reading** (`core/rig/folder.ts`): `listing(showDir, doc, { durations })` → every file under the show folder,
two levels deep by default, except the show's own (`show.json`, `show.unsaved.json`, `versions/`, `backups/`,
`logs/`, `recordings/`), each `{ path, kind: sound | video | image | midi | text | other, bytes, secs?, usedBy: [cue refs] }`;
and `readText(showDir, rel, { from = 1, lines = 400 })` → `{ ok, why, text, from, to, total }` for `.txt`,
`.md`, `.markdown`, `.fountain`, `.csv`, `.json`, `.ino`, `.h`, `.cpp`, `.toml`, `.yaml`, and `.docx` (its
paragraphs as lines: a `.docx` is a zip, read with `zlib` and forty lines of code; no dependency is added).
Anything else, a file over 2 MB, a path that leaves the folder or a link that points out of it is refused with
a sentence. A PDF's sentence is "Export it as text or .docx and put that in the folder."

**Writing** (`core/show/files.ts`, and `proposal.files` in `core/show/document.ts`): a proposal may carry
files, `[{ path, text }]`, written when it is accepted. `files.check(showDir, files)` allows only: `AGENTS.md`
and `CLAUDE.md` at the top of the show folder, and anything under `props/`; text, at most 200 KB each and 24 in
a proposal; never a path that leaves the folder. Each is marked `replaces: true` when a different file is
already there. Writing is atomic per file (temp, then rename). An untitled show has no folder: the tools refuse
before staging, with "Save the show to a folder first: this writes files into it." Undo takes back the change
to the show and leaves the files; the review says so.

**Starting from a folder.** *File ▸ Start from a Folder…* (and a button on the welcome panel) picks any folder
and opens it as a show: `ShowDocument.open` already makes a new show in a folder that has none. The sounds stay
where they are and cues name them by their path in the folder (`01 Overture.wav`, `sfx/door.wav`); this is
already how a file inside the show folder is adopted. The title is the folder's name.

## 4. The assistant

### 4.1 What it may touch (one review model)

There are three classes, and only three:

- **Read**: happens at once, changes nothing, sends nothing to any equipment.
- **Proposal**: goes into the turn's draft and reaches the show only through `propose_changes` and a person's
  Accept. There is one review card. It has up to three parts: cues, devices and settings, files.
- **Ask**: one "are you there?" sent to equipment, at once, under the rules below. This is the single new power.

| Thing | Class | Notes |
|---|---|---|
| Cues, lists, settings, modules | Proposal | As today. |
| Devices (`device.add` / `set` / `remove`) | Proposal | Shown in the review as devices, field by field. |
| The checklist (`settings.rig.checks`), the script link | Proposal | |
| Files: prop firmware under `props/`, `AGENTS.md`, `CLAUDE.md` | Proposal | **The model does not write them.** It calls a generator with parameters (`make_prop_files`, `hand_off`) and the app writes the text from its own templates. |
| The show folder's file names; the text of a text file in it | Read | Only inside the show folder (decided: no "folder you point at". Pointing at a folder is *Start from a Folder*, or dropping its files on the list.) |
| The Rig: every row, every device's state and reports, audio outputs, displays, MIDI ports, networks | Read | |
| The monitor: what was sent and what arrived, and who unknown senders are | Read | |
| "Are you there?" to a device | Ask | Only (a) the `alive.send` of a device **that is in the show** (a person accepted it), or (b) a **model's** built-in test message (`/eos/ping`, `/info`, `/ec/hello` …) to an address on a private network (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8). Never a message the model wrote. At most 30 a turn. Held by Hold Back. |
| Looking for props | Ask | The one fixed hello of 3.6. |
| A device **command** (Try) | **Never** | A command does something on a stage. It is a person's click on the Rig page, or a cue. |
| GO, stop, pause, the playhead, Panic | **Never** | Unchanged. |
| Save, a version, Accept | **Never** | Unchanged. |
| Anything outside the show folder; any file that is the show's own | **Never** | |
| Running code, a shell, firmware tools, a serial port | **Never** | The app has none of these to give. |
| The Wi-Fi password | **Never** | It is never asked for, never in the show, never in a request. `secrets.h` is written with a placeholder. |

**Show mode.** The composer is disabled, as it is today, and Accept is refused by the host. For an agent
outside the app (the bridge): reads work; `propose_changes` stages and cannot be accepted; `ask_device` and
`find_devices` are refused ("Show mode: an assistant sends nothing to the equipment").

**Apply at once** covers the show part and the files alike, and never happens in Show mode.

### 4.2 Extensibility without code

Everything a show can be taught is data: a device (messages with typed holes in them, one way of asking "are
you there?", a list of what to read out of the answers), a checklist line, a script mark, and a Script cue (a
list of transport commands, which the assistant may write, because it is a cue field checked by
`core/show/script.ts`). **Nothing in v1 runs code from a show or from a model**, and a show file from a
stranger stays safe to open.

What that cannot express, and where it goes (rung 7): a device that needs a conversation (a login, a session
token, a checksum worked out from the message, binary framing); HTTP, MQTT or a serial port; a decision ("if
the sensor reads more than 5"; an OSC trigger covers "when this arrives, fire that", and conditions with state
are roadmap 0.3); firmware beyond the kit's settings; a new module. For each the assistant says in a sentence
that it is beyond what it does here, and offers the hand-over.

### 4.3 Tools

One table, `TOOLS` in `core/assistant/tools.ts`, for the built-in assistant, the MCP server and the Claude Code
and Codex providers (`TOOL_NAMES` in `assistant.ts` becomes `TOOLS.map((t) => t.name)`, so the allow-list can
never fall behind). `execute` may now return a promise (two tools wait for an answer); every caller awaits it.

Changed:

| Tool | Change |
|---|---|
| `read_show` | New argument `device`: that device as JSON. The outline gains the lines of 4.4. |
| `edit_show`, `propose_changes` | Take the three device operations. The answer names devices added, changed and removed, and, for a proposal, the files it carries. A proposal may now be files alone. |
| `check_show` | Also: device trouble, Device cues that cannot be composed, and script marks with no cue. |
| `simulate` | A Device cue reads `⇄ Lantern A ▸ Effect (breathe)  /ec/effect breathe  → Lantern A`. |
| `list_media` | Kept as it is (it is in people's habits and in the tests); its description points at `list_folder`. |

New:

| Tool | Class | Input | Returns |
|---|---|---|---|
| `list_folder` | Read | `{ path?: string }` (a folder inside the show folder; default the top) | One line a file: path, kind, size, length for a sound, the cues that use it or "not used by any cue". At most 300 lines, then a count. With no show folder: "This show is not in a folder yet." |
| `read_file` | Read | `{ path: string, from?: integer, lines?: integer }` (required: `path`) | The text with line numbers, at most 400 lines a call, and "lines 1–400 of 1,212". For the show's script, each mark is noted beside its line. |
| `rig_status` | Read | `{}` | The summary line; every row as `state  label: text (fix)`; each device with its state, age and reports; then "This computer:" the audio output and how many outputs it has, the other outputs by name, displays, MIDI ports in and out, network addresses. Without the running app (a show folder alone): the rows a folder can answer, and "the rest needs the app". |
| `read_monitor` | Read | `{ last?: integer (default 40, at most 200), from?: string (an address or a device id) }` | The messages, oldest first, `time  →/←  who  message  (why)`; then **Unknown senders**: `10.0.0.57:53100 sent /ec/here 14 times, about every 2.0 s (not one of the show’s devices)`. |
| `ask_device` | Ask | `{ device?: string }` or `{ host: string, port: integer, probe: string }` (`probe` is a model id from the reference that has a test) | "Lantern A answered in 4 ms: /ec/here lantern_a light 1.0 steady 532 -52 87", or "No answer in 1.5 s.", or "Held back: OSC out is switched off for rehearsal.", or the refusal of 4.1. Waits up to 1.5 s. |
| `find_devices` | Ask | `{}` | Each prop that answered: name, kind, firmware, address, and whether it is already a device (and if at another address). Or "Nothing answered. Props must be powered, on this network, and running the kit’s firmware." |
| `make_prop_files` | Proposal | `{ device: string, sketch: "light" \| "switch", board?: string, pin?: integer, count?: integer, order?: "GRB" \| "RGB" \| "BRG", output?: "relay" \| "servo", ssid?: string, address?: string, look?: { r, g, b, level, effect } }` (required: `device`, `sketch`) | Stages `props/<id>/…` (6.3) in the draft and answers with the list of files and the first lines of the steps. `device` must be in the draft or the show. Refused for an untitled show. |
| `hand_off` | Proposal | `{ why: string }` | Stages `AGENTS.md` and `CLAUDE.md` (4.7) and answers with the two command lines to give the person. |

Schemas are written with the file's `obj()` helper, `additionalProperties: false`, as the existing seven are.
`describeCall` gains a line each: "looking at the folder", "reading script.md", "looking at the rig", "reading
the monitor", "asking Lantern A if it is there", "looking for props", "writing firmware for Lantern A",
"preparing the hand-over".

**What the tools are given.** `ctx` gains `rig`, the host's service, absent when there is no app:

```js
ctx.rig = {
  status(),                 // 5.1's `rig`, plus { computer: { audio: { device, outputs, devices: [label] }, displays: [label], midi: { inputs, outputs }, interfaces: [{ name, address }] } }
  monitor(last),            // the hub's entries
  senders(),                // core/rig/senders.ts over the monitor: [{ address, port, count, messages: [{ address, count, every }], lastAt }]
  ask(target),              // → Promise<{ ok, held, answered, ms, text, why }>; target: a device id, or { host, port, probe }
  scan(),                   // → Promise<[{ name, kind, fw, host, port, known, moved }]>
  locked(),                 // true in Show mode
};
```

The folder, the script and the kit need no app: the tools call `core/rig/folder.ts`, `core/rig/script.ts` and
`core/kit/kit.ts` with `ctx.document.showDir`. The draft's files are `ctx.files` (a `Map` of path → text),
handed to `document.proposeDocument(draft, { summary, author, files })`.

### 4.4 The outline and the reference

The outline (sent with each question) gains at most three lines and one line a device. Long shows are not made
longer by anything else.

```
Devices: lantern_a = Lantern A (prop, osc udp 10.0.0.42:53100; commands: look(n), level(level, fades), effect(name), identify; asked every 2 s)
         desk = Lighting desk (desk, etc-eos, osc udp 10.0.0.20:8000; commands: fire(list, cue), go, stop, macro(macro), sub(sub, level, fades), chan(chan, level, fades), cmd(command); asked every 2 s)
Rig: script script.md (214 lines, 31 marks) · checklist 4 lines · folder: 11 sounds, 1 text file; 3 files no cue uses
Rig now: 7 of 9 ready · problem: Lantern A is not answering · to look at: the show has unsaved changes
```

More than 12 devices: ids and names only, and `read_show {"device": …}` for one. `Rig now` is there only when
the app is running (as the Playhead line is). File names are not in the outline: `list_folder` has them.

The generated reference gains a **DEVICES** section, written from `core/rig/devices.ts`'s tables as the cue
types are written from theirs: every device field with its rule; the three operations with an example each;
"making a patch a device"; and **MODELS**, replacing today's "NETWORK DEVICES": each model's id, label, usual
port, its commands as templates, and its test message if it has one. A test adds a field to `FIELDS` and looks
for it in the reference, as the cue-type test does.

### 4.5 The instructions

Added to `SYSTEM` (kept as short as this; the reference carries the detail):

> **Equipment.** A piece of equipment the show talks to is a *device*: its address, its named commands, and how
> to tell it is there. Devices are part of the show; you add and change them with device.add, device.set and
> device.remove, and the person reviews them like any change. To make a device, start from a model in the
> reference when one fits, and say so; otherwise write its commands from what the person tells you or pastes
> (a manual page, a list of messages). Write only commands you have been given or that the model has. Never
> invent an address, a port or a message: ask for it, or use read_monitor to see what has arrived and
> find_devices to look for props.
>
> A cue that makes a device do something is a Device cue (type "device": the device, one of its commands, its
> arguments). Prefer it to a Network cue with a typed message whenever the device has the command.
>
> You may ask a device whether it is there (ask_device) and look for props (find_devices). You can never send a
> device a command: tell the person to press Try on the Rig page, and what they should see.
>
> rig_status says what the show depends on and whether each part is ready. When the person asks whether they
> are ready, read it, and answer with what is not ready and what to do about each, worst first.
>
> **The folder.** list_folder shows the files in the show's folder; read_file reads a text file (a script, a cue
> sheet, notes). Asked to make a show from the folder: list it, put the sounds in the order their names give,
> name each cue from its file without numbers or extensions, group by scene only when the names or a script say
> so, leave levels and fades alone, and say in your reply exactly what you guessed. Asked to work from the
> script: read it; a line "@cue 12 Thunder" is a cue to make, numbered and named so, with the line above it
> quoted in the cue's notes.
>
> **A prop.** For a light or a switch on an ESP32, make_prop_files writes firmware into the show folder from
> the app's own kit, set up for the board, pin and name you give it, with the steps to put it on the board. You
> do not write firmware yourself, and you never ask for a Wi-Fi password: the person types it into a file.
>
> **Beyond this.** You do not write code, and this app runs none. If what is asked needs it (a protocol the
> devices here cannot describe, firmware beyond the kit's settings, a program beside the show), say so in one
> sentence and offer hand_off, which prepares the show folder for a coding agent.

### 4.6 The first screen

`core/assistant/starters.ts` exports `first({ doc, showDir, folder, rig, imported, provider, installed })`, a
pure function. Its answer is pushed as `assistant.first` and is what the drawer shows before the first message.
Nothing in it is generic: every ask is made from this show, and is offered only when it is true.

```jsonc
{ "state": "folder",                       // no-model | empty | folder | imported | cues | devices
  "line": "11 sounds and 1 text file not in a cue yet.",
  "asks": [ { "label": "Make cues from these 11 sounds", "text": "Make cues from the 11 sounds in this folder.", "offline": true } ],
  "next": { "label": "Next: tell me how each one should end", "text": "" },   // text '': a hint, not a button
  "setup": null }                          // for no-model: 4.6.1
```

At most four asks. `offline: true` marks one the built-in helper can do with no model. `next` is one quiet line
below the asks: the rung above the one the show is on. That line is the whole of "how a person learns the next
rung": no tour, no checklist of features.

| State | When | `line` | Asks (each only if true) | `next` |
|---|---|---|---|---|
| **empty** | no cues, and no folder or nothing usable in it | "An empty show." | *Start from a folder of sounds…* (opens the picker; needs no model) | "Or drop sounds on the list and ask me to arrange them." |
| **folder** | files in the show folder that no cue uses | "N sounds[, N videos][ and N text files] not in a cue yet." | *Make cues from these N sounds* (offline) · *Read <the one text file> and make cues from it* (when there is exactly one, and it is not the script) | "Next: tell me how each one should end." |
| **imported** | the show came from QLab (the importer's report is in its notes) | "Imported from QLab: N cues, N patches, N things did not come across." | *What did not come across, and what should I do about each?* · *Check the show for problems* · *Turn the patch “<name>” into a device* (a patch whose kind has a model; the first such) | "Next: the Rig page shows what this show needs from the room." |
| **cues** | cues, no devices | "N cues[, N of them broken]." | *Fix the N broken cues* (if any) · *Renumber <list> in tens* (if its numbers have gaps or repeats) · *Add a fade-out after every <bus> cue that has none* (if there are such) · *Make cues for the N sounds no cue uses* (if any) | "Next: tell me about a piece of equipment (“my lighting desk is an Ion at 10.0.0.20”), or press Look for props on the Rig page." |
| **devices** | at least one device | "N devices: N answering[, <name> is not]." | *Why is <name> not answering?* (the first not ready) · *Add a cue that sends <command> to <name>* (a device no cue uses; its `test` command, else its first) · *Is everything ready?* · *Write firmware for <name>* (a kit-model prop with no folder under `props/`) | "Next: more than this needs a coding agent. Ask me to hand the show over." |
| **no-model** | provider `off` (wins over all the above for `setup`; the state's own line and its offline asks are still shown) | as the state beneath | only the asks marked offline | — |

#### 4.6.1 No model yet

The path from "off" to "it answered" is one click when Claude Code is installed, and never more than one field.
The drawer shows, under the show's own line, four choices as rows, in this order, each true of this computer:

| Row | Says | Click |
|---|---|---|
| **Claude Code** (only if found, `installed['claude-code']`) | "Found on this computer. Uses the account it is signed in to: nothing to pay here, and it counts against that plan." | Sets the provider. Ready at once. |
| **Your own key** | "Anthropic, OpenAI or OpenRouter. You pay them for what you use, usually a few cents a request." | Opens Settings ▸ Assistant on that provider. |
| **A model on this computer** | "Ollama. Free and offline. Small models often cannot do this well." | Opens Settings ▸ Assistant on Ollama. |
| **The built-in helper** | "No model, no internet, nothing sent anywhere. It does a few jobs: cues from a folder, adding a device, a cue for a command, “is everything ready?”." | Sets the provider to `demo`. Ready at once. |

If Codex is found and Claude Code is not, it takes Claude Code's place. The **Endless Cues
assistant** ("free during the beta") is the first row; choosing it signs in ([17](17-service-protocol.md)). Under the rows, one line: "Everything else in Endless Cues works without any of
these." The provider's id is `demo`; its name on screen is **Built-in helper**.

#### 4.6.2 The built-in helper's turns

`demoProvider` learns these, each a scripted turn through the real tools (so each is also a test, and a thing a
person without a model can do). Phrasings are matched loosely; anything else gets the list.

| Asked | Its turn |
|---|---|
| "make cues from the (N) sounds in this folder" | `list_folder` → `propose_changes` with `starters.folderOps(listing)`: natural order of the paths; a sub-folder, or a shared prefix such as `sc2_` or `Act 1 -`, becomes a group named for it; names without leading numbers, separators and extensions; nothing else set. Reply: what order, what it grouped by, "I guessed nothing else." |
| "look for props" | `find_devices` → `propose_changes` with a `device.add` (model by the answered kind) for each one that is not a device. |
| "add a device called X at A[:P]" / "add the lighting desk at A" (a model's label or id may be named) | `propose_changes` with one `device.add`. |
| "add a cue that sends C to X" | `read_show {"device"}` → `propose_changes` with one Device cue after the playhead's cue. |
| "is everything ready?" / "why is X not answering?" | `rig_status` (and `ask_device` for the second) → the rows that are not ready, worst first, each with its fix. |
| "write firmware for X" | `make_prop_files` with the kit's defaults → `propose_changes`. |
| "hand the show over" | `hand_off` → `propose_changes`. |
| the five it has today | unchanged |

### 4.7 The hand-over (rung 7, small)

`core/assistant/guide.ts`: `agentGuide(doc, { showDir, bin })` → `[{ path: 'AGENTS.md', text }, { path: 'CLAUDE.md', text: '@AGENTS.md\n' }]`.
Generated, never written by a model, and regenerated whole each time (its first line says so). `AGENTS.md`
holds, for this show:

1. What this folder is: an Endless Cues show; which file is the show; which folders are the app's and must not
   be edited by hand (`versions/`, `backups/`, `logs/`, `show.unsaved.json`).
2. The rules: change the show only through the tools or `ec apply`; never while the app holds unsaved changes
   (`show.unsaved.json` exists); never play or save for the person; a change is proposed and they review it.
3. How to work on it, as command lines with this computer's real paths: `claude mcp add endless-cues -- node <bin>/ec-mcp.js`
   (the show open in the app, with "Let coding agents work on the show" on), or `… --show .` (no app);
   `ec outline .`, `ec validate .`, `ec check .`, `ec devices .`, `ec simulate .`, `ec apply . ops.json`.
4. The show as it is: title, how many cues, each device (id, name, address, commands as templates, how it is
   asked), the script file, what is under `props/`.
5. The kit's protocol (6.1), in full, because the likeliest job is "make this prop do something the kit does
   not".
6. What the app will not do, so the agent does not try to make it: run code from a show, flash a board, speak
   HTTP.

Two ways to make it, both ending in the same review card: the assistant's `hand_off`, and *Settings ▸ Assistant
▸ Write the guide for coding agents* (the host command `agent-guide`, which needs no model). After Accept the
drawer shows the two command lines to copy.

**As built.** The guide's command lines are made for where the app is running from (`guide.runner()`): from
source, `node <bin>/ec.js …`; from an installed app, where `bin/` is inside the app's archive and plain Node
cannot read it, the app's own program run as Node:
`ELECTRON_RUN_AS_NODE=1 "<the app's program>" "<…/app.asar/bin/ec.js>" …`, and
`claude mcp add endless-cues --env ELECTRON_RUN_AS_NODE=1 -- "<the app's program>" "<…/ec-mcp.ts>"`. Settings ▸
Assistant's line for coding agents is made the same way. Run once against an unsigned packaged build.

## 5. The pages

### 5.1 What the host pushes

In every state push (the heavy parts only when they change):

```jsonc
"rig": {
  "summary": { "ready": 6, "total": 9, "look": 2, "problems": 1, "unknown": 0, "at": 1731700000000, "text": "6 of 9 ready · 2 to look at · 1 problem" },
  "items":   [ /* 3.7 */ ],
  "devices": { "lantern_a": { /* 3.6 */ } },
  "ticks":   { "k1": true },
  "found":   null,                 // the last Look for props: [{ name, kind, fw, host, port, known, moved }]
  "scanning": false,
  "senders": [],                   // unknown senders, when the input port is listening
  "script":  { "file": "script.md", "found": true, "lines": 214, "marks": 31, "missing": ["12.5", "31"] },
  "folder":  { "sounds": 11, "videos": 0, "texts": 1, "unused": 3 }
},
"proposal": { /* as today */ "files": [ { "path": "props/lantern_a/lantern_a.ino", "lines": 212, "replaces": false } ] },
"assistant": { /* as today */ "first": { /* 4.6 */ } }
```

Host commands (all through `host.cmd`; "Edit" means refused in Show mode):

| Op | Arguments | Does | Show mode |
|---|---|---|---|
| `device-try` | `device`, `command`, `args?` | Sends that command once, through the hub (Hold Back holds it and the answer says so). Returns the monitor entry. | Refused, except the device's own `test` command while no cue is running. |
| `device-ask` | `device` | One "are you there?" now. Resolves `{ answered, ms, text }` within 1.5 s. | Allowed. |
| `rig-check` | | Asks every `ask` device now, re-reads the folder and the script, and stamps the summary. | Allowed. |
| `rig-scan` | | Look for props. | Refused. Also refused in Edit while a cue runs. |
| `rig-tick` | `id`, `on` | A checklist tick. | Allowed. |
| `rig-ticks-clear` | | *Start again*. | Allowed. |
| `prop-files` | `device`, `options` | Stages a files-only proposal from `core/kit/kit.ts`. | Refused (Edit). |
| `agent-guide` | | Stages a files-only proposal from `core/assistant/guide.ts`. | Refused (Edit). |

Devices are edited with the existing `edit` command and the operations of 3.5.

### 5.2 The Rig page

A view beside the cue list: the middle of the title bar's tabs, **Edit · Rig · Show** (and **· Live** when that is
on; the tabs replaced the old Cues | Rig switch and Edit / Show toggle, docs/specs/07-design-system.md). The Rig keeps
the mode the app is in: from Show it opens under Show mode's locks. *View ▸ Rig* is ⇧⌘R (`CmdOrCtrl+Shift+R`). Space is
still GO and Esc is still Panic; the list's own keys do nothing here. The sidebar (active
cues, sent, mixer) stays, and any drawer may be open beside it: the assistant and the Rig are meant to be
looked at together.

```
┌ title bar ── Edit · Rig● · Show ────────────────────────────────── Save  Versions  ✦ Assistant  ⚙ ┐
├ masthead: GO │ standing by … ───────────────────────────────────────────────────────────────────┤
├──────────────────────────────────────────────────────────┬──────────────────────────────────────┤
│ The rig    6 of 9 ready · 2 to look at · 1 problem       │ Lantern A                       prop │
│                        [Check again] [Look for props]    │ Address      10.0.0.42 : 53100   udp │
│                                                          │ Is it there  Ask it, every 2 s       │
│ THE SHOW                                                 │ ● answering · 4 ms                   │
│ ◐ The show is saved         3 unsaved changes    [Save]  │ Firmware 1.0 · Signal −52 dBm        │
│ ● Backups are on            every 5 minutes              │ Battery 87 %                         │
│ ● Every cue can run         42 cues                      │                                      │
│ SOUND                                                    │ COMMANDS                             │
│ ● Sound goes to the interface                            │ Look      n [1  ]       [Try] [+cue] │
│ ● Every file is found       14 files                     │ Level     level [1  ]   [Try] [+cue] │
│ EQUIPMENT                              [Add a device ▾]  │ Effect    [breathe ▾]   [Try] [+cue] │
│ ✕ Lantern A                 not answering (2 min)        │ Identify                [Try] [+cue] │
│     Check its power, and that it is on the show’s Wi-Fi. │ [Add a command]                      │
│                             [Ask again] [Try: Identify]  │                                      │
│ ● Lighting desk             on cue 12 · 3 ms             │ → /ec/identify            19:02:14   │
│ ○ Projector                 cannot be asked              │ ← /ec/here lantern_a light 1.0 …     │
│ BEFORE THE SHOW                        [Start again]     │                                      │
│ ☐ Fresh batteries in both lanterns                       │ Notes  In the stage-left wing.       │
│ ☑ Haze fluid                                             │                                      │
│ [Add a line]                                             │ [Write firmware…]           [Remove] │
│ HEARD ON THE NETWORK                                     │                                      │
│ 10.0.0.57 sends /ec/here every 2 s   [Make it a device]  │                                      │
├──────────────────────────────────────────────────────────┴──────────────────────────────────────┤
│ footer                                                                                          │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
(the sidebar, and a drawer if one is open, are to the right of this as they are beside the cue list)
```

- **The list** (left, a sheet like the cue list; rows 30 px). Group labels are section labels (10.5 px,
  uppercase, `--text-2`). A row: the state mark, the label, its text in `--text-1`, its actions as small
  buttons at the right. The mark is the only colour on the row: `●` in `--go` (ready), `◐` in `--standby` (to
  look at), `✕` in `--danger` (problem), `○` in `--text-3` (unknown). A row that is not ready has its `fix` on a
  second line, in `--text-1`, never coloured. A device's row also shows its reports that carry a warning
  ("Battery 18 %" with `◐`). Clicking a device row selects it (`--accent-wash`, as a selected cue).
- **The header**: the summary (the counts in mono), "checked <time>", *Check again* (the default grey button;
  it is not a GO), *Look for props* (shows "Looking…" for 1.5 s; what answered appears as rows under
  Equipment: "Lantern B answered at 10.0.0.43 [Add it]", or "Lantern A is now at 10.0.0.57 [Use this
  address]").
- **Add a device** offers: *From a model…* (the models, by label), *A prop on this network* (Look for props),
  *An empty device*. Each is one `device.add`; the new device is selected, its name ready to type.
- **The device editor** (right of the list, 400 px, shown while a device is selected; Edit mode only: in Show
  mode the selected device's state, reports and last messages are shown and nothing can be changed). Fields
  are drawn from `core/rig/devices.ts`'s tables as the inspector draws a cue's from its table. Commands are a
  small table: label, a control for each param (a number box, a text box, a select), **Try**, and **+cue**
  (adds a Device cue for that command, with the values showing, after the cue selected in the list, and says
  so in a toast). The last message out and the last in are under the commands, in mono; clicking either opens
  the monitor drawer. Every change is one undoable edit, pending until saved, and marked with the yellow dot
  that every unsaved control has.
- **Try** sends once. Held back, the toast says "Held back: nothing was sent (OSC out is off for rehearsal)".
  In Show mode the Try buttons are disabled with that reason in their tooltip, except the `test` command's
  while nothing is running.
- **Before the show**: each line a checkbox and its text; *Add a line* (an edit to the show); a tick is not an
  edit. *Start again* clears the ticks.
- **Heard on the network** appears only when the input port is listening and something has arrived from an
  address that is no device's and no patch's: who, what, how often, and *Make it a device* (a `device.add`
  with that address and `alive: { how: 'heartbeat', hears: <that address> }`).
- **An empty new show** has three rows (saved, backups, every cue can run; two more once it has a sound) and
  one line under Equipment: "Nothing yet. A device is a piece of equipment this show talks to: a
  lighting desk, a projector, a prop. [Add a device] [Look for props] or ask the assistant."

**As built (package C).** Where the page differs from the drawing above, and why:

- The header's summary is drawn from the counts, each behind its mark (`● 6 of 10 ready  ✕ 1 problem  ◐ 2 to look at  ○ 1
  cannot be told`), so that it reads by shape as well as by colour; `summary.text` is its tooltip.
- The device rows are drawn from the show's devices, each joined to its item `device.<id>` when the host has one (a
  device with no item yet reads "not checked yet", unknown). The checklist is drawn from `settings.rig.checks` and
  `rig.ticks`; items in the group "Before the show" are not drawn a second time.
- *Add a line* is a text box at the foot of the checklist (type, then Enter or leave it), not a button.
- In a page under 760 px wide the device editor takes the list's place (with "‹ The rig" to go back): the list and a
  400 px editor do not both fit beside the sidebar in a 1024 px window.
- Under every command is the exact message Try and a cue will send, always, not only after Try.
- A command's own settings (name, message, each value's kind, default and range, what fades, safe to try) open in
  place under it from a pencil button. A value is made for every `{word}` in the message as it is typed, and taken
  away with its word, so the show's rule (every hole a parameter, every parameter a hole) cannot be broken from here.
  A command made here takes its id from its name until a cue uses it.
- Choosing "Ask it" for a device whose model has no ask message does not change the show until the message is typed
  (the show refuses an empty one).
- Not drawn in v1: editing `reports`, `destinations`, `iface` and `framing` (they are shown or kept as they are; the
  assistant and `device.set` can change them). Under *More*: needed, safe to try, send again, answers on port.
- A row's action carries the host command that does it (`cmd`, from `core/rig/check.ts`: `stage-open`,
  `stage-pattern`, `override … off` for one held output, the `edit` that makes a patch a device), and the page sends
  that. Five need the window and are known to it by id: `ask`, `try`, `save` (an untitled show is asked where
  first), `select` (shows the action's `cue`), `relink` (asks for a folder: `ec.app` `relink`). The row ids are
  `show.saved`, `show.backups`, `show.cues`, `show.script`, `sound.output`, `sound.buses`, `sound.files`,
  `sound.mic`, `picture.stage`, `lights.dmx`, `device.<id>`, `patch.<id>`, `equipment.input`, `equipment.midi`,
  `module.<id>`, `connections.timecode`, `held`, `check.<id>`; each row also carries `groupLabel`.
  `test/rig-seams.test.ts` fails if the check gives a row a button the page has no way to carry out.
- A device's row also shows its firmware and signal when it reports them. What answered the last *Look for props*
  is drawn against the show as it is now: a prop that has since been added is not offered again, and one that is
  already a device at that address is not listed (its own row says how it is). A prop is added under the id it
  answers by (`lantern_b`), named to be read (`Lantern b`).
- *Write firmware…* is drawn from the kit's own `OPTIONS` (label, choices with their labels, default, help, `only`
  for the sketch an option belongs to); the light's own look is not in the form.

### 5.3 Elsewhere in the window

- **The cue list**: a Device cue's row shows its default name (`Lantern A ▸ Effect (breathe)`) and the glyph
  `◈`; broken, it has the `✕` every broken cue has. No other change.
- **The inspector** for a Device cue: Device (a select of the show's devices), Command (a select of that
  device's commands), then one control for each param of the chosen command, then, for a command with `fade`,
  "Fade to" and "Duration". A Network cue's Patch select lists the patches and then the devices.
- **The title bar**: the Rig tab's dot (3.7). No new chip: a device that stops answering mid-show is said by
  that dot and by its row, and by a notice once, when it stops ("Lantern A has stopped answering").
- **The review card** gains two parts under the cue changes, each only when it has something: **Devices**
  (`+ Lantern A · prop · 10.0.0.42:53100 · 4 commands · asked every 2 s`; a changed one field by field) and
  **Files** (`+ props/lantern_a/lantern_a.ino · 212 lines`, a replaced one signed `~` and marked "replaces";
  clicking a file shows its text in a scrolling mono box). The footer line becomes: "Nothing has changed yet.
  Accepting is one undo step and is not kept until you save. Files are written when you accept, and undo does
  not remove them." (the last sentence only when there are files).
- **The welcome panel**: a fifth button, *Start from a folder…*, after *New show*.
- **Settings ▸ Assistant**: the provider called "Offline demo" is "Built-in helper"; a button *Write the guide
  for coding agents*; and "What is sent" is rewritten to be true: "When you ask something: your message, an
  outline of the open show (cue numbers, names, types, settings, file names, each device’s name, address and
  commands), and whatever it looks at to answer: the names of the files in the show folder, the text of a file
  you ask it to read, the Rig’s state, and what the monitor has heard. Never audio, never a password, never
  anything outside the show folder. Nothing is sent unless you ask."
- **Settings ▸ Integrations ▸ Network**: one line above Patches: "Equipment with named commands, a Try button and a readiness
  check is a *device*: see the Rig."

### 5.4 The assistant drawer, rung by rung

Before the first message the body is `assistant.first`: its line, its asks as full-width buttons (the suggestion
pills of today, made from the show), and `next` as one line in `--text-2`. After the first message it is the
conversation, as now; the asks return, made afresh, whenever the transcript is cleared.

```
no model, a folder of sounds            a show with devices                      after a hand-over
┌ ✦ Assistant ───────────── × ┐         ┌ ✦ Assistant · claude-code ─── × ┐       ┌ ✦ Assistant ─────────────── × ┐
│ This folder has 11 sounds   │         │ 3 devices: 2 answering,         │       │ … I can’t make it speak HTTP  │
│ that no cue uses.           │         │ Lantern A is not.               │       │ here. I have prepared the     │
│ ┌─────────────────────────┐ │         │ ┌─────────────────────────────┐ │       │ folder for a coding agent.    │
│ │ Make cues from these 11 │ │         │ │ Why is Lantern A not        │ │       │ ┌ PROPOSED · 2 files ────────┐│
│ │ sounds                  │ │         │ │ answering?                  │ │       │ │ + AGENTS.md · 96 lines     ││
│ └─────────────────────────┘ │         │ ├─────────────────────────────┤ │       │ │ + CLAUDE.md · 1 line       ││
│ Next: tell me how each one  │         │ │ Add a cue that sends        │ │       │ │        [Reject] [Accept]   ││
│ should end. (That needs a   │         │ │ Identify to Lantern B       │ │       │ └────────────────────────────┘│
│ model: below.)              │         │ ├─────────────────────────────┤ │       │ Then, in a terminal:          │
│ ─────────────────────────── │         │ │ Is everything ready?        │ │       │  cd "…/Spring Concert"        │
│ Who should answer?          │         │ └─────────────────────────────┘ │       │  claude                       │
│ ▸ Claude Code   found       │         │ Next: more than this needs a    │       │                               │
│ ▸ Your own key              │         │ coding agent. Ask me to hand    │       │                               │
│ ▸ A model on this computer  │         │ the show over.                  │       │                               │
│ ▸ The built-in helper       │         │ ┌ What should change? ────────┐ │       │                               │
│ Everything else works       │         │ └───────────────────── [Send] ┘ │       │                               │
│ without any of these.       │         └─────────────────────────────────┘       └───────────────────────────────┘
└─────────────────────────────┘
```

With no model the asks marked offline still work: pressing one sets the provider to the built-in helper and
sends it, and the drawer says "Answered by the built-in helper (no model)."

**As built.**

- The rows of "Who should answer?" are the host's (`first.setup = { title, rows, foot }`; a row is
  `{ id: claude-code | codex | key | local | helper, label, says, found, set, open }`): `set` is the provider a
  click chooses at once, `open` the provider Settings ▸ Assistant is opened on.
- `first` also carries `under` (the state beneath `no-model`), `helper` (the built-in helper is answering) and,
  for the helper, `note` (what the helper is), drawn as a second quiet line. The helper's `next` is the rung above
  in words the helper takes ("Ask me to “look for props”…"). "(That needs a model: below.)" is added by `first`,
  only where it is true: the hand-over needs none.
- **Far fewer words, and a face (the owner's walk).** He found the drawer confusing and wordy, and chose Claude
  Code in a test window, where it cannot run, and nothing happened. So: the rows are a name and at most five
  words ("Claude Code · uses your Claude plan", "Your own key · Anthropic, OpenAI…", "Ollama · free, on this
  computer", "Built-in helper · no model, a few jobs"), with no line under them; an empty show is one line and
  one button; `next` is one short sentence or empty (always empty with nobody answering, and "(That needs a
  model: below.)" is gone); the helper's `note` and "Answered by the built-in helper" are gone (the header's badge
  says who answers). The table in 4.6.1 above is the design as it was, not the words as they are:
  `core/assistant/starters.ts` and its tests hold those.
- **A chosen answerer that cannot answer says why.** `assistant.chosen` is what was asked for, `assistant.provider`
  what is answering; when they differ, `assistant.missing` is one short line ("Claude Code can’t be used in a
  test window.", "Ollama needs a model name.") and the drawer shows it above the rows.
- **The assistant has a face: QIRX-G drawn flat, its pentagon eye carrying the state**, a robot puppet from the show this app was made for,
  drawn flat. It is in the side panel above the mixer ("Ask the assistant", a click opens the drawer; it can be
  hidden), beside the drawer's first line and each reply, and it says the state, always with words: asleep (off,
  or Show mode, where nothing of it moves), awake, thinking, a change waiting. [`docs/brand-assistant.md`](../brand-assistant.md).
- **The asks come back under a conversation**, made afresh from the show as it now is, with the `next` line, when
  the assistant is idle and no change is waiting. The design had them only on an empty transcript; in the walk a
  newcomer who had accepted the first change had nothing on the screen saying what could come next.
- *Start from a Folder…* opens the drawer when the folder has no cues yet (the first of the "three people").
- After files are accepted the drawer says where they are: for firmware, the prop's folder and that its
  `README.md` has the steps; for the hand-over, the two lines.
- A review card is never squeezed to fit the drawer (its Accept was out of reach under a long conversation):
  the drawer scrolls, and scrolls to a new card.

## 6. The prop kit (rung 6, small)

The smallest honest kit: **one protocol on one page, two sketches, and a generator that fills in their
settings.** It is written tonight and run by nobody: no board is here. That is said wherever a person meets it.

### 6.1 The protocol (version 1)

OSC 1.0 over UDP. The prop listens on **53100**. It never needs the booth: every rule below holds with the
booth switched off.

Booth → prop:

| Message | Arguments | Does |
|---|---|---|
| `/ec/hello` | — | The prop answers `/ec/here` to the sender's address and port. |
| `/ec/identify` | — | Shows itself for 2 s (a light blinks white; a switch does nothing but answer) and returns to what it was doing. |
| `/ec/look` | `n` int, `secs` float (optional) | Recalls look `n` (0: the look it starts with; 1 to 8: the looks in its settings) over `secs`. |
| `/ec/color` | `r g b` ints 0–255, `secs` float (optional) | A light: this colour. |
| `/ec/level` | `level` float 0–1, `secs` float (optional) | A light: its brightness. A servo: its position, 0–1 between its two ends. |
| `/ec/effect` | `name` string (`steady` \| `breathe` \| `pulse` \| `flicker`), `speed` float (optional, 1 is normal) | A light: how it moves. |
| `/ec/on`, `/ec/off` | `secs` float (optional, lights only) | A switch: on, off. A light: its last look, dark. |
| `/ec/pulse` | `ms` int | A switch: on for that long, then off. |

Any message may end with one more string argument beginning `#` (`#a41f07`). A prop acts once on each such id
(it remembers the last eight) and ignores a repeat: this is what `resend` on a device uses, so that a lost
datagram is covered and a relay is never fired twice.

Prop → booth, only ever in answer to `/ec/hello`:

```
/ec/here  <name:s>  <kind:s light|switch>  <fw:s>  <state:s>  <uptime:i seconds>  <signal:i dBm>  <battery:i percent, -1 unknown>
```

`state` is one word a person can read: `look3`, `breathe`, `on`, `off`, `own` (it is running its own look
because it has not been told anything). The models `ec-prop-light` and `ec-prop-switch` in
`core/net/devices.ts` describe exactly this: the commands above, `alive: { how: 'ask', send: '/ec/hello', reply: '/ec/here', every: 2 }`,
reports for arguments 2, 3, 5 and 6, `resend: 3`, `test: 'identify'`.

### 6.2 The two sketches

Kept in the repository under `core/kit/firmware/` (inside `core/` so that a packaged app carries them), written
fresh for this project, Arduino framework, ESP32 family:

- `prop-light/prop-light.ino`: an addressable strip (WS2812 / WS2811, the Adafruit NeoPixel library).
- `prop-switch/prop-switch.ino`: a relay on a pin, or a servo (50 Hz PWM from the core's own LEDC, no library).
- `ec_osc.h`: the little of OSC they need (read an address and int, float and string arguments; write
  `/ec/here`), shared by copying into each folder.

Each reads its settings from `config.h` and its Wi-Fi from `secrets.h`, and has no other per-prop line. The repository holds
only `secrets.example.h` (the template the kit writes `secrets.h` from); `secrets.h` there is gitignored. What
each must do, as rules a reader of the sketch can check:

1. **Its own look at power-on.** Before Wi-Fi is tried: the look in `config.h`, faded up over 1.5 s. A switch
   starts off (or on, if its settings say so).
2. **It carries on alone.** It never waits for the booth, never goes dark because the booth went quiet, and
   keeps doing the last thing it was told for as long as it has power.
3. **Wi-Fi is not in the show's path.** Joining and rejoining never block the light: the loop is never held
   for more than a few milliseconds, and a lost network is retried every 10 s without a restart.
4. **A hand wins.** With `BUTTON_PIN` set, a press steps through the looks (a switch: toggles), whatever the
   booth last said.
5. **It can be asked.** `/ec/hello` is always answered, with the truth.
6. **Over-the-air updates are off as written** (`#define OTA 0`). Turned on, they take `OTA_PASS` from
   `secrets.h`.

### 6.3 What the assistant tailors, and what is written

`core/kit/kit.ts`: `files(device, options)` → `[{ path, text }]`, and `OPTIONS` (the table of what may be
set, with defaults, which `make_prop_files`'s schema and the Rig's *Write firmware…* form both read):

| Option | Default | |
|---|---|---|
| `sketch` | `light` | `light` \| `switch` |
| `board` | `esp32dev` | A label for the steps (`esp32dev`, `esp32-c3`, `esp32-s3`, `xiao-esp32c3`): it chooses the board name the steps say to pick, and the default pin. |
| `pin` | 5 (a C3: 4) | The data, relay or servo pin. Refused if it is one of that board's boot pins, with the reason. |
| `count`, `order` | 30, `GRB` | A light: how many LEDs, and their colour order. |
| `output` | `relay` | A switch: `relay` \| `servo`. |
| `ssid` | `''` | The network's name, if the person said it. Not a secret; the password is. |
| `address` | `''` | A fixed address, if the person wants one (else the router gives it one, and the steps say to reserve it). |
| `look` | warm white, 40%, `steady` | A light's own look. |

Written, under `props/<device id>/` (the folder and the sketch share the name, as the Arduino IDE requires):

| File | Is |
|---|---|
| `<id>.ino`, `ec_osc.h` | The sketch, unchanged from the kit. |
| `config.h` | The settings above, the prop's `name` (the device's id), the port, the protocol version. |
| `secrets.h` | `#define WIFI_PASS "CHANGE-ME"` (and `WIFI_SSID` from `ssid`, else `"CHANGE-ME"`). **Written only if it is not there**: the person's password is never overwritten. |
| `README.md` | The steps, below, with this prop's board and pin filled in. |

and, once, `props/.gitignore` holding `secrets.h` and `build/`.

**Flashing is not in the app** (decided). It needs a compiler and a serial port, neither of which this app
has, and getting it wrong bricks nothing but wastes an evening. The assistant writes the files and the steps,
and says so. The steps, in the generated `README.md`:

1. Install the Arduino IDE (free). In it, add the ESP32 boards (Boards Manager ▸ "esp32"); for a light, add the
   library "Adafruit NeoPixel" (Library Manager).
2. Open `secrets.h` in this folder and type the network's name and password between the quotes. This file is
   yours: do not share it. The show never holds it.
3. Open `<id>.ino`. Choose the board (**<board name>**) and the port. *If this board already runs something
   you care about, save it first:* `esptool.py read_flash 0 ALL before.bin`.
4. Upload. The light comes up in its own look within two seconds, before it has found the network.
5. In Endless Cues, on the Rig page, press **Look for props**. It should answer by name. If it does not: the
   same network as this computer? 2.4 GHz? (An ESP32 does not join 5 GHz, or a WPA3-only network.)
6. Press **Try ▸ Identify**. It blinks.
7. Give it a fixed address in your router (reserve the one it has), so that it is in the same place tomorrow.

For people who use a terminal, the same with `arduino-cli`, as two lines.

## 7. Simple until asked

Added to [00 · Simple until asked](00-defaults.md), each with a line in `test/defaults.test.ts`:

| Behaviour | Default | Switch |
|---|---|---|
| The Rig page | A tab that is always there. It reads what the app already knows; it opens no port and sends nothing. An empty new show has three rows. | — |
| Asking a device whether it is there (one message every 2 s) | No devices in a new or an imported show, so nothing is asked. | A device whose "Is it there" is *Ask it*: adding one is the switch, and the review says "asked every 2 s". |
| Listening for a device's heartbeat (opens the input port) | Off | A device whose "Is it there" is *It says so by itself*. |
| Looking for props (one broadcast) | Never by itself | *Look for props*; the assistant's `find_devices`. |
| A device command sent more than once (`resend`) | 0 | The device; the kit's models set 3. |
| The assistant asking a device whether it is there | Off with the assistant | Choosing a provider. Then only as 4.1 allows. |
| The assistant reading files in the show folder | Off with the assistant | Choosing a provider, and then only when asked something that needs it. |
| Writing files into the show folder | Never by itself | Accepting a proposal that lists them. |
| A new show started from a folder | The folder's sounds are **not** made into cues | The assistant's first ask, or dropping them on the list. |

A new show is still a plain cue list: `defaultSettings().rig` is three empty things, and the test "a new show
plays as a plain cue list" still holds. An imported QLab show has no devices: its patches stay patches until
someone asks.

## 8. Building it

Three packages, built at once in three worktrees, after one short first step. **No file is in two packages.**
A file not named below belongs to nobody tonight: if a package needs to change one, it stops and says so in its
hand-back.

### Step 0 · The seam (package A, first, alone; about half an hour)

A commits this before anything else, on its branch, with `npm test` green, and reports the commit. **B and C
start from that commit.** It contains the shapes everyone codes against, real where that is cheap, stubbed
where it is not:

1. `core/rig/devices.ts`: the tables (`FIELDS`, `COMMAND_FIELDS`, `PARAM_FIELDS`, `ALIVE_FIELDS`,
   `REPORT_FIELDS`, `KINDS`, `VIAS`), and **real** `clean`, `trouble`, `compose`, `fromModel(modelId, over)`,
   `patchesOf(doc)`, `line(device)` (the outline's line for one device), `idFrom(name, taken)`.
2. `core/net/devices.ts`: `ec-prop-light` and `ec-prop-switch` (6.1); the optional `kind`, `alive`, `reports`,
   `resend` on an entry; `compose` here calls the one in `core/rig/devices.ts`.
3. `core/show/show.ts`: `settings.rig` in `defaultSettings()`; `normalise` cleaning devices; `problems` and
   `toEngineDoc` for the Device cue (**real**). `core/show/cue-types.ts`: the `device` type and the kinds
   `device`, `command`, `args` (**real**). `core/show/ops.ts`: the three operations (**real**).
   `core/show/diff.ts`: the device change kinds (**real**).
4. `core/show/files.ts` (`check`, `write`) and `proposal.files` in `core/show/document.ts`: `proposeDocument`
   and `propose` take `files`, a proposal may be files alone, `accept` writes them (**real**).
5. Stubs with their final signatures, each returning the empty shape this document gives: `core/rig/check.ts`
   (`items`, `summary`), `core/rig/liveness.ts` (`createLiveness`), `core/rig/scan.ts` (`scan`),
   `core/rig/senders.ts` (`senders`), `core/rig/script.ts` (`read`, `compare`), `core/rig/folder.ts`
   (`listing`, `readText`), `core/rig/fake-prop.ts` (`createFakeProp`).
6. `app/main/host.ts`, the seams (the only lines in that file that exist for B and C):
   - `const rigService = { status, monitor, senders, ask, scan, locked }` (4.3), stubbed;
   - `snapshot()` gains `rig` (5.1, from the stubs), `proposal.files`, and
     `assistant: assistant.status({ document, engine, rig: rigService, imported: state.imported || null })`;
   - `ask`: `assistant.ask(c.text, { document, engine, rig: rigService, canApply })`;
   - `agentCall` sets `ctx.rig = rigService` and **awaits** `agentTools.execute` (it becomes `async`; the
     bridge already awaits it);
   - the eight commands of 5.1, the six of A's returning `{ error: 'not built yet' }`, and the two that call
     B's modules written in full, each requiring its module inside the `case` (so the tree runs before B is
     merged; until then each answers with an error, which the window shows as a toast):
     `prop-files` → `require('../../core/kit/kit').files(device, c.options)` then
     `document.proposeDocument(document.doc, { summary: 'Firmware for <name>', author: 'you', files })`;
     `agent-guide` → `require('../../core/assistant/guide').agentGuide(document.doc, { showDir: document.showDir, bin })` likewise;
   - `'device-try'`, `'rig-scan'`, `'prop-files'`, `'agent-guide'` handled for Show mode as 5.1 says.
7. `app/main/smoke.ts`: one loop, after the existing sections, that runs `./smoke-rig`,
   `./smoke-assistant-rig` and `./smoke-rig-pages` if each exists (`require` inside `try`; a
   `MODULE_NOT_FOUND` for that very file is skipped, anything else is thrown), each
   `run({ host, win, check, until, page, sleep, shot, dir })`.

### Package A · The core

**Goal.** Devices are part of the show, a cue can send a device's command, the app knows whether each device
is there, and one function says whether the show is ready. All of it works with no window.

**Owns.**
- New: `core/rig/{devices,liveness,check,scan,senders,script,folder,fake-prop}.js`, `core/show/files.ts`,
  `bin/ec-fake-prop.ts`, `app/main/smoke-rig.ts`,
  `test/rig-{devices,ops,cue,live,check,folder,files,script}.test.js`.
- Edits: `core/show/{show,ops,cue-types,diff,document}.js`, `core/net/{hub,devices}.js`,
  `core/engine/dry-run.ts`, `app/main/host.ts`, `app/main/smoke.ts` (step 0's loop only), `bin/ec.ts`,
  `package.json` (one script, `fake-prop`), `test/defaults.test.ts`, and the docs
  `docs/specs/{00-defaults,03-show-file,06-control-surfaces}.md`.

**After the seam, builds.**
- `core/net/hub.ts`: `configure({ patches, devices, … })` (a device is found by id as a patch is; "the only
  patch" counts patches); `send(…, { quiet })`; replies and heartbeats that match a device's `alive` kept out
  of the monitor (the first after a silence excepted) and still counted; each entry's `from`;
  `pretendHeard(id, text)` for test runs; what arrives on the input port from a device's address is credited
  to it.
- `core/rig/liveness.ts`, `scan.ts`, `senders.ts`; `resend` in `sendNetwork`.
- `core/rig/check.ts` (3.7), `script.ts` (3.8), `folder.ts` (3.9, with `.docx`).
- The host: `rigService` and the six commands, real; the input port wanted by a heartbeat device; a notice,
  once, when a needed device stops answering; ticks.
- `core/rig/fake-prop.ts` and `bin/ec-fake-prop.ts` (below).
- `bin/ec.ts`: `ec devices <show>` (each device, one line, then its commands); `ec check <show> [--ask]` (the
  rows a folder can answer; with `--ask`, each `ask` device is asked once from here; exit code 1 on a
  `problem`); `ec try <show> <device> <command> [key=value …]` (composes, prints the message, sends it once:
  a person at a terminal is a person); `ec fake-prop [--name n] [--kind light|switch] [--port 53100]`.

**The fake device.** `createFakeProp({ name = 'lantern', kind = 'light', port = 0, host = '127.0.0.1', fw = '1.0', battery = 87 })`
→ `{ start() → Promise<{ port }>, stop(), heard: [{ at, text }], state(), set({ battery, signal }), silent(on) }`.
It speaks 6.1 to the letter over real UDP: answers `/ec/hello`, obeys every command by changing its `state`,
drops a repeated `#id`, and with `silent(true)` hears and answers nothing (a prop with a flat battery).
`bin/ec-fake-prop.ts` runs one in the foreground and prints each message as it arrives, so a person can see
the app working with no hardware. It is the stand-in for the unit tests (loopback sockets, as
`test/osc-net.test.ts` already uses), for the virtual users (a `--net` session), and for the end-to-end check.

**Must not touch.** `core/assistant/`, `core/kit/`, `core/engine/cue-engine.ts` (the engine does not change),
`app/renderer/`, `app/main/main.ts`, `app/audio/`, the importer.

**Tests.** Unit: a device round-trips through `normalise` and `stringify`; a show with no devices
writes no rig, and opens, plays and saves unchanged, with patches untouched;
every sentence of `trouble`; `compose` (defaults, ranges, enums, fade, quotes); the three operations, and
`show.set` on the device list refused; a patch made a device in one batch keeps every cue aimed at it; a
Device cue on a fake engine sends the composed message to the device, fades a value, is broken when its device
or command is gone; a raw Network cue to a device id; "the only patch" unchanged by a device; the diff's
sentences; liveness on a fake clock (ask, heartbeat, none; ready → problem once, logged once); the hub against
the fake prop on loopback (ask and answer, reports read, `resend` acted on once, quiet asks absent from the
monitor); scan finds it; `items` for each row of 3.7 from invented facts, including "unused is never a
problem" and "unknown is never ready"; `folder.listing` and `readText` (a path that leaves the folder, a link
out, a `.docx` made in the test); `files.check` (every refusal) and the files written on accept, a replaced one marked;
`script.read` and `compare`; `test/defaults.test.ts`: a new show has no devices, asks nothing, and the
input port is shut.
Smoke (`app/main/smoke-rig.ts`; the hub sends nothing in a smoke run): add a device by an edit; fire a Device
cue and find its message in `snap().sent`; `pretendHeard` an answer and see the device's row go ready and the
summary change; Hold Back on, Try answers "held"; Show mode refuses `device-try` for a command that is not the
test; a files-only proposal is accepted and the files are on disk in the temp show.

**Done when.** `npm test` and `npm run smoke` are green; `node bin/ec.js fake-prop` in one terminal and
`node bin/ec.js check <a show with that device> --ask` in another prints the device as ready; an old show's
`show.json` is unchanged by opening and saving it.

### Package B · The assistant and the kit

**Goal.** The assistant climbs the ladder: it can see the folder, the script, the rig and the monitor; make
devices and Device cues; ask whether a device is there; stage firmware and the hand-over; and it shows a first
screen true of this show. With no model, the built-in helper does the offline rungs.

**Owns.**
- New: `core/assistant/starters.ts` (`first`, `folderOps`), `core/assistant/guide.ts` (`agentGuide`),
  `core/kit/kit.ts` (`files`, `OPTIONS`), `core/kit/firmware/{prop-light/prop-light.ino,prop-switch/prop-switch.ino,ec_osc.h}`,
  `app/main/smoke-assistant-rig.ts`, `test/{assistant-rig,starters,kit,guide}.test.js`,
  `test/users/people/june.md` (a puppeteer with two props and a desk; tasks as goals, one per rung).
- Edits: `core/assistant/{tools,assistant,mcp}.js`, `bin/ec-mcp.ts`, `test/{assistant,assistant-tools,mcp}.test.js`,
  `test/users/materials.ts` (june's desk: six sounds, a script with marks, and a line in her `rig.txt` saying
  how to start the stand-in prop), `docs/specs/08-assistant.md`.

**Builds.** The eight new tools and the changed ones (4.3), on `ctx.rig` and A's modules; `execute`
awaited everywhere (`assistant.ts`'s loop, `mcp.ts`'s `fileBackend`, which gives no `ctx.rig`);
`TOOL_NAMES` from `TOOLS`; the outline's lines and the reference's DEVICES and MODELS sections (4.4), from A's
tables; the instructions (4.5); `status(ctx)` returning `first` (4.6); the provider rows' facts for 4.6.1
(`installed`); the built-in helper's turns (4.6.2); `agentGuide` (4.7); the kit: the two sketches to 6.1 and
6.2, `kit.files` and the steps (6.3), `secrets.h` written only when absent (the tool leaves it out of the
staged files when `props/<id>/secrets.h` exists).

**Must not touch.** Anything in A's or C's lists. It reads `core/rig/*` and `core/show/*`; it does not edit
them. If a signature in the seam is wrong for it, it says so in its hand-back and works round it.

**Tests.** Unit, with a scripted provider and a fake `ctx.rig`: each new tool's answer and each refusal
(`ask_device` for a device only in the draft; a public address; a `probe` that is no model's; Show mode; the
31st ask of a turn); a device made through `edit_show` and proposed, with the review's device line; a proposal
of files alone; `read_file` paging and the note beside a script mark; the outline's lines, and that a show of
300 cues with 3 devices gets the short outline plus three device lines; a field added to `FIELDS` appears in
the reference; `first()` for every state of 4.6, and that no ask is offered when it is not true (no "fix the
broken cues" with none broken); `folderOps` (natural order, a sub-folder becomes a group, a prefix becomes a
group, names cleaned, nothing else set); each of the helper's turns end to end against a temp show folder;
`kit.files` (the pin, count and name are in `config.h`; a boot pin is refused; `secrets.h` is left out when
present; no file path leaves `props/<id>/`); `agentGuide` names every device and the right paths; the MCP
server lists every tool in `TOOLS`. The sketches cannot be compiled here: a test checks only that each
contains every address of 6.1 and the six rules' markers, and the hand-back says they have never been built.
Smoke (`app/main/smoke-assistant-rig.ts`, provider `demo`): "add a device called Lantern at 127.0.0.1" stages
a proposal with one device; accepted, "add a cue that sends identify to Lantern" stages a Device cue; "is
everything ready?" answers with the Rig's summary; "hand the show over" stages two files.

**Done when.** `npm test` and `npm run smoke` are green, and, through Claude Code as the provider if it is
installed on the build machine (else said to be untried): "the desk is an ETC Ion at 127.0.0.1, add a cue that
fires its cue 12" produces a device from the model and a Device cue, in one proposal.

### Package C · The pages

**Goal.** A person can see the rig, add and edit a device, try a command, tick the checklist, start from a
folder, and meet the assistant's first screen, without reading anything.

**Owns.**
- New: `app/renderer/Rig.ts` (the page and the device editor), `app/main/smoke-rig-pages.ts`.
- Edits: `app/renderer/{app,Drawers,Inspector,Settings,CueList,lib}.js`, `app/renderer/styles.css`,
  `app/main/main.ts` (the View menu's Rig item, *File ▸ Start from a Folder…* and the `ec.app` op
  `start-in-folder { path? }`, the models and the kit's `OPTIONS` in what `ec.init()` returns),
  `app/main/preload.ts` if a bridge call is needed, `site/docs/index.html` (now in the service repository; the manual: a section "Equipment
  and the Rig", a section "Building a prop" with 6.1 and the steps, and the assistant's section brought up to
  date), `docs/specs/07-design-system.md`.

**Builds.** 5.2 to 5.4 exactly: the view switch and its dot; the Rig list from `s.rig.items`; the header;
*Add a device*; the device editor drawn from the tables; Try, +cue, Ask again, Use this address, Make it a
device; the checklist; Heard on the network; the Device cue in the inspector and the list; the review card's
Devices and Files parts; the drawer's first screen from `s.assistant.first` and the four provider rows; the
welcome panel's button; Settings' new words and button; *Write firmware…* (a form from `OPTIONS`, then
`prop-files`). Every colour is one of the four tokens or a neutral; every state mark is one of the four of
3.7; nothing here holds show state.

**Must not touch.** `core/`, `app/main/host.ts`, `bin/`. It draws what the host pushes and sends the commands
of 5.1. Until A and B are merged the stubs push empty shapes: the pages must draw sensibly from them (an empty
Rig is the plain-show Rig).

**Tests.** Smoke (`app/main/smoke-rig-pages.ts`; with `SMOKE_SHOTS`, a picture of each): the view switch shows
Rig and ⇧⌘R goes there; a plain show draws its rows and the "Nothing yet" line; after an edit adding a device
the row is there and selecting it opens the editor; a Try click reaches the host (`snap().sent`); a tick sets
and *Start again* clears; Show mode disables the editor's fields; a Device cue's row reads
`Lantern ▸ Identify`; a proposal with a device and a file draws both parts; with the provider off the drawer
shows the provider rows and no composer; Space on the Rig page still GOes (focus on a Try button, then Space:
the playhead moves, the command is not re-sent). Looked at by eye in all three themes from the pictures.

**Done when.** `npm test` and `npm run smoke` are green and the pictures show the page of 5.2 in LAB, OCEAN
and GRAPHITE with no colour outside the tokens.

### Step 4 · The coordinator

1. **Merge order: A, then B, then C.** B and C began from A's seam, so each merge should be clean in code.
   Expected conflicts are only where two packages were *given* the same file by mistake; there are none in the
   lists above. If `app/main/smoke.ts`, `package.json` or `test/users/materials.ts` conflict, keep both sides.
2. After each merge: `npm test && npm run smoke`.
3. **The end-to-end check**, by hand or with one virtual-user session started with `--net` (never beside the
   show's own app: `pgrep` first, as `CLAUDE.md` says). The provider is the built-in helper, so it needs no
   model and is the same every time:
   1. A new empty folder with six WAVs (from `test/users/materials.ts`). `node bin/ec.js fake-prop --name lantern` running.
   2. *Start from a folder…* → the drawer says "6 sounds not in a cue yet." → **Make cues from
      these 6 sounds** → Accept. Six cues, in order.
   3. "look for props" → a proposal with one device, Lantern, at 127.0.0.1:53100 → Accept.
   4. The Rig tab: Lantern's row is ready within three seconds and shows firmware 1.0.
   5. Select it; **Try ▸ Identify**: the fake prop's terminal prints `/ec/identify` once (it was sent three
      times with one id).
   6. "add a cue that sends identify to Lantern" → Accept. GO to it: the terminal prints it again.
   7. Save. **The Rig says "All N are ready"** and its tab has no dot. (A row that is not ready must be one
      that is true of the machine it is run on, such as no sound output in a silent test session; say which.)
   8. Stop the fake prop: within six seconds the row is a problem with its fix, the tab has a red dot, and one
      notice says so. Start it again: ready.
   9. "hand the show over" → Accept → `AGENTS.md` is in the folder and names Lantern.
4. Then, and not before: add to `CLAUDE.md`'s "Not verified yet" the lines of section 9; add the tracker lines;
   bring [12 · Roadmap](12-roadmap.md) up to date; run the virtual users with `june` added.

**As done.** Steps 1 to 4 are done except the last clause: the virtual users have not yet been run with `june`.
The walk of step 3 was done in a `--net` test session with the built-in helper, every step as written, and a
second time through Claude Code in the person's own words (such a session may now use an installed agent
through a door of its own, `EC_BRIDGE_FILE`). One difference from step 3.7: a row that could not be ready on the
test machine did not arise ("All 6 are ready"). `test/users/prepare.ts` gives `june` a session with network
ports, so the rule about not running `theo` beside a running show covers `june` too.

## 9. What is left out, what is unproven, what to ask

### Out of v1, and why

| Left out | Why |
|---|---|
| HTTP, MQTT, serial, and devices that need a conversation | Each is a new sender with its own failure modes, and none can be tried tonight. HTTP is the first to add (`via: 'http'`). Until then: rung 7. |
| Flashing from the app; compiling | Native tooling and a serial port. The steps are written instead. |
| PDF scripts | Needs a dependency. `.docx` and text are read. |
| A test tone on an output; a "flash every prop" button | The tone belongs to the audio window, which nobody can listen to tonight. Identify exists per device. |
| A device kept as its own file, to copy between shows | 3.1. An "export this device" file is the right later form. |
| The assistant in Show mode, even to answer a question | It is disabled there today; changing that deserves its own decision. The Rig page works in Show mode without it. |
| Writing marks into a script; regenerating cues from one | 3.8. |
| Patches and the lighting-desk module folded into devices | Would change every show's patches. They sit side by side. |
| A drawn diagram of the rig | Needs a layout per show. |
| Discovery of anything but kit props (mDNS, Art-Net nodes as devices, a sweep) | A sweep of the network can make a printer print. One hello to one port is all v1 sends. |
| Disk space and mains power on the Rig | Worth having; platform-specific; not tonight. |
| The hosted assistant | Its own spec: [17](17-service-protocol.md). |

### Not verified until there is equipment

In `CLAUDE.md`'s list since the merge (as corrected there):

- **The prop kit's firmware has never been flashed or run.** It compiles with arduino-cli for `esp32` and
  `esp32c3`; no board has been flashed with it. Every rule in 6.2 is a rule the sketch was written to, not one
  that was watched. The protocol has been spoken only by this app and its own stand-in (`bin/ec-fake-prop.ts`).
- *Look for props* on a real network: whether a broadcast hello reaches a prop through a given router (many
  isolate clients), and on a computer with two networks.
- A packaged, signed build reaching a prop on macOS (the Local Network permission is judged per signed app; the
  first show lost an evening to it).
- A device made from any model (`etc-eos`, `x32`, …) against that equipment: the "are you there?" and its
  answer, the reports, a Device cue arriving.
- `resend` against a real prop on lossy Wi-Fi: that one of three arrives, and that a relay fires once.
- Liveness over a long sitting: a device asked every two seconds for four hours, and what the log holds after.
- A MIDI device's commands at a port.
- The assistant's device-making with a real model on a real manual page: whether it writes only commands it
  was given. Tested with scripted replies; tried live only as B's hand-back says.
- A `.docx` script written by Word (the test's is made by the test).

### For the owner (none of these blocks the build; each is built as recommended)

1. **Is the page called "Rig"?** You called it the pre-show checklist page. Recommended: **Rig**, because it
   also holds the devices and is looked at all day, not only at the half; the readiness line and "Before the
   show" keep the checklist's words. Changing the word later is one string in three places.
2. **Is the Rig tab always visible, even on a plain show?** Recommended: yes. It is one word, it acts on
   nothing, and its red dot is how a newcomer finds a missing file. The alternative is hiding it until the
   show has a device.
3. **Devices inside `show.json`, not files of their own.** Recommended as written (3.1): one undo, one
   version history, one review. A device file for sharing between shows can follow.
4. **May the assistant send an "are you there?" by itself?** Recommended: yes, and only that (4.1). Without it
   the assistant cannot tell a wrong address from a dead prop, and every check costs a click. It can never
   send a command.
5. **Starting from a folder makes that folder the show** (a `show.json` beside your sounds, nothing copied).
   Recommended as written. The alternative is a new `Name.ecshow` folder with the sounds copied in, which is
   tidier and doubles the disk use.
6. **The built-in helper does real work with no model** (cues from a folder, adding a device, "is everything
   ready?"). Recommended: yes; it is the honest first minute for someone with no account anywhere. It must
   never pretend to understand more than its list.
