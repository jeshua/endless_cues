# 00 · Simple until asked

Out of the box Endless Cues is a plain cue list: it plays sound and sends what its cues say. **Anything that
analyses, decides, or acts on its own is off until a person switches it on**, and switching it on is one obvious
control in the place a person would look. This file is the list of every such behaviour, what it is set to on a new
show, and where its switch is. A new behaviour of that kind is added here, off, with a test in
`test/defaults.test.ts`.

Three rules follow from that:

- **A new show and an imported QLab workspace start the same**: `defaultSettings()` and `defaultModules()` in
  `core/show/show.ts`. The importer sets only what the workspace says (its patches, its double-GO time, its panic time).
- **A show that has something switched on keeps it.** Settings live in the show file and are never reset on open.
- **Hiding a view never changes what is heard.** The engine does what the show says whether or not the view that
  made it is shown.

## Tempo and beat analysis

`core/audio/tempo.ts` runs only when a person asks, for the sounds they ask about:

- **Time & Loops ▸ Tempo ▸ Find the tempo** on one Audio cue, or **Find the tempo** in the Playing strip while it plays (that sound only).
- **Time & Loops ▸ Loop regions ▸ Find loops** on one Audio cue (that sound only; what it finds is added as loop regions, one edit).

Nothing looks for a tempo when a sound is added, when a workspace is imported, when a show is opened or when a view
is opened. What is found is written to the cue (`tempo`) as one undoable edit and travels with the show.

## Steering a running track is the cue list's own

These are the cue list's own, because a show needs them:

| Tool | Where it lives |
|---|---|
| The waveform of what is playing | The Playing strip under the list: the longest sound playing, or the selected cue if it is playing (select a running cue to look into it). With a tempo: a light line at each bar, and the bar and beat counted beside the time. Also its Time & Loops tab. |
| Pause or stop one running cue | Active Cues: each sound has its own ❙❙ and ■ (■ fades it out; again, or with Shift, stops dead). The Playing strip has Pause and Stop for the sound it shows. |
| Go round from here, with no region drawn (stalling) | The Playing strip's row: **Loop 1 2 4 8 bars** from the beat the track is on, when the sound has a tempo; under **More**, 1 or 2 beats, or 2 4 8 16 seconds for a sound with none. **Let go** in the same place, or **L**. (`op: 'loop', free: true`.) |
| Go round a stretch dragged on the waveform | A drag across the Playing strip's waveform: it goes round at once, its ends on the nearest beats (⇧: where they were let go), until let go (**Let go**, **L**). **Keep** (Edit mode) makes it one of the sound's loop regions. (`op: 'loop', free: true`.) |
| Hold a planned loop and let it go | A loop region drawn on Time & Loops: **L**, the "⟳ hold next / let go" chip in Active Cues, or a click on the region's block over the waveform. **H** holds the section the track is in. A Devamp cue lets go from the list. |
| Move to another place in a track | Click the waveform in the Playing strip to mark a place, then **Skip** (at once) or **Fade to** (a 1.5 s crossfade inside the track). Each marker of the sound has a button in the row (click: skip; Shift: crossfade). **+ here** (More; Edit mode) keeps a marker where the track is. A Jump cue does it from the list. |
| …on the bar | **On the bar** (More; a sound with a tempo): a skip or a crossfade from the strip leaves on the track's own next bar line and lands on the bar line nearest the place (`seek` / `fadeto` with `on: 'bar'`; `engine.moveOnGrid`). Off as it comes. |
| Start or move on the beat or the bar | A group's **Quantise** (now / beat / bar), Beat lead-in and Blend (under More). They need the playing track's tempo. |
| Find a tempo, and correct it | **Find the tempo** in the Playing strip or on Time & Loops ▸ Tempo (that sound only). Corrected there: the number typed, ÷2 and ×2, the listen's other readings, beats in a bar, **1 is here**, a 10 ms nudge of the bar lines, Remove. A track that changes tempo: **+ Change here** begins a new section on the beat nearest where the sound is, **Remove change** takes away the one it is in; the other tools act on the section the sound is in. |
| One cue to the next without a hole | A group's or a cue's "Fade & stop others", a Fade cue, a playlist group's Crossfade. |

The strip stays quiet until a tool is wanted: one row under the waveform, the extras behind More, and on a sound
with no tempo nothing of bars at all, only "Find the tempo". Loops and moves are running the show and work in Show
mode; keeping a marker and finding or correcting a tempo are edits and wait for Edit mode.

## Every behaviour, and its default

"Switch" is where a person turns it on. "Show" means it is kept in the show file; "computer" in this computer's
`config.json`.

### Sound

