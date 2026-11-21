# Endless Cues

Endless Cues is a cue list for running a show: a play, a puppet show, a comedy night, dance, a piece of digital art. One GO button runs the sound, the video, the lights and whatever else is on the network. It works the way QLab does, and it opens QLab 4 and 5 workspaces.

It runs on macOS, Windows and Linux, with no account and no internet. It's free and open source (GPL-3.0), all of it. I made it to run *Endless Forms*, our puppet show, and I'm sharing it because other people who make shows might want it too. Do whatever you want with it.

Downloads and the manual are at [endlesscues.com](https://endlesscues.com).

## What it does

All of it is free. There are no tiers and nothing to unlock.

**Running a show**

- A cue list with one GO, a playhead, and Space for GO and Esc for panic. Double-GO protection, pause, Load to Time, jump to a cue by number.
- Cue types: Group (all together, playlist, start first, start first and enter, random), Audio, Mic, Fade, Stop, Start, Pause, Devamp, Load, GoTo, Arm, Disarm, Reset, Target, Wait, Memo, Network, Device, MIDI, MIDI File, Timecode, Light, Mix, Jump, Video, Text, Camera and Script (a list of show commands, not code), plus Sections: headings that never play.
- Pre-wait, post-wait, auto-continue and auto-follow. Several cue lists, each with its own playhead.
- Carts: a list drawn as a grid of buttons. A list, a cart or the inspector can have a window of its own.
- Triggers on any cue: a hotkey, OSC, MIDI, a time of day or timecode, and a second trigger for when it's already playing.
- Show mode locks editing. Run from here starts a rehearsal at any cue with everything that would be going on there. Check the show lists what would go wrong, without playing anything. A show log records every GO and what it did.

**Sound**

- WAV, MP3, M4A, FLAC, Ogg, AIFF and CAF, on named buses with a master fader and a safety limiter.
- Fades with a shape, or drawn as a line over the waveform. Lines for pan and any effect setting too.
- Loops, loop regions held until you let go, play counts, markers, and Jump cues that move inside a playing sound.
- Find loops: it listens to a sound and adds loop regions that go round cleanly, on the bar lines when it has a tempo. You can also drag across the waveform of a playing sound to loop that stretch right away, and keep it as a region.
- The Playing strip under the list shows the waveform of whatever is playing. Hold a loop until the stage is ready, then skip or fade out on the bar.
- Tempo and bar lines found in a track when you ask, and GOs that land on the beat or the bar.
- Rate, with or without the pitch.
- A rack of effects on a cue: filters, EQ, gate, compressor, drive, pitch, chorus, delay, reverb and more. Sends to a reverb and a delay, ducking (off until you switch it on), outputs per bus and per cue with trims, a monitor feed, and recording the main outputs.
- An experimental native audio engine, off until you choose it in Settings ▸ Audio.

**Video and lights**

- Video, Text and Camera cues on a stage window on a second display, with position, scale, opacity and a four-corner pin, all of which can fade. H.264, VP8, VP9 and AV1; not ProRes.
- Light cues written as text (`front = 80`), with a patch, groups and fixtures, sent as DMX over Art-Net or sACN. Or Light cues that fire cues on an ETC Eos or grandMA3 desk.

**Other equipment**

- OSC out to named patches, raw network messages (text or hex), and incoming OSC for triggers and show commands.
- MIDI cues (with faded values), MIDI File cues, MIDI Show Control in and out.
- Timecode: MTC and LTC, out and in.
- OSC control with QLab's addresses, so remotes made for QLab (Companion, a Stream Deck) can run it.
- A web remote for a phone or tablet on the show network.
- A monitor of every message sent, and outputs held back so you can rehearse without the equipment.
- A backup computer that follows the main one.

**The rig**

- The Rig page says whether everything is ready: the show is saved, every file is found, the sound goes where it should, and each piece of equipment answers or doesn't. You can add your own checklist.
- A piece of equipment is a device in the show with its commands by name, and a Device cue sends one.
- A prop kit: firmware for a small Wi-Fi prop (a light or a switch on an ESP32), and Look for props on the network.
- A show from another computer opens with its network features off until you turn them on.

**The assistant** (off until you set it up)

- It reads the show, makes a change on a draft, checks it and dry-runs it, then shows you one change to accept or reject. It never edits or plays a show by itself.
- Give it a folder of sounds and it proposes the cues. Tell it about a piece of equipment and it makes the device and the cues that use it. Ask where something is in the window and it shows you.
- It runs on your own Claude Code or Codex, your own key (Anthropic, OpenAI, OpenRouter or any OpenAI-compatible service), a local model through Ollama, or a built-in helper with no model at all. See [The assistant](#the-assistant) below.
- It hands the show to a coding agent like Claude Code when you need more than the app does.

**The show file**

- A show is a folder of plain text (`show.json`) and its media. You can keep it in git.
- Nothing is kept until you save. Every save is a version you can compare with any other and go back to. Timed backups keep unsaved work. Templates, and settings you can export and import.
- QLab 4 and 5 workspaces open as shows, with a report, cue by cue, of what didn't come over. QLab doesn't need to be installed.
- A command line for shows (`validate`, `outline`, `diff`, `simulate`, `apply`) and an MCP server, so Claude Code, Codex or any MCP client can work on a show.

**Everywhere else**

- macOS and Windows builds (signed), and Linux from source. Shortcuts follow the platform.
- Lab, Ocean and Graphite themes.
- Updates from inside the app (never in Show mode or while anything plays), and Help ▸ Report a Problem.
- No telemetry and no crash reports. The one thing it sends by itself is a daily check for a new version, which Settings ▸ General turns off.

## Where it stands

It's an alpha (the version is in [`CHANGELOG.md`](CHANGELOG.md); the app calls itself "Endless Cues Public Alpha"). Its cue engine ran *Endless Forms*, the show it was made for, on a Mac. The app around the engine is newer. Some of it has been used with real equipment, and some has only been run against stand-ins so far.

Things may not work. If something breaks, tell me and I'll try to get a fix out very quickly: email jeshua@endlessformspuppetry.com, use Help ▸ Report a Problem in the app, or open an issue here. Try it on your own rig well before a show depends on it.

Tried for real:

- *Endless Forms*, run from one laptop: its sound, a projector on a second display for the video, live microphones, Wi-Fi props (small ESP32 boards) over OSC on the show's own network, and the line to the lighting desk over OSC.
- macOS (Apple silicon). Windows, on a test PC: the app, the tests and the end-to-end run.
- The native audio engine, measured on a Mac's own devices.
- QLab import, checked against what QLab itself says about 53 workspaces.
- The assistant through Claude Code.
- Report a Problem, against the live service.

Not yet widely tested:

- Linux, beyond the tests.
- Audio interfaces with many outputs.
- MIDI equipment and timecode.
- DMX fixtures over Art-Net or sACN, and lighting desks other than the show's.
- Cameras.
- Remotes made for QLab, and the web remote on a real phone.
- A main and a backup computer.
- The prop kit's own firmware on a board.
- The effects, the reverb and ducking, by ear.
- The assistant with your own key, Codex or a local model.

For anyone working on the code, the "Not verified yet" section of [`CLAUDE.md`](CLAUDE.md#not-verified-yet) has the precise list.

## Run it from source

Node 22 or newer. The code is TypeScript; `npm ci` builds it (`build/compile.mjs`, under a second), and `npm start` builds again before it starts.

```bash
npm ci
npm start                 # the app; File ▸ Open the Demo Show to look around
npm run watch             # while editing: rebuilds on every save (reload the window to see it)
```

## Tests

```bash
npm test                  # builds, checks the types, then the engine, the show file, the assistant, the modules (node --test, no Electron)
npm run smoke             # the real app end to end: offscreen, silent, never takes focus
npm run pack              # an unpacked app for this platform in dist.noindex/
```

## The website and the manual

[endlesscues.com](https://endlesscues.com) has the downloads and the manual. It, and the service behind Report a Problem and the hosted assistant, live in a separate private repository; the app talks to the service only through [`docs/specs/17-service-protocol.md`](docs/specs/17-service-protocol.md).

## Reporting a problem

In the app, Help ▸ Report a Problem… is the easiest way: it fills in the version and the system. Or open an issue here, or email me. A security problem goes by email instead: see [`SECURITY.md`](SECURITY.md).

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
| [`native/`](native) | The native audio engine, `ec-audio` (Rust; `npm run native` builds it): the same player as the audio window, opening the device itself. Off until Settings ▸ Audio ▸ Audio engine chooses it ([`docs/specs/18-native-audio.md`](docs/specs/18-native-audio.md)). |
| [`app/stage/`](app/stage) | The stage: the output window Video, Text and Camera cues are drawn in ([`core/video/`](core/video) is its arithmetic). It holds no show state. |
| [`app/renderer/`](app/renderer) | The window: a view of the host. Preact + htm, vendored; bundled into one file by `build/compile.mjs`. |
| [`app/main/modules/`](app/main/modules) | OSC control, Lighting desk, Web remote, Show feedback, Main and backup. Off until a show turns them on. |
| [`bin/ec.ts`](bin/ec.ts) | Validate, outline and diff shows from a terminal or CI. |
| [`examples/`](examples) | `make-demo.ts` writes the demo show, synthesising its sounds. |
| (not here) | endlesscues.com, the account site and the hosted service live in a separate private repository, `endless_cues_service`; the app talks to them only through [`docs/specs/17-service-protocol.md`](docs/specs/17-service-protocol.md). |
| [`docs/specs/`](docs/specs) | How it is meant to work, and why. Start at [`docs/specs/README.md`](docs/specs/README.md). |

## The four ideas

1. **The engine outlives the screen.** The show runs in the main process; the window is a view. Reload it, crash it: nothing that is sounding changes.
2. **Nothing is kept until you save.** A change is heard and seen at once, each changed control is marked with its saved value a hover away, and ⌘S writes the show and records a version. Unsaved changes survive a crash.
3. **A show changes one way.** Every edit, from the inspector, a drag, undo, a restored version or the assistant, is a list of [edit operations](docs/specs/03-show-file.md#edit-operations) applied whole or not at all. That is what makes a change reviewable before it lands.
4. **The assistant is an agent that proposes; a person decides.** It works on a private draft with tools to search, edit, check and dry-run the show, then hands over one change. You see the diff and accept or reject it. Accepting is one undo step, and like every edit it is not kept until you save.

## The assistant

The app is complete without the internet, and the assistant is optional. It works through Claude Code or Codex if you have one installed, with your own key from Anthropic, OpenRouter, OpenAI or any OpenAI-compatible service, or with a local model through Ollama. Nothing here costs money.

There is also a hosted assistant (an Endless Cues account, with no key to manage). You can try it for free, for a limited number of asks: how many, and for how long, I can't promise, since every ask costs me something. See [`docs/adr/0004-open-core-boundary.md`](docs/adr/0004-open-core-boundary.md).

## Credit

Endless Cues was made to run *Endless Forms*, a show by [Endless Forms Puppetry](https://endlessformspuppetry.com). If you use it on a show, please credit it: a line in your programme or on your website such as

> Show control: Endless Cues, by Endless Forms Puppetry (endlesscues.com)

That is a request, not a condition of the licence.

## Licence

GPL-3.0-or-later ([`LICENSE`](LICENSE)). The show file format is free for anyone to implement. The show's artwork in the app (the icon, its textures, the QIRX drawing) is not under the GPL and is not licensed for reuse; [`NOTICE`](NOTICE) lists those files. The fonts are under the SIL Open Font License. To contribute, read [`CONTRIBUTING.md`](CONTRIBUTING.md) first.

QLab is a trademark of Figure 53, LLC. Endless Cues is an independent project and is not affiliated with or endorsed by Figure 53.
