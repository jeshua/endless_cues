# Changelog

What changed in each version of Endless Cues, newest first. Versions are numbered as `docs/RELEASING.md` says.
Until 1.0, anything may change between versions; a show file saved by an older version always opens in a newer one.

`docs/qlab-tracker.md` is the detailed list of what is done, what is partly done, and what has not yet met the
equipment it is for. This file is the short version, for someone deciding whether to update.

## Unreleased
- **Show control in the manner of QLab**, free and open source: a cue list with one GO, a playhead, groups (timeline, start first and enter, playlists), sections, carts, hotkeys and triggers, Show and Edit modes, double-GO protection, Panic, Run from here, Check the show, and a show log. Nothing is kept until you save; every save is a version you can compare and restore, and timed backups keep unsaved work.
- **Sound**: Audio, Fade, Mic, Mix and Jump cues on named buses, with loops and loop regions, markers, tempo and bar lines, lines drawn over a sound (volume, pan, any effect setting), a rack of effects per cue (filters, eq, gate, compressor, drive, pitch, chorus, delay, reverb…), fade shapes, ducking by kind (off until switched on), a matrix of outputs with trims, a monitor feed and recording. The Playing strip steers a running track: hold a loop, skip or fade on the bar.
- **The native audio engine** (experimental, off until chosen in Settings ▸ Audio): `ec-audio`, in Rust, opens the output device itself; anything it cannot do yet stays with Web Audio.
- **Video, Text and Camera cues** on a stage window on a second display, with geometry that fades.
- **Lighting**: Light cues with levels by command line, a patch, groups and fixtures, sent as Art-Net or sACN; or cues fired on an ETC Eos or grandMA3 desk.
- **Network and devices**: OSC and MIDI cues (with faded values), MIDI files, MSC in and out, MTC and LTC in and out, timecode triggers, raw network messages, OSC control from remotes built for QLab (passcodes with levels), a web remote for a phone, show feedback, and a main and backup link.
- **The rig**: the show's equipment on one page, each device with named commands, asked whether it is there; Device cues; a prop kit with firmware for ESP32 boards; a show from another computer opens with its network features off until turned on.
- **The assistant** (off until set up): reads the show, proposes changes as one reviewable edit, and shows where things are in the window. It works through Claude Code or Codex, your own key (Anthropic, OpenAI, OpenRouter, any OpenAI-compatible service, Ollama), or an Endless Cues account. It never edits or plays a show by itself.
- **QLab import**: QLab 4 and 5 workspaces open as shows, with a report of what did not come across.
- **macOS, Windows and Linux**; signed builds for the Mac, updates from inside the app, Report a Problem from Help.
