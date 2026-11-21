# 05 · Audio

Source: `app/audio/audio.html` (the player), `app/main/host.ts` (its controller; the native engine beside it is [18](18-native-audio.md)), `core/engine/waveform.ts` (peaks), `core/audio/chain.ts` (a sound's own tools), `core/audio/kinds.ts` (the kinds of sound).

## The signal path

One diagram, source to device. A stage in square brackets exists only for a sound (or a bus) that uses it: a sound with no sound design, no envelope and nothing ducking it is `source ─▶ level ─▶ voice band ─▶ bus`, exactly the wire it has always been.

```
VOICE  (one per playing Audio or Mic cue, or Video cue's sound)

  stream (HTMLAudioElement) ─▶ dip (a streamed move's 30 ms) ────┐
  buffer (decoded) ─▶ sub stage (a move's crossfade, bass swap) ─┤   a move crossfades two sub stages
  microphone (one channel of an input) ──────────────────────────┤   a stream becoming a buffer (`upgrade`) crossfades the first two
                                                                 ▼
 [ SOUND DESIGN  (the cue's `chain` and `eq`; built by core/audio/chain.ts, in this order, each only if on)
     door (cutAt and Stop shut this when the tail is to ring)
     ─▶ high-pass ─▶ low-pass ─▶ eq (4 bands) ─▶ gate ─▶ compressor ─▶ drive ─▶ crush ─▶ pitch shift
     ─▶ chorus ─▶ tremolo ─▶ auto-pan ─▶ stereo width ─▶ delay ─▶ reverb ]
                                                                 ▼
  level (the cue's level, every Fade, a trim) ─▶ [ envelope ] ─▶ [ "others" duck ] ─▶ voice band (a voice-range Fade)
                                                                 ▼
BUS    fader ─▶ (stereo) ─▶ duck ─▶ voice band ─┬─▶ its pair
                                                [ sends ─▶ reverb, delay ─▶ a pair ]
       or, for a cue with outputs of its own: the voice skips the bus's path, is ridden by the bus's level and
       voice-band dip as control signals, and goes channel by channel to the pairs it names

PAIR   (one per pair of outputs in use)      master ─▶ limiter ─▶ meters ─▶ [ per-output trim ] ─▶ device
```

**Where sound design sits, and why.** Between the source and the level. Everything that moves a sound's loudness (its level, a Fade, the envelope, a duck, its bus) comes after its tools, so (1) a fade or a trim never changes how hard its compressor or gate is driven, or how much it distorts: the character of the sound is the same at any level; and (2) a fade takes a reverb's tail down with the sound, as an insert effect on a channel does. And it is after everything that makes the source: a move's crossfade, a loop region, a change of rate and the stream-to-buffer swap all happen before it and it sees one continuous sound.

- **A voice** is created by `play` and destroyed by `stop` or when its file ends. Its level gain carries the cue's level and every Fade aimed at it; fades are linear in dB.
- **The voice band** is a peaking filter at 1.2 kHz (Q 0.6, roughly 400 Hz–3.5 kHz), flat at 0 dB. A Fade with `range: voice` moves this filter's gain instead of the level: the music keeps its bass and its air while speech sits in the gap. There is one per voice (a cue's duck) and one per bus (the ducker's).
- **A bus** has the fader the mixer shows. Bus levels are part of the show; a fader move is heard at once and written to the show when the fader is released (one undo step).
- **The limiter** is a compressor at −0.3 dBFS, ratio 20, 2 ms attack: a safety net so a fader pushed up never clips the PA. The threshold is not −1: mastered music peaks at −0.01 dBFS, and at −1 the limiter audibly worked on every transient of a track playing at its own level. The mixer's LIMIT light says when it is working. It can be switched off per show.
- **Meters** are read after the limiter (what the PA gets): RMS for the bar, 15 times a second.

## Where sound goes

Source: `core/audio/routing.ts` (what the show file says, as data), `patch`, `ride`, `route`, `lay`, `setOutputs`, `setFx` and `setSends` in `audio.html`, `app/renderer/Routing.ts` (the matrix in the inspector, the outputs in Settings ▸ Audio).

```
bus ─▶ its pair of outputs (bus.out) ──────────────┐
cue with outputs of its own ─▶ channel × output ───┼─▶ per pair: master gain ─▶ limiter ─▶ per output: trim ─▶ device
audition (V) ─▶ the audition pair ─────────────────┤
reverb / delay return ─▶ its pair ─────────────────┘
```

**A bus** plays on one pair of the device's outputs (`out` on the bus: 1, 3, 5…). **Each pair in use has its own master gain and limiter**, and the master fader moves all of them. The rest of this section is what a cue, an audition, an effect and an output can do on top of it.

**The rule that holds for all of it:** an output the device does not have is silent, and said (on the bus, on the cue, in Settings ▸ Audio and in the mixer). Nothing is ever moved to outputs 1–2 by itself: a click that fell back into the house would be worse than a click that is missing. An output counts as there when its whole pair is.

### A cue's own outputs (the matrix)

An Audio or Mic cue may carry `outputs`: one row per channel of its sound, each row `{ "<output>": dB }`.

```json
"outputs": [ { "3": 0 }, { "4": 0 } ]          a stereo file on outputs 3 and 4
"outputs": [ { "5": -6 }, { "5": -6 } ]        both channels on output 5 alone (a mono output)
"outputs": [ {}, {}, { "3": 0 } ]              only the third channel of a file, on output 3
```

A silent crosspoint is simply absent; a cue with no rows plays on its bus. The inspector draws it as a grid (More ▸ Own outputs) with a "Send it to outputs…" menu for the plain cases.

**The decision: a routed cue leaves its bus's path but stays under its bus's hand.** A bus here is stereo (its pair is two channels wide), so a matrix cannot be something that happens *after* a bus without the bus becoming a matrix too. The alternatives were (a) QLab's model, where a cue's matrix goes straight to the outputs and there are no buses in the way: then a "Music" fader and the ducker would silently stop applying to any cue that had been routed, which is exactly the kind of surprise a mixer must not have; or (b) making every bus N channels wide, which its pair and its sends have no meaning for. So:

- The sound's channels go, crosspoint by crosspoint, into the **pairs** of the outputs they name, at each pair's input. So the master fader and **the limiter per pair are still the last things every sound meets**, whichever way it came.
- **Its bus still rides it.** Each bus keeps its level as a control signal beside its sound: a steady 1 through copies of its fader and its duck, and its voice-band dip as a second signal in dB (`ride`). Every move of the real ones is made on the copies in the same call. A routed sound passes through one gain driven by the first signal and one voice-band filter driven by the second. A bus fader, a Mix cue and both kinds of ducking therefore move a routed cue exactly as they move the bus.
- **Its bus hears it.** The routed sound is also fed to the bus's meter tap, so the bus's meter shows it and the ducker's key is triggered by it (a routed Mic cue on Vocals still ducks the music).
- **What does not follow:** the bus's own output pair, and its reverb and delay sends. Those shape the bus's stereo pair; a routed sound is not in it. (A cue has an eq of its own; see below.)
- The cue's own level, its fades, its ducks and its `cutAt` are on the voice before any of this and work as they always did.

A change to a cue's `outputs` is heard the next time the cue plays, not on a sound already running. There are no gangs (QLab's linked crosspoints): the "Send it to outputs…" menu covers the common case of setting a whole diagonal at once.

