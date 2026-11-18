/**
 * The native audio engine (`ec-audio`, native/audio/) for a packaged app: one program per platform and architecture,
 * built with cargo for its target triple and put where electron-builder's `extraResources` takes it from,
 * `native/dist/<os>-<arch>/` (`os` as electron-builder says it: mac, win, linux). docs/RELEASING.md, "The native
 * audio engine".
 *
 *   node build/native.js                       this computer's platform and architecture
 *   node build/native.js --arch arm64,x64      those architectures of this platform (a Mac builds both)
 *   node build/native.js --os win --arch x64   another platform (needs that target's linker: docs/RELEASING.md)
 *
 * It is also electron-builder's `beforePack` hook (package.json `build.beforePack`), so that every packaged build,
 * `npm run pack`, `npm run dist:*` and `node bin/release.js mac` alike, carries a fresh engine for the architecture
 * being packed. EC_NO_NATIVE=1 packs without one (the app then plays with Web Audio and says the native engine is not
 * there if it is chosen).
 *
 * `npm run native` (cargo build --release) is the development build, in native/target/release/, which the app run
 * from source uses.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..');
type Os = 'mac' | 'win' | 'linux';
type Arch = 'x64' | 'arm64';
/** The cargo target triple for each platform and architecture electron-builder packs. */
export const TRIPLES: Record<Os, Record<Arch, string>> = {
  mac: { x64: 'x86_64-apple-darwin', arm64: 'aarch64-apple-darwin' },
  win: { x64: 'x86_64-pc-windows-msvc', arm64: 'aarch64-pc-windows-msvc' },
  linux: { x64: 'x86_64-unknown-linux-gnu', arm64: 'aarch64-unknown-linux-gnu' },
};
const osOf = (platform: string): Os => (platform === 'darwin' || platform === 'mac' ? 'mac' : platform === 'win32' || platform === 'win' || platform === 'windows' ? 'win' : 'linux');
const exe = (os: Os) => (os === 'win' ? 'ec-audio.exe' : 'ec-audio');
/** Where electron-builder takes the program from (`${os}-${arch}` in package.json's `extraResources`). */
export const distDir = (os: Os, arch: Arch) => path.join(ROOT, 'native', 'dist', `${os}-${arch}`);

/** Builds `ec-audio` for one platform and architecture and puts it in native/dist/<os>-<arch>/. Throws why not. */
export function buildFor(os: Os, arch: Arch) {
  const triple = TRIPLES[os][arch];
  if (!triple) throw new Error(`no native engine for ${os} ${arch}`);
  const installed = spawnSync('rustup', ['target', 'list', '--installed'], { encoding: 'utf8' });
  if (installed.status === 0 && !installed.stdout.split('\n').includes(triple)) throw new Error(`the Rust target ${triple} is not installed: rustup target add ${triple}`);
  console.log(`  • native audio engine  ${os} ${arch} (${triple})`);
  const r = spawnSync('cargo', ['build', '--release', '--manifest-path', path.join(ROOT, 'native', 'Cargo.toml'), '--target', triple], { cwd: ROOT, stdio: 'inherit' });
  if (r.error) throw new Error(`cargo could not be run (${(r.error as NodeJS.ErrnoException).code}): install Rust from https://rustup.rs`);
  if (r.status !== 0) throw new Error(`cargo could not build ec-audio for ${triple}`);
  const built = path.join(ROOT, 'native', 'target', triple, 'release', exe(os));
  if (!fs.existsSync(built)) throw new Error(`cargo built nothing at ${built}`);
  const dir = distDir(os, arch);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(built, path.join(dir, exe(os)));
  if (os !== 'win') fs.chmodSync(path.join(dir, exe(os)), 0o755);
  return path.join(dir, exe(os));
}

/** electron-builder's `beforePack`: the engine for the platform and architecture about to be packed. (Its `arch` is
 *  electron-builder's Arch: 1 x64, 3 arm64.) */
async function beforePack(context: { electronPlatformName: string; arch: number }) {
  if (process.env.EC_NO_NATIVE) { console.log('  • native audio engine  left out (EC_NO_NATIVE)'); return; }
  const arch: Arch | null = context.arch === 1 ? 'x64' : context.arch === 3 ? 'arm64' : null;
  if (!arch) throw new Error(`no native engine for architecture ${context.arch}`);
  buildFor(osOf(context.electronPlatformName), arch);
}
export default beforePack;

if (require.main === module) {
  const args = process.argv.slice(2);
  const opt = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const os = osOf(opt('--os') || process.platform);
  const archs = (opt('--arch') || (process.arch === 'arm64' ? 'arm64' : 'x64')).split(',').map((a) => a.trim()) as Arch[];
  try { for (const a of archs) console.log(`    ${path.relative(ROOT, buildFor(os, a))}`); }
  catch (err) { console.error(`build/native: ${(err as Error).message}`); process.exit(1); }
}
