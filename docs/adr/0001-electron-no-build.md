# 0001 · Electron, plain JavaScript, no build step

**Status:** accepted for 0.x.

## Decision

The app is Electron. The main process and `core/` are CommonJS; the window is ES modules with Preact and htm, vendored as one file. Nothing is compiled, bundled or transpiled: `npm start` runs the sources.

## Why

- **Three platforms, one audio-capable runtime, no native code.** Chromium's Web Audio decodes, mixes, schedules to the sample and routes to a chosen device on macOS, Windows and Linux. Any native alternative means writing that three times before the first cue plays.
- **It is what the engine already ran on.** The cue engine and the audio player were proven on a real show inside Electron. Changing the runtime and generalising the product at once would have been two risks.
- **A contributor's first change takes a minute.** No toolchain to learn, no watch process, no source maps. For a project that wants outside contributors from theatre, not only from software, this matters more than type safety does today.
- **No build means nothing between the source and a show.** A stale bundle shipping in place of the code that was tested is a real failure mode; with no bundle it cannot happen.

## What it costs

- No static types. Mitigated by keeping logic in small pure modules with tests, and by the cue-type table being data. JSDoc types checked by `tsc --checkJs` can be added without a build step; that is the likely next move.
- ~300 MB installed, Chromium's memory.
- The audio ceiling described in `docs/specs/05-audio.md`.

## Not chosen

- **Tauri**: smaller, but the webview differs per platform (WebKit, WebView2, WebKitGTK), so Web Audio behaviour, device routing and codecs would differ per platform: exactly the thing a show cannot have. Revisit once audio is a native sidecar, at which point the UI runtime matters much less.
- **Native (Swift, C++/JUCE, Rust + a native toolkit)**: the right end state for the audio engine, the wrong first step for the whole product.
- **React + Vite + TypeScript**: the mainstream choice and a reasonable one. Declined for now for the reasons above; nothing in the structure prevents adopting it later (the renderer is ~1,500 lines of components over one state push).

## What would change this

The renderer growing past what one person can hold in their head without types; or a contributor base that expects the mainstream toolchain. Adopt `tsc --checkJs` first, a bundler only if it buys something a user can see.