| Behaviour | Default | Switch | Notes |
|---|---|---|---|
| Ducking by kind (music and ambience dip under voice and live buses) | Off (`settings.audio.ducking.on`; absent is off) | Settings ▸ Audio; show | Nothing switches it on in a new or imported show (tested). |
| A cue ducking the others while it runs | Off (`duckOthers` 0) | The cue, under More | |
| "Fade & stop others" on a cue or group | Off (0) | The cue, under More | |
| A Fade cue stopping its target when it is done | **On for a fade to silence** (to the show's floor or below, not relative, not a voice-band duck), off for any other; the cue's own "Stop target when done" wins when it is set (`stopTarget`; `cue-types.ts` `stopsTarget`) | The Fade cue's switch | QLab leaves a faded sound playing at −∞ unless asked; an imported QLab fade carries QLab's own setting, so it plays as it did there. |
| Tempo and beat analysis | Never by itself | Find the tempo: Time & Loops, the Playing strip | |
| Finding loops in a sound | Never by itself | Find loops: Time & Loops ▸ Loop regions | |
| Quantise on a group | Off (`onBeat` 'now') | The group, under More | |
| A skip or crossfade from the Playing strip waiting for the bar | Off ("on the bar" unticked; kept by the window, not the show) | The Playing strip, under More | |
| A new long sound put on the Music bus by its length | **Off** (`settings.editing.longSoundsToMusic`) | Settings ▸ Show ▸ Long sounds go on the Music bus; show | A sound added with no bus chosen goes on the bus every Audio cue starts on (Effects, or the show's Audio template). |
| Auto-load (a cue loads the one after it) | Off | The cue, under More | |
| The safety limiter (a ceiling at −0.3 dBFS on each output pair) | **On** (`settings.audio.limiter`) | Settings ▸ Audio; show | It does nothing to sound that would not clip; left for the owner to decide. |
| Level limits (−60 … +12 dB) | On | Settings ▸ Audio; show | A range. |
| The monitor feed | Off | Settings ▸ Audio; show | |
| Reverb and delay sends | Off (no send on any bus) | The bus | |
| Upcoming sounds read into memory ahead of their GO | On | None | This is what makes a GO immediate. |
| A waveform's peaks | Read when a view asks to draw that sound | None | |
| Falling back to the system output when the chosen device goes away | On | None | The alternative is silence. Said in a notice. |
| The native audio engine (`ec-audio`, [18](18-native-audio.md)) | **Off**: Web Audio makes the sound (`audio.engine` 'webaudio', computer). Chosen while something plays, it takes over once nothing does; if it stops three times in a minute, or there is no program, Web Audio plays for the rest of the sitting, said in a notice and the show log | Settings ▸ Audio ▸ Audio engine; computer | The status bar names the engine in use beside the output. |

### The network and other equipment

On a new show **no port is open for listening and nothing is transmitted** until a module is switched on, a
setting asks for it, or a cue that sends is fired.

| Behaviour | Default | Switch | Notes |
|---|---|---|---|
| OSC control (QLab's addresses on 53000, answers on 53001, UDP and TCP) | **Off** (`modules.osc-control.enabled`) | Settings ▸ Integrations ▸ Modules ▸ OSC control; show | A port that runs the show stays shut until it is asked for. One switch opens it, with QLab's port already filled in. |
| OSC control's "no passcode" row (what a sender with no passcode may do) | View and control, **never edit** (with no passcode set; nothing once there is one) | Settings ▸ Integrations ▸ Modules ▸ OSC control ▸ Who may do what (edit takes a passcode with edit access); show | Nobody may edit without a passcode. QLab's no-passcode row is empty by default. |
| OSC control's answers over UDP | Only to a sender that has sent `/connect` (`/connect`, `/version`, `/workspaces` to anyone), at most 32 KB a second to an address | None (over TCP everything is answered) | A forged address is never answered. |
| A show from another computer (not made, saved or turned on here) | **Network features off**: no module, no port, no connection, nothing sent, no device asked, no clock, OSC, MIDI or timecode trigger, no sound on another computer's share opened | The title bar's line ▸ Turn on (remembered for that show on this computer, in config.json `shows`) | |
| The OSC input port (53000) for cue triggers and show commands | Shut. Opens by itself only when the show has an OSC trigger on a cue, an OSC show command, or the OSC control module on | Settings ▸ Integrations ▸ Network ▸ "listen" holds it open to watch what arrives; show | |
| The web remote (HTTP on 8137) | Off | Settings ▸ Integrations ▸ Modules; show | |
| Show feedback (OSC out as cues run) | Off | Settings ▸ Integrations ▸ Modules; show | |
| Lighting desk (OSC to an Eos or grandMA, a ping, a reply port) | Off | Settings ▸ Integrations ▸ Modules; show | |
| Main and backup | Off | Settings ▸ Integrations ▸ Modules; show | |
| The app's own lighting: Art-Net (UDP 6454, with ArtPoll every 3 s) and sACN | Off (`settings.light.on`, and nothing is sent with no instrument patched) | Settings ▸ Integrations ▸ Light; show | |
| Network cues (OSC, text, hex) | Sent when the cue is fired, to its patch. A new show has no patches | The cue | |
| MIDI out (MIDI, MSC, MIDI File cues; MTC) | Sent when a cue that sends is fired | The cue | |
| MIDI in | The computer's MIDI inputs are opened at launch (Web MIDI) and what arrives is shown in the monitor. It acts on nothing until a cue has a MIDI trigger, a MIDI show command is set, or a control is mapped | The cue's Triggers tab; Settings ▸ Integrations ▸ Network ▸ MIDI | Opening the inputs sends nothing. |
| MIDI Show Control in | Off (`settings.midi.mscIn`) | Settings ▸ Integrations ▸ Network; show | |
| Timecode chase (MTC or LTC in) | Off (`settings.timecode.source` 'off'; no audio input is opened) | Settings ▸ Integrations ▸ Network ▸ Timecode; show | |
| Timecode out | Only while a Timecode cue runs | The cue | |
| The stage (video) window | Opened only once a display (or "In a window") is chosen for it | Settings ▸ Integrations ▸ Video; computer | |
| The door for coding agents (a local socket for `bin/ec-mcp.ts`) | Shut | Settings ▸ Assistant; computer | |
| Reports to the service (Help ▸ Report a Problem…; [17](17-service-protocol.md) section 3) | Nothing is sent until the person presses Send. No telemetry and no crash reports. A report that could not be sent is kept on disk and tried again 30 s after the next launch and after 30 s, 2 and 10 minutes, three times at most | The form's Send; the picture, the show's name and the show log's last lines each have their own box (the picture on, the name off, the log off; the log goes as times, kinds, cue numbers and words, with every cue's and file's name taken out, in `context.show_log`) | |
| The Rig page ([15](15-assistant-and-rig.md)) | A view that is always there. It reads what the app already knows; it opens no port and sends nothing. An empty new show has three rows | — | |
| Asking a device whether it is there (one message every 2 s, kept out of the monitor) | A new or an imported show has no devices, so nothing is asked (`settings.rig.devices` is empty; a device's `alive.how` is `none` unless it says otherwise) | A device whose "Is it there" is *Ask it*: adding one is the switch, and the review says "asked every 2 s" | |
| Listening for a device's heartbeat (this opens the input port) | Off | A device whose "Is it there" is *It says so by itself* | |
| Looking for props (one `/ec/hello` to UDP 53100 on each network's broadcast address and on this computer) | Never by itself; never in Show mode, never while a cue runs | *Look for props* on the Rig page; the assistant's `find_devices` | |
| A device command sent more than once (`resend`) | 0: each command is sent once | The device; the prop kit's two models set 3 | |
| The assistant asking a device whether it is there | Off with the assistant | Choosing a provider. Then only a device that is in the show, or a model's own test message to a private address; never a command | |
| The assistant reading files in the show folder | Off with the assistant | Choosing a provider, and then only when asked something that needs it. Never outside the folder, never the show's own files | |
| Writing files into the show folder (prop firmware under `props/`, `AGENTS.md`, `CLAUDE.md`) | Never by itself | Accepting a proposal that lists them. An existing `secrets.h` is never replaced | |
| A new show started from a folder | The folder's sounds are **not** made into cues. The assistant's drawer opens to say what is in the folder, and does nothing until a button in it is pressed | The assistant's first ask, or dropping them on the list | |

### The app itself

| Behaviour | Default | Switch | Notes |
|---|---|---|---|
| The assistant | Off (`provider: 'off'`). Nothing is sent to any service until a provider is chosen and a question is asked | Settings ▸ Assistant; computer | |
| The assistant applying its own proposals | Off (`autoApply`) | Settings ▸ Assistant; computer | |
| Checking for a new version (`core/update/updates.ts`) | **On**, by the owner's decision: once a day, only in Edit mode with nothing playing (a check that is due waits; in Show mode nothing about updates happens at all). The request is one GET of the feed's file (`https://downloads.endlesscues.com/latest-mac.yml`; `latest.yml` on Windows, `latest-linux.yml` on Linux) and sends nothing about the person or the show. A copy run from source never checks | Settings ▸ General ▸ Check for updates automatically; computer (`updates.auto`). Help ▸ Check for Updates… works either way | |
| Downloading and installing a new version | **Never by itself.** A version found is one line in the title bar; it downloads only after Download, installs when the app quits or on Restart now (Edit mode, nothing playing, after the unsaved-changes question). Show mode hides the line and stops a download | The line's buttons | |
| Test versions (the feed under `…/test/`) | Off | Settings ▸ General ▸ Test versions; computer (`updates.test`) | |
| Telemetry, crash reports | **None exist** | — | |
| Timed backups (a copy of the show beside it, while it is changing) | Every 5 minutes, 30 kept (`settings.backup`) | Settings ▸ General; show | A file on this disk, sent nowhere. |
| The playback log (`logs/playback.csv` in the show folder) | Written as cues run | None | A file on this disk. |
| The show log (`logs/<date time>.log` and `.csv` in the show folder; an untitled show's in this computer's `logs/`) | Written as the show runs: every GO and what started it, each cue starting, stopping and fading, the GOs ignored, problems, mode changes, saves. One file a sitting, a new one after 2 MB, the newest 20 sittings kept. Written a moment later in the background, never while a GO waits; nothing that looks like a key or a password | View ▸ Show Log reads it | A file on this disk, sent nowhere. |
| Check the show (Tools ▸ Check the Show, ⇧⌘F; the footer's Check; the Rig page) | Only when asked. It plays nothing and asks no device anything the Rig page does not already ask | — | |
| Run from here (right-click ▸ Run from Here…, Tools ▸ Run from the Selected Cue…) | Only when asked, in Edit mode, after a preview of what it will start; Show mode refuses it | — | |
| Keeping the display awake | On while the app is open | None | |
| Reopening the last show at launch | On | None | |
| Double-GO protection | 0.3 s (`settings.go.doubleGoProtection`) | Settings ▸ General; show | An imported QLab workspace keeps its own value. Left for the owner to decide. It covers every GO (the button and Space, the web remote, OSC, MIDI and MSC GOs, remotes built for QLab), **and a cue's own trigger repeating** (the same hotkey, OSC or MIDI message, clock, cart button or remote start for the same cue within the time); a trigger is not a GO, so it neither locks GO nor is locked by it. Each one ignored is a line in the show log (`core/engine/go-guard.ts`). |
| Numbering new cues; the playhead locked to the selection | On | Settings ▸ Show; show | |
| Cue templates | None | "Start like this one" in the inspector | |
| The side panel's Network section (the last messages sent) | **Hidden** | ⋯ ▸ Network in the Side Panel (also View ▸ Network and MIDI Monitor for the full monitor); this window's storage, per viewer | |
| A list column nothing in the list fills (Target, Pre-wait, Duration, Post-wait) | Not drawn; back with the first cue that has a value. Held as it was through Show mode | None | |
| "Something went wrong. Report it?" in the status bar | On: offered, never sent by itself; a mark only in Show mode | × puts it away until the next | Nothing is sent until Send in the form. |

## Is every integration free?

Yes: **every integration is in the open-source app, with no key, account or licence check anywhere in the code**
(there is no licence, entitlement, trial or "pro" test in `app/`, `core/` or `bin/`). What each needs from outside:

| Integration | In the app | Needs from outside |
|---|---|---|
| Audio to many outputs (buses to pairs, a cue's own matrix, trims, a monitor feed) | Yes | An audio interface. |
| Video, text and camera on a second display | Yes | A display. Codecs are Chromium's: H.264, VP8/9, AV1; not ProRes or HAP (`13-video.md`). |
| Lighting: DMX over Art-Net and sACN, a patch, fixtures, Light cues | Yes | A node on the network. USB DMX widgets are not wired in (the framing is written, `core/light/usb.ts`; nothing opens a serial port). |
| A lighting desk fired from Light cues (ETC Eos, grandMA3) | Yes | The desk. |
| MIDI cues, MIDI Show Control in and out, MIDI File cues | Yes | A MIDI port. |
| Timecode: MTC and LTC, out and in (chase, timecode triggers) | Yes | A MIDI port, or an audio output or input for LTC. |
| OSC out (Network cues, device templates) and in (triggers, show commands) | Yes | Nothing. |
| OSC control with QLab's addresses (remotes built for QLab) | Yes | Nothing. The remote app itself may be paid (Companion and a Stream Deck are someone else's). |
| The web remote (a phone or tablet on the same network) | Yes | Nothing. |
| QLab 4 and 5 import | Yes | Nothing: QLab need not be installed. |
| Main and backup | Yes | A second computer. |
| The assistant | Yes, the whole agent and its tools | **Someone's model.** It runs on the user's own Claude Code or Codex sign-in, their own Anthropic or OpenAI-compatible key, or a local model server. Or the Endless Cues assistant: an account on the Endless Cues service, which holds the model key ([17](17-service-protocol.md)); optional, and not running for everyone yet (the owner may host it if people want it). Nothing contacts the service until a person chooses it. |

Free is not the same as field-tested: much of this has been tried against stand-ins more than real equipment so far.
`CLAUDE.md`'s "Not verified yet" list says exactly what.
