# 02 · Architecture

## The picture

```
┌──────────────────────────── main process (Node) ────────────────────────────┐
│                                                                              │
│   app/main/main.ts      window, menu, file dialogs, per-computer config      │
│                                                                              │
│   app/main/host.ts  ── the show host ──────────────────────────────────────  │
│     ShowDocument  (core/show)      the open show, undo, versions, proposals  │
│     CueEngine     (core/engine)    plays it: playhead, waits, fades, holds   │
│     mixer                          bus and master levels → the audio window  │
│     modules                        OSC control · lighting desk · web remote  │
│     assistant     (core/assistant) reads the show, stages proposals          │
│                                                                              │
│              cmd(c) ▲            │ state (pushed)          │ audio-cmd       │
└─────────────────────┼────────────┼─────────────────────────┼─────────────────┘
                      │            ▼                         ▼
        ┌─────────────┴──────────────────┐      ┌────────────────────────────┐
        │  the window  (app/renderer)    │      │  audio window (app/audio)  │
        │  a view: cue list, inspector,  │      │  hidden; Web Audio; plays  │
        │  mixer, drawers, settings      │      │  what it is told; no state │
        └────────────────────────────────┘      └────────────────────────────┘
              also through cmd(c): UDP (OSC control), HTTP (web remote)
                                                ┌────────────────────────────┐
                    (when chosen) JSON lines ─▶ │  ec-audio  (native/audio)  │
                    on stdin / stdout           │  Rust; the device itself;  │
                                                │  plays what it is told     │
                                                └────────────────────────────┘
```

Three processes, one owner of truth; four when this computer has chosen the native audio engine.

## Why it is split this way

**The show must outlive the screen.** The engine is in the main process because the operator's window is the part most likely to be reloaded, resized, blocked by a modal or crashed by a rendering bug. If the window dies, the main process reloads it and pushes the state again; what is sounding never noticed.

**The audio window holds no show state.** It is a player: `play`, `fade`, `stop`, `seek`, `move`, `region`. If it crashes, the host makes a new one and clears the engine's idea of what is running, so the next GO works. The cost is one renderer process; the benefit is that Web Audio's whole engine (decoding, sample-accurate scheduling, device routing) comes for free on three platforms. [05 · Audio](05-audio.md) says where that stops being enough.

**The native audio engine is the same player in another language.** `ec-audio` (`native/audio/`, Rust) is a child process of the main process, started only when this computer chooses it (Settings ▸ Audio ▸ Audio engine). It takes the audio window's own commands as JSON lines on its standard input and answers with the window's own events on its standard output; `app/main/native-audio.ts` starts it, starts it again when it exits, and after three exits in a minute hands the sound back to the audio window for the sitting. The audio window keeps running beside it for MIDI and for reading waveforms. Like the window it holds no show state, and a crash in it cannot take the main process with it ([18](18-native-audio.md), [ADR 0007](../adr/0007-native-audio.md)).

**The stage window is the same idea for pictures.** `app/stage/stage.html` is the output window Video, Text and Camera cues are drawn in; `app/main/stage.ts` owns it and the display it is on. It too holds no show state, and the sound of a video never passes through it ([13 · Video and the stage](13-video.md)).

**One door.** `host.cmd({ op, … })` is the only way anything acts on the show. The window calls it over IPC; the OSC module calls it for a UDP packet; the web remote calls it for an HTTP POST. They cannot disagree about what GO means, double-GO protection applies to all of them, and Show mode's lock is enforced in one place. The full command list is in [06 · Control surfaces](06-control-surfaces.md).

**`core/` is plain Node.** Nothing under `core/` requires Electron. The engine takes its audio backend, its network sender and its clock as arguments; the tests hand it fakes and a clock they advance by hand, so a three-minute sequence is tested in a millisecond and never flakes on timing. This is also what makes a headless engine (a show computer with no window, a CLI validator, a server-side dry run) a small step rather than a rewrite.

## State and how it moves

There are three kinds of state, kept apart on purpose.

