# 03 · The show file

Source: `core/show/` (`show.ts`, `cue-types.ts`, `ops.ts`, `diff.ts`, `versions.ts`, `document.ts`), tested by `test/show.test.ts`.

## On disk

```
MyShow.ecshow/
  show.json          the whole show (this document)
  media/             its sound files
  versions/
    index.json       [{ id, at, note, author, hash, cues }], oldest first
    <hash>.json      a whole show.json as it was
  backups/           timed copies of the working document: "2026-03-14 19.05.09.json" (core/show/backups.ts)
  logs/playback.csv  what played, when, for how long (core/engine/playlog.ts)
  logs/<date time>.log, .csv   the show log, one sitting each: GOs, cues, triggers, problems (core/log/show-log.ts)
  recordings/        the show's sound, when ● Rec is on
```

A show is a folder so that media travels with it and so that git, Dropbox and a USB stick all work without an export step. On a Mac the app declares it a package (`com.endlesscues.show`, [10](10-cross-platform.md) item 5): Finder shows it as one file with the show's icon and opens it with the app; Show Package Contents opens it as the folder it is. `show.json` is written with two-space indentation and a fixed key order (`show.stringify`), so two versions differ only on the lines that changed. It is rewritten only when the show is saved, atomically (temp file, then rename). While there are unsaved changes a journal, `show.unsaved.json`, sits beside it: the working document, written on every edit and removed on save or revert, so a crash loses nothing.

A cue's `file` is relative to the show folder (`media/rain.wav`). Sounds dropped on the list are copied into `media/` unless they are already inside the folder. An absolute path is allowed and is how an untitled show refers to files before it has a folder; saving it collects them.

## The document

```jsonc
{
  "format": "endless-cues-show",
  "version": 1,
  "id": "show_1a2b3c4d",
  "title": "Demo show",
  "notes": "",
  "settings": {
    "go":      { "doubleGoProtection": 0.3, "panicFade": 1 },
    "editing": { "autoNumber": true, "numberStep": 1,     // a new cue takes the next number, counting by the step
                 "lockPlayhead": true },                  // selecting a cue stands by on it; false: the two go their own ways
    "templates": { "fade": { "duration": 5, "stopTarget": true } },   // what a new cue of a type starts with (core/show/templates.ts)
    "audio":   { "masterDb": 0, "limiter": true,
                 "levels": { "min": -60, "max": 12 }, "monitor": { "on": false, "out": 3, "db": -12 },
                 "buses": [ { "id": "music", "name": "Music", "db": 0, "kind": "music" }, … ] },     // a kind is a label; 05 · Audio
    "network": { "patches": [ { "id": "desk", "name": "Lighting desk", "host": "10.0.0.20", "port": 8000 } ] },
    "light":   { "on": false, "rate": 40, "panicBlackout": false,
                 "universes": [], "instruments": [], "groups": [], "fixtures": [] },     // 14 · Lighting
    "timecode": { "source": "off", "rate": "30", "input": "", "channel": 1, "catchUp": true, "follow": true }
  },
  "modules": {
    "osc-control":   { "enabled": false, "replyPort": 53001, "passcodes": [ { "code": "4821", "view": true, "edit": false, "control": true } ], "noPasscode": { "view": true, "edit": false, "control": false } },   // a sender with no passcode never edits
    "lighting-desk": { "enabled": false, "kind": "etc-eos", "host": "", "port": 8000, "listenPort": 8001, "list": 1 },
    "web-remote":    { "enabled": false, "port": 8137, "control": true, "key": "" }
  },
  "lists": [
    { "id": "list_…", "name": "Main", "cues": [ /* cues */ ] }
  ]
}
```

Where sound goes is in the show only when the show uses it ([05 · Audio](05-audio.md), "Where sound goes"). On a bus: `out` (the first of its pair of outputs), `reverb` and `delay` (sends, dB). In `settings.audio`: `outs` (`{ "3": { "name": "Click", "trim": -6 } }`), `auditionOut` (the first of the pair V plays to) and `fx` (`{ reverb: { secs, db, out }, delay: { secs, feedback, db, out } }`). On an Audio or Mic cue: `outputs` (a row per channel of the sound, each `{ "<output>": dB }`) and `eq` (`{ low, mid, high }` in dB).

