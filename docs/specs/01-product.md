# 01 · Product

## What it is

**A free, QLab-compatible cue list for running a show** (a puppet show, a play, a comedy night, a piece of digital art), with an assistant that helps build the show and connect its equipment.

It is a show-control application for live performance. An operator sits in a booth with a list of cues and a GO button; pressing GO does the next thing: plays a sound, fades one, tells the lighting desk to go, starts a sequence. Endless Cues is that list, the engine that runs it, and the tools for building it.

It is deliberately in QLab's family. QLab's model (one GO, a playhead, cues that target other cues, composition through groups and continue modes) is the industry's shared language, and a stage manager who has called a show from QLab should be able to sit down here and run one. Where QLab already got something right, we copy the behaviour and the keys.

## Who it is for

1. **The sound designer / operator of a small or mid-sized production** who knows QLab, or will learn it from a tutorial written for QLab, and who needs one or more of: a computer that is not a Mac, a price that is not $1,399, a show file they can put in git, or a way to hand the show to someone else without licences.
2. **The person whose show has music under it that must bend on the night**: a scene runs long, an entrance is late, an actor skips a page. The music tools are for designing a sound (a cue's chain of tools) and for rescuing a show that goes off script (go round from here, skip or crossfade to a marker on the bar), in the cue list itself. They are not for performing music.
3. **The production with a developer near it**: people who want to script, extend and integrate. An open file format, a documented command surface and a module interface are for them.

Not for (yet): large video shows (Watchout, disguise), lighting programmers (a console), broadcast playout.

## What makes it different

| | QLab 5 | Endless Cues |
|---|---|---|
| Platforms | macOS | macOS, Windows, Linux |
| Show file | Binary document | A folder of plain text (`show.json`) and media; diffs line by line |
| History | Snapshots | Named versions beside the show; compare any two as a readable diff; restore is undoable |
| Music | Plays files; loops and slices set in advance | Hold a playing track in a section, let go, jump inside it on the bar with a crossfade or a DJ blend |
| Ducking | Absolute fades | Relative fades (survive a re-trim) and voice-band ducks (music keeps its bass and air under speech) |
| Remote | iOS app | A web page on the show network; QLab-compatible OSC for Companion and Stream Deck |
| Editing by description | — | The assistant proposes; you review a diff and accept |
| Price | $599–$1,399, or rent | Free and open source; the hosted assistant is paid |

It is behind QLab on much else: see [09 · QLab parity](09-qlab-parity.md) and the [tracker](../qlab-tracker.md). Video, lighting, MIDI and timecode have first slices that no real equipment has confirmed.

## Principles

These decide arguments.

1. **GO is sacred.** What GO will do next is always visible. Nothing steals Space. A second GO by accident is dropped. Nothing the app does in the background (saving, the assistant, a module failing) can delay or block a GO.
2. **Safe by default.** Show mode locks editing. Panic is one key and cannot be remapped. A broken cue is marked and skipped, never a crash. A live edit to a playing cue is heard at once, so what you hear is what is saved.
3. **The show is yours.** One folder, plain text, no account, no network. A show made today opens in ten years with a text editor if it has to.
4. **Dense for experts, discoverable for everyone else.** The cue list is a spreadsheet because operators need forty cues on screen. Settings that are set once live in Settings, not on the main page. Every field explains itself on hover.
5. **Change is reviewable.** Every edit is an operation; operations make diffs; diffs make versions and proposals. Nothing edits the show that cannot be shown, undone and named.
6. **A sound designer's ear over a programmer's convenience.** Fades are in dB. A duck is relative. A loop is sample-exact or it is not offered. Numbers measured in a room beat numbers that look tidy.

## The two tiers

**Open source**: the whole application. Everything needed to build and run a show, on any number of computers, forever, offline.

**Paid**: the hosted assistant (and, later, things that genuinely need a server: cloud version history, sharing a show with a collaborator, main/backup pairing across sites). The rule for what is paid: it costs us money to run each time it is used. Features are never held back from the open app to make the paid tier look better. [ADR 0004](../adr/0004-open-core-boundary.md).

## Names

The application is **Endless Cues**. A show on disk is a **show** (a folder ending `.ecshow`). The thing QLab calls a workspace we call a show; the things it calls cue lists we call **lists**. Otherwise QLab's vocabulary is used unchanged: cue, group, playhead, standby, pre-wait, post-wait, auto-continue, auto-follow, arm, panic, devamp.
