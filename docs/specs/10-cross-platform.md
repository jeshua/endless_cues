# 10 · Cross-platform

Endless Cues is one codebase for macOS, Windows and Linux. This says what differs between them, how it is packaged, and what is still unproven.

**State of play:** developed and run on macOS (Apple silicon). The unit tests are platform-neutral and run on all three in CI (`.github/workflows/ci.yml`). An unpacked macOS build has been made with `electron-builder` and passes the end-to-end run. On Windows, the app has been launched from source on one Windows 10 PC, where the tests and the end-to-end run pass; it has not yet been used there for a show. Linux has run the tests only. The lists below are what to look at on each.

## What is the same everywhere

Electron gives the same Chromium (so the same Web Audio engine, decoding and device routing) and the same Node on all three. Everything in `core/` is plain Node with no native module. There is no compiled dependency anywhere in the app today, which is why one `npm install` works on any of them.

## What differs

| | macOS | Windows | Linux | Where handled |
|---|---|---|---|---|
| Window chrome | Our title bar holds the window buttons (`hiddenInset`) | Native frame and menu bar | Native frame and menu bar | `main.ts` `createWindow`; `.mac .titlebar` padding in `styles.css` |
| Menus | App menu with Settings and Quit | Settings and Quit under File | same as Windows | `main.ts` `buildMenu` |
| Shortcuts | ⌘ | Ctrl | Ctrl | `CmdOrCtrl` accelerators; `mod(e)` and `keys()` in `app/renderer/lib.ts` |
| Settings folder | `~/Library/Application Support/EndlessCues` | `%APPDATA%\EndlessCues` | `~/.config/EndlessCues` | `app.getPath('appData')` |
| Default shows folder | `~/Documents/Endless Cues` | `Documents\Endless Cues` | `~/Documents/Endless Cues` | `app.getPath('documents')` |
| Paths in a show | forward slashes, relative | same (converted on import) | same | `host.adopt` |
| Audio API under Chromium | Core Audio | WASAPI (shared mode) | PulseAudio / PipeWire | Chromium |
| Local-network permission | Asked once (macOS 15+); declared in `Info.plist` | Firewall prompt on first listen | none | `package.json` `build.mac.extendInfo` |
| Sleep | `powerSaveBlocker` | same | same (depends on the desktop) | `main.ts` |
| Never-take-focus test runs | activation policy `accessory` | `showInactive` only | `showInactive` only | `main.ts`, `smoke.ts` |

Written for Windows and Linux from reading the code, without being run there, so each is still to be seen working:

- **One copy of the app.** Windows and Linux start a second process when a show is opened while the app is running (macOS sends `open-file` to the first). `main.ts` takes the single-instance lock there, and the second hands its path to the first (`second-instance`) and quits.
- **A show named on the command line** may end in `\`, or be the `show.json` inside the folder (a folder cannot be given an app to open with on Windows or Linux): `showArg`.
- **Closing the main window quits** (asking about unsaved changes and sound still playing, as Quit does), so the hidden audio window never keeps the app alive with nothing to click on.
- **Shortcut labels**: every tooltip and message that names a shortcut goes through `keys()`, which also writes ⌥ and ⇧ as Alt+ and Shift+; key caps in Settings ▸ Keys are spelled out off the Mac.
- **About** is under Help where there is no app menu.
- **`npm install`**: the `postinstall` step (clearing a quarantine flag on macOS) is a Node one-liner, which `cmd.exe` can run, and does nothing off the Mac.
- The `ec://` handler refuses a path beside the renderer folder as well as above it (`RENDERER + path.sep`).

Only a person at that computer can check:

- **Windows**: that the installer runs and the app starts; that a second launch with a `show.json` reaches the first; the firewall prompt when the OSC input or the web remote opens a port; audio out through WASAPI and its delay; a show folder on a drive letter path with spaces, and a show made on a Mac opened there with its media; `shell.trashItem` to the Recycle Bin; the menu bar and the native frame around our title bar (which was drawn for a frameless Mac window); Alt alone opening the menu while a show runs (an Alt+key cue hotkey may fight it); high-DPI scaling; file dialogs for `.ectemplate` and `.ecsettings`; `safeStorage` (DPAPI) for the assistant's key.
- **Linux**: the Chromium sandbox in an AppImage; device names under PipeWire and PulseAudio, and whether `setSinkId` reaches a chosen device; Web MIDI (ALSA) permissions; `safeStorage` with no keyring (keys fall back to plain text in `config.json`, said nowhere in the app yet); `powerSaveBlocker` on Wayland; the `.deb`'s desktop entry and icon; the bundled fonts' fallback for `ui-monospace`.
- **Both**: the smoke run (`npm run smoke`), which is the first thing to try; a second window (a cart) on a second screen; drag and drop of files from the file manager (`webUtils.getPathForFile`).

