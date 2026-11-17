#!/usr/bin/env node
/**
 * The build: TypeScript to the JavaScript that runs. (The one JavaScript file here, because it is what makes the rest.)
 *
 *   node build/compile.mjs            every .ts beside it as a .js (CommonJS, for Node and Electron's main process),
 *                                     and the two bundles below; then the .js that no .ts makes any more are removed
 *   node build/compile.mjs --watch    the same, again on every change
 *   node build/compile.mjs --clean    only remove what it writes
 *
 * Types are not checked here (esbuild only strips them): `npm run typecheck` (tsc) does that, and `npm test` runs both.
 *
 * The main window's code is one bundle (app/renderer/window.bundle.js: app.ts and everything it imports, an ES module).
 * The audio, stage and remote pages stay plain scripts, as they were written (their tests reach into them), so their
 * .js is the one beside their .ts; the audio window's share of core/ is app/audio/audio-lib.bundle.js.
 */
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['app', 'core', 'bin', 'build', 'test', 'examples'];
const SKIP = new Set(['node_modules', 'vendor', 'fixtures', 'runs', 'firmware']);
const BUNDLES = [
  { entry: 'app/renderer/app.ts', out: 'app/renderer/window.bundle.js', format: 'esm' },
  { entry: 'app/audio/lib.ts', out: 'app/audio/audio-lib.bundle.js', format: 'iife' },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const all = () => DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const sources = () => all().filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'));
const bundleFiles = new Set(BUNDLES.flatMap((b) => [b.out, `${b.out}.map`].map((f) => path.join(ROOT, f))));

/** What this script wrote: a .js (and its .map) beside a .ts, a bundle, or one left from a .ts that is gone. */
function written() {
  return all().filter((f) => {
    if (bundleFiles.has(f)) return true;
    if (f.endsWith('.js.map')) return true;
    return f.endsWith('.js') && !f.endsWith(path.join('build', 'compile.mjs'));
  });
}
/** The .js that no .ts makes any more (a file renamed or deleted), and their maps. */
function stale() {
  const ts = new Set(sources());
  return written().filter((f) => !bundleFiles.has(f) && !ts.has(f.replace(/\.js(\.map)?$/, '.ts')));
}

const node = () => ({
  entryPoints: sources(), outdir: ROOT, outbase: ROOT, format: 'cjs', platform: 'node', target: 'node22',
  sourcemap: 'linked', logLevel: 'warning',
});
const page = (b) => ({
  entryPoints: [path.join(ROOT, b.entry)], outfile: path.join(ROOT, b.out), bundle: true, format: b.format,
  platform: 'browser', target: 'es2023', sourcemap: 'linked', logLevel: 'warning',
});

const args = new Set(process.argv.slice(2));
if (args.has('--clean')) {
  for (const f of written()) fs.rmSync(f);
} else if (args.has('--watch')) {
  for (const f of stale()) fs.rmSync(f);
  const ctxs = await Promise.all([esbuild.context(node()), ...BUNDLES.map((b) => esbuild.context(page(b)))]);
  await Promise.all(ctxs.map((c) => c.watch()));
  console.log('Watching (a new .ts needs a restart).');
} else {
  for (const f of stale()) fs.rmSync(f);
  await Promise.all([esbuild.build(node()), ...BUNDLES.map((b) => esbuild.build(page(b)))]);
}