A cue:

```jsonc
{
  "type": "group",              // one of the types in core/show/cue-types.ts
  "number": "3",                // what the operator calls it: any text, may be empty, need not be unique (a warning if not)
  "name": "Thunder",            // empty: a default is shown ("fade Rain", the file's name)
  "id": "c_9f8e7d6c",           // stable for the cue's life; targets refer to this, never to the number
  "notes": "On “…and the sky answered.”",
  "color": "orange", "flagged": false, "armed": true,   // twenty colours (COLORS in cue-types.ts)
  "color2": "grey",             // optional: the colour it shows once it has fired, until Reset
  "preWait": 0, "postWait": 0, "continue": "none",      // none | auto-continue | auto-follow
  /* …the type's own fields… */
  "children": [ /* cues; groups only */ ]
}
```

Times are seconds. Levels are dB (0 is the file's own level; −60 is silence). The fields each type has, with their kinds, defaults and help text, are one table: `core/show/cue-types.ts`. Validation, the inspector, the assistant's reference and [04 · The cue engine](04-cue-engine.md) all read it.

**Sections.** A heading in a list is an ordinary entry, `{ "id", "type": "section", "name", "color", "notes" }` and nothing else (no number, waits, continue or triggers). It holds the top-level cues after it up to the next section; it never holds them in `children`, so the file stays flat and a show without sections is unchanged. A section is only ever a top-level entry of a list that is not a cart: an edit that would put one inside a group or in a cart is refused (`core/show/sections.ts` `trouble`), and renumbering passes over it. It never plays: `toEngineDoc` leaves it out (04, section 2). Which sections are folded is not in the file.

**Ids and numbers.** A cue's `id` never changes; its `number` is a label. Targets (`"target": "c_…"`) use ids, so renumbering can never break a fade. People and the assistant name cues by number; operations accept `"#3"` and resolve it.

### Reading a file is forgiving, writing one is strict

`show.normalise(input)` never throws on a file a person could have hand-edited: missing settings get defaults, a cue of an unknown type is kept as a Memo (with a note of what it was), a field that does not parse is dropped, duplicate ids are re-issued. Each of these is a warning shown when the show opens. It does throw for a file that is not a show at all, and for one saved by a newer major format (`version` greater than this app's), with a message that says to update.

`show.problems(doc)` lists what would not work in a performance: a required field empty, a target that is gone or is the wrong type, a network patch that no longer exists, an OSC message with no leading `/`, a number used twice. Errors make the cue `broken` for the engine (it is skipped and marked); warnings are shown and nothing else.

### Versioning the format

`version` is an integer. A change that an older app would misread bumps it and adds a migration to `normalise`. A new optional field, cue type or module does not: older apps keep unknown cues as Memos and ignore unknown settings (they are preserved on disk only if untouched; this needs hardening before 1.0: unknown fields should round-trip).

## Edit operations

`applyOps(doc, ops)` in `core/show/ops.ts` is the only way a show changes. It is pure (the input is never touched), atomic (any invalid operation fails the whole batch with an `OpError` naming which one and why), and its result is normalised, so it is always a show the app can open.

| Operation | |
|---|---|
| `{ op: "cue.add", cue: {type, …fields, children?}, ref?, after? \| before? \| parent? \| list? }` | Add a cue (and, for a group, its children). `ref` names it for later operations in the same batch. |
| `{ op: "cue.set", id, props: { field: value \| null } }` | Set fields; `null` clears one. Values are coerced by the field's kind (`"1:30"` → 90 s, `"-inf"` → −60 dB). |
| `{ op: "cue.remove", id }` | |
| `{ op: "cue.move", ids, after? \| before? \| parent? \| list? }` | Reorder, move into a group or to another list. A group cannot go into itself. |
| `{ op: "cue.duplicate", id, ref? }` | New ids throughout; a target inside the copy follows the copy. |
| `{ op: "cue.renumber", ids, start, step?, prefix?, suffix? }` | numbers other cues have are passed over |
| `{ op: "cue.unnumber", ids }` | |
| `{ op: "list.add", name, cart? }` · `list.rename` · `list.remove` | A show keeps at least one list. `cart: { rows, columns }` makes the new list a cue cart. |
| `{ op: "list.cart", id, rows, columns }` | A list becomes a cart of that size, or a cart is resized (1 to 15 each way). `rows: null`: a plain list again. |
| `{ op: "show.set", path, value }` | `title`, `notes`, `settings.…`, `modules.…` only. |
| `{ op: "device.add", device: { name, …fields } }` | Adds a piece of equipment ([15](15-assistant-and-rig.md), `core/rig/devices.ts`). `id` is made from the name if left out; with `model` and no commands, the model's commands, port and way of being asked are copied in. Refused with a sentence if the device is not one that can be kept. |
| `{ op: "device.set", id, props: { field: value \| null } }` | Sets fields; `null` clears. `commands`, `reports` and `alive` are set whole. `id` cannot be set. |
| `{ op: "device.remove", id }` | Cues that named it become broken, and are reported as cues that lose a target are. |

A cue is named by its id, by `"#<number>"`, or by `"@<ref>"` for one added earlier in the batch. That last form is what lets one batch build a sequence whose cues target each other:

```json
[ { "op": "cue.add", "ref": "rain", "cue": { "type": "audio", "number": "4", "file": "media/rain.wav" } },
  { "op": "cue.add", "cue": { "type": "fade", "number": "5", "target": "@rain", "db": -60, "duration": 6, "stopTarget": true } } ]
```

**Checked before it is applied.** An operation may carry only the keys it takes (`OP_KEYS` in `ops.ts`: a `to` on a `cue.move`, or a field beside `props` instead of in it, is refused, not ignored), a move must say where to, `cue.set` needs `props`, `show.set` needs `value`. In a `show.set` path a bus or a patch may be named by its id (`settings.audio.buses.music.db`). And the batch as a whole may not leave a setting as something it cannot be: a number where text belongs, a patch with no port, two buses with one id (`settingsTrouble`; what was already wrong before the batch is not held against it). These checks are in `applyOps` itself, so the inspector, `ec apply` and the assistant are all held to them and are all told the same sentence.

Why operations rather than "send the new document": a batch is small enough to read, it says what was meant, it fails with a reason a person (or a model) can act on, and the same batch can be previewed, applied, undone and recorded.

**The rig** (`settings.rig`: `{ devices: [], checks: [], script: '' }`). The show's equipment lives in the show file, so undo, versions, compare and the review of a proposal cover it. A device is its address, its named commands (messages with `{holes}` for typed parameters), how to tell it is there (`alive`) and what to read out of what it says (`reports`); the fields are one table in `core/rig/devices.ts` (`FIELDS`, `COMMAND_FIELDS`, `PARAM_FIELDS`, `ALIVE_FIELDS`, `REPORT_FIELDS`), read by validation, the device editor and the assistant's reference. Devices change only through the three operations above: `show.set` on `settings.rig.devices` is refused with a sentence naming them. `settings.rig.checks` (the operator's own lines, `[{ id, text }]`, set whole) and `settings.rig.script` (a text file in the show folder) are ordinary settings. A device and a network patch may not share an id, which is checked on the batch as a whole, so a patch is made a device in one edit: `device.add` with the patch's id and a `show.set` that removes the patch, in either order; every cue that named the patch then names the device. **A rig with nothing in it is not written to `show.json`**: a show with no equipment is, on disk, exactly what it was before there was a rig, and no format version was bumped.

**A Device cue** (`type: "device"`: `device`, `command`, `args`, and for a command with a value that fades `fadeTo`, `duration`, `curve`) sends one of a device's named commands. The engine has no such type: `show.toEngineDoc` resolves it into the Network cue (to the device's id, which the hub finds as it finds a patch) or the MIDI cue it makes, and one that cannot be sent (its device or command gone, a value out of range, no address) is marked broken and plays as a Memo, so nothing half-made reaches the equipment.

## Diff

Devices are reported as an operator reads them and not as a settings path: `device-added` and `device-removed` (`{ kind, id, label, text }`, `text` being the line a review shows: "prop · 10.0.0.42:53100 · 7 commands · asked every 2 s"), and `device-changed` (`{ kind, id, label, fields: [{ field, label, from, to }] }`; a changed command list is one field, "7 → 8 (added Strobe)"). `summary()` counts them as `devices`.

`diffShows(a, b)` matches cues by id and reports, in an operator's terms: cues **added**, **removed**, **changed** (field by field, values formatted: `Level 0 dB → −8 dB`), **moved** (into a group, to another list, or reordered: only the cues that are out of place, by longest common subsequence), lists added / renamed / removed, and settings by path. `describe(changes)` makes one line of it, which is the note a version gets when you do not write one: `3: level −8 dB · Curtain call added`.

## Saving

Nothing is kept until the show is saved. An edit changes the working document: it is heard and seen at once and can be undone, but `show.json` is untouched. This is deliberate. The app this grew from saved every move as it was made, and a knob brushed by accident during a run became the show.

- `document.unsaved()` is the diff from the saved document to the working one: the list of pending changes. The app counts them ("3 unsaved"), marks each changed control in yellow with its saved value in the tooltip, and offers ↺ beside it to put that one control back (a `cue.set` to the saved value, or the host's `unset` for a setting).
- `document.save({ note })` writes `show.json` and records a version. With no note, one is written from the pending changes.
- `document.revert()` discards everything pending. It is an edit, so it can be undone.
- What the show does while it runs is not a change: a Mix cue moving the faders, a Reset, a GO. Only a person's edits are pending.
- Quitting with unsaved changes asks: Save, Don't Save, or Cancel.
- The journal (`show.unsaved.json`) means "not saved" never means "lost": a show that is reopened after a crash comes back with its unsaved changes, still unsaved, and says so.

## A show from another computer

A show is a folder that is meant to travel, so a show can arrive from anywhere: a download, a USB stick, a shared folder, a clone. A show that was not made, saved or turned on on this computer opens with its **network features off**: no module starts (OSC control, the web remote, the lighting desk, show feedback, the backup link), no port is opened, no TCP connection is made, nothing is sent (a Network or Device cue's GO is written in the monitor as held back, as with Tools ▸ Hold Back), DMX does not go out, no device is asked whether it is there and no props are looked for, and no cue is started by a clock, OSC, MIDI (or a MIDI show command or MSC) or timecode. A sound named by another computer's path (`\\host\share\…`, `//host/share/…`) is not opened, and the cue says why: "its file is on another computer". Everything else plays as it always does: GO, Space and Esc, the sound, the stage.

One quiet line in the title bar says so: *This show came from another computer. Its network features are off until you turn them on.* and **Turn on**, which gives it all back at once, without stopping anything that is playing, and is remembered for that show on this computer. Only this computer's window can turn it on (`turn-on`; a command that came in from anywhere else is refused).

Nothing about this is in the show file, which stays the same whichever computer saved it. This computer keeps a record in its own `config.json` (`shows`: each show folder, by its real path, with the id of the show in it, the last 400): a show is this computer's when its folder is there with its id. A show is put in the record when it is made here (a new folder, New Show, an import or a template once saved, Start from a Folder), saved here, saved somewhere else with Save As, or turned on. A save does not turn on a show that came from elsewhere. The demo, which lives in this computer's settings folder, is its own. So a show moved or copied to another folder asks once more, and a show put in place of one of yours (another id) is not taken for yours. The first time the record is made, the recent shows (File ▸ Open Recent) are taken as this computer's, so an update holds back nothing that already worked here. A show written by the `ec` command line is not in the record and asks once. `core/show/trust.ts`, tested by `test/trust.test.ts`.

## Versions

A **version** is what a save records: a checkpoint you can name, compare with and return to.

- `save(showDir, doc, { note, author })` writes the document to `versions/<hash>.json` (the hash of its text, so the same show saved twice is one file) and appends to `index.json`. Saving when nothing changed since the newest version returns that version, marked `same`.
- Whole snapshots, not deltas. A show file is tens of kilobytes; a thousand versions is a few megabytes; any one of them can be opened in a text editor or diffed with git.
- **Restore is an edit.** It replaces the working document and pushes the old one onto the undo stack; like any edit it is pending until saved. History is never rewritten: restoring `v3` then saving makes `v9`, and `v4`–`v8` are still there.
- `author` is `you` or `assistant`; the app shows which.

This is local-first on purpose ([ADR 0002](../adr/0002-versions-as-files.md)): it works offline and on any OS, and a hosted history can be added by uploading the same blobs.

## Proposals

A proposal is a batch of operations that has been applied to a *copy* of the show and turned into a diff, waiting for a person.

```
document.propose(ops, { summary, author })   → { id, summary, changes, counts, … }   nothing has changed
document.accept(id)                          → the edit lands (one undo step)
document.reject(id)
```

`accept` refuses if the show has changed since the proposal was made (its base hash no longer matches): a stale diff is not what the person reviewed. An accepted proposal is an ordinary pending edit: undoable, marked like any other change, and kept only when the show is saved; the version that save records is authored `assistant`.

**Files.** `propose(ops, { summary, author, files })` and `proposeDocument(draft, { …, files })` may carry text files for the show folder, `[{ path, text }]`, written when the proposal is accepted (each atomically); a proposal may be files alone. `core/show/files.ts` decides what may be written, and nothing else does: `AGENTS.md` and `CLAUDE.md` at the top of the show folder and anything under `props/`; text, at most 200 KB each and 24 in a proposal; never a path that leaves the folder, by `..`, by an absolute path or through a link. Each is marked `replaces` when a different file is already there, and an existing `secrets.h` is never replaced. An untitled show has no folder, and the proposal is refused before it is staged ("Save the show to a folder first: this writes files into it."). If a file cannot be written when the proposal is accepted, nothing has changed and the proposal is still waiting. Undo takes back the change to the show and leaves the files.

Only one proposal is pending at a time. This is the whole mechanism behind the assistant ([08](08-assistant.md)); nothing about it is specific to AI, and the same path will carry "import these cues from a QLab workspace" and "apply this change a collaborator sent".

## Carts

A cue cart is a list with `"cart": { "rows": 3, "columns": 4 }` on it (each 1 to 15), drawn as a grid of buttons. A cue in it may say which button it is with `"cell": "2,3"` (row, column, from 1); one that does not, or whose cell is taken or outside the grid, takes the first free button in reading order. `core/show/cart.ts` `layout(list)` is the one place that decides, and the host sends its answer to every view (`carts` in the pushed state). Cues beyond the last button are a warning on the cue, not lost. Nothing else about a cart's cues differs: a button is `host.cmd({ op: 'start', id })`, the same start a hotkey or a remote makes, so the list being run keeps its playhead.

## Backups, templates, settings files

- **Backups** (`core/show/backups.ts`). `settings.backup` is `{ minutes: 5, keep: 30 }`. While the working document is changing, the host writes it (unsaved changes included) to `backups/` every `minutes`; an unchanged document is never written twice. Pruned on each write: the newest `keep`, then the last of each day for 14 days. A show with no folder is backed up under the app's settings folder. `ShowDocument.replace(doc)` goes back to one: an undoable, unsaved edit.
- **Templates** (`core/show/show-templates.ts`; a cue type's template is another thing, `core/show/templates.ts`). `{ format: "endless-cues-template", version: 1, name, show }`, a `.ectemplate` file: a whole show with every passcode and key emptied and its sounds named by absolute path. `showFrom` gives it a new id and no folder.
- **Settings files.** `{ format: "endless-cues-settings", version: 1, from, settings, modules }`, a `.ecsettings` file, again with no secrets. Importing one is `settingsOps(file, doc)`: a `show.set` for each group of settings and each module, keeping the open show's own passcodes, applied as one edit and refused whole if anything in it cannot be held.
