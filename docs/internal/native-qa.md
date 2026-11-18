# The native audio engine on a Mac, 2026-11-17

What `ec-audio` ([spec 18](../../specs/18-native-audio.md)) really does on real CoreAudio devices, measured on one
MacBook Pro (Apple silicon) with no audio interface: **BlackHole 2ch** (a virtual device, 48 kHz, whose output comes
back on its input, digitally), **RØDE Connect Virtual** (virtual, 48 kHz, no loopback) and the **built-in speakers**
(44.1 kHz, every signal at −40 dB or lower). Web Audio (the audio window) was measured the same way, beside it.

The scripts, so this can be run again:

| What | How |
|---|---|
| What leaves the engine, against what it was asked | `cargo run --release --example qa -- truth [--buffer N] [--loop-s S] [--stream-s S]` |
| GO to output, both engines | `qa latency`; `npx electron test/native-qa/webaudio.js latency --device … [--loopback]` |
| One scene through both engines, both recorded off BlackHole | `qa parity --write`; `npx electron test/native-qa/webaudio.js scene --scene …/scene.json`; `qa parity` |
| The output changed under the sound | `qa devices` |
| Many sounds for a long time, and a burst | `qa soak [--minutes 20]` |

(`native/audio/qa/`, built with `cargo build --release`; none runs while the show's app runs. Files go to
`$EC_QA_DIR`, else the system's temp folder.) The engine's own new test aids: `--capture FILE.wav` (every buffer handed
to the device, each buffer's moment, each command as taken) and `ec-audio listen` (an input's clicks, and a
recording of it).

## The verdict

On these devices the native engine does exactly what it is told, to the sample, and says how it is doing. Everything
that left it in a five-minute stream, a three-minute held loop, fades, pans, a Pan line and thirty GOs (23 647 744
frames) came back off BlackHole **bit for bit the same as its own capture**, a constant 9 984 frames later (the
recorder started first). No buffer was missed in any run. Eight bugs were found and fixed; the Web Audio engine
differs from it in four ways worth knowing (below), none of them the native engine's mistake.

## Latency

GO to output: from the command being taken to its first sample leaving the device, by each engine's own clock and
its device's own timestamps (`ec-audio measure`; for Web Audio, from just before `play()` in the window to
`getOutputTimestamp()`'s moment for the frame where the click first appears after the limiter). Round trip: the
same click found in BlackHole's input, stamped by the input's own clock. Milliseconds; 200 clicks (60 on the
speakers), at random moments 60–160 ms apart.

| Engine | Device | Buffer | Mean | p95 | Max | Jitter (sd) | Round trip mean / p95 / max | Device's own part |
|---|---|---|---|---|---|---|---|---|
| Native | BlackHole | 256 | 8.27 | 10.66 | 10.67 | 1.71 | 8.27 / 10.66 / 10.67 (200 of 200) | 5.32 |
| Native | BlackHole | 128 | 4.16 | 5.32 | 5.35 | 0.84 | 4.16 / 5.32 / 5.36 (200 of 200) | 2.66 |
| Native | BlackHole | 64 | 2.07 | 2.66 | 2.67 | 0.42 | 2.07 / 2.66 / 2.67 (200 of 200) | 1.33 |
| Native | RØDE Virtual | 256 | 8.12 | 10.65 | 10.67 | 1.65 | — | 5.33 |
| Native | RØDE Virtual | 128 | 4.17 | 5.33 | 5.35 | 0.82 | — | 2.66 |
| Native | RØDE Virtual | 64 | 2.08 | 2.66 | 2.67 | 0.42 | — | 1.34 |
| Native | Speakers (44.1 kHz) | 256 | 26.22 | 29.07 | 29.25 | 1.69 | — | 23.45 |
| Native | Speakers | 128 | 22.14 | 23.44 | 23.49 | 0.88 | — | 20.55 |
| Native | Speakers | 64 | 19.84 | 20.55 | 20.55 | 0.45 | — | 19.10 |
| Web Audio | BlackHole | (its own) | 21.27 | 24.02 | 28.54 | 1.91 | 24.69 / 28.85 / 29.76 (198 of 200) | 16.81 |
| Web Audio | RØDE Virtual | (its own) | 20.97 | 23.97 | 26.80 | 1.73 | — | 16.81 |
| Web Audio | Speakers | (its own) | 38.36 | 41.23 | 42.42 | 1.92 | — | 34.81 |

- No underrun at any buffer size, 64 included (`xruns` 0 in every run).
- The native engine's spread is the wait for the next buffer: uniformly 0 to one buffer (0–5.3 ms at 256), and
  nothing else: its maximum is one buffer plus the device's part, to 0.02 ms.
- **Its estimate is right**: BlackHole's round trip, found in the recording by the input's own clock, agrees with the
  engine's estimate to 0.001 ms on every click (`loopback_minus_estimate_ms`). Web Audio's is not: its round trip is
  3.4 ms longer than `getOutputTimestamp()` says, on average (its context runs at 44.1 kHz, the speakers' rate when
  the window opened, and is resampled to BlackHole's 48 kHz).
- The speakers add 65 frames of latency, 639 of stream latency and 74 of safety offset (CoreAudio's own numbers): about
  16 ms that cpal never reported. The engine now counts them (bug 2).
- Like for like at 256 frames on BlackHole the native engine is 13 ms sooner than Web Audio and its worst is 18 ms
  sooner; at 64 frames, 19 ms sooner.

## What leaves the engine (`qa truth`, BlackHole, its capture and BlackHole's input)

| Part | 256 frames | 64 frames |
|---|---|---|
| A decoded sound's first sample: in the first buffer rendered after its command, at that buffer's first frame | 30 of 30 | 30 of 30 |
| Command to first sample heard (mean / max) | 8.54 / 10.65 ms | 2.04 / 2.62 ms |
| A held loop (0.25–0.5 s of an index ramp), frames out of place | 0 in 180 s (720 passes) | 0 in 30 s (120 passes) |
| A streamed sound from 1.234 s: its first frame | 59 232 (as asked) | 59 232 |
| …then frames skipped, repeated or wrong | 0 in 300 s | 0 in 30 s |
| A fade (−40 dB over 1 s, an s-curve shape), worst difference from curves.ts | 5×10⁻⁷ dB | 5×10⁻⁷ dB |
| Pan −100, −50, 0, 30, 100 against lanes.ts `panGains`; a bent Pan line, every sample | within 6×10⁻⁸ | within 6×10⁻⁸ |
| A stop: frames to silence, its largest step | 96 (2 ms), 0.0052 of a 0.5 level (a straight ramp) | the same |
| Capture against BlackHole's recording | 23 647 744 frames identical, 0 different | 3 485 760 identical, 0 different |
| Buffers missed (`xruns`), the device's clock's gaps, capture drops | 0, 0, 0 | 0, 0, 0 |
| The busiest buffer, as a share of its time | 1.2 % | 3 % |

## The output changed under the sound (`qa devices`)

Six rounds of `sink` between the speakers (44.1 kHz) and RØDE Connect Virtual (48 kHz) with a decoded sound and a
streamed one playing (ramps whose frames say which they are, at −40 dB at most):

- Every change: `outputs`, then `sink ok`, then `devices`; nothing else said. Silence at each change: 21–48 ms
  (the old device stopped, the new one started).
- **Both sounds carry on from the frame after the last one heard** (a jump of 1.00 source frames at 48 kHz, 1.09 at
  44.1 kHz: one output frame), **at the right speed** (1.0884 source frames an output frame at 44.1 kHz, 1.0000 at
  48 kHz). A decoded sound keeps its buffer at its old rate and is read at the right speed; the file is decoded again
  at the new rate for the next GO, which plays exact (`mode` exact).
- `sink` to an output that does not exist: `sink ok:false` "there is no output named No Such Output"; the sound
  carries on, on the device it was on, with no gap.
- Not tried (cannot be without hardware): a device unplugged under the sound; the system's default changed.

## Load (`qa soak`, BlackHole)

Twenty minutes, 32 sounds at once (41 at most), streamed (10-minute files at 44.1, 48 and 96 kHz, mono and stereo)
and decoded (30-second files at three rates), a GO, stop, fade, seek, held loop, rate change, move, pause or resume
every 20–120 ms: 2 514 GOs and 14 705 commands in all.

| | |
|---|---|
| Buffers missed (`xruns`) | 0 |
| Frames a stream ran dry (`starved`) | 0 |
| The busiest buffer, as a share of its time (`load`) | 5.4 % |
| CPU (`ps`, every 5 s) | mean 8.4 %, p95 13.3 %, max 14.7 % |
| Memory (RSS) | 141 MB while the four files were decoded at the start; then 80 MB, rising to 88 MB over the first 13 minutes and flat at 90.5–90.9 MB for the last 7 |
| `errors` | none |
| A burst: 100 plays in one write (decoded and streamed) | all 100 playing in 46 ms; 0 buffers missed; 24 % CPU with 100 playing; 101 MB |
| A `devices` asked every 5 s | answered in 246–330 ms (now off the control thread; every GO meanwhile was taken at once) |

The slow rise of memory in the first quarter of an hour (about 0.6 MB a minute, then none) looks like the allocator
settling with thousands of streams' threads and rings made and let go; a soak of some hours would say whether it
stays flat.

## One scene through both engines (`qa parity`)

The same commands at the same moments, through each engine, recorded off BlackHole. Native first, Web Audio second.

| Part | Native | Web Audio | Difference |
|---|---|---|---|
| A sound at −6 dB | −6.000 dB | −5.829 dB | Web Audio +0.171 dB |
| On a bus at −10 dB | −10.000 | −9.830 | +0.170 |
| The master at −6 dB | −6.000 | −5.829 | +0.171 |
| Pan −50: left, right gain | 1.30656, 0.54120 (= lanes.ts) | 1.33251, 0.55194 | +0.171 dB on both: the pan law is the same |
| Fade −6 → −30 dB over 1 s (s-curve): worst at tenths of its time | 0.035 dB (5×10⁻⁷ by the capture) | 0.010 dB | the same shape |
| A stop from −30 dB: frames to silence | 94 (2 ms) | 24 (0.5 ms) | Web Audio's stop is shorter |
| A held loop: frames identical a loop apart (of 120 000) | 120 000 | 115 203 (worst 6×10⁻⁸) | Web Audio's is resampled |
| A bent Pan line: worst gain off lanes.ts, any sample | 6×10⁻⁸ | 1.55 | Web Audio's line is late or stepped |
| Each part's start after its moment, from the first click | −1.3 to +1.3 ms | +1.5 to +5.4 ms | |

What these say about Web Audio (none is the native engine's mistake; each is a choice to make before the native
engine becomes the default, because shows have been balanced by ear on Web Audio):

1. **Web Audio plays everything 0.171 dB louder.** Chromium's DynamicsCompressor (the safety limiter at −0.3 dBFS)
   adds its own make-up gain even when it is not compressing. The native limiter does not.
2. **Web Audio's context runs at the default output's rate when the window opens** (44.1 kHz here), and is resampled
   to the chosen device: not bit-exact, and 3.4 ms of latency its own `outputLatency` does not count.
3. **Web Audio's Pan line rides are off** by up to 1.55 in gain at the fast part of a bent line (the native engine's
   are within 6×10⁻⁸ of lanes.ts). Worth a look on the Web Audio side (`rideParam`): it may be late by its ride period.
4. **Web Audio's stop declick is 0.5 ms**, the native engine's 2 ms.

And one difference in what each plays: the native engine starts any sound it has decoded from its buffer; Web Audio
only one asked to be `exact`.

## Bugs found and fixed

| # | What | Fix | Test |
|---|---|---|---|
| 1 | `measure --loopback` lost clicks: one found within 100 ms of the last was taken for the same click, and GOs are 60–160 ms apart (9 of 50 lost in a first run) | a click is the next one 20 ms after the last (`Finder`) | `measure::tests::clicks_close_together_are_each_found_once` |
| 2 | On macOS the moment a buffer is heard was "now plus one buffer" (cpal's guess), whatever the device: the speakers' 16 ms of latency were left out of `measure` and `where`; and the loopback's input was stamped by the same guess, so it could not check it | the buffer's own CoreAudio host time, read out of cpal's timestamp, plus the device's and its stream's latency (`mac.rs`); the loopback stamped by the input's own host time less the input's latency | measured: the round trip agrees with the estimate to 0.001 ms on BlackHole (no automatic test: it needs a device) |
| 3 | `devices` held the control thread 280–500 ms (CoreAudio's list is slow): a GO sent after `devices` or `sink` waited for it | listed on a helper thread | `control::a_go_is_not_kept_waiting_by_the_list_of_devices` |
| 4 | The engine never said when devices came or went (the window does, on `devicechange`), so the host could not return to an output that came back; on the system default it did not follow a new default | a CoreAudio listener on the devices and the default output: `devices` said; the default followed | not automatic (needs a device to come and go) |
| 5 | An M4A (AAC) played 2 112 frames (48 ms) of the encoder's silence before its sound, and was 68 ms long: every GO 48 ms late, every place in the file 48 ms out | its `iTunSMPB` tag read: priming and padding left out, as Chromium does | `files::compressed_and_other_containers` (every format starts at its first frame), `pcm::tests::an_m4a_says_its_priming_and_length` |
| 6 | A long file was decoded whole (two hours: 1.4 GB at 48 kHz mono), and the host read its bytes only to drop them | a decoded sound holds at most 2²⁸ samples; longer, `decoded` says why and it streams. The host sends the native engine's `decode` without reading the file | `files::a_file_too_long_to_hold_is_not_decoded_but_streams` |
| 7 | A line that was not a command went only to the log; an op nobody has was said to be "not in the native engine yet" (and so a notice "cannot do … yet") | `operror` "not a command (…)" (at most once a second), and "not a command this engine knows" | `binary::what_is_not_a_command_is_said_and_nothing_breaks` (also: a 10 MB line plays, unknown keys say nothing, stdin closed exits 0) |
| 8 | Nothing counted a missed buffer | `level` says `xruns` (a gap in the device's clock between callbacks; on the silent clock, a catch-up), `starved` (frames a stream had nothing decoded for) and `load`; the host puts each new `xruns` in the show log; `measure` says `xruns` | `binary::the_level_event_says_buffers_missed_and_streams_run_dry` |

Also tested, no bug: every WAV of 16, 24 and 32-bit float at 44.1, 48 and 96 kHz in mono, stereo and six channels,
streamed and decoded (length, level, six channels folded as Web Audio folds them); M4A (AAC and ALAC), FLAC, AIFF,
CAF, MP3 and Ogg Vorbis (made with afconvert and ffmpeg) each start at their first frame and are their length; Opus
(no decoder) is refused with an `error`; a truncated file plays what it has; a header with no sound ends at once; an
empty file, a text file named .wav and a missing file are `missing` to `probe` and an `error` to `play`
(`tests/files.rs`). Killed with SIGKILL mid-play three times: the host started it again twice and said so, then went
back to Web Audio for the sitting with the reason (`test/native-audio-host.test.ts`, the real program).

## The whole app on the native engine

`EC_SMOKE_NATIVE=1 npm run smoke` (new) runs the whole smoke run with the native engine chosen (`--silent`, with
eight outputs pretended, as the window pretends them). The checks of what is sounding now read the host's `level`
events on the native engine (`soundingKeys`, `audioVoices` in smoke.ts) and the window's own voices on Web Audio, as
before; a part in a file of its own that throws is said as that part's failure and the run goes on. Web Audio's run
is unchanged (`npm run smoke`: all passed).

On the native engine: **170 checks pass and 46 fail, and the run stops at the inspector's Triggers tab** (a cascade:
the Video part threw and left a cue with a problem behind it). The 46, by why:

| Why | Checks (grouped by hand) |
|---|---|
| Not in the native engine yet, and said so (`operror`): a sound's own outputs and the matrix, audition, the reverb and delay sends, a cue's eq, the Mic cue, the ducker, recording, LTC in and out | 26 (outputs 5–6, both channels to one output, outputs the device lacks, four-channel file, Mic to its own output, V on the audition pair, reverb, delay, no send, eq; Mic opens, ducking dips, recording; LTC read back, timecode trigger, held back, let go, stopped, LTC to a missing output; and the like) |
| They read the audio window's own nodes (a voice's `under` gain, a bus's fader node): the window is not making the sound | 13 (a bus at rest, eq knob, pending change, solo, crossfader, undone; EQ Three, crossfader at B; ducks the others, they come back, Mix cue fader; trims; smoke-live) |
| **A real gap: a Video cue's sound (WebM: VP8 and Opus)**. symphonia has no Opus decoder, so the native engine reports the file as missing and the cue as unplayable | 7 (measured like a sound, none a problem, first frames, its sound plays, on its bus, Active Cues, in step) and the throw |
| A cascade of that: the problem it left | 2 (a MIDI File cue's length, the Triggers tab) |

## Not tested here (needs hardware)

- An audio interface: its real latency and an analogue round trip, more than two outputs, sample rates other than
  44.1 and 48 kHz on a device, ASIO-class buffer sizes on an interface.
- A device unplugged under the sound (the error path, the fallback, the return), and the system default changing:
  the watcher is written and run only on a device list that did not change.
- Windows (WASAPI) and Linux (ALSA): the macOS latency fix is macOS only; elsewhere the estimate is still cpal's.
- Listening to any of it.

## What next

1. Decide the 0.171 dB: either the native limiter adds Chromium's make-up so shows sound as they were balanced, or Web
   Audio's is taken out (a gain of −0.171 dB after it) so both are true to the dB. Then hold the two to it in a test.
2. Look at Web Audio's Pan line rides (finding 3 above) with this harness.
3. Run `qa truth`, `qa latency` (with `--loopback` on a cable) and `qa devices` on an interface, and unplug it.
4. Make 128 frames the native engine's default: no underrun here at 64, and 4.2 ms against 8.3.
5. Open the AudioContext at the chosen device's rate (Web Audio): it removes a resampler and 3 ms.
6. An Opus decoder for the native engine (a Video cue's sound is WebM with Opus), or Video cues' sound left to the
   audio window while the native engine plays the rest.
7. Make the smoke run's remaining window-reading checks (strips, a voice's `under`, a bus fader) read the host's
   events, so the native run can be held to "all passed but what it says it cannot do".
