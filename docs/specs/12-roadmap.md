# 12 · Roadmap

The order things are meant to happen in, and what "done" means for each. [09 · QLab parity](09-qlab-parity.md) is the detailed gap list this is drawn from.

*Brought up to date on 2026-11-15, against the code and [`../qlab-tracker.md`](../qlab-tracker.md). The tracker is the living list, item by item; this is the shape of it.*

## What it is for (decided 2026-11-15)

Endless Cues is **a free, QLab-compatible cue list for running a show**: a puppet show, a play, a comedy night, a piece of digital art. Its **assistant** helps build the show and connect its equipment. Two things follow:

- **Simple until asked.** Out of the box it is a plain cue list; everything that analyses, decides or acts by itself is off until switched on ([00](00-defaults.md)).
- **Music tools are for designing a sound and for rescuing a show that goes off script, not for performing it**: a cue's sound-design chain ([05](05-audio.md)); and, in the cue list's own Playing strip, going round from here, bar lines, markers, moves on the bar, and a tempo found and corrected where it is asked for.

## 0.1 — the public alpha (this)

What the app does today. "Checked" means a unit test or a check in the end-to-end run; much of it has still only been run on one Mac, and [CLAUDE.md](../../CLAUDE.md) lists what real equipment has never confirmed.

- **The cue list**: GO, a playhead, double-GO protection, panic, pause, Load to Time, jump to a cue, several lists. Continue modes run from any start (GO, a trigger, a Start cue, OSC) and inside the "start first" groups.
- **Cue types**: Group (all together, playlist, start first, start first and enter, random), Audio, Mic, Fade (of a cue or a group), Stop, Start, Pause, Devamp, Load, GoTo, Arm, Disarm, Wait, Memo, Network (OSC, with a faded value), MIDI (notes, program changes, controllers, MSC, SysEx), Light (called, and fired on a desk), Mix, Jump, and Script (a list of show commands, not code).
- **Cue carts**, and a list, a cart or the inspector in a window of its own.
- **Triggers**: hotkey, OSC, MIDI and time of day on any cue; show commands from MIDI and MSC.
- **Sound**: buses with a level; each bus to a pair of the device's outputs; ducking; loop regions held, counted and let go; play counts; a tempo found in a track when asked, and GOs that land on the beat or bar; a sound-design chain on a cue (measured, not heard); the rescue tools in the Playing strip (a loop from here, markers, moves on the bar); recording the show.
- **Editing**: cut, copy, paste, duplicate, group, ungroup, renumber, find, a right-click menu, QLab's single keys (remappable), drag and drop, undo through everything.
- **The show file**: a folder of plain JSON; nothing kept until Save; a version for every save, compared and restored; timed backups of the working show; templates; settings exported and imported; a playback log as CSV; a command line (`ec validate`, `diff`, `simulate`, `apply`).
- **From QLab**: QLab 5 and QLab 4 workspaces read directly, carts included, with a report of what did not come across.
- **Control**: OSC control in QLab's addresses (transport, cue properties, queries, updates); a web remote; show feedback out; a lighting desk module; a network monitor; outputs held back for rehearsal; a second computer that follows the first.
- **The assistant**: an agent that reads, edits a draft, dry-runs it and proposes; the same tools for Claude Code, Codex or any MCP client. Every edit, whoever makes it, is one checked batch of operations.

## 0.2 — trustworthy for a small show

The bar is unchanged: a sound designer can build and run a real audio-only show on a Mac or a PC, and nothing surprising happens on the night. What stands between here and there is mostly proof, not features.

