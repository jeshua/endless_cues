# 0006 · TypeScript, compiled by esbuild

**Status:** accepted. Replaces the "plain JavaScript, no build step" half of [0001](0001-electron-no-build.md); Electron stays.

## Decision

Every source file is TypeScript, checked with `strict` on. `build/compile.mjs` (esbuild) writes the JavaScript that runs:

- each `.ts` as the CommonJS `.js` beside it, so every path in the app, the tests, the command-line tools and the package is the one it always was;
- the main window as one bundle, `app/renderer/window.bundle.js` (app.ts and what it imports, with the vendored Preact);
- the audio, stage and remote pages as the plain scripts they were (their code is now in `.ts` files of its own instead of inside the HTML), and the audio window's share of `core/` as `app/audio/audio-lib.bundle.js`.

The `.js` files are not kept in git. `tsc` checks types and writes nothing; esbuild only strips them, in well under a second. `npm test`, `npm start`, `npm run smoke` and the packaging scripts build first, and `npm test` fails on a type error.

## Why

- **The renderer outgrew what one person can hold without types.** 0001 named that as the thing that would change its answer; the window had grown from 1,500 lines to almost 7,000.
- **The seams are where a show breaks.** The host's state pushed to the window, the commands it takes, the messages to the audio and stage windows, a cue's fields: each is now one declared type that both sides are checked against. A cue's fields are written from the cue types table (`build/cue-fields.ts`), so the table is still the one place a field is added.
- **A stale bundle cannot ship.** 0001's worry stands, so: the build is one script, every entry point runs it first, it removes any `.js` whose `.ts` has gone, and the packaged app is built from a fresh build.

## What it costs

- A step between editing and running: `npm run watch` keeps it out of the way (a change is a reload again), and a new contributor needs nothing more than `npm install`, which builds.
- Two development dependencies (esbuild, TypeScript) and Preact's types (the window still runs the vendored, patched copy).

## Not chosen

- **Running the `.ts` directly** (Node's type stripping): Electron's renderer cannot, and the main process's Node does not reliably, so there would be a build for half of it anyway.
- **One output folder (`dist/`)**: every `__dirname` in the app, the HTML pages, the tests' fixtures and the package's file list would have to learn a second layout.
- **tsc for the output**: slower, and esbuild is needed for the window's bundle anyway.
