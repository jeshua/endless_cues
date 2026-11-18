# 13 · Video and the stage

Source: `core/video/stage.ts` (the arithmetic), `core/engine/cue-engine.ts` (the `video` hooks, `case 'picture'`), `app/main/stage.ts` (the output window and its display), `app/stage/stage.html` (the page that draws), `app/main/smoke-video.ts` (the end-to-end check).

## The picture

```
                       ┌────────────── main process ───────────────┐
                       │  CueEngine                                 │
   GO ───────────────▶ │   a Video cue with a video file            │
                       │     = an audio cue (running, fades, seek…) │
                       │       + a picture                          │
                       │   a still, a Text cue, a Camera cue        │
                       │     = a `picture` cue (no sound, no end)   │
                       └───────┬───────────────────────┬────────────┘
                     audio-cmd │                       │ stage-cmd (show, move, pause, seek, hide)
                               ▼                       ▼
                   audio window (hidden)        stage window (the output)
                   the video's SOUND,           the PICTURE, muted,
                   on its bus          ──where──▶ kept in step with the sound (sync)
```

Video is built the way sound is. The engine decides; the stage window only does what it is told and holds no show state. If it is closed, crashes or loses its display, the engine and the sound go on, and a stage that opens is told again what is up (`engine.pictures()`).

## Why a video is a sound with a picture

A video file's sound has to go through the cue's bus: its fader, the ducker, the limiter, the recording. All of that lives in the audio window. So the audio window plays the file's sound exactly as it plays an Audio cue (an `HTMLAudioElement` streams the sound track of an mp4 or a webm), and the stage window plays the same file muted.

That makes a Video cue with a video file **an audio cue to the engine** (`show.toEngineDoc` gives it `type: 'audio'` and `picture: 'video'`). Level, fade in, fade out, Start and End, Loop, pause, resume, skip, Load to Time, Stop, panic, "fade and stop others", Fade cues, playlists, auto-follow: none of it was written again, and none of it can behave differently for a video than for a sound. The engine adds a call to the stage beside each call to the audio backend.

A still image, a Text cue and a Camera cue have no sound. They are `type: 'picture'`: an entry in `running` with no file to play and no end of its own (as a Mic cue is), so they also show in Active Cues, pause, stop and fade out with everything else. With a `duration` they end by themselves.

The cost of the split is that picture and sound are two media elements in two processes. They are started by the same GO, one IPC hop each, and then **kept in step**: twice a second the audio window says where each playing video's sound is and when it read that (`where`), and the stage brings the picture to it (`sync`): within 40 ms it is left alone; up to 0.4 s out, it plays 5 % fast or slow until it is there (a skip would be seen); further, it skips. The sound is the clock, never the picture. This is what QLab calls "follow audio clock". It has been measured only in the test run (under a tenth of a second); it has not been judged by eye against lips on a real projector.