| | Where | Saved | Examples |
|---|---|---|---|
| **The show** | `ShowDocument.doc` → `show.json` | Only on Save (⌘S), atomically, with a version; pending edits are journalled | Cues, lists, buses, patches, module settings, GO settings |
| **The run** | `CueEngine` | Never | Playhead, what is running, waits, fades, armed holds, disarmed-by-hand |
| **This computer** | `config.json` in the OS's app-data folder | On change | Last show, recent shows, audio output device, the assistant's sign-in, "light cues are stops" |

The show never contains a credential or a device id. The run is never written to disk (crash recovery of the playhead is a roadmap item, and will be a separate journal file, not the show).

**Edits.** `document.edit(ops)` applies operations to a copy (`core/show/ops.ts`), and if they all fit, swaps the working document, journals it, and emits `change`. Nothing reaches `show.json` until the show is saved ([03](03-show-file.md#saving)). The host answers `change` by converting the document for the engine (`show.toEngineDoc`) and calling `engine.load()`, which keeps the playhead and everything that is sounding. If a playing cue's level changed, the host trims the live sound by the difference, so an edit is heard as it is made.

**Pushes.** The host pushes a snapshot to every view whenever the engine or document changes, and ten times a second while anything is running (for clocks and meters). The document itself is large and changes rarely, so it is sent only when its revision changes; the per-tick push is the engine's small state. A view that has just loaded asks for `state` and gets everything.

**The renderer keeps only what is the viewer's**: the selection, which groups are folded, which drawer is open, a half-typed field. It never caches show state beyond the last push and never computes what a cue "will do".

## Rules that keep a show safe

These are load-bearing. Each has cost a production something, here or in the app this grew from.

1. **Nothing eats Space.** The key handler listens in the capture phase and ignores Space only when a text field is being typed in. A click blurs whatever it focused. A focused fader that swallowed Space once dropped a cue.
2. **Esc panics, except in a field being typed in**, where it cancels the typing. Never anything else.
3. **A cue that cannot work is marked, not thrown.** A missing target or file makes the cue `broken` in the engine document; GO skips it and the list shows why. `engine.load` must never fail on a show a person could have made.
4. **Timers that fire cues are wrapped.** A cue that throws when it fires is logged; it must not be an uncaught exception in the main process.
5. **A test run cannot disturb a show.** `--smoke` uses its own temporary settings folder, mutes the master, starts no module (so binds no port), never saves config, and sets the macOS activation policy so it cannot take the keyboard.
6. **Quitting while sounding asks twice.** So does Reset.
7. **The audio device going away is survivable.** (Inherited behaviour to port: fall back to the system default, say so, and return when the device does. Not yet in 0.1; see [05](05-audio.md).)

## Modules

A module connects the cue list to something outside it. It is a plain object (`app/main/modules/*.js`): an id, a name, a list of setting fields the Settings page draws, and `create(ctx)` returning `{ start(config), stop(), status(), onLight?(cue), onState?() }`. Its settings live in the show file under `modules.<id>`; the host starts it when `enabled` becomes true, restarts it when its settings change, and stops it when the show closes. A module reaches the show only through `ctx.host.cmd` and `ctx.host.snapshot`: the same door as everything else.

Shipped: **OSC control** (QLab-compatible addresses), **Lighting desk** (Light cues fire an Eos-family desk), **Web remote**. Planned as modules, not as core: MIDI, timecode, video output, microphones and ducking, main/backup, motion capture. The test of whether something is a module: a show that does not use it should not pay for it, in the UI or at run time.

## What is deliberately not here

- **No framework runtime beyond Preact, and one build script.** The code is TypeScript; `build/compile.mjs` writes the `.js` beside each `.ts` and bundles the main window ([ADR 0006](../adr/0006-typescript.md)). With `npm run watch`, a contributor edits a file and reloads.
- **No database.** The show is a file; versions are files. [ADR 0002](../adr/0002-versions-as-files.md).
- **No server.** The app listens on a port only when a module that needs one is switched on.
