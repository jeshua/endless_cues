# 0001 · Electron

**Status:** accepted. How the code is built is [0006](0006-typescript.md); the native audio engine beside it is [0007](0007-native-audio.md).

## Decision

The app is Electron. The main process and `core/` run on Node; the window is ES modules with Preact and htm, vendored.

## Why

- **Three platforms, one audio-capable runtime.** Chromium's Web Audio decodes, mixes, schedules to the sample and routes to a chosen device on macOS, Windows and Linux. Any native alternative means writing that three times before the first cue plays.
- **One Chromium everywhere.** The window, the stage, the audio window and the web remote's page behave the same on every platform, because they run in the same browser engine, shipped with the app.
- **It is what the engine has run a show on.** The cue engine and the audio player have played a real show inside Electron.
- **A contributor from theatre, not only from software, can read it.** The window is plain components over one state push; the logic is small pure modules with tests.

## What it costs

- ~300 MB installed, Chromium's memory.
- The audio ceiling of Web Audio described in `docs/specs/05-audio.md`, which the native engine ([0007](0007-native-audio.md)) is there to lift.

## Not chosen

- **Tauri**: smaller, but the webview differs per platform (WebKit, WebView2, WebKitGTK), so Web Audio behaviour, device routing and codecs would differ per platform: exactly the thing a show cannot have.
- **Native throughout (Swift, C++/JUCE, Rust + a native toolkit)**: the right home for the audio engine, the wrong one for the whole product.
- **React + Vite**: the mainstream choice and a reasonable one. Preact and htm, vendored, need no package at runtime and no dev server.

## What would change this

A platform the show must run on that Electron does not reach, or a contributor base that expects the mainstream toolchain.