What a video cannot do that a sound can: it is never decoded whole, so it cannot loop a section to the sample. A video that loops from Start to End is skipped back at its End (a few frames' hitch). Loop regions, play counts, holds, Jump cues and Devamp are for Audio cues only.

## The stage

A stage is a raster of its own size (`settings.video.width` × `height`, 1920 × 1080 unless set), scaled to fit the window it is in and black around and between everything. Positions are in stage pixels from the centre, right and up positive, so a show keeps its layout when the projector changes.

Each cue on it is one layer:

| | |
|---|---|
| `fit` | `fit` (all of it shows), `fill` (covers the stage, cropped), `stretch`, `natural` (its own pixels) |
| `opacity` | 0–100 |
| `x`, `y` | stage pixels from the centre |
| `scale` | 1 = the size `fit` gave it |
| `rotation` | degrees, clockwise |
| `layer` | higher is in front; on one layer, what started last is in front |

**A Fade cue aimed at a Video, Text or Camera cue** moves whichever of opacity, x, y, scale and rotation it names, in a straight line over its duration, with its level if it names one. Naming some geometry and no level leaves the sound alone. Naming nothing takes the target out (sound to silence, picture to nothing), which is what a Fade with nothing set does to a sound. Anything that fades a cue out and stops it (a Fade with "stop target", Esc, "fade and stop others", the cue's own fade out) fades its picture with it. Layer and fit are not faded.

The stage's **corner pin** (`settings.video.pin`: four corners as fractions of the stage, top left first, clockwise) bends the whole stage, test pattern included, with one projective matrix (`pinMatrix`). Corners that cross, or three in a line, are refused (`cleanPin`) and the stage is square. The **blackout** covers everything and is the operator's hand, not the show's: it is not saved, and the title bar says while it is on. So is the **test pattern**.

## The output window

`app/main/stage.ts`. Which display is this computer's (`config.json`: `stage: { open, display, label }`), like the audio output.

- **On a display**: a frameless window exactly the display's bounds, above the menu bar and the Dock (`alwaysOnTop: 'screen-saver'`), not a full-screen Space. It is `focusable: false` and shown with `showInactive()`: a click on the projector's screen cannot take Space away from the cue list. The display the operator's window is on is refused.
- **In a window**: an ordinary window, for a computer with one screen.
- **In a test run** (`--smoke`, a virtual user): `offscreen: true`, never shown. `capturePage()` reads it, which is how the smoke test checks colours.
- **The display is unplugged**: the OS would move the window to the operator's screen, so the stage is closed at once, a notice says so, the title bar shows "Stage display gone", and the show goes on with no picture. When a display with the same id (or the same name: ids change with the socket) appears, the stage opens on it and is told what is running.
- A stage that was open when the app quit opens again at launch, or waits for its display.
- A cue with a picture that fires while the stage is closed plays its sound and says once that the stage is not open.
- The stage closes when the operator's window does.

## Formats

The picture is drawn by Chromium's media stack as Electron ships it. That decides what plays, and it is narrower than QLab's AVFoundation.

| | macOS | Windows | Linux |
|---|---|---|---|
| **H.264 + AAC in .mp4 / .m4v / .mov** | yes | yes | yes |
| **VP8, VP9 + Opus or Vorbis in .webm** (VP8/VP9 may carry transparency) | yes | yes | yes |
| **AV1 in .mp4 / .webm** | yes | yes | yes |
| **H.265 / HEVC in .mp4 / .mov** | yes, where the computer decodes it in hardware | yes, where the graphics card decodes it | only with VA-API hardware decoding |
| **ProRes, Hap, DV, Photo-JPEG, MPEG-2, Theora** | no | no | no |
| Stills: PNG, JPEG, WebP, AVIF, GIF, BMP, SVG | yes | yes | yes |

Only VP8 + Opus in WebM and PNG are exercised by the tests. The rest of the table is what Chromium documents for the Electron this is built on, and has not been tried file by file here.

A `.mov` plays when what is inside it is H.264 or HEVC; a `.mov` holding ProRes or Hap (what a QLab show is usually made of) does not. The cue is flagged ("its file cannot be played here") when the audio window cannot open it. **What to convert to**: H.264 in mp4 for ordinary footage; VP9 in WebM for footage with transparency. With ffmpeg:

```
ffmpeg -i in.mov -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 256k out.mp4
ffmpeg -i in-with-alpha.mov -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 24 -c:a libopus out.webm
```

Long-GOP codecs (H.264, VP9) skip and loop less crisply than ProRes or Hap do in QLab. That is the price of no native code.

## What is not here, and what it would take

- **Several stages, regions and outputs.** One stage on one display. More stages is mostly bookkeeping: a list of stages in `settings.video`, a `stage` field on the cue, one window per stage in `stage.ts`. A stage spanning two projectors needs either one window across both displays (works when they are side by side in the OS's arrangement) or regions: the same stage drawn in two windows, each showing a part. Two windows cannot share one `<video>` element, so each would decode the file again and be synced separately; a WebGL stage drawing each region from a shared texture is the real answer, and is a rewrite of `stage.html`.
- **Edge blending.** With regions, a blend is a gradient mask along the overlapping edge with a gamma curve (`mask-image` on the region, or a shader). The arithmetic is small; it is worthless until two projectors can be driven and measured.
- **Masks.** A greyscale image as the stage's `mask-image` is a few lines in `stage.html` and a file field in settings. Not done: no one has asked, and it wants a real surface to check against.
- **Mesh and Bézier warps.** CSS can only do the one projective transform the corner pin uses. A mesh needs the stage drawn into WebGL and re-drawn through a grid.
- **Corner pin by dragging.** The corners are typed as percentages. Handles on the stage itself need the stage to take the mouse, which it deliberately cannot on a display.
- **Per-cue crop, anchor point, 3D rotation, blend modes, video effects, fade curves and paths, playback rate.** Each is small in CSS (`clip-path`, `transform-origin`, `rotateX/Y`, `mix-blend-mode`, `filter`); none is done.
- **Rich text.** A Text cue is one font, size and colour.
- **A Camera cue's sound.** Put a Mic cue beside it.
- **A monitor of the stage in the operator's window**, and a picture of the frame in the inspector.
- **Frame-accurate anything.** Starts are within an IPC hop; nothing is locked to the display's refresh.

### NDI, Syphon, Spout, Blackmagic

These cannot be done from a web page. NDI is a proprietary SDK (a native library with a licence to accept); Syphon and Spout share GPU textures between processes through macOS's IOSurface and Windows' DirectX, which Chromium does not expose to a page; a DeckLink card is driven through Blackmagic's Desktop Video SDK. Each needs native code in the app: a Node addon per platform, built, signed and notarised three times, which is exactly what [ADR 0001](../adr/0001-electron-no-build.md) decided against for now. The route, when it is taken, is the one planned for audio ([05](05-audio.md)): a native sidecar that takes the same small command set the stage window takes (`show`, `move`, `pause`, `seek`, `hide`), with Electron's offscreen rendering (`paint` events deliver each frame's pixels) as a cheap first source of frames for an NDI or Syphon sender. Until then: a hardware output on the computer's own display connector, or a capture of the stage window by a tool that speaks NDI.
