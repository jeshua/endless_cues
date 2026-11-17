# 06 · Control surfaces

This document covers everything that can drive the show other than a person clicking in the window: the host's command door and pushed state (`app/main/host.ts`), the bridge the window uses (`app/main/preload.ts`, and the `ec-app` handler in `app/main/main.ts`), the keyboard (`app/renderer/app.ts`), and the three modules that ship: OSC control (`app/main/modules/osc-control.ts`), the web remote (`app/main/modules/web-remote.ts` and `remote.html`) and the lighting desk (`app/main/modules/lighting-desk.ts`). It ends with the module interface and how to write one. OSC encoding and decoding is `core/net/osc.ts`.

## 1. One door

The show host lives in the main process. `host.cmd(c)` is the only way anything changes the show or the transport: the window (over IPC), OSC control and the web remote all call it with the same command objects.

- `cmd(c)` returns the op's result, or `{ ok: true }` when the op returns nothing, or `{ error: '<message>' }`. It never throws. Every call schedules a state push.
- A command is `{ op: '<name>', ...arguments }`. A missing or non-string `op` gives `{ error: 'no command' }`; an unknown one `{ error: 'unknown command <op>' }`.
- Callers add their own fields (`from: 'osc'`, `from: 'web-remote'`, `guard`, `sure`). The host reads none of them.
- **Show mode.** While `mode` is `'show'`, the ops `edit`, `undo`, `redo`, `import`, `accept` and `restore-version` return `{ error: 'Show mode: editing is locked' }`. Every other op still runs in Show mode, including `bus` and `master` with `commit` (which write the show file), `save-version`, `reject`, `arm`, `lights`, `device` and `mode` itself.
- Where an op takes "a cue", `id` is used if present, else `number` is looked up across every list at any depth (`show.findByNumber`, case-insensitive).

## 2. Host commands

### 2.1 Transport