### Files of more than two channels

On a bus, such a file is folded to two channels where the bus's pan meets it (four and six channels by the usual speaker rules; any other count keeps only its first two channels). With `outputs`, **every channel is its own row**: both the streamed and the decoded player carry all the channels as far as the matrix. The host reads a WAV's channel count from its header so the inspector draws the right number of rows (`routing.channels` in the snapshot); for other formats it draws two, and more rows can be written in the show file by hand.

### Audition to its own pair

`settings.audio.auditionOut` (Settings ▸ Audio) names a pair for V. With it set, an auditioned cue's sounds go straight into that pair and nowhere else: past the bus entirely (its fader, mute and ducking do not apply, and it does not trigger the ducker), with the cue's own level and eq. Unset, V plays the cue as a GO would.

The host decides what is an audition (`Audition` in `core/audio/routing.ts`): V marks the cue and everything under it; a sound starting from a marked cue is sent to the pair and its mark is spent. GO, a start, a launch, Panic and Reset clear the marks first, and a mark expires two seconds after the longest pre-wait under the auditioned cue. The bias is deliberate: a sound that was meant for the house must never end up only in the headphones. A cue fired by an OSC, MIDI, clock or hotkey trigger inside that short window, while its own audition is still waiting on a pre-wait, would go to the audition pair; that is the one known gap. There is no "always audition" switch.

### The outputs themselves

`settings.audio.outs` is `{ "<output>": { "name", "trim" } }`. The name is shown where outputs are chosen. The trim is a gain on that one output **after** the limiter, from 0 down to −60 dB and never up, so the limiter's ceiling still holds on every output. An output with no trim has no node in its way, and a show with no trims and everything on 1–2 still takes the plain stereo path.

The level meters for routing are one per output, read at each pair's input (before the master, so a muted test run still reads them): `routing.outCh` in the host's snapshot, drawn beside each output in Settings ▸ Audio.

### Effects: a reverb and a delay

One reverb and one delay per show (`settings.audio.fx`), each fed by sends from the buses (`reverb` and `delay` on a bus, in dB) and each returning on a pair of its choosing. A send is taken after the bus's fader, gate and duck, so a bus that is turned down or muted sends less or nothing. The reverb is a convolution with a generated impulse response (noise decaying to −60 dB over the time set); the delay is one line with feedback.

A bus stays **a plain wire at rest**: a send is a branch off the end of the bus, made only when the bus has one; and neither effect exists until some bus sends to it. They are deliberately small: no pre-delay, tone control or tempo sync, and a routed cue (above) is dry.

**A cue's eq** is one of the stages of its sound design (next section); a cue without one has no filters in its path.

## Sound design: a cue's own chain of tools

