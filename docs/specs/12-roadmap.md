# 12 · Roadmap

The order things are meant to happen in, and what "done" means for each.

## What it is for

Endless Cues is **a free cue list for running a show**: a puppet show, a play, a comedy night, a piece of digital art. Its **assistant** helps build the show and connect its equipment. Two things follow:

- **Simple until asked.** Out of the box it is a plain cue list; everything that analyses, decides or acts by itself is off until switched on ([00](00-defaults.md)).
- **Music tools are for designing a sound and for rescuing a show that goes off script, not for performing it**: a cue's sound-design chain ([05](05-audio.md)); and, in the cue list's own Playing strip, going round from here, bar lines, markers, moves on the bar, and a tempo found and corrected where it is asked for.

## Now: the public alpha

What the app does today. "Checked" means a unit test or a check in the end-to-end run; much of it has so far been run on a Mac and against stand-ins, and [CLAUDE.md](../../CLAUDE.md#not-verified-yet) lists exactly what has not yet met real equipment.

- **The cue list**: GO, a playhead, double-GO protection, panic, pause, Load to Time, jump to a cue, several lists. Continue modes run from any start (GO, a trigger, a Start cue, OSC) and inside the "start first" groups.
- **Cue types**: Group (all together, playlist, start first, start first and enter, random), Audio, Mic, Fade (of a cue or a group), Stop, Start, Pause, Devamp, Load, GoTo, Arm, Disarm, Wait, Memo, Network (OSC, with a faded value), MIDI (notes, program changes, controllers, MSC, SysEx), Light (called, and fired on a desk), Mix, Jump, and Script (a list of show commands, not code).
- **Cue carts**, and a list, a cart or the inspector in a window of its own.
- **Triggers**: hotkey, OSC, MIDI and time of day on any cue; show commands from MIDI and MSC.
- **Sound**: buses with a level; each bus to a pair of the device's outputs; ducking by kind (off until switched on); loop regions held, counted and let go; play counts; a tempo found in a track when asked, and GOs that land on the beat or bar; a sound-design chain on a cue (measured, not heard); the rescue tools in the Playing strip (a loop from here, markers, moves on the bar); recording the show.
- **Editing**: cut, copy, paste, duplicate, group, ungroup, renumber, find, a right-click menu, single-key shortcuts (remappable), drag and drop, undo through everything.
- **The show file**: a folder of plain JSON; nothing kept until Save; a version for every save, compared and restored; timed backups of the working show; templates; settings exported and imported; a playback log as CSV; a command line (`ec validate`, `diff`, `simulate`, `apply`).
- **QLab import**: QLab 5 and QLab 4 workspaces read directly, carts included, with a report of what did not come across.
- **Control**: OSC control in QLab's addresses (transport, cue properties, queries, updates); a web remote; show feedback out; a lighting desk module; a network monitor; outputs held back for rehearsal; a second computer that follows the first.
- **The assistant**: an agent that reads, edits a draft, dry-runs it and proposes; the same tools for Claude Code, Codex or any MCP client. Every edit, whoever makes it, is one checked batch of operations.
- **The rig** ([15](15-assistant-and-rig.md)): devices with named commands, Device cues, the Rig page and its check, a prop kit, the hand-over to a coding agent.
- **Timecode, video and lighting, first slices**: MTC and LTC out and in, MIDI File cues; one stage on one display (Video, Text and Camera cues, geometry and its fades, a corner pin; [13](13-video.md)); Art-Net and sACN out, a patch, Light cues that hold levels, a dashboard ([14](14-lighting.md)).
- **A native audio engine**, experimental and off until chosen ([18](18-native-audio.md)).

## Next: trustworthy for a small show

The bar: a sound designer can build and run a real audio-only show on a Mac or a PC, and nothing surprising happens on the night. What stands between here and there is mostly proof, not features.

- **Run it where it has not been run much.** Windows on more than one PC, Linux launched by a person, and what breaks fixed ([10](10-cross-platform.md) lists what to look at); an update installed from one signed build to the next.
- **Try it on more real equipment.** A multi-output interface, a microphone, a MIDI port, a lighting desk, Companion and other remotes, two computers as main and backup. Each is written and tested against a stand-in; what has met the real thing is in CLAUDE.md's list.
- **Show-night hardening**: a dry run of the whole list in the Rig page's check; a relaunch that offers to resume where the run was.
- **What operators still reach for**: hold-to-play in a cart, bus mute and solo, a timeline view of a group, Record Cue Sequence; and whatever trying the real remotes finds.
- **The assistant and the rig on real equipment**: the kit's firmware on a board, a desk or a mixer as a device, Look for props through a real router; then HTTP devices (WLED, Shelly), a test tone per output, and flashing from the app.
- **Main and backup, finished**: one role switch that moves the outputs and the sound together, the show's hash in the heartbeat, a backup that catches up mid-show ([06](06-control-surfaces.md) says exactly what is missing).

## Later: what needs more engine or a new protocol

- **The native audio engine grown up** ([18](18-native-audio.md)): played real shows, then more than one device, sample-synchronous starts, ASIO / JACK, plugins. The cue engine and the host do not change.
- **Edits mirrored between computers** (the operations are already the wire format): the backup that stays current by itself, and from there several people editing one show.
- **Scripting with state**: show variables and conditional cues. If a Script cue ever runs more than a list of commands, it runs in a sandbox with the same command surface and no other power; it never becomes "run this code".
- **The web remote grown up**: editing, carts, HTTPS.
- **Video and projection past the first slice**: several stages and regions, masks, edge blending, mesh warps; NDI and Syphon/Spout, which need native code.
- **Lighting beyond the first slice**: USB DMX, a fixture library, cue lists synced both ways with Eos and MA.
- **Collaboration**: several people editing one show live, with per-person selection. The operations are already the wire format; what is missing is a relay and conflict rules.
- **A headless engine**: a show on a small computer with no screen, driven by the web remote and OSC.
- **Motion capture and generative visuals** as a module.
- **A device library** that has been checked against the devices. (15's models are that library's first form: written from documentation, checked against nothing.)

## Not planned

- Replacing a lighting console or a media server for large shows.
- A cloud-only anything. Every feature that can work offline does.
- Anything paid in the app, or held back from it. It is free, all of it.

## Decisions waiting on the owner

1. **The hosted assistant**: running, free to try for a limited number of asks; whether it grows depends on whether people use it.
2. **The name collision** with the original show's installed app ([10](10-cross-platform.md)).
