# Endless Cues

Endless Cues is show control for live theatre and events, in the manner of QLab: a cue list with one GO button, a playhead, and cues that play sound, fade, wait, and send OSC and MIDI to other equipment. It also holds a track in a loop while a scene runs long, lets you change levels and waits while the sound plays, and keeps every saved version of the show as plain text beside it. It runs on macOS, Windows and Linux, with no account and no internet. It is free and open source (AGPL-3.0).

## Status

**A public alpha** (the version is in [`CHANGELOG.md`](CHANGELOG.md)). The app calls itself "Endless Cues Public Alpha". Its cue engine has run one real show (*Endless Forms*, which it was made for); the app around the engine is new and has only been launched on a Mac. It plays to one audio device at a time. Much of what talks to equipment (MIDI ports, timecode, a multi-output interface, a lighting desk, DMX over Art-Net and sACN, a projector, a backup computer, the prop firmware) has been tested against stand-ins, not the real thing.

- What is done and what is next: [`docs/qlab-tracker.md`](docs/qlab-tracker.md)
- QLab's features, row by row, and which ones are here: [`docs/specs/09-qlab-parity.md`](docs/specs/09-qlab-parity.md)
- What has never been tried on real equipment: the "Not verified yet" section of [`CLAUDE.md`](CLAUDE.md#not-verified-yet)

## Run it from source

Node 22 or newer. Nothing is built or bundled: the app runs from these sources.

```bash
npm ci
npm start                 # the app; File ▸ Open the Demo Show to look around
```

## Tests

```bash
npm test                  # the engine, the show file, the assistant, the modules (node --test, no Electron)
npm run smoke             # the real app end to end: offscreen, silent, never takes focus
npm run pack              # an unpacked app for this platform in dist.noindex/
```

## The website and the manual

[endlesscues.com](https://endlesscues.com) has the downloads and the manual. It, and the hosted assistant's service, live in a separate private repository; the app talks to the service only through [`docs/specs/17-service-protocol.md`](docs/specs/17-service-protocol.md).

## Reporting a problem

In the app, Help ▸ Report a Problem… is the easiest way: it fills in the version and the system. Or open an issue here. A security problem goes by email instead: see [`SECURITY.md`](SECURITY.md).

## More

The show file has a command line of its own, with no window:

```bash
node bin/ec.js validate My.ecshow        # what would not work on the night; exit 1 if anything is broken
node bin/ec.js diff Old.ecshow My.ecshow # what changed, cue by cue
node bin/ec.js outline My.ecshow
node bin/ec.js simulate My.ecshow 3 2    # a dry run: what two GOs from cue 3 do, second by second
node bin/ec.js apply My.ecshow ops.json  # edit operations from a file, checked as every edit is, saved as a version
```

To see the assistant, the Rig page and a stand-in prop working together in ten minutes with no hardware, follow [`docs/try-the-assistant.md`](docs/try-the-assistant.md).

And it is a tool for other agents. Claude Code, Codex or any MCP client can work on a show with the assistant's own tools:

```bash
claude mcp add endless-cues -- node /path/to/endless_cues/bin/ec-mcp.js      # the show open in the app
node bin/ec-mcp.js --show My.ecshow                                          # or a show folder, with no app
```

## What is where

| | |
|---|---|
| [`core/engine/`](core/engine) | The cue engine. Plain Node, no Electron: audio, network and the clock are injected, so tests drive it with fakes. |
| [`core/show/`](core/show) | The show file: its format, the edit operations (the one way a show changes, and where every edit is checked), diff, saved versions, timed backups, templates, carts, the Script cue's commands, proposals. |
| [`core/assistant/`](core/assistant) | The assistant: reads the show, proposes edit operations. It cannot change or play a show. |
| [`core/net/`](core/net) | OSC, both ways, no dependency. |
| [`app/main/`](app/main) | The Electron main process: the show host (document + engine + mixer + modules) and the app shell. |
| [`app/audio/`](app/audio) | The hidden window that makes the sound (Web Audio). It holds no show state. |
| [`app/stage/`](app/stage) | The stage: the output window Video, Text and Camera cues are drawn in ([`core/video/`](core/video) is its arithmetic). It holds no show state. |
| [`app/renderer/`](app/renderer) | The window: a view of the host. Preact + htm, vendored, no build step. |
| [`app/main/modules/`](app/main/modules) | OSC control, Lighting desk, Web remote, Show feedback, Main and backup. Off until a show turns them on. |
| [`bin/ec.js`](bin/ec.js) | Validate, outline and diff shows from a terminal or CI. |
| [`examples/`](examples) | `make-demo.js` writes the demo show, synthesising its sounds. |
| (not here) | endlesscues.com, the account site and the hosted service live in a separate private repository, `endless_cues_service`; the app talks to them only through [`docs/specs/17-service-protocol.md`](docs/specs/17-service-protocol.md). |
| [`docs/specs/`](docs/specs) | How it is meant to work, and why. Start at [`docs/specs/README.md`](docs/specs/README.md). |

## The four ideas

1. **The engine outlives the screen.** The show runs in the main process; the window is a view. Reload it, crash it: nothing that is sounding changes.
2. **Nothing is kept until you save.** A change is heard and seen at once, each changed control is marked with its saved value a hover away, and ⌘S writes the show and records a version. Unsaved changes survive a crash.
3. **A show changes one way.** Every edit, from the inspector, a drag, undo, a restored version or the assistant, is a list of [edit operations](docs/specs/03-show-file.md#edit-operations) applied whole or not at all. That is what makes a change reviewable before it lands.
4. **The assistant is an agent that proposes; a person decides.** It works on a private draft with tools to search, edit, check and dry-run the show, then hands over one change. You see the diff and accept or reject it. Accepting is one undo step, and like every edit it is not kept until you save.

## Open and paid

The app is open source and complete without the internet. The assistant works through Claude Code or Codex if you have one installed, with your own key from Anthropic, OpenRouter, OpenAI or any OpenAI-compatible service, or with a local model through Ollama. The paid part is the hosted assistant: an Endless Cues account, with no key to manage. See [`docs/adr/0004-open-core-boundary.md`](docs/adr/0004-open-core-boundary.md).

## Credit

Endless Cues was made to run *Endless Forms*, a show by [Endless Forms Puppetry](https://endlessformspuppetry.com). It is free. If you use it in a production, please credit it: a line in your programme or on your website such as

> Show control: Endless Cues, by Endless Forms Puppetry (endlesscues.com)

That is a request, not a condition of the licence.

## Licence

AGPL-3.0-or-later ([`LICENSE`](LICENSE)). The show file format is free for anyone to implement. The show's artwork in the app (the icon, its textures, the QIRX drawing) is not under the AGPL and is not licensed for reuse; [`NOTICE`](NOTICE) lists those files. The fonts are under the SIL Open Font License. To contribute, read [`CONTRIBUTING.md`](CONTRIBUTING.md) first.

QLab is a trademark of Figure 53, LLC. Endless Cues is not affiliated with or endorsed by Figure 53.