| Op | Arguments | Does | Result |
|---|---|---|---|
| `go` | — | `engine.go()`. Dropped if within `settings.go.doubleGoProtection` s (default 0.3) of the last accepted GO, whatever the source. | `{ ignored: 'double GO' }` when dropped |
| `panic` | `hard?` | `engine.panic()`; with `hard`, twice (stops dead). | |
| `reset` | — | `engine.reset()`, stops every voice in the audio window, re-sends the mixer. | |
| `pause` | `id?` \| `number?` | Pauses that cue and everything under it; with neither, everything. | |
| `resume` | `id?` \| `number?` | The reverse. | |
| `toggle` | `id` \| `number` | Pauses the cue if nothing under it is paused, else resumes it. No cue found: nothing. | |
| `stop` | `id` \| `number` | `engine.stopCue`. No cue found: nothing. | |
| `fadeall` | `secs?` (5) | Fades everything out and stops it. | |
| `playhead` | `id` | Puts the playhead on a top-level cue of the current list. | |
| `move` | `step` | Moves the playhead by `step` stops (clamped). | |
| `list` | `name` | Makes another list the current one; playhead to its top. | |
| `jump` | `number` | Playhead to the top-level cue with that number (or id), in any list. | `{ error: 'no cue numbered …' }` |
| `load` | `secs` | Load to Time for the cue at the playhead; 0 clears. | |
| `seek` | `id`, `t` | Skips a running audio cue to `t` s. | |
| `arm` | `id` | Toggles a cue armed / disarmed in the engine (not written to the show file). | |
| `fire` | `id` \| `number` | Fires a cue without moving the playhead or running its continue. | `{ error: 'no such cue' }` |
| `loop` | `id`, `region: { start, end }` | `engine.toggleHold`: arm, disarm or let go of a loop section on a running track. | `{ did: 'armed' \| 'disarmed' \| 'let go' \| null }` |
| `light-set`, `light-level`, `light-blackout`, `light-clear`, `light-revert`, `light-record`, `light-fixture` | see [14 · Lighting](14-lighting.md#5-the-dashboard-and-recording) | The app's own lights: a hand on the levels, blackout, recording what is live into a Light cue (an edit: locked in Show mode). | |
| `lights` | `on` | Light cues are stops (`true`) or skipped (`false`). Saved in this computer's config, not the show. | |
| `mode` | `mode: 'show' \| 'edit'` | Sets the mode (anything but `'show'` is `'edit'`). Not persisted. | |

A `pause`, `resume`, `toggle`, `stop` or `fire` that names a cue (`id` or `number`) which does not exist is refused with an error; it never falls through to "everything".

### 2.2 Editing

| Op | Arguments | Does | Result |
|---|---|---|---|
| `edit` | `ops: [...]`, `label?` | One undoable edit: the ops in `core/show/ops.ts`, applied whole or not at all, written to `show.json` at once. | `{ made: [ids], refs, changed: true }`, or `{ made, changed: false }`, or `{ error }` |
| `undo`, `redo` | — | | `{ error: 'nothing to undo' }` / `'nothing to redo'` |
| `import` | `paths: [...]`, `after?`, `parent?`, `copy?` (true) | One Audio cue per sound file (wav, aif/aiff, mp3, m4a, aac, flac, ogg, opus). Files outside the show folder are copied into `media/` unless `copy` is false or the show is untitled. Lands after `after`, else in `parent`, else at the end of the current list. | As `edit`; `{ error }` if no path is a sound file |
| `clip-copy` | `ids: [...]`, `cut?` | Takes those cues (the topmost of them, in list order) onto the cue clipboard. The clipboard is the host's, not the show's and not the window's: it is still there when another show is opened (`core/show/clipboard.ts`). | `{ count, cut }` |
| `clip-info` | — | What is on the clipboard. | `{ clip: { count, cut, same, cue, properties: [{ key, label, set }] } \| null }` |
| `clip-paste` | `after?` \| `before?` \| `parent?` | One edit. Cut and pasted into the show it came from: a move. Otherwise the cues are made again: targets inside the clip follow the copy, a target that is not in this show is dropped, a number in use is not pasted, and in another show each sound is found from the first show's folder and copied into this one's `media/`. With no place named: the end of the list shown. | `{ made: [ids], moved, count, fromAnotherShow }` |
| `clip-props` | `ids: [...]`, `keys: [...]` | Paste Cue Properties: those fields of the first cue on the clipboard, onto each cue named that has them. One edit. | `{ count }` |
| `retarget` | `id`, `path` | An Audio cue plays this sound file from now on (copied into `media/` as `import` does). | as `edit` |
| `template` | `id` \| `type`, `clear?` | New cues of that cue's type start with its settings (`settings.templates.<type>`, `core/show/templates.ts`); `clear` removes the type's template. | as `edit` |

The window adds to the operations of `edit`: `cue.unnumber { ids }`, and `cue.renumber` passes over numbers held by cues it is not renumbering. A cue added from the toolbar or by a dropped sound starts from its type's template; a paste, a duplicate and the assistant's cues do not.

After any document change the host reloads the engine, applies a changed `gainDb` to a sound that is playing (`engine.trim`), re-sends the mixer, re-probes files if the file set changed, and reconciles modules.

### 2.3 Mixer

| Op | Arguments | Does | Result |
|---|---|---|---|
| `bus` | `name` (bus id), `db`, `commit?` | Moves the bus fader in the audio window at once (30 ms ramp). With `commit`, writes `settings.audio.buses.<i>.db` (rounded to 0.1) as an undoable edit. | |
| `master` | `db`, `commit?` | The same for the master (`settings.audio.masterDb`). Not heard while the output is muted by a smoke run. | |
| `device` | `id` | Asks the audio window to switch output device; the outcome arrives in pushed state (`mixer.device`, `mixer.deviceOk`). Saved per computer on success. | |
| `peaks` | `file` | Waveform data for a file. WAV is read in the main process; other formats are decoded in the audio window, during which the answer is pending. | `{ file, peaks, rms, pending }` |

### 2.4 Versions

| Op | Arguments | Result |
|---|---|---|
| `versions` | — | `{ versions: [{ id, at, note, author, hash, cues }] }`, newest first |
| `save-version` | `note?` | `{ version }` (the entry; `same: true` if nothing changed since the newest). An empty note is written from the diff. `{ error }` for an untitled show. |
| `compare-version` | `id`, `other?` | `{ entry, changes, summary }`: from version `id` to the show now, or to version `other`. |
| `restore-version` | `id` | `{ version }`. An undoable edit. |

### 2.5 Proposals and the assistant

| Op | Arguments | Does | Result |
|---|---|---|---|
| `ask` | `text` | One assistant turn. Asynchronous: `cmd` returns a promise. The assistant may stage a proposal; it cannot edit. | `{ ok: true, proposal }` or `{ error }` |
| `accept` | `id?` | Lands the staged proposal as one edit, with a version saved before (if there were unsaved changes) and after. Refused if the show changed since it was proposed. | As `edit`, or `{ error }` |
| `reject` | `id?` | Discards the staged proposal. | |
| `assistant-reset` | — | Clears the conversation. | |
| `assistant-config` | `config` | Reconfigures the assistant in memory. The window uses the `ec-app` op of the same name instead, which also saves it per computer. | |

### 2.6 Misc

| Op | Does |
|---|---|
| `state` | Marks every view as needing the full state on the next push (a page that has just loaded sends this). |

## 3. Pushed state

The host pushes state to every registered view on the `ec-state` channel: after any command, on any engine change, and every 100 ms while anything is active or a level reading exists. `host.snapshot(full = true)` builds it; modules call it too.

| Field | Content |
|---|---|
| `rev` | A counter that bumps when the document changes (or the list is switched). |
| `doc`, `labels` | Only when the view has not yet been sent this `rev`. `doc` is the show document with `beats` / `downbeats` stripped from cues (`hasGrid: true` in their place). `labels` is `{ cueId: displayName }` for the current list. The window keeps the last ones it was sent. |
| `rows` | The current list flattened: `[{ id, depth, parent, type, number, name, notes, color }]`. |
| `show` | `{ title, dir, untitled, dirty, canUndo, canRedo, undoLabel, warnings }`. `dirty`: changed since the newest saved version. |
| `problems` | `[{ id, level: 'error' \| 'warning', why }]`: document problems plus one error per missing file. |
| `engine` | The engine's `snapshot()` without `cues` and `poem` (see `04-cue-engine.md`, section 13). |
| `mixer` | `{ masterDb, buses: [{ id, name, db, peak }], level, limiting, device, devices, deviceOk, audioReady, muted }`. `level` is per-channel `[{ peak, rms }]` in dB. |
| `modules` | `[{ id, name, summary, fields, enabled, running, status }]`. |
| `mode` | `'edit'` or `'show'`. |
| `proposal` | `{ id, summary, author, changes, counts }` or `null`. |
| `assistant` | `{ available, provider, busy, transcript, signedIn }`, or `{ available: false }`. |
| `sent` | The last 12 Network cue sends: `{ at, message, to, ok, why? }`. |
| `notice` | A transient message from the host, or `''`. |

## 4. The window's bridge

`app/main/preload.ts` exposes `window.ec` and nothing else:

| Call | Does |
|---|---|
| `ec.init()` | `{ version, platform, smoke, types, typeOrder, common, colors, theme, themes, assistant }`: the cue-type table the inspector is drawn from, and this computer's theme. |
| `ec.cmd(c)` | `host.cmd(c)`. |
| `ec.app(c)` | Things only the shell can do (below). |
| `ec.onState(fn)`, `ec.onMenu(fn)` | Pushed state; menu actions (`settings`, `assistant`, `versions`, `toggle-mode`, `save-version`, `save-version-named`). |
| `ec.pathFor(file)` | The disk path of a dropped `File`. |

`ec.app` ops (`main.ts`): `open` (folder dialog), `open-path { path }`, `new`, `demo`, `save-as` (dialog), `import { after? }` (file dialog, then the host's `import`), `pick-sound` (→ `{ file }`, adopted into the show's `media/`), `recent` (→ `{ recent: [{ path, name }] }`), `reveal`, `log` (→ `{ lines }`, the last 300), `theme { theme }` (one of `lab`, `ocean`, `graphite`; saved per computer), `assistant-config { config }`. These are not reachable from modules.

## 5. Keyboard

One `keydown` listener on `window`, in the capture phase, so a focused button or slider never takes a key for itself. "Typing" means the focus is in a text input, a textarea or a contenteditable (`typingIn` in `app/renderer/lib.ts`; checkboxes, radios, ranges and buttons do not count). ⌘ is Ctrl on Windows and Linux.

| Key | Action | Edit mode only | Notes |
|---|---|---|---|
| Space | GO | | Auto-repeat is ignored. |
| Esc | Panic (again within 1.5 s: stop dead) | | While typing: blurs the field instead. With Settings open: closes it instead. |
| ↑ ↓ | Select the previous / next row; a top-level row also takes the playhead | | Shift extends the selection without moving the playhead. |
| `[` `]` | Pause all, resume all | | |
| P | Pause / resume the selected cue | | One cue selected. |
| S | Stop the selected cue | | One cue selected. |
| V | Fire (audition) the selected cue | | One cue selected. Playhead does not move. |
| D | Arm / disarm the selected cue | | One cue selected. Engine state, not the show file. |
| Q or Enter | Rename in place | yes | One cue selected. |
| N | Edit the number in place | yes | One cue selected. |
| ⌫ / Delete | Delete the selection | yes | |
| ⌘Z, ⇧⌘Z | Undo, redo | yes | In Show mode the keys are swallowed. |
| ⌘A | Select every visible row | | |
| ⌘D | Duplicate the selection | yes | |
| ⌘G | Group the selection | yes | |
| ⌘1 … ⌘0 | Add a cue of the 1st … 10th type in toolbar order (Group, Audio, Fade, Stop, Start, Pause, Devamp, Load, GoTo, Arm) | yes | ⌘2 adds an empty Audio cue; the toolbar's Audio button opens the file dialog instead. |
| ⌘, | Settings | | Works while typing. Also a menu item. |

Everything but Esc and ⌘, is ignored while typing or while Settings is open. Menu accelerators (`main.ts`): ⌘N new show, ⌘O open, ⌘S save version, ⇧⌘S open the Versions drawer, ⇧⌘O add sounds, ⇧⌘M Show mode, ⌘L the Live view, ⌘K assistant, ⇧⌘V versions, ⌘T Load to Time, ⌘J Jump to cue, ⌘R Renumber. Also ⌥⌘V Paste Cue Properties, ⌘E go to the selected cue's target, ⇧⌘F the flagged cues and problems.

## 6. Module: OSC control

`id: 'osc-control'`. Config: `{ enabled, replyPort: 53001, passcodes: [{ code, view, edit, control }], noPasscode: { view, edit, control }, passcode: '' }` (`passcodes` and `noPasscode` are absent until set; `passcode` is the older single one, which grants everything). It owns no socket: it handles what arrives on the hub's one input port (UDP and TCP, IPv4; `settings.network.inputPort`, default 53000). Every message of a bundle is read, in order.

The addresses are QLab 5's OSC dictionary, as far as the host has a command or a fact for what each names. Everything is done with `host.cmd` and read from `host.snapshot()`. Nothing here has been tried against a real remote (tracker O10; section 6.6 is the script for doing so).

A leading `/workspace/<id>` is stripped and ignored (there is one show). An address that is none of the below gets no reply and is left for a cue's `oscTrigger`.

### 6.1 The show

| Address | Does (host command) |
|---|---|
| `/go` | `go` |
| `/go/<n>`, `/go "<n>"` (a string argument) | `jump { number }` then `go`; the `go` is not sent if the jump is refused |
| `/panic` | `panic` |
| `/panicInTime <secs>` | `fadeall { secs }`; with no argument `panic`; with 0, `panic { hard }` |
| `/stop`, `/hardStop` | `panic { hard: true }` |
| `/pause`, `/resume`, `/reset` | `pause`, `resume` (everything), `reset` |
| `/playhead/<n>`, `/select/<n>` | `jump { number }` |
| `/playheadID/<id>`, `/select_id/<id>` | `jump` to that cue; an error for a cue inside a group |
| `/playhead/next`, `/playhead/previous`, `/select/next`, `/select/previous` | `move { step: ±1 }` |
| `/playhead/nextSequence`, `/playhead/previousSequence` | `playhead { id }`: the first cue of the next (previous) cue sequence of the list on screen. A sequence starts at a cue the one before it does not continue into. An error at either end. |
| `/showMode` | read: `true` / `false`. With a boolean (or `toggle`): `mode`. |
| `/toggleEditShowMode` | `mode` |
| `/undo`, `/redo` | `undo`, `redo` (refused in Show mode) |
| `/save` | `save`; an error for a show with no folder yet |

| `/playhead/active` | `playhead { id }`: the first cue of the list on screen that is running or paused; an error when none is |
| `/playhead/selected` | nothing (the selection is the playhead); answered `ok` |
| `/playhead/none` | `playhead { id: null }`, **where the host has it** (`host.supports('playhead-none')`); otherwise an error |
| `/new <type> [<after id>]` | one `edit` with a `cue.add`: after the cue named, else after the cue standing by, else at the end of the list on screen. `data` is the new cue's id, and the playhead goes to it (QLab selects a new cue). `<type>` is QLab's name where this app has that cue (`audio`, `mic`, `fade`, `network`, `midi`, `group`, `start`, `stop`, `pause`, `load`, `devamp`, `goto`, `arm`, `disarm`, `wait`, `memo`, `light`) or `cue list` (a `list.add`; `data` is the list's id); `video`, `camera`, `text`, `midi file`, `timecode`, `reset`, `target`, `script` and `cart` are answered "there is no … cue in this app". |
| `/move/<id> <index> [<parent id>]` | one `edit` with a `cue.move`: to that place (0 first; past the end is the end) among the cues of the list or group named, or of its own. `data` is `{ parent, index }` (QLab's manual says the reply carries the new parent and index, not in what shape: this shape is ours). |
| `/delete/<n>`, `/delete/<pattern>`, `/delete_id/<id>`, `/delete/selected`, `/delete/active` | one `edit` of `cue.remove` ops (a cue inside a group that is going too goes with it) |
| `/renumber <start> <increment> [<prefix> [<suffix>]]` | one `edit` with a `cue.renumber` of the cue standing by (QLab renumbers the selected cues; here the selection is one cue) |

`/new`, `/move`, `/delete` and `/renumber` go through `host.cmd({ op: 'edit', … })`, so **Show mode refuses them** and each is one undo step.

`/playbackPosition…` is accepted wherever `/playhead…` is. **There is no selection in the host: "selected" means the cue standing by (the playhead)**, in `/select…`, `/cue/selected/…`, `/delete/selected` and `/selectedCues`. `none`, `active` and `selected` are never taken for a cue number.

**Ops the host may not have yet.** Three addresses need a host op that is being added elsewhere: `load { id, secs }` (load a cue that is not standing by), `reset { id }` (one cue) and `playhead { id: null }`. The module asks `host.supports('load-id' | 'reset-id' | 'playhead-none')` before sending any of them, and answers with an error saying so when the host has not; it never sends the old host an op it would misread (`reset` with an id it ignores would reset the whole show). The names are listed in `SUPPORTS` beside `api` in `host.ts`: add a name there when its op exists.

### 6.2 One cue

| Form | Names |
|---|---|
| `/cue/<n>/…` | the cue with that number (URL-decoded; any list, any depth; case-insensitive) |
| `/cue/<pattern>/…` | every numbered cue whose number matches an OSC pattern (`*`, `?`, `[abc]`, `[1-5]`, `[!…]`, `{a,b}`) |
| `/cue_id/<id>/…` | the cue with that id; a cue list's id names the list (read-only) |
| `/cue/selected/…`, `/cue/playhead/…`, `/cue/playbackPosition/…` | the cue standing by |
| `/cue/active/…` | every cue that is running or paused |

**A message that names no cue (no such number or id, a pattern nothing matches, nothing standing by, nothing running) is answered with an error and does nothing.**

| Method | Does |
|---|---|
| `/start`, `/go` | `start { id }`: the cue and the sequence that continues from it; the playhead stays. Also `/cue/start <n>` and `/cue_id/start <id>`. |
| `/preview` | `fire { id }`: the cue alone |
| `/stop`, `/hardStop` | `stop { id }` |
| `/panic` | `stop { id, fade: true }`: out over the panic time |
| `/pause`, `/hardPause`, `/resume`, `/togglePause` | `pause`, `pause`, `resume`, `toggle` |
| `/loadAt <secs>` or `<h> <m> <s>` | `load { secs }` (negative: from the end) for the cue standing by. For any other cue: `load { id, secs }` where the host has it (see above), else an error. |
| `/load` | the same with `secs: 0` (clears a Load to Time) |
| `/reset` | `reset { id }` where the host has it, else an error (`/reset` with no cue resets the whole show) |

On several cues the commands are sent in list order and stop at the first the host refuses.

Properties. With no argument it is a read (of exactly one cue: an address matching several is an error); with an argument it is a write to every cue named, as one `edit` of `cue.set` ops, so **Show mode refuses it** and it is one undo step.

| Property | Read | Write |
|---|---|---|
| `number`, `name`, `notes` | text (`name` is the cue's own, which may be empty) | text |
| `preWait`, `postWait` | seconds | seconds; `/+ <d>`, `/- <d>`, `/+/<d>`, `/-/<d>` (never below 0) |
| `duration` | the `duration` field; for an Audio cue without one, the file's measured length | as above, for a type that has a `duration` field (others: the error from `cue.set`) |
| `continueMode` | 0 none, 1 auto-continue, 2 auto-follow | 0, 1, 2; `/+` and `/-` roll over |
| `armed` | whether the engine has it armed | boolean, `toggle`, `/toggle`. Written to the cue; if the engine still disagrees (the operator armed or disarmed it live), an `arm { id }` follows. |
| `flagged` | boolean | boolean, `toggle`, `/toggle` |
| `colorName` | the cue's `color` (`none` when unset) | one of the show's colours (`core/show/cue-types.ts`) |
| `uniqueID` | the cue's id | |
| `type` | the type's label (`Audio`, `Group`, `GoTo`, `MIDI`…); a list is `Cue List` | |
| `displayName`, `listName` | the name the list shows (the default name when it has none) | |
| `defaultName` | the default name | |
| `isRunning` | something is going on under it and it is not paused | |
| `isPaused` | paused, or everything going on under it is | |
| `isLoaded` | it is the cue loaded to a time | |
| `isBroken`, `isWarning` | the show has an error (a warning) against it | |
| `actionElapsed`, `percentActionElapsed` | seconds, and 0 to 1, of its sound or fade (0 when it is not running; a pre-wait does not count) | |
| `children` | its children as cue dictionaries (below) | |
| `valuesForKeys "[\"name\",…]"` | an object of the properties asked for; a name not in this table is left out | |
| `playheadID`, `playbackPositionID` (a list only) | the id of the cue standing by, or `none` (also for a list that is not the one on screen) | |

A boolean is OSC true/false, a number (0 is false) or text (`n`, `f`, `0`… false; `y`, `t`, `1`-`9`… true). Any other method under `/cue/…` or `/cue_id/…` is answered with an error.

### 6.3 Asking about the show

| Address | `data` |
|---|---|
| `/cueLists` | every list: `{ uniqueID, number, name, listName, type, colorName, flagged, armed, cues: [the same, nested] }` |
| `/runningCues`, `/runningOrPausedCues` | those cues, at any depth, in list order, as the same dictionaries |
| `/selectedCues` | the cue standing by, in an array (or `[]`) |
| `/playheadID`, `/playbackPositionID` (no argument) | the id of the cue standing by, or `none` |
| `/version` | `5.0.0`: the QLab dictionary this follows (a remote chooses how to speak by it), not the app's version |
| `/workspaces` | `[{ uniqueID, displayName, port, udpReplyPort, version }]`: one workspace, this show. `uniqueID` is the show's id; `udpReplyPort` is the asker's own port (replies go back to the sender). |

### 6.4 Replies, sessions, updates

**Replies.** Address `/reply<the address as sent>`, one string argument holding JSON `{ workspace_id, address, status, data? }`. `status` is `ok`, `error` (`data` says why: the host's own words where it refused) or `denied` (`data`: which access it needs). A message that asks for something is always answered, and so is one that is refused. A plain command that went well (`/go`, a property written) is answered only after the sender has sent `/alwaysReply 1`, as in QLab. (QLab's manual does not say whether a failed command is answered without `/alwaysReply`; here it is, so that a programmer sees why nothing happened.)

**Where a reply goes.**

| Sender | Reply |
|---|---|
| a TCP connection | on the connection, in the framing it used; any size |
| UDP | to the sender's address at **port 53001** (QLab's fixed reply port, which is where its remotes listen), or the port the sender set with `/udpReplyPort <n>` (0 puts it back; no argument reads it). The module's `replyPort` setting changes the default; `0` means "the port each message came from", for tools that listen on the socket they send from. |

A UDP reply that would be over 9000 bytes (a long `/cueLists`) is replaced by an error saying to ask over TCP. Updates and events (below) go the same way as replies.

**No UDP reflector.** A UDP sender's address can be forged, so a short question sent "from" someone else would make the app send them the answer: 9 KB for a `/cueLists` of a few dozen bytes. So over UDP only a sender that has sent `/connect` (successfully, and within the last 61 s, as below) is answered or sent updates and events; `/connect`, `/version` and `/workspaces` are answered to anyone (short answers). And no address is sent more than 32 KB a second over UDP, whatever it asked; the rest is dropped and logged. A command from a sender that never connects still works (a GO box that sends `/go` needs no answer). A remote built for QLab connects first and is answered on 53001 as before. Over TCP there is a real connection, and everything is answered.

**The monitor.** The module tells the hub a message "did something" only when its result is `ok`.

**Access.** Three permissions, as QLab's: `view` (every read: properties, `/cueLists`, `/showMode` with no argument), `edit` (writing a property, `/new`, `/move`, `/delete`, `/renumber`, `/undo`, `/redo`, `/save`) and `control` (transport, the playhead, `/load`, `/showMode <b>`). The session messages (`/updates`, `/listen`, `/alwaysReply`, `/udpReplyPort`, `/forgetMeNot`, `/thump`, `/disconnect`) need any one of them. The per-method table of QLab's dictionary was not available when this was written: the assignment above is by what each message does.

- `passcodes` is a list; each has its own three permissions. `/connect <passcode>` answers `ok:view|edit|control` (only the ones granted), or `badpass` with status `denied`. A passcode of digits matches whether it is sent as text or as a number.
- `noPasscode` is what a sender that has not connected (or sends `/connect` with nothing) may do: `view` and `control` at most. **It never edits**: changing the show (writing a property, `/new`, `/move`, `/delete`, `/renumber`, `/undo`, `/redo`, `/save`) takes a passcode with edit access, whatever the row says (`edit: true` in a file is read as false, and Settings shows the box greyed). **Default: with no passcode set, view and control; once any passcode exists, nothing**, until the row is ticked. (QLab's default is a random passcode with full access and an empty no-passcode row; ours lets anyone on the network run the show until a passcode is made, because the module is off until it is switched on, and no further: a stranger cannot delete or save.)
- After a wrong try, the next from that address is not listened to for 1 s, then 2, 4… up to 32 (answered `error`); a right one clears it.
- A UDP sender is remembered (its passcode, `/updates`, `/listen`, reply port) for 61 s from its last message of any kind; `/thump` (answered `thump`) is the heartbeat, and `/forgetMeNot 1` (or `/udpKeepAlive 1`) keeps it without one. A TCP connection is remembered until it closes. `/disconnect` forgets either.
- A sender with no permission at all gets `denied` for everything except `/version` and `/workspaces` (over UDP, only once it has connected: see above).
- Settings ▸ Integrations ▸ Modules draws this as a table (`kind: 'osc-access'`): a No passcode row, a row per passcode, Add a passcode (a random four digits with everything ticked). Passcodes are in the show file; the assistant's outline shows only that one is set.

**Updates.** After `/updates 1` a sender is sent, for as long as it stays remembered (61 s of silence, as above):

| Message | When |
|---|---|
| `/update/workspace/<show id>/cue_id/<cue id>` | that cue was edited, or started, stopped, paused, resumed, armed, disarmed or loaded. A group whose children changed order, and a list whose cues did, is sent by its own id. |
| `/update/workspace/<show id>/cueList/<list id>/playbackPosition <cue id>` | the playhead moved (no argument when it stands nowhere) |
| `/update/workspace/<show id>` | cues were added or removed, another list was put on screen, or another show was opened |

They are worked out after each push of the host's state by comparing with what was last sent, so several changes between two pushes arrive as one message per cue.

### 6.5 Show control broadcast (`/listen`)

QLab's own form of "what is the show doing", beside this app's Show feedback module (which sends to a patch, in its own words). The wording is in `core/net/qlab-events.ts`; it is written from QLab 5's manual and has not been compared with QLab on a network.

| Message | Does |
|---|---|
| `/listen` | subscribe the sender to every event |
| `/listen/<event>` | to one event: `go`, `cue/start`, `cue/stop`, `playhead` (and `auditionGo`, which never happens here), `pauseAll`, `resumeAll`, `panicAll`, `stopAll`, `hardStopAll`, `resetAll` |
| `/listen/<event>/<field>` | to one single-argument form of a cue event: `number`, `name`, `uniqueID`, `type` |
| `/ignore`, `/ignore/…` | the reverse, in the same three forms |
| `/eventFormat "<text>"` | this sender's own wording: every single-argument message it listens to is sent as `<text>` instead, with `#data#` (the argument), `#address#` (the event's address) and `#workspace_id#` filled in (`#status#` is empty). With a format, only single-argument messages are sent. No argument reads it; `""` clears it. |

A cue event is sent as `/qlab/event/workspace/<event> <number> <name> <uniqueID> <type>` (four strings; `name` is the name the list shows) and again as four messages `…/<event>/number` etc. of one argument each. The "All" events have no argument.

| Event | When |
|---|---|
| `go` | a GO fired a cue (`engine.lastGo` changed): that cue |
| `cue/start` | a cue began running any other way: a trigger, a Start cue, a preview, a continue from the cue before, a group's child |
| `cue/stop` | a cue is no longer running or paused, however it ended |
| `playhead` | the playhead moved, or another list was put on screen (empty strings when it stands nowhere) |
| `pauseAll`, `resumeAll`, `resetAll` | the host did `pause`, `resume` or `reset` with no cue named, whoever asked (the window, a key, MIDI, OSC) |
| `panicAll`, `hardStopAll`, `stopAll` | `panic` (or `fadeall`); `panic { hard }`; and `stopAll` when the hard stop came from OSC `/stop` |

Cue events are worked out after each push of the host's state, by comparing with the last; the "All" events come from `host.onCmd(fn)`, which tells a module each command once it is done. What was already so when a sender subscribes is not sent. QLab's recipe works as written: `/listen/go/number` then `/eventFormat "/eos/cue/#data#/fire"`.

### 6.6 Trying it against real remotes (tracker O10, O12)

None of the three has been run. Each script below is what to set, what to press and what should happen; where the outcome differs, the monitor (Window ▸ Monitor) shows what the remote actually sent, which is the thing to write down. Use the demo show (File ▸ Open the Demo Show), in Edit mode, OSC control on (Settings ▸ Integrations ▸ Modules), input port 53000, and no copy of QLab running on any computer in the test (it would take port 53000 or answer the remote itself).

**A. Bitfocus Companion (its "Figure 53: QLab" connection).** Companion on the same computer or another on the network.

1. In Endless Cues: OSC control on, no passcode in the table (No passcode row: view and control ticked; edit cannot be). Settings ▸ Integrations ▸ Network shows "listening on UDP and TCP 53000".
2. In Companion: Connections ▸ add *Figure 53: QLab*. Target IP: the show computer (127.0.0.1 if the same). Port 53000. Leave the passcode empty. Switch on its option to use TCP (its feedback needs a connection). Save. (The option and variable names below are as remembered from the module, not checked against its current version: go by what the module's own page lists.)
3. **Expect:** the connection goes green within a few seconds. In the monitor: `/version`, `/workspaces` (or `/connect`), then `/updates 1` and `/cueLists`, each not marked "did nothing". OSC control's status reads "… · 1 connected". If it stays yellow or red: note the last message in the monitor and the reply to it (the monitor does not show replies: `ec-user osc` or Wireshark on port 53000 does).
4. Add a button with the action *GO*. Press it. **Expect:** cue 1 plays; the playhead moves to LQ1.
5. Buttons *Panic*, *Pause*, *Resume*, *Previous*, *Next*, *Reset*: **expect** each to do what its name says.
6. A button *Start (cue)* with cue number `3`. **Expect:** Thunder plays, the playhead does not move.
7. A button that shows the module's next-cue and running-cue variables (their names are in the connection's variable list), or its feedback for a running cue: **expect** the next-cue variable to be the name of the cue standing by, and to change within a second when the playhead moves in the window; the running-cue variable or colour to follow a GO and to clear after Panic.
8. Set a passcode: Add a passcode in the table, untick nothing; put it in Companion's connection. **Expect:** green again, and the buttons work. Put a wrong passcode in: **expect** the connection to fail, and the right one to work again after at most 32 s.
9. Switch the TCP option off in Companion and repeat step 4. **Expect:** GO works (UDP, no feedback).

**B. The Stream Deck plugin for QLab (Elgato Marketplace, by Figure 53).** It cannot send a passcode.

1. OSC control on; in its table the No passcode row has view and control ticked (edit cannot be: without a passcode the plugin cannot edit, so step 6 and 7 are expected to do nothing, "did nothing" in the monitor).
2. In the Stream Deck app, drag *GO* onto a key. In its settings: Address 127.0.0.1 (or the show computer), Port 53000.
3. Press it. **Expect:** GO. Then *Panic*, *Pause All*, *Resume All*, *Reset All*: each as named.
4. *Move playhead* next / previous: **expect** the playhead to move. *Start a cue* with `3`: Thunder plays.
5. *Selected cue ▸ Pause/Resume toggle*, *Preview*, *Panic*: they act on the cue standing by (this app's "selected").
6. *Flag*, *Arm/Disarm*, *Set continue mode*, *Set cue colour* on the selected cue: **expect** the cue in the window to change (these are edits: in Show mode expect nothing, and "did nothing" in the monitor).
7. *New cue* of type Memo: **expect** a Memo after the cue standing by.
8. Untick control in the No passcode row. Press GO. **Expect:** nothing happens and the monitor marks `/go` "did nothing".
9. Anything else the plugin offers (levels, rate, video, overrides, dials for Load to time): press each once and list which are marked "did nothing"; those are addresses this app does not have yet.

**C. QLab Remote (iOS).** Phone or tablet on the same network as the show computer. It finds QLab by Bonjour, which this app does not announce.

1. OSC control on, one passcode in the table with everything ticked.
2. In QLab Remote, look at the list of workspaces. **Expect: this computer is not listed** (no Bonjour). Tap *Other* (manual connection), enter the show computer's address.
3. **Expect, if it connects:** the show's title, then a keypad for the passcode; after it, the cue list, with the cue standing by marked. Whether it connects at all is the open question: QLab Remote talks to QLab 5 over an encrypted connection this app does not offer, and may refuse a plain one. If it refuses, write down what the monitor shows arriving (if anything) and stop here: that is the finding.
4. If the list shows: tap GO (**expect** GO); swipe a cue to move the playhead; open a cue and change its name (**expect** the name to change in the window; Undo takes it back); Pause all / Resume all / Panic all; *Load to time*.
5. Leave it connected for two minutes without touching it, then press GO. **Expect:** it still works (a TCP connection is not forgotten).

**D. Device descriptions (tracker O12).** For each device in `core/net/devices.ts` that is on the bench: make a patch of that kind with the device's address, press Test and expect the patch to read "answering" within a second (for a device listed with `answers`); then make a Network cue for each command in its list with a harmless value, fire it, and tick the command off only when the device visibly did it. A command that does nothing is corrected in `devices.ts` from the monitor and the device's own OSC log.

**Not covered.** `/replyFormat`; `/live` values; the `/shallow` and `/uniqueIDs` forms of the list queries; `/panicInTime` on one cue, `/loadActionAt`, `/loadAndSetPlayhead`, `/soloCueInTime`; targets, levels and every type-specific property; a cart's row and column on `/new`; `/auditionGo`; `/settings/…`, `/overrides/…`, the light dashboard; per-list playheads (`/cue/<list>/playhead/…`); MSC broadcast; Bonjour, and the encrypted connection QLab Remote uses with QLab 5; QLab's "duplicate message interval" (here two identical messages within the double-GO time are one: a GO, or the same cue started the same way, the second ignored and said in the show log); the plain-text command port (53535).

**Status.** `listening on UDP and TCP <port>`, how many remotes are connected over TCP, the count of messages taken and the last address; or the bind error.

## 7. Module: Web remote

`id: 'web-remote'`. Config: `{ enabled, port: 8137, control: true, levels: true, key: '' }`. An HTTP server on `0.0.0.0`.

| Request | Response |
|---|---|
| `GET /?k=<key>` | The page (`remote.html`: one file, no dependencies). |
| `GET /events?k=<key>` | Server-sent events. One `data:` line of JSON at once and again whenever the view changes. |
| `POST /cmd?k=<key>` | Body: a host command as JSON (4 kB limit). Allowed ops: `go`, `panic`, `move`, `jump`, `pause`, `resume`, `playhead`; and, unless `levels` is false, `load { secs }`, `bus { name, db, commit? }` and `master { db, commit? }`, rebuilt from only those fields with `db` rounded to 0.1 and kept between −60 and +12. Returns `{ ok, error }`. Any other op, unparseable JSON, or `control: false`: `403`. |
| anything without the right `k` | `403` with a line of text. |
| anything else | `404`. |

**The key.** `key` from the config, or, if empty, eight random hex characters made each time the module starts (so it changes when the app restarts or the module's config changes; set a key to keep the address stable). The module's status carries the full addresses (`urls`: one per LAN IPv4 address), shown in Settings ▸ Integrations ▸ Modules. Plain HTTP; the key is the only protection.

**The view** sent to a remote: `{ title, list, playhead, control, cues: [{ id, number, name, type, notes, color, live, paused, disarmed }], active: [{ name, elapsed, total, paused }] }`: top-level cues of the current list and the running sounds only.

**The page** shows the standing-by cue's number, name and notes, up to three running sounds with time left, and the list (playhead row marked, live rows marked, disarmed rows struck through). With control: GO, ▲ ▼ (`move`), PANIC (`panic`; twice within 1.5 s stops dead, as everywhere), and a tap on a row sets the playhead. With `control: false` the footer is hidden and every POST is refused: a view for a stage manager. A dot shows whether the event stream is connected; it reconnects every 1.5 s.

**Levels and Load to Time.** With `control` and `levels`, the view carries `mix: { masterDb, buses: [{ id, name, db }], loaded: { id, at } | null, min, max }` (no meters: they would be sent to every phone ten times a second) and the page has a Levels button that opens a fader per bus and the master, and a Load to Time field (`1:30`, `90`, `-10` for ten seconds from the end; Clear sends 0) for the cue standing by. A fader is the window's fader: while it is dragged the level is sent at most ten times a second, and on release it is sent with `commit`, which makes it the bus's level in the show (an unsaved, undoable change), so the window and other remotes show it. Nothing else of the show can be edited from the remote: editing cues from a phone is not built (tracker X7).

**HTTPS: what it would take.** The remote is plain HTTP, and the key in the address is its only protection: anyone on the show network who sees the address (or sniffs it) has the remote. HTTPS would need: (1) a certificate for an address that is a private IP or a `.local` name, which no public authority issues, so the app would make its own certificate authority once per computer (kept in userData, never in the show) and a certificate per address; `node:crypto` can make keys but not sign an X.509 certificate, so this means vendoring a small ASN.1 writer or shipping `openssl` calls, neither of which exists here yet; (2) every phone trusting that authority: installing a profile on iOS and switching on full trust for it by hand, a user-CA install on Android (which Chrome honours and some browsers do not), or else a full-page warning on every visit, which trains people to click through warnings; (3) `https.createServer` in place of `http` (a small change), and the page's EventSource and fetch work unchanged. The honest alternatives are cheaper: keep the show network closed (its own Wi-Fi with a password, no route to the building's), and move the key out of the URL into a cookie set by a one-time pairing code shown in the app, so a shoulder-surfed or logged address is not the credential. Neither is done.

GO from a remote passes through the host's double-GO protection like any other, and a remote's start of one cue (a cart, `/cue/n/start`) is ignored when the same cue was started the same way within that time.

## 8. Module: Lighting desk

`id: 'lighting-desk'`. Config: `{ enabled, kind: 'etc-eos', host: '', port: 8000, listenPort: 8001, list: 1 }`. When the engine fires a Light cue (and light cues are not skipped, and the cue is not marked `follows`), the host calls the module's `onLight(cue)`, which sends one OSC message over UDP to `host:port`.

| `kind` | Fire message | Ping | Hears | Accepts as a cue number |
|---|---|---|---|---|
| `etc-eos` | `/eos/cue/<list>/<n>/fire` | `/eos/ping` every 2 s | Any `/eos/out/…` on `listenPort` counts as the desk answering; `/eos/out/active/cue/<list>/<n>` and `/eos/out/pending/cue/<list>/<n>` for the configured list update `active` / `pending`. | digits, optionally with a decimal part |
| `grandma3` | `/gma3/cmd "Goto Cue <n> Sequence <list>"` (one string argument) | — | — | digits, optionally with a decimal part |
| `generic` | `/cue/<n>/go` | — | — | any non-empty text |

`<n>` is the Light cue's `lightCue`. A value the desk kind does not accept is logged and not sent. Firing by number is idempotent: a board operator pressing GO as well re-runs the same cue.

**Status.** `{ ok, text, active, pending, fired: { number, at }, setup }`. For a kind that can be heard, `ok` requires a message from the desk within the last 5 s and `text` is `desk answering · on cue <active>` or `desk not answering`; otherwise `text` is `sending to <host>:<port>`. No `host` set: `no desk address set`. `setup` is a line of instructions for the desk's own OSC settings, shown in Settings.

Other desks (sound desks, video servers) are reached with Network cues and a network patch, not this module: `engine.send` → the host's `sendNetwork`, one OSC message over UDP to the cue's patch (or the only patch, if there is exactly one).

## 9. The module interface

A module is a plain object exported from a file and listed in `MODULES` at the top of `app/main/host.ts`:

```js
module.exports = {
  id: 'my-module',              // the key under `modules` in the show file
  name: 'My module',            // shown in Settings ▸ Integrations ▸ Modules and on the title-bar chip
  summary: 'One sentence.',
  fields: [                     // drawn as the module's settings form
    { key: 'port', label: 'Port', kind: 'number', help: '…' },
    // kind: 'number' | 'text' | 'bool' | 'enum' (with `options`, optional `labels`); optional `placeholder`
  ],
  create({ log, changed, host }) {
    return {
      start(config) {},         // required: open sockets, begin
      stop() {},                // required: close everything
      status() {},              // required: { ok, text, ...anything } (urls and setup are shown if present)
      onState() {},             // optional: called after every state push
      onLight(cue) {},          // optional: only the module with id 'lighting-desk' is called
    };
  },
};
```

`create` receives `log(line)` (prefixed with the module's id), `changed()` (schedule a state push, so a new `status()` reaches the window) and `host`: `{ cmd, snapshot, onPush(fn) → unsubscribe }`.

**Lifecycle (`reconcileModules`).** Runs after every document change. For each module, the wanted state is `doc.modules[id].enabled`; the running instance is keyed by the JSON of its whole config. If that key is unchanged, nothing happens. Otherwise the old instance is stopped, and if enabled a new one is created and `start(config)` is called with `doc.modules[id]`. So changing any setting restarts the module with the new config; a module never sees a config change while running. Exceptions from `create`, `start`, `stop`, `status` and `onState` are caught and logged; a module that fails to start is simply not running.

**Smoke runs.** In a smoke run (`electron . --smoke`) no module starts, whatever the show says, unless the environment variable `EC_SMOKE_MODULES` is set: the end-to-end check opens no network ports (it also opens no audio device and sends no Network cue datagrams).

**Config.** Lives in the show file under `modules.<id>`, edited with `show.set` (`modules.<id>.<key>`), so it is versioned and undoable. Defaults for the three shipped modules are in `defaultModules()` in `core/show/show.ts`; a new module's config is `{}` until its fields are set.

**What a module may do.** Call `host.cmd` with any op (it is not restricted the way the web remote restricts its clients; restrict what you expose). Read `host.snapshot()`. It has no direct access to the engine, the document or the audio window.

### Writing a module: a worked example

A module that sends a line of text over UDP on every GO (for a device that listens for a string).

There is no "on GO" hook. A module observes the show through `onState` and `host.snapshot()`: `engine.lastGo` is `{ id, at }` for the most recent GO, and changes on each one.

```js
// app/main/modules/udp-on-go.js
const dgram = require('dgram');

module.exports = {
  id: 'udp-on-go',
  name: 'UDP on GO',
  summary: 'Sends a line of text over UDP every time GO fires a cue.',
  fields: [
    { key: 'host', label: 'Send to', kind: 'text', placeholder: '10.0.0.30' },
    { key: 'port', label: 'UDP port', kind: 'number' },
    { key: 'text', label: 'Text', kind: 'text', help: '{number} and {name} are filled in.' },
  ],

  create({ log, changed, host }) {
    let sock = null, cfg = null, lastAt = null, sent = 0, error = '';
    return {
      start(config) {
        cfg = { ...config };
        error = cfg.host ? '' : 'no address set';
        sock = dgram.createSocket('udp4');
        sock.on('error', (e) => { error = e.message; log(error); changed(); });
        sock.unref();
        const go = host.snapshot(false).engine.lastGo;
        lastAt = go ? go.at : null;            // do not fire for a GO made before the module started
      },
      stop() { try { sock && sock.close(); } catch { /* closed */ } sock = null; },
      onState() {
        const s = host.snapshot(false);        // false: skip the document copy
        const go = s.engine.lastGo;
        if (!go || go.at === lastAt || !cfg.host) return;
        lastAt = go.at;
        const row = s.rows.find((r) => r.id === go.id) || {};
        const line = String(cfg.text || 'GO {number}').replace('{number}', row.number || '').replace('{name}', row.name || '');
        sock.send(Buffer.from(line + '\n'), Number(cfg.port) || 9000, cfg.host, (err) => { if (err) { error = err.message; log(`DROPPED: ${error}`); changed(); } });
        sent++;
      },
      status() { return { ok: !error, text: error || `sending to ${cfg.host}:${cfg.port} · ${sent} sent` }; },
    };
  },
};
```

Then:

1. Add `require('./modules/udp-on-go')` to `MODULES` in `app/main/host.ts`.
2. Optionally add defaults to `defaultModules()` in `core/show/show.ts` (`'udp-on-go': { enabled: false, host: '', port: 9000, text: 'GO {number}' }`).
3. Test it the way `test/modules.test.ts` tests the others: call `create` with a fake `host` (`{ cmd, snapshot }`), `start` it on a free port, and assert on what arrives.

Rules the shipped modules follow, worth keeping: bind nothing until `start`; release everything in `stop`; never throw out of a socket callback (set an error, `log`, `changed()`); `unref()` sockets and timers so they do not hold the app open; report a state the operator can act on in `status().text`; do not call `changed()` from `onState` unconditionally (each push calls `onState` again).

## Saving, and the ops added with it

| Op | Arguments | Does |
|---|---|---|
| `save` (alias `save-version`) | `note?` | Writes `show.json` and records a version. `{ needsFolder: true }` for an untitled show. Allowed in Show mode. |
| `revert` | | Discards every pending change (undoable). |
| `unset` | `path` | Puts one setting back to its saved value. |
| `fadeto` | `id`, `t`, `secs?` | Crossfades a playing track to `t` inside itself (default 1.5 s). |
| `prepare` | `id` | Decodes a playing track so `fadeto` is a real crossfade. |
| `launch` | `id` | The Live view's ▶: fires the cue on the launch quantise, taking over the tracks it plays on unless `settings.live.overlap`. Again while it waits: called off. |
| `live-set` | `key: 'overlap' \| 'tempo'`, `value` | A Live setting of the show (`settings.live`). The desk's tempo may be set in Show mode; it re-rates warped sounds that are playing. |
| `tempo-edit` | `id`, `edit: { do: 'set' \| 'nudge' \| 'one' \| 'split' \| 'join', at, … }` | A sound's tempo changed by hand, in the section `at` is in (`editTempo`). |
| `desk-keep` | `id?`, `name?` | The desk as it stands into a new Mix cue after the playhead, or into the Mix cue `id`. |
| `desk-live` | `key`, `value`, `name?` | A control moved as a controller moves it: heard and shown, not written to the show. |
| `mute`, `stop-track`, `stop-clips` | `name` | A track's on/off button toggled; every clip on a track stopped; every sound stopped. |
| `map-set`, `map-learn`, `map-learn-cancel`, `map-in` | `on`, `to` | Give a key or MIDI control to a desk control (`on: null` unmaps); wait for the next MIDI control and give it; a mapped key was pressed. |
| `fade-from-target` | `id` or `number` (a Fade cue) | Writes the level its target is playing at (not playing: the target cue's own) into the Fade cue, and makes it absolute. One edit. Returns `{ db, playing }`. |
| `revert-fade` | `id` or `number` (a Fade cue) | Puts what that cue last faded back as it was (level, voice-band dip, rate) over half a second. `{ reverted: n }`, or an error when there is nothing to put back. |
| `peaks` | `file`, `detail?` | A file's waveform: `{ peaks, rms, pending }`, 1,600 slices, or 8,000 with `detail` (the inspector's zoomable waveform). |

`bus` and `master` with `commit` make a pending edit in either mode. The pushed state's `show` carries `dirty`, `recovered` and `unsaved` (the pending changes, each with the saved value of every changed field).

## The network hub (replaces the per-module sockets described above)

All OSC, in and out, goes through one hub (`core/net/hub.ts`); the host owns it.

- **Patches** (`settings.network.patches`): `{ id, name, host, port, protocol: 'udp' | 'tcp', framing: 'slip' | 'length', device, listenPort?, notes?, iface?, destinations?: [{ host, port, protocol?, framing?, iface? }] }`. UDP patches share one socket; a TCP patch keeps a connection and reconnects every 2 s. `listenPort` is for equipment that answers to a fixed port rather than to the sender.
- **Several destinations.** A message to a patch goes to the patch's own address and to each of `destinations` (which take the patch's protocol, framing and interface unless they have their own). The send is `ok` only if every destination took it; `why` names the one that did not, and the others are still sent.
- **Interface.** `iface` is the name of one of this computer's network interfaces (`en0`), as listed in `network.interfaces` (`[{ name, address }]`); the message leaves from that interface's IPv4 address (a UDP socket bound to it, `localAddress` for TCP). An interface that is not there when the cue fires is a failed send that says so. It is stored by name, so it is a property of the show on this computer: on another computer the name may differ and the patch says "not on this computer now".
- **Text and bytes.** `hub.send(patch, message, { format })`: `'osc'` (default), `'text'` (sent as UTF-8, with `\n \r \t \0 \e \\` and `\xNN` escapes, nothing appended) or `'hex'` (pairs of hex digits; spaces, commas, colons and `0x` ignored). On TCP an OSC message is framed; text and bytes are written as they are. A Network cue's `format` field chooses (`core/net/raw.ts`).
- **Status** per patch: `idle`, `sent`, `connecting`, `connected`, `answering` (heard from within 6 s) or `error` with the reason. Pushed as `network.patches`.
- **One input port** (`settings.network.inputPort`, default 53000), over UDP and, on the same number, TCP. It opens when something needs it: the OSC control module, any cue with an `oscTrigger`, a show command set in `settings.network.commands`, `settings.network.listen`, or a Learn in progress. A TCP remote frames its messages with SLIP (OSC 1.1) or a 4-byte length (OSC 1.0); which is read off the connection's first byte (a length starts with 0). If the TCP port cannot be bound and the UDP one can, UDP goes on working and the status says so (`network.input.tcpError`).
- **Listeners** get `fn(msg, from, reply)`: `from` is `{ address, port, tcp? }`; `reply(address, args, { port }?)` answers on the connection, or over UDP to the sender's port or to `port`. `hub.onGone(fn)` is told when a TCP remote hangs up. A listener returns `true` when it acted on the message: an input message no listener acted on is marked `unused` on its monitor entry ("did nothing" in the monitor).
- **Learn.** The next message to arrive resolves `osc-learn` and is **not** passed to the listeners: capturing a desk's GO button does not GO the show.
- **The monitor**: the last 400 messages, both directions, with time, who, text and (for a failure) why.
- **Devices** (`core/net/devices.ts`): a table of equipment with its usual port and a list of commands; a patch names its device and Network cues aimed at it offer the commands. Written from published OSC documentation and not yet checked against hardware.

- **A device of the show's rig is also a patch to the hub** ([15](15-assistant-and-rig.md)): the host gives the hub `devices` beside `patches` (`hub.configure({ patches, devices, … })`), and anything that sends to a patch id may name a device id, so a raw Network cue's `patch` may be a device. One thing differs on purpose: a cue with no patch chosen goes to "the only patch" counting **patches only**, so adding a device never re-aims an old cue. For a device the hub also: sends its "are you there?" quietly (`send(…, { quiet, ask })`: not in the monitor, and not "the last thing sent to it"); keeps its answers, or its heartbeat, out of the monitor, the first after a silence excepted, while still counting them; and credits what arrives on the input port from a device's address to that device (a patch is still not credited there). A heartbeat is not passed to the listeners: a device saying it is there is not a command, a trigger or a message to learn. `hub.onHeard(fn)` is told of everything that arrives (`fn(msg, from, patch | null, { via, alive, at })`), which is how `core/rig/liveness.ts` keeps count; every incoming monitor entry carries `from: { address, port }`; `hub.sendTo({ host, port }, text)` sends one message to an address that is in no show (the assistant asking a model's test message of a private address); and in a test run, where nothing is sent or heard, `hub.pretendHeard(id, text)` stands in for an answer.
- **`resend`** is the host's (`app/main/rig-service.ts`, which `sendNetwork` calls): a command going to a device with `resend` > 0 gets one more argument, `#<6 hex digits>`, and is sent that many times 40 ms apart; the repeats are not written in the monitor, and a faded value is never sent again.

**The Rig's commands** (through `host.cmd`; the page and its readiness rows are [15](15-assistant-and-rig.md), sections 3.7 and 5):

| Op | Arguments | Does | Show mode |
|---|---|---|---|
| `device-try` | `device`, `command`, `args?` | Composes that command and sends it once (with the device's `resend`). `{ sent, held, message }`; held back, `held: true` and `text` says so; a value the command cannot take is `{ error }`. | Refused, except the device's own `test` command while no cue is running. |
| `device-ask` | `device` | One "are you there?" now. Resolves `{ ok, held, answered, ms, text, why }` within 1.5 s. | Allowed. |
| `rig-check` | | Asks every device that can be asked, reads the folder and the script again, stamps the summary's time. Resolves `{ summary }`. | Allowed. |
| `rig-scan` | | Look for props: resolves `{ found: [{ name, kind, fw, host, port, state, known, moved }] }`, also pushed as `rig.found`. | Refused; also refused in Edit while a cue runs. |
| `rig-tick` | `id`, `on?` | A tick on one of the operator's own lines. This sitting's: kept by the host, never in the show. | Allowed. |
| `rig-ticks-clear` | | *Start again*. | Allowed. |
| `prop-files` | `device`, `options` | Stages a files-only proposal from `core/kit/kit.ts`. `{ proposal, files }`. | Refused (an edit). |
| `agent-guide` | | Stages a files-only proposal from `core/assistant/guide.ts`. `{ proposal, files }`. | Refused (an edit). |

Pushed with every state as `rig`: `{ summary: { ready, total, look, problems, unknown, at, text }, items, devices: { id: { state, text, heardAt, ageMs, reports, lastOut, lastIn } }, ticks, found, scanning, senders, script: { file, found, lines, marks, missing }, folder: { sounds, videos, texts, unused } }`. Each of `items` is `{ id, group, groupLabel, label, state, text, fix, needed, actions }`; `group` is one of `show`, `sound`, `picture`, `lights`, `equipment`, `connections`, `held`, `before`; an action is `{ id, label, cmd? }`, and where it has a `cmd` that is the host command that does it (`save`, `device-ask`, `device-try`, `override`, `stage-open`, `stage-pattern`, `rig-tick`, or the `edit` that makes a patch a device). A pending proposal's `files` are pushed as `[{ path, lines, replaces, text }]`.

| Op | Arguments | Does |
|---|---|---|
| `net-test` | `patch`, `text?` | Sends the patch's device's "are you there?" (or `text`). |
| `net-send` | `patch`, `text` | Sends one message by hand. |
| `net-monitor` | `since?` | Monitor entries after `since`. |
| `net-clear` | | Empties the monitor. |
| `osc-learn` | `ms?` | Resolves with the next message to arrive on the input port. |

**Cue triggers.** Any cue's `oscTrigger` is an address (OSC patterns allowed), optionally followed by arguments that must match; a matching message fires the cue without moving the playhead.

**Triggers, as one table.** `core/show/triggers.ts` lists every trigger in a show (`triggersOf(doc)`: hotkey, OSC, MIDI, clock, timecode, and the MIDI messages set to run the show) with what each shares with another; the state pushed to the window carries it as `triggers`. A cue's trigger fields are marked `tab: 'triggers'` in the cue-type table, which is what puts them on the inspector's Triggers tab.

**Show commands from any message** (`settings.network.commands`: `{ go, panic, pause, resume, next, previous }`, each `''` or an OSC message written as a trigger is; `core/net/commands.ts`). It mirrors `settings.midi.commands` key for key. A matching message does `go`, `panic`, `pause`, `resume`, `move { step: 1 }` or `move { step: -1 }` through `host.cmd` (so GO has its double-GO protection). The host listens for these itself: they work with OSC control off and need no passcode, as QLab 5's do. Settings ▸ Integrations ▸ Network ▸ Incoming OSC has a field and a Capture button (an `osc-learn`) for each. QLab's own list of assignable commands is a screenshot in its manual and could not be read; this is the list MIDI has.

**A Network cue over time** (`core/net/network-cue.ts`; the engine asks it what to send at each tick).

| The cue has | It sends |
|---|---|
| no `duration` | one message (for `#v#`, the `fadeTo` value; for a path, its last point) |
| a `duration`, no token | the same message `fps` times a second for that long (QLab's "Resend") |
| `#v#` | a value from `fadeFrom` to `fadeTo` along `curve`: `linear`, `s-curve`, `ease-in`, `ease-out` |
| `#x#`, `#y#` | a point moving at an even speed along `path` (`"0,0 1,0 1,1"`); with `pathLoop`, round again (from the start) until the cue is stopped |

`fps` is 1 to 120 (default 30). A value is a float on the wire (at most six places; `1.0` for a whole one) unless `whole` is set, when it is rounded and sent as an integer. Tokens may be in the address. With a duration it is a fade to the engine: shown in Active Cues, paused and stopped like one. `format: 'text' | 'hex'` cues are sent once whatever their duration (a warning says so), and no token in them is filled in. Not done: a curve drawn by hand, a path drawn on a canvas, "smooth" paths, a background image, live preview while editing, OSC queries (`#/cue/1/number#`) inside a message, and device descriptions with faded parameters.

**OSC control** no longer owns a socket: it handles messages from the hub's input port. **Show feedback** (module `show-feedback`) sends `<prefix>/go`, `/cue/<number>/start|stop`, `/playhead` and `/running` to a patch.

## Timecode and MIDI files

**The engine owns the time, the host plays to it.** A `timecode` or `midifile` cue fires the engine's `run` hook (`run(cue, offset)` answers with the cue's length in seconds, 0 for "until stopped"). The engine files the cue with its fades, marked `run`, so it is in Active Cues, pauses, resumes, stops, is followed by an auto-follow, and can be loaded to a time. `core/timecode/transport.ts` (the host's part, with the clock and the ports handed in, so it is tested on a fake clock) looks at that entry every 20 ms and plays to match: it never keeps a position of its own.

**MIDI that must leave on time is stamped, not timed.** A timer in either process wakes late: measured on one Mac (`test/manual/timer-jitter.ts`, a 10 ms timer aimed at fixed times, ten seconds), about 1.3 ms late on average, 2.5 to 5 ms at the 99th percentile and up to 6 ms at worst, in the main process and in the hidden window alike. An MTC quarter frame is 8.3 ms long at 30 frames a second, so sending "when the timer fires" would move each message by a large part of its own period. Instead `core/net/playout.ts` hands over everything due in the next 100 ms, each message with the time it is due on the engine's clock; the host turns that into milliseconds since 1970 (`performance.timeOrigin + performance.now()`, which the two processes agree on to within about 0.3 ms, measured, the message's own travel included) and the audio window passes it to Web MIDI as the send timestamp. What decides the moment on the wire is then the computer's MIDI system: on macOS Chromium hands the timestamp to CoreMIDI; on Windows and Linux how exactly a stamped message is sent has not been examined. **None of this has been measured at a MIDI port.** The cost: a stop or a pause takes up to 120 ms to reach the wire (the lookahead and a tick), and a message cannot be recalled once handed over.

**MTC** (`core/timecode/timecode.ts`): a full-frame message (`F0 7F 7F 01 01 hr mn sc fr F7`, the rate in bits 5–6 of the hours) where a stream starts or resumes, then quarter frames (`F1 0nnn dddd`), four to the frame, each run of eight naming the frame its first piece began on. Rates: 24, 25, 29.97 drop, 30. Incoming: a full frame is the time outright and starts nothing (a parked transport sends one); eight quarter frames in order are a time, known a frame and three quarters after it.

**LTC** is made and read in the audio window by AudioWorklets running that same file (its own text is pasted into the worklet, so the code the tests check is the code that runs). Out: 80 bits a frame, biphase mark, written to the sample on one device output of the cue's choosing, connected after the limiter. It runs on the audio device's clock, not the computer's: over an hour the two drift apart by whatever the device's crystal is off by, and LTC and MTC started together will show it. In: an input and a channel (Settings ▸ Integrations ▸ Network ▸ Timecode); each frame is reported with the time its last bit ended. The test run opens no input and listens to its own LTC output instead, which is how the smoke test checks the path end to end.

**Chase** (`core/timecode/chase.ts`, `settings.timecode`): `source` (`off` / `mtc` / `ltc`), `rate` (what triggers are written at), `input`, `channel`, `catchUp`, `follow`. While the time runs on, a cue starts as its `timecodeTrigger` is passed. When the time appears or jumps (more than a quarter of a second from where it should be), nothing skipped is fired; a cue within three frames behind starts from its top, and with `catchUp` a cue that would be part way through starts that far in (`engine.fire(id, offset)`: sounds, groups of them, Timecode and MIDI File cues honour the offset; a Wait or a Fade starts from its top). A quarter of a second without a frame is "stopped". Not done: stopping or pausing cues when the timecode stops, a freewheel setting, chase per list, and capturing a trigger from the incoming time.

**MIDI files** (`core/net/smf.ts`): formats 0, 1 and 2 (2 played as 1), tempo changes, files timed in frames, running status, SysEx. Stopped or paused, the notes it started are ended; started or resumed part way in, the programs, controllers and bends the file had set by then are sent first.

## More windows, carts and overrides

- **Views.** `host.addView(webContents)` is all a window is to the host. `main.ts` `openOwnWindow` opens the same page with `?list=<id>` (one list or cart) or `?inspector=1`, adds it as a view, and removes it when it closes. Selection is each window's own; the main window tells the others what is selected over `ec-relay` (preload `relay` / `onRelay`), which is all an inspector in its own window needs. Menu actions still go to the main window.
- **Carts.** Pushed state carries `carts: { <list id>: { rows, columns, cells: [cue id | null], extra } }` with every full push. A button is `{ op: 'start', id }`. `{ op: 'import', paths, list, cell }` adds sounds to a cart (the first on that button).
- **Overrides.** `{ op: 'override', what: 'osc' | 'midi' | 'timecode' | 'dmx', on? }` holds an output back or lets it go (`on` left out: the other way). Held, `hub.send` and `sendMidi` record the message in the monitor with `ok: false, held: true` and the reason, and send nothing; a Light cue is called and not sent to the desk. The state is this computer's (`config.json` `overrides`), survives a restart, and is in every push as `overrides: [{ id, label, on }]`: the window shows a red chip per held output. The table of outputs is `OVERRIDES` in `host.ts`. **MIDI out** holds everything on its way to the MIDI port (MIDI cues, a MIDI file's messages, MTC); **Timecode out** holds MTC alone and stops LTC (which starts again, where it would have got to, when it is let go); **DMX out** makes every Art-Net and sACN packet and sends none (`core/light/output.ts` `hold`), so the dashboard still shows the levels.
- **Keeping.** `backups`, `backup-now`, `restore-backup { name }`; `playlog { last }`; `settings-import { file }`. The file dialogs for templates, settings files and the playback log are `ec-app` ops (`template-save`, `template-new`, `settings-export`, `settings-import`, `playlog-export`), each taking a `path` so a test run needs no dialog.

## Module: Main and backup

`app/main/modules/backup-link.ts`, with the mapping in `core/net/mirror.ts`. A module may now have `onCommand(c, result, before, after)`: the host calls it after each command it has carried out, with the playhead before and after.

On the **main** (role `main`), each transport command becomes OSC control messages to a patch that is the backup:

| Host command | Sent to the backup |
|---|---|
| `go` (not one double-GO protection ignored) | `/playheadID/<the cue fired>`, `/go`, `/playheadID/<where the playhead now is>` |
| `start`, `fire` / `launch`, `stop` (`fade`), `pause`, `resume`, `toggle` with a cue | `/cue_id/<id>/start`, `/preview`, `/stop` (`/panic`), `/pause`, `/resume`, `/togglePause` |
| `pause`, `resume` (all), `panic` (`hard`), `fadeall`, `reset` | `/pause`, `/resume`, `/panic` (`/hardStop`), `/panicInTime <s>`, `/reset` |
| `load` | `/cue_id/<playhead>/loadAt <s>` |
| `playhead`, `move`, `jump`, `list` | `/playheadID/<id>` |

plus `/connect <passcode>` at the start and every half minute, and `/thump` every second. On the **backup** (role `backup`) the OSC control module does the obeying; this module only notes that the main is being heard and raises a notice when it has been quiet for 3.5 s.

**What taking over needs that is not here.** These are named so nobody mistakes the following for a failover system:

1. **A decision, and a hand.** Nothing switches by itself. The backup's operator lets its outputs go (overrides off) and brings its sound up. An automatic switch needs a rule for a split network (both alive, neither hearing the other) that does not put two computers on the desk at once.
2. **One sound output.** The two computers' audio must meet in a switch or a mixer; the app does not mute or unmute itself as it changes role. A `role` that drives the master and the overrides together is the next step.
3. **The same show, kept the same.** Edits are not mirrored and media is not synced: the backup has what was last copied to it. Mirroring edits means sending the operations (`core/show/ops.ts` batches are already the wire format) and comparing `show.hash` in the heartbeat; the heartbeat does not carry the hash yet, so a backup on an older show is not detected.
4. **State that is not a command.** A backup started mid-show does not learn what is already playing (there is no "catch up" message; `/runningCues` could seed one). Triggers that fire cues inside the main (OSC, MIDI, clock) are not commands and are not mirrored. The mixer, a seek, a loop held by hand and Show mode are not mirrored.
5. **Clocks.** Each engine runs its own waits and follows from the moment it hears the command. Network delay (a millisecond on a wire) is the offset between them; nothing measures or corrects it, and a mirrored GO that arrives early by more than the slack in double-GO protection would be dropped by the backup (the next GO re-aims the playhead, so it is one cue behind, not adrift). An exemption for mirrored commands needs an authenticated sender.
6. **Proof.** Tested with two engines in one process (`test/backup-link.test.ts`), including a lost message. Never run on two computers.