Things to check on first contact with each platform (none verified):

- **Windows**: file URLs for media with drive letters and spaces; the `ec://` protocol handler's path join; the firewall prompt when a module binds a port; whether WASAPI shared-mode latency is acceptable (it is typically 10–30 ms; exclusive mode and ASIO need the native audio engine, [05](05-audio.md)); high-DPI scaling of the 30 px rows.
- **Linux**: the Chromium sandbox in an AppImage (may need `--no-sandbox` or a setuid helper depending on the distribution); device enumeration under PipeWire; the tray-less window on tiling window managers; fonts (the interface fonts are bundled; numbers use `ui-monospace`, which falls back to whatever monospace the desktop provides).
- **All**: a show made on one opened on another, with media.

## Packaging

`electron-builder`, configured in `package.json` under `build`. Output goes to `dist.noindex/` (the suffix stops macOS Spotlight from indexing build output, which otherwise lists a second copy of the app beside the installed one).

| Platform | Targets | Command |
|---|---|---|
| macOS | `.dmg` and `.zip`, arm64 and x64 | `npm run dist:mac` |
| Windows | NSIS installer, x64 and arm64 | `npm run dist:win` |
| Linux | AppImage and `.deb` | `npm run dist:linux` |

`npm run pack` makes an unpacked app for the current platform, which is what to test before making installers. The package contains `app/`, `core/`, `examples/make-demo.ts` and the one runtime dependency (the Anthropic SDK); `docs/`, `site/`, `test/` and `reference/` are left out.

### Before a public release

1. **The icon on every platform.** `build/mark.ts` writes `build/icon.png` (1024 px) and `build/icon.icns` (macOS, with heavier drawings at 16 and 32 px); `electron-builder` derives the Windows icon from the PNG. Not yet checked: how it reads at 16 px in a Windows taskbar, and the Linux icon set.
2. **Signing and notarisation (macOS).** An Apple Developer ID certificate and notarisation credentials in CI. Unsigned, Gatekeeper refuses the app on anyone else's Mac, and macOS ties the Local Network permission to the signature (an app whose signature is broken shows the permission as granted and still cannot reach the network).
3. **Signing (Windows).** A code-signing certificate, or SmartScreen warns on every install.
4. **Auto-update.** `electron-updater` against downloads.endlesscues.com ([`RELEASING.md`](../RELEASING.md)). A show computer must never update itself mid-run: updates are offered, never applied without being asked, and never while a show is open in Show mode.
5. **File association.** A show is a folder. On macOS it is a package the app owns: `com.endlesscues.show`, an exported type conforming to `com.apple.package` (`mac.extendInfo.UTExportedTypeDeclarations`), and the `.ecshow` document type with `isPackage` (`LSTypeIsPackage`), so Finder shows a show as one file with the document icon and a double-click opens it. Checked on an unsigned `--dir` build registered with `lsregister`: `mdls` gives `kMDItemContentType = com.endlesscues.show` (tree: `com.apple.package`, `public.composite-content`, `public.directory`), Kind "Endless Cues Show", NSWorkspace names the build as the app to open it, and `open` delivered the open-documents event to it. File ▸ Open takes the package, a plain show folder or its `show.json` (`core/show/picked.ts`); the pickers for sounds, pictures and a folder to search look inside packages, so a show's `media/` is still reachable (as is Finder's Show Package Contents). Windows and Linux cannot make a folder one file. The cross-platform answer is a single-file export (`.ecshowz`, a zip of the folder) for sending a show to someone, with the folder remaining the working form.
6. **A second name.** The show app this grew from is also called "Endless Cues" and is installed on the original show's computers under a different bundle id. They do not share settings, but two apps with one name on one Mac is confusing; that install should be renamed when this one ships.

## Why Electron

It is the only stack that gives one audio-capable, hardware-accelerated UI runtime on three platforms with no native code, today. The costs are known: ~300 MB installed, Chromium's memory, and Web Audio's ceiling. The architecture is arranged so those costs are contained: the engine is plain Node (it can run headless), and the audio backend is an interface, which the native engine also speaks ([18](18-native-audio.md)). [ADR 0001](../adr/0001-electron.md).