Source: `core/audio/chain.ts` (the table of tools, what the show keeps, the node builder, the worklets' kernels, the presets), `design`, `setDesign`, `sweep`, `ring`, `measure` in `audio.html`, `app/renderer/SoundDesign.ts` (the inspector's tab: a rack of devices), `app/renderer/Knob.ts` and `dial.ts` (its knobs and response curves), `core/engine/sound-kinds.ts` (a Fade's sweep).

An Audio cue, a Mic cue and a Video cue (its sound) have two fields, both edited on the inspector's **Sound design** tab:

```json
"chain": { "highpass": { "hz": 300, "slope": 24 }, "comp": { "threshold": -20, "ratio": 3, "attack": 10, "release": 150, "makeup": 2 },
           "reverb": { "size": 0.5, "decay": 2.5, "predelay": 20, "mix": 0.3 }, "tail": true },
"eq":    { "low": -3, "mid": { "db": 4, "hz": 1800, "q": 2 } }
```

`chain` is one object per tool in use, absent for a tool that is not, with every setting of a tool written out (the file says what will be heard, and a later change of a default changes no show). `"on": false` in a tool keeps its settings and takes it out of the path; `"bypass": true` takes the whole chain and the eq out (the tab's A/B switch; a cue left bypassed is flagged); `"tail": true` is "let the tail ring". The tools always run in the one order below, whatever order the file lists them in. There is no reordering: the order is the one a channel strip has, and a fixed order is what lets a tool be switched in without anything else moving.

| Tool | Settings | Made of | A change on a playing sound |
|---|---|---|---|
| `highpass`, `lowpass` | `hz`, `slope` (12, 24 or 48 dB/oct) | 1, 2 or 4 biquads in a Butterworth cascade | `hz` glides; a slope rebuilds |
| eq (the `eq` field) | `low`, `mid`, `mid2`, `high`: a dB number, or `{ db, hz, q }` | a low shelf (250 Hz), two bells (1 kHz, 3 kHz, Q 0.8), a high shelf (4 kHz); only bands that are not 0 dB | glides; a band added or removed rebuilds |
| `gate` | `threshold`, `range`, `attack`, `hold`, `release` | a worklet (`Dynamics`, gate mode). A range above −80 dB is a downward expander | at once |
| `comp` | `threshold`, `ratio`, `attack`, `release`, `makeup` | a worklet (`Dynamics`, comp mode): 6 dB soft knee, channels linked | at once |
| `drive` | `db`, `tone`, `out` | a tanh waveshaper, 4× oversampled, then a low-pass | `tone` and `out` glide; `db` rebuilds |
| `crush` | `bits`, `hz` | a worklet (`Crusher`): rounding, and sample-and-hold with no filter | at once |
| `pitch` | `semitones`, `cents` | a worklet (`PitchShifter`) | at once |
| `chorus` | `rate`, `depth`, `delay`, `feedback`, `mix` | a delay line swept by an oscillator (2 ms and feedback: a flanger) | glides |
| `tremolo`, `autopan` | `rate`, `depth` | an oscillator on a gain, or on a panner | glides |
| `stereo` | `width` (0 mono, 1 as recorded, 2 wide), `invert` | a mid/side matrix of four gains | `width` glides; `invert` rebuilds |
| `delay` | `time`, `feedback`, `tone` (a low-pass in the loop), `pingpong`, `mix` | one delay line with feedback, or two feeding each other | glides; ping-pong rebuilds |
| `reverb` | `size`, `decay`, `predelay`, `mix`, `file` | a convolver with a generated impulse response (six first reflections spread by `size`, then noise from a fixed seed falling 60 dB over `decay`, darker as it goes), or with an impulse-response file from the show's media | `predelay` and `mix` glide; `size`, `decay` and `file` rebuild |

"Glides" is a 20 ms ramp of the node's parameter (a frequency along a ratio). "Rebuilds" means a new chain is built and the sound is moved over to it at once (`setDesign`): it is heard immediately, a click is possible, and a reverb or delay that was ringing is cut. A tool switched on or off is a rebuild, including the first tool switched on for a sound that was playing as a plain wire (its sources are re-plugged into the new chain: `feeders`). The host sends the change whenever an edit changes a playing cue's `chain` or `eq` (`sendDesigns`).

**The tab.** A rack of devices, as a channel strip or a DAW draws one: only the tools in use, left to right in the order they run, the eq after the filters. "+" lists every tool, lightly grouped, and adds the one chosen with its defaults written out; a tool already in the chain is not offered twice (the chain holds one of each). Since the order is fixed, a device is placed where it runs, wherever it was added, and there is nothing to drag. Each device has a power button (off: `"on": false`, settings kept; a knob turned on a device that is off leaves it off), up to four knobs on its face and the rest behind ‹ ›, its choices (a slope, ping-pong, invert) as small buttons, and × to remove it from the cue. A filter and the eq draw their response curve. The eq device shows one band at a time (Low, 1, 2, High: gain, frequency and, on a bell, Q); it has no power button, since the eq has no switch in the file: a band at 0 dB is out of the path, and × takes the eq off the cue. Presets, Bypass and Tail are in the tab's header. A knob's turn is one edit when the button is let go (the wheel's, once it rests), so a drag is one undo step and a playing sound hears the result, not the drag.

**The eq has four bands** (`low`, `mid`, `mid2`, `high`). A band that sits at its usual place is written as a plain dB number (`{ "low": -6, "high": 2 }`), and as `{ db, hz, q }` once it is moved. It sits in the chain before the level.

**Why the compressor is a worklet.** Web Audio's `DynamicsCompressorNode` only compresses, has no make-up control, and applies an automatic make-up gain of its own that cannot be switched off (a sound under the threshold comes out louder). So the gate and the compressor are one small kernel (`Dynamics`) run in an AudioWorklet, and the same class is run by the unit tests in Node. The crusher and the pitch shifter are worklets for the same reason: the tests measure the code that plays. The worklet module is added to the context once as the audio window starts; a sound that asks for one before it has loaded plays without that tool and says so in the log.

**The pitch shifter** is a time-domain one: the sound is written into a short memory and read back faster or slower; when the reader must jump to stay inside the memory it jumps by the lag at which the sound just played most resembles itself (a whole number of periods of a pitched sound), found to a fraction of a sample, and crossfades over 12 ms. The measure it is kept by, which the unit tests and the smoke run both check: a steady tone (pure, or with six harmonics; 110 Hz to 5 kHz; −12 to +12 semitones) comes out within 10 cents of the pitch asked for (measured: within 5), and its level does not move by 1 dB from one 20 ms to the next (measured: under 0.5 dB). What that measure does not cover: dense music and noise have no single period, and the splices will be heard as a roughness; nobody has listened to it on speech. It delays the sound by up to 45 ms. `rate` (the Audio tab) remains the tape way, where pitch and speed move together.

**Reverse is not built.** It needs the whole file decoded before the cue can start (a stream cannot be played backwards), a second copy of it in memory, and the engine's clock, the waveform, the markers and the loop regions all told that time runs the other way. Reverse the file in an editor.

### Letting the tail ring

With `tail` on (it can be switched on only while a reverb or a delay is), what the reverb and the delay still hold is heard after the sound itself has gone. What each way of ending a sound then means:

| The sound… | With `tail` |
|---|---|
| reaches its end, or its **End at** (`cutAt`) | The source ends; the tail rings out. `cutAt` shuts the chain's door (its first gain) instead of the level, so the cut is as exact as without a chain and the reverb is not cut with it. |
| is stopped (a Stop cue, the ■ beside it, a restart of the same cue) | The door shuts over 5 ms, the source is stopped, the tail rings out. To the engine the cue has stopped at once: it is not running, a follow-on is not delayed, and the cue can be started again over its own tail. |
| is on a bus that fades its stops, or is faded out and stopped (a Fade with "stop target", fade & stop others, the first Panic) | **The tail fades with the sound.** The level is after the chain, so the fade takes down source and tail together; when the stop comes there is nothing left to ring. |
| is caught by the second Panic, or Reset | Everything stops dead, tails included (`stopAll`). |
| is paused | The source pauses; whatever is in the reverb and delay rings out and is gone when it resumes. |

A ringing tail is a voice of its own in the audio window (`tail:…`), with the sound's level, envelope, bus and outputs still in its path, for the tail's length: the reverb's pre-delay and decay, or the delay's repeats down 60 dB, capped at 30 s (`plan().tailSecs`; six seconds for an impulse-response file, whose length is not known to the host). A change of the bus fader, a mute, the master and the ducker still move it. A Fade cue cannot reach it (it is no longer the cue's sound).

### A Fade that moves a tool

A Fade cue's **Sound design to** (`chainTo`: `{ "lowpass": { "hz": 400 } }`) moves settings of its target's chain over the Fade's duration, beside whatever it does to the level: "fade this cue's low-pass from where it is to 400 Hz over 8 s". Only settings that glide can be moved (the table above; `SWEEPABLE`), and only on a tool that is already on in the target: a sweep cannot switch a tool in. To have a filter to close, switch the low-pass on at 20,000 Hz, where it changes nothing. The Fade's inspector warns when its target has no such tool. Limits, stated: the sweep is a straight ramp (a ratio for a frequency), not the Fade's shape; it is not held by Pause and not undone by Revert fade; an edit to the target's chain afterwards puts the chain back to what the cue says.

### Presets

Applying a preset writes its `chain` and `eq` onto the cue, where every number can then be changed; nothing links the cue to the preset afterwards. None is ever applied by itself. Built in (`PRESETS`): Voice (a high-pass at 80 Hz and a light compressor), Phone, Radio, Next room, Underwater, Cathedral (with its tail on), Old record, Lo-fi. A show keeps its own in `settings.audio.chains` (`{ "<name>": { chain, eq } }`), saved from the tab. The numbers in the built-in ones are a designer's starting points written from the textbook, not tuned by ear.

### How it is checked, and what that is worth

**So far this is checked by measurement more than by ear.** A test run plays to no device. Each tool is measured instead, two ways:

- The kernels (gate, compressor, crusher, pitch shifter) are run on synthesised signals in the unit tests (`test/chain.test.ts`): a tone 12 dB over a 4:1 threshold comes out 9 dB down; a transient is let through for the attack; the gate is shut, open, held and shut again; the shifted tone's pitch and steadiness.
- The built chain is rendered offline in the audio window (`measure`: the same `Chain.build`, on an `OfflineAudioContext`, a synthesised signal in, levels and a pitch out) by the smoke run (`app/main/smoke-sound.ts`): 100 Hz and 5 kHz through a high-pass, the slopes, the old and the new eq, a step through the compressor, an impulse through the reverb for its decay and pre-delay and through the delay for its repeats and its ping-pong, a tone through the pitch shifter, tremolo's swing, auto-pan's sides, width 0 as mono, a sweep.

That shows each tool does what its numbers say. It does not show that any of them sounds good, that the generated room is a pleasant one, that the presets are well chosen, or that a rebuild's click is acceptable in a show.

**Not built:** the same chain on a bus (the show-wide reverb and delay take sends from buses); reverse; side-chain anything; a meter for the compressor's gain reduction (the worklet reports it and nothing draws it); reordering the tools; overlapping plays of one cue (below).

## The kinds of sound

Source: `core/audio/kinds.ts` (kinds, ducking rules, where the speech is, the guess), `core/engine/sound-kinds.ts` (what a kind asks of a stop and a start), `setDucker` and its tick in `audio.html`, `app/renderer/Kinds.ts` (Settings ▸ Audio, the chooser).

A bus has a **kind**: `music`, `voice` (recorded dialogue and voice-over), `effects`, `ambience` (beds and loops) or `live` (microphones). A new show's three buses are music, effects and voice. The kind is `kind` on the bus, chosen in Settings ▸ Audio ("What each bus carries").

**The rule for all of it: the default is simple. A kind is a label, and nothing happens to a sound because of its kind unless a person switched that thing on.** A new show, and a show brought in from QLab, play as a plain cue list: nothing ducks, a stop is a cut, sounds on a bus overlap, a new sound is not listened to, no chain is put on anything. Each behaviour a kind could bring is a switch, off, written on the bus or in the show where it can be seen. The table says what each is, where it lives, and **which switch turns it on**:

| Behaviour | Off by default; turned on by | Lives on | What is suggested | What it does |
|---|---|---|---|---|
| Ducking by kind | Settings ▸ Audio ▸ the **Ducking** switch (`ducking.on`) | the show: `settings.audio.ducking` `{ on, threshold, by, under }` | `by: [voice, live]`; `under.music` −8 dB, 0.05 s down, 0.5 s wait, 1 s back, voice band only; `under.ambience` −4 dB, 0.1 / 0.5 / 1.5 s; effects not ducked | Every bus of a kind in `under` dips while any bus of a kind in `by` sounds. |
| Look-ahead for a recorded voice | the same switch (it is how ducking by kind treats a sound whose speech is known; with ducking off nothing is read) | nowhere | | The dip starts an attack time **before** each stretch of speech and is let go 0.15 s after its last word. See below. |
| A stop that fades | a time typed in the bus's **A stop fades over** box, or **Use suggested** | the bus: `stopFade` (s) | music 1.5, ambience 2 | A Stop cue or the operator's stop of a sound on the bus fades it out over this and then stops it. Panic keeps its own fade; the second Panic, Reset, and a second trigger of "Stops it" still cut. |
| One at a time | a time typed in the bus's **One at a time, over** box, or **Use suggested** | the bus: `oneAtATime` (s) | ambience 3 | A sound starting on the bus fades out whatever else is playing on it over this long (and stops it), and comes in over the same time unless it has a fade-in of its own. With nothing playing there it starts as it is. |
| Left alone by "Duck others while running" | the bus's **Never ducked** switch, or **Use suggested** | the bus: `noDuck` | live | A sound on the bus is not one of "the others" a cue ducks. |
| A new sound put by its kind (and an ambience one added as a loop) | Settings ▸ Audio ▸ **Sort new sounds by kind** | the show: `settings.audio.sortNew` | | Each sound added with no bus chosen is listened to and put on the first bus of the kind it sounds like, and every guess is shown. See below. Off, nothing is listened to and no analysis runs. |
| A gentle voice chain | the **Use the Voice chain** button on a cue's Sound design tab | the cue (`chain`) | voice, live | A cue on such a bus, with no chain, is shown the offer in one dim line. It is never applied by itself. |
| Tempo, beat grid, loop regions, vamps, jumps | whoever asks for them, per cue | the cue | | Not tied to a kind at all. |

**Use suggested** (one button per bus) writes what the table suggests for the bus's kind onto the bus (`withSuggested`), where the three settings can then be changed or switched off again. Choosing a kind does not press it.

Separate from kinds: Settings ▸ Show ▸ **Long sounds go on the Music bus** (`settings.editing.longSoundsToMusic`, off) puts a sound of half a minute or more, added with no bus chosen, on the Music bus, and the notice says so.

**Cue, bus or show?** Ducking is the show's (it is a relation between kinds, and one place to see it is better than a setting per bus). A stop that fades, one-at-a-time and never-ducked are the bus's (they are about what else is on that bus, and a designer with two music buses may want them different). Loop, the transcript, the chain and the speech map are the cue's (they are about that one sound).

**A new show has none of it.** It has no `ducking`, `stopFade`, `oneAtATime` or `noDuck` until a person writes them; opening a show adds none (`defaultSettings` has none). A show with no `ducking` reads as the defaults above, off (`duckingOf`). A bus with no `kind` is effects (`kindOf`); a bus added in Settings ▸ Audio is made with `kind: 'effects'`. "A new show plays as a plain cue list" in `test/kinds.test.ts` holds it (every behaviour above off, a Stop that cuts, two sounds on a bus overlapping).

### Ducking by kind, and look-ahead

With ducking on (it is off until switched on), the host turns the show's ducking into rules, one per bus that dips (`duckRules`: `{ target, keys, threshold, depth, attack, hold, release, range }`), and the audio window runs them thirty times a second, each with its own state. A bus that is listened to never dips (a kind does not duck under itself).

A level-keyed ducker reacts after the voice has started: the first syllable lands on full music. For a **recorded** voice that is unnecessary, because where it speaks is known before it plays. When a sound starts on a bus the ducker listens to, the host reads its speech from the waveform it already draws (`speechSpans`: the slices within 30 dB of the file's loud level and above −55 dBFS; stretches less than 0.6 s apart are one, so the music does not pump between words; under 80 ms is a click, not a word) and sends it with the `play` (`speech: [[from, to], …]`, seconds into the file). In the audio window a voice with a speech map is never listened to: each tick asks where it is in its file and whether a stretch of speech begins within the rule's attack time, so the dip is **down as the word starts**, and the bus comes back 0.15 s after the last word instead of waiting out the hold. Because it asks where the sound *is*, a pause, a skip, a loop and a change of rate need nothing special.

The keyed ducker is still what a microphone gets, and what a recorded voice gets when its waveform has not been read by the time it starts (a compressed file on its first play: the audio window decodes it, and the next play has the map), or when a sound with no map is on the same bus at the same moment. A cue auditioned to its own pair is not ducked for.

Limits, stated: the map is from level alone (a loud breath or a music bed under the voice counts as speech); it is read at the waveform's resolution (8,000 slices: 4 ms for a half-minute line, a quarter second for a half-hour one); it ignores the cue's sound design (a gate would change where it speaks) and its level; and nobody has heard whether an attack of 50 ms ahead of the word is the right lead.

### Where a new sound lands

With **Sort new sounds by kind** on (`settings.audio.sortNew`; off by default, and off nothing below happens: no decode, no tempo analysis, no chooser), a sound added with no bus chosen (a drop on the list, File ▸ Add) is **listened to first**: the audio window decodes it small (mono, 11 kHz, the reading its tempo is found in) and `guessKind` reads six things from it (`featuresOf`): its length, how much of it is sounding, its pauses per minute, how far its level swings, how much of its energy is below 150 Hz and above 250 Hz, and whether it has a steady tempo. The rules, in order:

1. Nothing in it, or under 1.5 s: **effects**.
2. A steady pulse (a tempo found, eight seconds or more of it): **music**.
3. Pauses like speech (six or more a minute), a level that swings (5 dB or more), almost nothing under 150 Hz and most of it above 250 Hz: **voice**.
4. Under 15 s: **effects**.
5. Twenty seconds or more, sounding nearly all the time, steady in level (under 4 dB of swing): **ambience**.
6. Half a minute or more: **music**; otherwise effects.

It goes on the show's first bus of that kind, or on the cue's usual bus if the show has none. **The guess is always shown.** One sound: the notice says which bus and why ("it sounds like music (a steady pulse, 120 bpm)"). A guessed ambience on an ambience bus is added as a loop. Several: a chooser lists each file, what it was taken for and why, and its bus as a menu to change, with a loop switch (`state.added`; `AddedChooser`). A template that names a bus for new Audio cues is kept over the guess, and the chooser says so. A sound that cannot be read within fifteen seconds is added with no guess.

The rules are tested on synthesised signals only (`app/main/test-signals.ts`: syllables in phrases, a kick and a chord at a tempo, a hit of noise, steady filtered noise). They have not been run on a real voice-over, a real song or a real rainstorm. Expect a rhythmic speech to be taken for music (rule 2 comes first), a voice over a music bed for music or ambience, and a rubato piano for ambience: which is why it is a guess with a menu beside it.

### A voice-over's words

An Audio cue has a **Transcript** (`transcript`, under More on its Audio tab). It is shown in the masthead while the cue stands by ("IT SAYS") and, when the cue standing by has none, for the voice that is playing ("SAYING"), so the operator can follow the line. There are no markers per sentence and the text does not scroll with the sound: not built.

### Not built, of what the kinds could do

- **Overlapping plays of one cue** (an effect fired again while it is still sounding, both heard). A cue is one voice here: the engine, the audio window and the playhead all key a sound by its cue. Today a second GO restarts it, or does what its Second trigger says. To overlap, copy the cue.
- A kind is not a **Mic cue's latency** fix: a live input still goes through the browser's audio path, unmeasured (see "Where this has to go").
- Ducking that reads a voice's **sound design** or follows a **live** voice ahead of time (it cannot).
- Markers per sentence, and a transcript made from the sound.

### None of this has been heard

All of the above is checked in the test run only: a context with no device, pretending to have eight outputs, read by meters. It has not been played through a real multi-output interface, so channel order on a real device, the behaviour of a device with an odd number of outputs, and the sound of the reverb and delay are unverified.

## More than one output device (not built, and why)

Web Audio gives one output device per `AudioContext` (`setSinkId`), so a second device means a second context. That can be made, and it is the right way to do it; what cannot be made honest today is the claim that goes with it.

- **Two devices are two clocks.** Each context runs on its device's sample clock, and two interfaces that are not word-clocked together drift apart: tens of parts per million is ordinary, which is tens to hundreds of milliseconds over an hour. Two *separate* sounds on two devices do not care. One sound *split* across two devices (left on one, right on the other, or the same track to the house and to a second system) slowly comes apart, and nothing in Web Audio lets the app measure or correct that.
- **Carrying sound from one context to another** (a `MediaStreamAudioDestinationNode` into a `MediaStreamAudioSourceNode`) puts a buffer of unknown and varying length between them and resamples to hide the drift. Its delay would have to be measured per machine to be stated, and it could not be relied on to stay put. So a bus cannot simply be "sent" to the other device.
- **The design that works** is for a bus to belong to a device: its voices are created in that device's context, with that context's own pairs, limiters and meters. Everything in `audio.html` assumes one `ctx` and one clock (`ctx.currentTime` is in every fade, loop, move and cut), so this is a rewrite of the player around a per-device object, not an addition, and another agent's work on fades and rate is in the same functions at the time of writing.
- **It cannot be checked here.** The test run opens no device at all, and the development machine is not to make sound. A second device that had never been opened would ship on trust.

What is worth building first when it is done: **audition on a second device** (headphones on the computer's own output while the show plays on the interface). It needs no synchronisation at all, is the most common reason to want two devices, and its failure is harmless. After that, a device per bus, with the manual saying plainly that two devices are not sample-locked. Until then: one device, and as many of its outputs as it has.

## A bus's level from a Mix cue

A Mix cue moves bus faders over its `duration` (`levels: { <bus>: dB }`). The host keeps where a cue has taken each bus (`mixLevels`) over the show's own fader until Reset, opening a show, or a hand on that bus's knob, and the mixer shows such a bus as `·mix`. A playing sound's level from the Playing strip (`op: 'level'`) is for that playing only.

A loop of any stretch of a playing track (`toggleHold(id, region, free)`: the Playing strip's loops, drawn or from here) is held whether or not the cue declares it as looping cleanly. With no beat grid it wraps wherever it was asked to.

## Tempo

`core/audio/tempo.ts` finds a steady track's tempo from its sound: an onset envelope in three bands, its autocorrelation for the period a person would tap, then every tempo within 2 % tried against the whole track so the answer does not drift. It returns the bpm, where a beat falls, a confidence, and the other readings worth offering (half time; a dotted reading such as 76 for 114), because which of those is "the" beat is a person's call. Below `MIN_CONFIDENCE`, or when the pulse does not hold sixteen beats on, the answer is "none": pads, rain, rubato, speech.

**Sections.** A tempo may change within a track: `tempo: { bpm, first, bar, sections: [{ from, bpm, first, bar }] }`. The top is the section from the start of the file; each later section has its own tempo, its own bar line (`first`) and its own beats in a bar from `from` on, so a change of time signature is a section too. `gridOf` lays every section's beats and bar lines end to end, and that one grid is all the engine reads, so quantise, loops in beats and the bar counter follow the section the track is in with no code of their own. `tempoMap` finds sections: where `tempoOf`'s grid does not hold, each stretch of sixteen seconds or more is listened to by itself, two stretches on one grid are joined (a breakdown does not make a section), and the hand-over between two tempos is placed on the beat before which the onsets sit on the first grid and after which on the second. It cannot hear a ritardando or a tempo kept for under sixteen seconds; those are marked by hand. `editTempo` is the hand: a section's bpm or bar, a nudge, "1 is here" (the beat nearest a place becomes beat one of its section's bar), a new section on the beat nearest a place, a section taken away. Beat one is never guessed.

**A sound at another rate.** An Audio cue's `rate` (a Fade can move it) re-pitches it: a stream's `playbackRate` or a buffer source's; with `preservePitch` it is the browser's own stretch, which only a stream has, so such a sound is never played from a buffer. The engine keeps a running sound's `rate`: places stay in the file's seconds, and every wait derived from one (its end, a fade-out's start, the next bar) is divided by it. A sound stretched with its pitch kept cannot be held in a section, looped, or moved inside itself (a Jump, Fade to): those are timed to the sample, and are refused with a line in the log.

The audio window decodes the file to mono at 11 kHz (`op: 'pcm'`) and the host does the arithmetic (about half a second for a ten-minute track; it runs when asked, not during a GO). What is found is kept only when the operator asks: `tempo: { bpm, first, bar }` on the Audio cue, where `first` is the time of a downbeat. The engine makes its `beats` and `downbeats` from that (`gridFromTempo`), which is what a quantised GO, a move on the bar and a loop in beats read. It hears a pulse, not a bar: whether `first` is beat one is set by hand ("1 is here"), as are the beats in a bar.

## Streams and buffers

Most sounds **stream** from disk through an `HTMLAudioElement`: a show's worth of decoded audio would not fit in memory, and a stream starts instantly.

A sound that must loop to the sample, or be moved inside itself, plays from a **decoded buffer** (`AudioBufferSourceNode`): only a buffer has `loopStart` / `loopEnd` and a clock exact enough to cross-fade two places in one file. The host decodes ahead of need: whatever is playing and whatever the next GO would play (`engine.wantedFiles()`), and lets go of the rest. If a GO arrives before its decode has finished, the voice starts as a stream and is swapped to the buffer when it lands (a 30 ms crossfade at the same position); from then on holds and jumps are exact. A voice reports which it is (`exact`), and the engine only offers a hold on an exact one.

**Moves** (a Jump cue) happen inside the voice: a second source starts at the landing point and the two are cross-faded by their own sub-gains (equal-power for a fade, equal-gain for a few-millisecond cut, and for a `dj` blend a low shelf swaps the bass from one to the other on the downbeat). The voice's level, its ducks and its bus are untouched, so a track that was trimmed, ducked and half-faded stays exactly so across the jump.

## What is exact and what is not

| | Accuracy |
|---|---|
| A hold's loop points, a jump's crossfade, `cutAt` on a buffer voice | Sample-exact (scheduled on the audio clock) |
| A fade's shape | Sample-exact once started |
| The moment a GO's sound starts | A few milliseconds: one IPC hop from the engine to the audio window, then the audio callback. Not sample-synchronous between two cues fired by one GO. |
| A quantised GO (`onBeat`) | The engine waits on its own clock for the downbeat; a Jump is handed to the audio window a quarter second ahead and lands on the sample. A plain Audio cue started "on the bar" lands within the IPC hop. |

That third row is the honest limit of this design, and the reason for the next section.

## Where this has to go

Web Audio in a hidden window has played a real show, and it gives decoding, mixing, device selection and metering on three platforms with no native code. It cannot do the following, each of which a serious sound show eventually needs:

1. **More than stereo, properly.** The web engine has a per-cue matrix (file channel × output), named and trimmed outputs and bus sends to two effects (see "Where sound goes"), none of it yet heard on a real interface. Still missing: output patches as a layer between cue outputs and device outputs, per-output delay or EQ, gangs, more than one device, and any control of the device itself.
2. **Sample-synchronous starts** across cues, and scheduling against timecode.
3. **Plugins** (VST3 / AU / LV2).
4. **Device control**: sample rate, buffer size, ASIO on Windows, JACK/PipeWire on Linux, surviving a device change without a glitch.
5. **Live inputs with low, known latency** (Mic cues).

The plan ([12 · Roadmap](12-roadmap.md)) is a native audio engine (Rust, `cpal` for devices) as a sidecar process speaking the same small command set the audio window speaks today (`play`, `fade`, `stop`, `seek`, `move`, `region`, `bus`, …). The engine and host do not change: the audio backend is already an injected interface. The Web Audio player stays as the fallback and as the thing that runs in a browser for a hosted demo.

Its first version is built and off by default: [18 · The native audio engine](18-native-audio.md) (Settings ▸ Audio ▸ Audio engine). While it is chosen this window still runs, for MIDI and for reading a file's peaks and samples.

Until then, 0.1 says plainly: one output device; any number of buses, each on a pair of its outputs; a cue may be sent to outputs of its own; and all routing beyond 1–2 is checked by meters in a test run, not yet by ear.

## Fade shapes

A fade moves a level from where it is to where it is going; its **shape** says how far along it is at each moment. `core/audio/curves.ts` is the arithmetic: `linear` (a straight line in dB, which is what every fade was before shapes and is still the default, written as nothing), `s-curve` (a raised cosine: it eases out of the start and into the end), `fader` and `fader-linear` (the same two, along a mixing desk fader's travel instead of along the dB), or a custom shape, points `[[x, y], …]` from (0, 0) to (1, 1) joined by straight lines. A Fade cue has `shapeUp` and `shapeDown`: the engine picks by whether the level it is asking for is above or below where the sound is. An Audio cue has `fadeInShape` and `fadeOutShape`.

The two on a fader are QLab's own fade shapes (its default S-curve and its linear curve, in its default "slider" domain), and a QLab Fade cue imports with them. A fader's travel is taken as the gain to the power 0.36 (`FADER_POWER`), which matches what QLab 5.6.3 plays to within 0.1 dB between 0 and −20 dB and 0.25 dB on a fade to silence (measured through a digital loopback). On a fader a fade down holds up longer and falls away at its end (a fade from 0 dB to silence is at −15 dB halfway, where a straight line in dB is at −30), and a fade up rises quickly and settles. How far along that is in dB depends on the two levels, so the engine turns the shape into points for the fade it is starting (`faderPoints`, from the level the sound is at or on its way to), and the backends play those points like any custom shape.

The engine passes the shape with the fade (`audio.fade(key, db, secs, range, shape, from)`); the host turns it into 65 evenly spaced readings (`progressOf`) and the audio window interpolates dB along them into the one `setValueCurveAtTime` it already used. A paused fade is taken up along what is left of its shape (`from`). Other than the two on a fader, a shape is applied in dB: there is no choice of QLab's other domains (dB, linear).

## Lines over a sound (automation)

A sound's volume, its pan and the settings of its sound design can each be drawn as a line over its length, as the lanes of a DAW. `core/audio/lanes.ts` is the arithmetic, loaded by Node, the audio window and the main window alike.

**What a cue keeps.**

| Field | What it is |
|---|---|
| `envelope` | The Volume line: `[[seconds into the file, dB], …]`, added to Level and to whatever fades it. |
| `pan` | The cue's pan, −100 (left) … 0 … 100 (right). A field on the Audio tab (and on a Mic cue). |
| `automation` | Every other line, by lane id: `{ "pan": [[t, −100…100], …], "chain.<tool>.<setting>": [[t, value], …] }`. |

A point is `[t, value]` or `[t, value, bend]`: the bend (−1 … 1, none = straight) shapes the line from that point to the next; above 0 it starts slow, below 0 fast (`bend(x, c) = (e^{4cx} − 1)/(e^{4c} − 1)`). Before the first point and after the last the line holds. An envelope written before lines had bends is the same straight lines in dB, read and played exactly as before (`test/lanes.test.ts` holds the old reading against the new one).

A `pan` lane replaces the Pan field while it has points; a `chain.<tool>.<setting>` lane replaces that knob. Only a setting that glides can have a line (`SWEEPABLE` in `core/audio/chain.ts`: a filter's frequency, a mix, a time…); one whose change rebuilds the chain (a slope, a reverb's size and decay, a drive's amount) cannot, and nor can the cue's eq bands. A lane for a tool the chain does not have does nothing; removing a device in the window removes its lanes in the same edit. Between points a setting moves along its knob's scale (`app/renderer/dial.ts`: a frequency along a ratio, so a straight line from 200 Hz to 2 kHz passes 632 Hz half way); Volume moves in dB and Pan in its own units.

**Pan** is equal power: each side's gain is √2·cos θ and √2·sin θ for θ = (pan/100 + 1)·π/4, so at 0 both are exactly 1 (an unpanned sound is untouched, and has no pan stage at all) and a sound at either side has the power it had in the middle. A stereo sound is balanced (each side by its gain), as a DAW's stereo pan is. A sound sent to outputs of its own is not panned: its matrix already says where each channel goes. A QLab Audio cue whose crosspoints only share its sound between outputs 1 and 2 (a mono file to both, or a stereo file's left to 1 and right to 2, each at a level of its own) is imported as a pan on its bus, with what is left over on its level (`panOfMatrix`, `core/import/qlab.ts`).

**Playing.** In the voice, the Volume line is a gain after the level (`env`) and the pan a stage after that (two gains on a splitter and a merger); a setting's line moves its tool. Every line is read at a place **in the file**, never at a time since the GO. Thirty times a second each is scheduled for the next 60 ms as straight ramps 10 ms apart, each ramp ending at the value drawn where the sound will be at that moment (a buffer's place from its own clock, through any ramp of its rate; a stream's from its element). So:

- a line inside a held loop region goes round with it, and a loop of the whole file plays the whole line again each pass (`Lanes.wrap`);
- a skip, a pause (the lines hold where they are), Rate, Load to Time and **Run from here** need nothing worked out again: a sound brought back part way in starts with each line where it is at that place, and its chain is built with each automated setting already there (`chainAt`);
- a Fade still moves the Level, which the Volume line rides on, as before; a Fade's `chainTo` of a setting that has a line is overridden by the line at its next reading;
- a line edited while its sound plays is sent to the audio window (`lanes`) and heard at once.

A corner of a line lands within about 10 ms; a bend is followed as a curve in 10 ms steps. A worklet's setting (a gate's, a compressor's, the crusher's, the pitch shifter's) steps at the 30 readings a second; a filter's frequency, a mix or a delay time glides between them.

**Drawing.** Time & Loops draws the line chosen in its lane picker (Volume, Pan, and each such setting of each tool on the cue; a dot marks a line with points), the others faint behind it. A click on the line adds a point there; points drag in time and value together (time snaps lightly to markers, bar lines, beats, Start and End; Shift is fine and does not snap); ⌘-drag selects a box of them to move or Delete together; ⌥-drag on a stretch bends it; a double-click removes a point. The value and time show while dragging. The Playing strip under the list draws the Volume line, read only. A knob with a line shows the line's value (where the sound is, else at its Start), carries a small ∿, and turning it moves the whole line by as much along its scale. In Show mode the lines are drawn and nothing moves.

**Finding loops.** Time & Loops ▸ Loop regions ▸ **Find loops** listens to the sound (decoded as for the tempo) and adds up to four loop regions that go round cleanly, named by their length ("8 bars"), as one edit (`core/audio/loops.ts`, `test/loops.test.ts`). A loop is played by jumping from its end back to its start, so it is seamless when the sound either side of its two ends is alike: each candidate is scored on twelve pitch classes and six bands of colour a beat either side, and on level, its worse side counting. With a tempo (the cue's, or one found for the purpose and not kept) the candidates are 2, 4, 8 or 16 bars from bar line to bar line, six seconds at least; without one, 4, 8 or 16 seconds from any quarter second. The sound is cut into four stretches and each offers its best, so the loops are spread over it; none overlaps a region the cue already has. Measured on made tracks and on a few real ones (whole bars of a repeating part found, nothing in a part that does not come back); its picks on three real tracks (twelve loops, played round three times with hard cuts) were listened to and judged good; a wider range of music has not been tried. It does not move a loop's end to where the waveform lines up, as a sample editor would.

**Markers and loop regions on the waveform.** Above the waveform on Time & Loops, the marker strip: a marker drags along it (snapping lightly to bar lines, beats, Start and End; Shift: fine), a double-click on its name renames it in place, an ⌥-click (or selecting it and Delete) removes it, and a drag on an empty part of the strip, or right-click ▸ Add marker here, makes one. Above that, the loop lane: a region's edge drags that edge, its middle moves it whole; a click (no drag) still holds it while it plays. Each is one edit (`markers`, `loops`). The arithmetic is `app/renderer/edit-math.ts` (`test/wave-edit.test.ts`). The Live view and the Playing strip draw the same `markers` and `loops`; the Live view's tempo **sections** (`tempo.sections`, where the tempo or the bar changes) are something else, a part of the tempo map, made and taken away with its "+ here" and Remove, and not dragged.

## Rate

An Audio cue's `rate` (0.25 to 4; 1 is as recorded) is how fast it plays. What Web Audio can do depends on how the sound is played:

| | A decoded buffer | A streamed element |
|---|---|---|
| Rate, pitch moving with it (a tape) | Yes: `AudioBufferSourceNode.playbackRate`, exact, and a ramp of it is on the audio clock | Yes: `playbackRate` with `preservesPitch` off; a ramp is stepped 30 times a second |
| Rate, pitch kept | **No.** Web Audio has no stretcher | Yes: `preservesPitch` (Chromium's own time stretcher; its quality is what it is) |
| Loop regions, a Start-to-End loop, a play count, to the sample | Yes | No |

So `preservePitch` at a rate other than 1 forces the sound to stay a stream: it is never decoded, and its loop regions, play count and Start-to-End loop do not go round (the cue is flagged with that warning; a loop of the whole file still works). Without `preservePitch` a sound that loops is decoded as before and loops exactly, at its rate.

Every time on a cue stays a place **in the file**: Start, End at, markers, loop regions. The sound simply reaches them sooner or later. The engine's clock for a running sound is `positionOf(r) = from + elapsed × rate`, and everything it schedules against a place in the file divides by the rate (`End at`, the fade-out's start, a counted loop's last pass, a playlist's crossfade, the next downbeat). In the audio window each buffer voice has a clock (`clk`) that answers "where is it" and "when will it be there" through a ramp of its rate, exactly.

A Fade cue with `rate` moves its target's rate over its duration (`keepLevel`: only that; with "stop target when done", a record slowing to a stop). The audio window ramps it; the engine corrects its own clock every 50 ms, each step counted at the rate half way through it, which is exact for a straight ramp. Jump cues on a track at a rate other than 1 are written for but have not been tried.

## Level limits, and putting a fade back

`settings.audio.levels` is `{ min, max }` in dB (default −60 and +12). Every level a cue or a fade asks for goes through `engine.lim`: above `max` it is played at `max` (and `show.problems` flags the cue), at or below `min` it is silence. The mixer's faders are not held by it.

An absolute Fade is the last word on a sound's level: a dip still held in the sound's voice band (a relative voice-range duck that never came back) is let go over the same time. A relative Fade leaves it. Before a Fade cue moves anything the engine remembers how each sound was (level, voice-band dip, rate); `revertFade(cueId)` (the inspector's **Revert fade**, host command `revert-fade`) calls the cue's fade off if it is still running and puts each sound back over half a second. It cannot bring back a sound the fade has already stopped. **Set level from target** (`fade-from-target`) writes the level the target is playing at (or, when it is not playing, the target cue's own level) into the Fade cue and makes it absolute.

## The monitor feed

`settings.audio.monitor` is `{ on, out, db }`: a mono copy of what outputs 1–2 get, after the limiter, on output `out` (counted from 1) of the device at its own level. Off, nothing of it is in the path. If the device has no such output the feed is off and the mixer and Settings say so. It has a meter (Settings ▸ Audio). Checked on the test run's pretended eight outputs only.

## Losing the output device

`core/audio/device-watch.ts` decides and the host carries it out. The audio window reports the computer's outputs whenever they change, and when its context fails. If the chosen device is no longer listed (or fails), the show moves to the system default output and says so; when the chosen device is listed again the show goes back to it and says so. A device that failed while still listed is not returned to until it has been seen to leave and come back, or the operator chooses again. A device that comes back under a new id is recognised by its name. On the system default there is nothing to fall back to: the output is simply opened again. The operator's choice (`config.json`) is never overwritten by a fallback.

This is tested as a decision (unit tests, and the smoke run feeds the host device lists). **It has not been tried by unplugging an interface**: what Chromium does to sounds that were playing when a device vanishes is not known, so the notice says they may need starting again.

## File formats

Checked end to end by the smoke run on generated three-second files (`test/fixtures/formats/`, made by `test/fixtures/make-format-fixtures.sh`): the length is measured, the waveform is drawn (in the 8,000 slices the inspector asks for), the sound is played and skipped in, a loop region is drawn on it and it is found going round inside the region.

| Format | Result | How |
|---|---|---|
| WAV (PCM 16-bit) | Pass | Chromium; its waveform is read from the file by the host |
| MP3 | Pass | Chromium |
| M4A (AAC) | Pass | Chromium, with Electron's codecs |
| FLAC | Pass | Chromium |
| OGG (Vorbis) | Pass | Chromium |
| Opus (in Ogg) | Pass | Chromium |
| AIFF, AIFF-C (PCM) | Pass, **from a WAV copy** | Chromium reads neither AIFF nor CAF (measured: the element refuses them and `decodeAudioData` fails). `core/audio/pcm-container.ts` rewraps the same samples as a WAV in the system's temporary folder (`endless-cues-audio/`), once per file, found again by path, size and date. The show's file is not touched. |
| CAF (PCM) | Pass, from a WAV copy | As AIFF |
| AIFF-C or CAF with compressed sound (IMA4, AAC, ALAC in CAF) | Refused | The cue is flagged, with the reason (“…whose sound is compressed (ima4): convert it to WAV”). Unit-tested; no such file was played. |

The copy costs the file's size again in temporary storage and is made when the show is opened or the sound is added, never at a GO. Only one bit depth and channel count of each format was run (mono 16-bit, 22.05 kHz; the Vorbis file stereo); 24-bit and float PCM are covered by unit tests of the conversion, not by playing them.

## Memory

A decoded track is large (about 170 MB for eight minutes of stereo at 44.1 kHz). The host has only what is playing and what the next GO plays decoded, and the audio window drops the rest (`keep`). Two more things hold memory down, measured with five eight-minute tracks each played from its buffer, drawn and analysed for tempo, then stopped (36 MB held with nothing playing):

- A dropped voice holds no sound (`drop` clears its buffer), even one that began as a stream and moved over to its buffer, whose stream element's listeners would otherwise keep it alive.
- The window is started with the garbage collector exposed and asks for a collection a moment after it lets sound go (`tidy`): an idle audio window has no other reason to run one.

A track whose bytes finish reading after it has stopped being wanted is not sent to be decoded, and a track already decoded is not read and sent again each time the list of wanted tracks changes.
