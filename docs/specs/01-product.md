# 01 · Product

## What it is

**A free cue list for running a show** (a puppet show, a play, a comedy night, a piece of digital art), with an assistant that helps build the show and connect its equipment.

It is a show-control application for live performance. An operator sits in a booth with a list of cues and a GO button; pressing GO does the next thing: plays a sound, fades one, tells the lighting desk to go, starts a sequence. Endless Cues is that list, the engine that runs it, and the tools for building it.

It works the way QLab does, and it opens QLab 4 and 5 workspaces. QLab's model (one GO, a playhead, cues that target other cues, composition through groups and continue modes) is the shared language of the people who run shows, so someone who has called a show from QLab can sit down here and run one. Where that model already works, the behaviour and the keys are the same.

## Who it is for

1. **The person who runs the sound on a small show**, who needs one or more of: a computer that is not a Mac, a show file they can put in git, a way to hand the show to someone else without licences, or simply no budget for show control.
2. **The person whose show has music under it that must bend on the night**: a scene runs long, an entrance is late, an actor skips a page. The music tools are for designing a sound (a cue's chain of tools) and for rescuing a show that goes off script (go round from here, skip or crossfade to a marker on the bar), in the cue list itself. They are not for performing music.
3. **The show with a programmer near it**: people who want to script, extend and integrate. An open file format, a documented command surface and a module interface are for them.

Not for (yet): large video shows (Watchout, disguise), lighting programmers (a console), broadcast playout.

## What it does

The whole list is in the [README](../../README.md#what-it-does). The things that shape the rest of these specs:

- **Every platform**: macOS, Windows and Linux from one codebase ([10](10-cross-platform.md)).
- **The show is a folder of plain text** (`show.json`) and its media, so it diffs line by line ([03](03-show-file.md)).
- **History**: named versions beside the show; compare any two as a readable diff; restoring one is undoable.
- **Music that bends**: hold a playing track in a section, let go, jump inside it on the bar with a crossfade ([05](05-audio.md)).
- **Relative fades and ducks**: a fade survives a re-trim, and a voice-band duck keeps the music's bass and air under speech (off until switched on, [00](00-defaults.md)).
- **Remotes**: a web page on the show network, and OSC control in QLab's addresses for Companion and a Stream Deck ([06](06-control-surfaces.md)).
- **Editing by description**: the assistant proposes; you review a diff and accept ([08](08-assistant.md)).
- **Free**: all of it, open source, with no account.

It is an alpha. Video, lighting, MIDI and timecode are first slices, and much of what talks to equipment has so far been tried against stand-ins more than the real thing.

## Principles

These decide arguments.

1. **GO is sacred.** What GO will do next is always visible. Nothing steals Space. A second GO by accident is dropped. Nothing the app does in the background (saving, the assistant, a module failing) can delay or block a GO.
2. **Safe by default.** Show mode locks editing. Panic is one key and cannot be remapped. A broken cue is marked and skipped, never a crash. A live edit to a playing cue is heard at once, so what you hear is what is saved.
3. **The show is yours.** One folder, plain text, no account, no network. A show made today opens in ten years with a text editor if it has to.
4. **Dense for experts, discoverable for everyone else.** The cue list is a spreadsheet because operators need forty cues on screen. Settings that are set once live in Settings, not on the main page. Every field explains itself on hover.
5. **Change is reviewable.** Every edit is an operation; operations make diffs; diffs make versions and proposals. Nothing edits the show that cannot be shown, undone and named.
6. **A sound designer's ear over a programmer's convenience.** Fades are in dB. A duck is relative. A loop is sample-exact or it is not offered. Numbers measured in a room beat numbers that look tidy.

## What is free

Everything. The whole application, everything needed to build and run a show, on any number of computers, offline, with no account and nothing to unlock. The assistant runs on your own Claude Code or Codex, your own key, or a local model.

The code also holds a hosted assistant (an Endless Cues account, no key to manage). It isn't running for everyone yet; if people want it, the owner may host it so they can try it and use it for a while. Nothing is ever held back from the open app to make a hosted thing look better. [ADR 0004](../adr/0004-open-core-boundary.md).

## Names

The application is **Endless Cues**. A show on disk is a **show** (a folder ending `.ecshow`). The thing QLab calls a workspace we call a show; the things it calls cue lists we call **lists**. Otherwise QLab's vocabulary is used unchanged: cue, group, playhead, standby, pre-wait, post-wait, auto-continue, auto-follow, arm, panic, devamp.