- **Run it where it has not been run.** Windows and Linux launched by a person and what breaks fixed ([10](10-cross-platform.md) lists what to look at); signed, notarised installers; auto-update that never acts by itself.
- **Try it on real equipment.** A multi-output interface, a microphone, a MIDI port, a lighting desk, QLab Remote and Companion, two computers as main and backup. Each is written and tested against a stand-in, and none has been heard or seen on the real thing.
- **Show-night hardening**: a pre-show check (every file, every target, every module answering, a dry run of the whole list; designed as the Rig page in [15](15-assistant-and-rig.md), which does not yet include the dry run); a fallback when the output device goes away; a journal of the run so a relaunch can offer to resume.
- **What a QLab user still reaches for**: second-trigger behaviour (and hold-to-play in a cart); per-list playheads and lists that keep running when not shown; skip-if-disarmed and auto-load; duck others while a cue runs; cue templates and Paste Cue Properties; fade curve shapes; rate and pitch; drag a cue onto a target; handles on the waveform.
- **OSC breadth**: OSC in over TCP, passcodes with levels of access, QLab's show-control broadcast, `/new` `/move` `/delete`.
- **The assistant and the rig on real equipment** ([15](15-assistant-and-rig.md) is built: devices with named commands, Device cues, the Rig page, an assistant that starts a show from a folder, makes devices and asks whether they are there, a built-in helper with no model, the prop kit's files, the hand-over to a coding agent). What is left is the equipment: the kit's firmware on a board, a desk or a mixer as a device, Look for props through a real router; then HTTP devices (WLED, Shelly), a test tone per output, and flashing from the app (the tracker's AR12 to AR18).
- **Tests for what has none** (the tracker's R16), and a decision on each engine feature no show file can reach (R8).
- **Main and backup, finished**: one role switch that moves the outputs and the sound together, the show's hash in the heartbeat, a backup that catches up mid-show ([06](06-control-surfaces.md) says exactly what is missing).

## 0.3 — the things that need a new engine or a new protocol

- **A native audio engine** (a Rust sidecar; [05](05-audio.md)): multichannel devices and files, a per-cue matrix, sample-synchronous starts, ASIO / JACK, effects. The engine and host are unchanged; this replaces the audio window.
- **Timecode**: LTC / MTC out, chase, timecode triggers; MIDI File cues.
- **Edits mirrored between computers** (the operations are already the wire format): the backup that stays current by itself, and from there several people editing one show.
- **Scripting with state**: show variables and conditional cues. If a Script cue ever runs more than a list of commands, it runs in a sandbox with the same command surface and no other power; it never becomes "run this code".
- **A timeline view** of any group or list: lanes, draggable starts, fades drawn on their targets.
- **The web remote grown up**: editing, levels, Load to Time, carts, HTTPS.

## 0.4 and after

- **Video and projection**: a first slice is in (one stage on one display: Video, Text and Camera cues, geometry and fades of it, a corner pin, a blackout; [13](13-video.md)). Still to come: several stages and regions, masks, edge blending, mesh warps; NDI and Syphon/Spout, which need native code.
- **Lighting beyond calling a desk**: a first slice is in (Art-Net and sACN out, a patch, Light cues that hold levels, a dashboard, and an override switch that holds DMX back; [14](14-lighting.md)). Still to come: USB DMX, a fixture library, cue lists synced both ways with Eos and MA.
- **Collaboration**: several people editing one show live, with per-person selection. The operations are already the wire format; what is missing is a relay and conflict rules.
- **A headless engine**: a show on a small computer with no screen, driven by the web remote and OSC.
- **Motion capture and generative visuals** as a module.
- **A device library** that has been checked against the devices. (15's models are that library's first form: written from documentation, checked against nothing.)

## Not planned

- Replacing a lighting console or a media server for large shows.
- A cloud-only anything. Every feature that can work offline does.
- Features held back from the open app to sell the paid tier.

## Decisions waiting on the owner

1. **Licence** ([ADR 0005](../adr/0005-licence.md)). Blocks making the repository public.
2. **Pricing for the assistant**: decided with the service; free during the beta.
3. **The name collision** with the original show's installed app ([10](10-cross-platform.md)).
4. **Whether bring-your-own-key stays in the open app** ([ADR 0004](../adr/0004-open-core-boundary.md) recommends yes).
