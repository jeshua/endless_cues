# 0006 · TypeScript, compiled by esbuild

**Status:** accepted. The runtime is [0001](0001-electron.md)'s Electron.

## Decision

Every source file is TypeScript, checked with `strict` on. `build/compile.mjs` (esbuild) writes the JavaScript that runs:

- each `.ts` as the CommonJS `.js` beside it, so every path in the app, the tests, the command-line tools and the package names the file beside its source;
- the main window as one bundle, `app/renderer/window.bundle.js` (app.ts and what it imports, with the vendored Preact);
- the audio, stage and remote pages as plain scripts, each from a `.ts` file of its own, and the audio window's share of `core/` as `app/audio/audio-lib.bundle.js`.

The `.js` files are not kept in git. `tsc` checks types and writes nothing; esbuild only strips them, in well under a second. `npm test`, `npm start`, `npm run smoke` and the packaging scripts build first, and `npm test` fails on a type error.

## Why

- **The window is too big to hold without types** (about 7,000 lines of components).
- **The seams are where a show breaks.** The host's state pushed to the window, the commands it takes, the messages to the audio and stage windows, a cue's fields: each is one declared type that both sides are checked against. A cue's fields are written from the cue types table (`build/cue-fields.ts`), so the table is still the one place a field is added.
- **A stale bundle cannot ship.** The build is one script, every entry point runs it first, it removes any `.js` whose `.ts` has gone, and the packaged app is built from a fresh build.

## What it costs

- A step between editing and running: `npm run watch` keeps it out of the way (a change is a reload), and a new contributor needs nothing more than `npm install`, which builds.
- Two development dependencies (esbuild, TypeScript) and Preact's types (the window runs the vendored, patched copy).

## Not chosen

- **Plain JavaScript, run as written**: nothing between the source and a show, and no toolchain to learn; but no types at the seams. The one build script keeps most of the first: there is still no bundle that can go stale.
- **Running the `.ts` directly** (Node's type stripping): Electron's renderer cannot, and the main process's Node does not reliably, so there would be a build for half of it anyway.
- **One output folder (`dist/`)**: every `__dirname` in the app, the HTML pages, the tests' fixtures and the package's file list would have to learn a second layout.
- **tsc for the output**: slower, and esbuild is needed for the window's bundle anyway.
