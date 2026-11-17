# Releasing

How a version of Endless Cues is numbered, built and offered. `bin/release.ts` does the mechanical parts; it uploads
only when a person runs `publish`, and never deploys, commits, tags or pushes: those are a person's decisions.

## Numbers

- **The app's version** is `package.json`'s `version`, shown in Settings ▸ About with the commit and date of the build.
  It is `MAJOR.MINOR.PATCH`, with `-alpha.N`, `-beta.N` or `-rc.N` after it for a version that is not yet a release:
  `0.2.0-alpha.1`, `0.2.0-alpha.2`, `0.2.0-beta.1`, `0.2.0`.
  - Until 1.0: MINOR goes up for a version with new things in it, PATCH for one that only repairs. Anything may change.
  - `alpha`: parts of it have not met the equipment they are for (see `docs/qlab-tracker.md` and CLAUDE.md's
    "Not verified yet"). `beta`: everything in it has been run by a person on a real show's equipment. `rc`: a beta
    nobody has found a fault in for a fortnight of use.
  - The product is called "Endless Cues Public Alpha" until the first beta; then the name in `package.json`
    (`productName`) changes, and with it the app's file name.
- **The show file's version** (`version` in `show.json`, `core/show/show.ts`) is a different number. It goes up only
  when an older app could not safely open a newer file. A newer app always opens an older file; an older app refuses
  a newer file with a reason, and never guesses.
- **A tag** `v<version>` marks the commit a published build was made from.

## A release, step by step

1. `npm test && npm run smoke` on the commit to be released. Read `CHANGELOG.md`'s "Unreleased": it is what a person
   decides to update on, so it says what changed for them, including what is not yet verified.
2. `node bin/release.js version 0.3.0-alpha.2` sets the number and dates the changelog. Commit that ("Version …").
3. `node bin/release.js mac` builds, signs and notarises (about an hour): into `dist.noindex/` go
   `Endless-Cues-<version>-mac-arm64.dmg` and `…-mac-x64.dmg` (to download), `…-mac-arm64.zip` and `…-mac-x64.zip`
   (what an installed app updates from), a `.blockmap` beside each (so an update fetches only what changed), the feed
   `latest-mac.yml` that names them, and `release.json` (every file's size and SHA-256). It says so if the tree had
   uncommitted changes or the build is not signed; `publish` refuses either.
4. `node bin/release.js publish` (or `publish --channel test`; `--dry-run` first lists what it would do) uploads
   to the R2 bucket `endlesscues-downloads`, served at `https://downloads.endlesscues.com/`, with
   `cf cues/cloudflare r2 object put … --remote` (the `cues` AWS profile holds the token). In this order:
   the `.dmg`s, the `.zip`s, the blockmaps, each checked by asking its address for its size; then `latest-mac.yml`,
   uploaded uncached and read back. A file that does not answer with its size stops it before the feed changes, so no
   installed app is ever offered a file that is not there. It refuses an unsigned build, one made with uncommitted
   changes, and a feed that is for another version or names a file the build does not have.
   - **Everyone** (`publish`): the files at the top of the bucket. Then the test feed (`test/latest-mac.yml`) is moved
     on to this version too, by full addresses, unless it already offers a newer one: a tester is never left behind.
   - **Test versions** (`publish --channel test`): everything under `test/`. Only an app with Settings ▸ General ▸
     Test versions on reads it. Try it there; to give it to everyone afterwards, `publish` the same build (nothing is
     rebuilt). The site is not changed for a test version.
5. `node bin/release.js site --base https://downloads.endlesscues.com/` (everyone's versions only) writes the
   download into the website, which is not in this repository: it is `site/` in the private service repository,
   `endless_cues_service`, checked out beside this one (`../endless_cues_service/site`; `--site-dir <dir>` or
   `EC_SITE_DIR` names another, and the step stops with a clear message if there is no site there). It writes the
   buttons, the version and date, each file's SHA-256 (folded away) and a link to the changelog, the site's
   `releases.json`, and its `_redirects` (`/download/mac-arm64` and `/download/mac-intel` lead to the files, so moving
   them later is one line). `node bin/release.js site --none` puts "nothing to download yet" back.
6. In the service repository: look at the site (`python3 -m http.server -d site 8788`), `node site/stamp.js`, commit,
   deploy it (its `README.md` has the command), and follow each download link once from a browser.
7. Tag the commit (`git tag v<version>`), push the tag, keep a copy of `dist.noindex/latest-mac.yml` and
   `release.json` somewhere outside the repository, and delete `dist.noindex/`.

## Windows

Installers to download, built from the same commit as the Mac's (any computer will do: electron-builder makes NSIS
installers on a Mac without Wine), and signed there too, through Azure Artifact Signing (below). Unsigned, Windows
SmartScreen says "Windows protected your PC" the first time; the site says how past it (More info ▸ Run anyway).
**No update feed**: an installed copy checks,
finds no `latest.yml`, and says the server has no version for this computer yet.

1. `node bin/release.js win` builds `dist-win.noindex/Endless-Cues-<version>-win-x64-setup.exe` and
   `…-win-arm64-setup.exe` (one installer an architecture; a combined one is twice the download) and
   `dist-win.noindex/release.json`. Each installs for the person alone, without an administrator, under
   `%LOCALAPPDATA%\Programs`. With `EC_WIN_SIGNING` set it signs (below); without it, it says it did not.
2. Try it on Windows: `endless_cues_service/winbox/winbox install dist-win.noindex/<x64 installer>` installs it on the
   test box and runs the installed app through the end-to-end check.
3. `node bin/release.js publish --win` (or `--channel test`, `--dry-run`) uploads the installers, each checked by its
   size where it is served, through Cloudflare's cache as a downloader gets it. It refuses a build with uncommitted
   changes, or one signed with a test certificate; unsigned is allowed, since nothing installs it unasked. Publishing
   over files of the same names (the same version signed, say) leaves the old ones in the cache for up to four
   hours: publish then says so, and Cloudflare ▸ endlesscues.com ▸ Caching ▸ Custom Purge clears those addresses.
4. `node bin/release.js site --base https://downloads.endlesscues.com/` writes Windows beside the Mac: buttons
   (`/download/windows`, `/download/windows-arm64`), the SmartScreen note, and the checksums (`Get-FileHash`).
   A platform with no build here keeps what the site already offers, so the Mac and Windows can be released apart.
   Then the service repository's steps as above. Delete `dist-win.noindex/` afterwards.

### Signing the Windows installers

Through **Azure Artifact Signing** (Microsoft's signing service, once called Trusted Signing): Microsoft holds the
certificate and signs each file's hash, so there is no key file or token to keep. It takes individual developers in
the United States and Canada (organisations in more places), on its Basic plan (about $10 a month).
`build/sign-win.ts` signs each file electron-builder signs (the app, its uninstaller, the installer) with
[jsign](https://ebourg.github.io/jsign/), which runs on a Mac; `bin/release.ts win` then reads every signature back
and refuses a build in which one is missing.

Once, in the Azure portal (portal.azure.com):

1. An Azure subscription (pay as you go). Its billing account's **Account Type is Individual**, and its legal name and
   sold-to address match the government ID exactly: Microsoft takes the certificate's name from there.
2. The subscription's resource providers: register `Microsoft.CodeSigning`.
3. Create an **Artifact Signing account** (Basic) in a region that offers it. Its endpoint is on its Overview page
   (East US's is `eus.codesigning.azure.net`).
4. In it, **Identity validations ▸ New ▸ Public ▸ Individual**. Microsoft emails a link to verify the ID with a
   phone; it takes from hours to days.
5. Once it says Completed: **Certificate profiles ▸ Create ▸ Public Trust**, with that validation.
6. **Access control (IAM)** on the account: give the person who releases the role **Artifact Signing Certificate
   Profile Signer** (Trusted Signing Certificate Profile Signer in older portals).

Each release, on the Mac that builds it (`brew install jsign azure-cli`, then `az login` once):

```bash
EC_WIN_SIGNING="eus.codesigning.azure.net <account> <certificate profile>" node bin/release.js win
```

It asks `az` for an hour's signing token and gives it to jsign by the variable's name, never on a command line.
`release.json` then says `"signed": true`, and the site says the installer is signed. A new certificate has no
reputation with SmartScreen yet, so the site still says how past the warning until it has.

To try the signing path without Azure: a certificate of your own (`openssl req -x509 … -addext
extendedKeyUsage=codeSigning`, then `openssl pkcs12 -export`) as `EC_WIN_SIGN_P12=<file.p12>
EC_WIN_SIGN_P12_PASS=<its password> node bin/release.js win --x64-only`. Windows trusts no such signature, so
`release.json` marks it `testSigned`, and neither `publish` nor `site` will take it. `osslsigncode verify -in
<installer>` (from Homebrew) checks a signature's hashes on a Mac.

## Updates

An installed app (from 0.3.0-alpha.2) reads `latest-mac.yml` from `https://downloads.endlesscues.com/`, or from
`…/test/` with Settings ▸ General ▸ Test versions on: once a day in Edit mode with nothing playing, and on Help ▸
Check for Updates…. A newer version there is offered in one line in the title bar; nothing is downloaded until the
person presses Download, and it installs when they quit (or press Restart now). The rules are in
`core/update/updates.ts` and [`docs/specs/00-defaults.md`](specs/00-defaults.md).

- **macOS installs only a build signed by the same Developer ID as the one running.** An unsigned build can find and
  download an update and then be refused; never publish one (`publish` will not).
- The feed's version is compared as semver: `0.3.0-alpha.10` is after `0.3.0-alpha.9`, and `0.3.0` after every
  `0.3.0-…`. An older version on the feed is never offered (no downgrades).
- Each check is one GET of the feed's file. electron-updater's per-computer id (for staged roll-outs, unused here) is
  replaced by the same zero id on every computer, so nothing about the person or the show goes with it.
- A version that must not spread: upload the previous version's `latest-mac.yml` over the feed (its files are still
  in the bucket; keep each release's feed file, from `dist.noindex/`, before deleting the folder). Nobody else is
  offered the bad one; whoever has it keeps it until a newer version is published.
- Windows (NSIS, `latest.yml`) and Linux (AppImage, `latest-linux.yml`) feeds are written by the same configuration,
  but neither platform is offered, `publish` uploads only the Mac's files, and no update has run on either.
- To try the updater without publishing: build (`EC_UNSIGNED=1 node bin/release.js mac --arm64-only`), serve a folder
  holding that zip, its blockmap and a copy of `latest-mac.yml` with a higher `version:` (`python3 -m http.server 8765
  --bind 127.0.0.1`), and start a test session with `EC_UPDATE_FEED=http://127.0.0.1:8765/ node bin/ec-user.js
  .scratch/u start`, then Help ▸ Check for Updates… and Download. Run from source, it gets as far as the download
  and macOS's installer then refuses it (the running app is Electron, not the build): that is the end of what can
  be tried without two signed builds.

## Signing

A Mac will not open an app downloaded from the web unless Apple has notarised it, which needs an Apple Developer ID
(a paid developer account). `bin/release.ts mac` signs and notarises when this computer's keychain has a
"Developer ID Application" certificate and the notary's credentials: a keychain profile called `endless-cues`
(made once with `xcrun notarytool store-credentials "endless-cues" --key <AuthKey.p8> --key-id <id> --issuer <id>`;
`EC_NOTARY_PROFILE` names another), or, failing that, the environment's own, never a file here:
`APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER` (an App Store Connect API key), or `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`. After a signed build it asks macOS (`spctl`) whether it accepts each app, and refuses to go on if it does not.
Without them (or with `EC_UNSIGNED=1`) the build is ad-hoc signed; the site then says, beside
the download, how to open it (`xattr -dr com.apple.quarantine …`) and gives the SHA-256 to check the file against.
An unsigned build is acceptable for an alpha among people who know what that command does, and not beyond that.

## Windows and Linux

`npm run dist:win` and `npm run dist:linux` exist and have never been run to a working app. Neither is offered until a
person has launched one and run a show's worth of cues on it (`docs/specs/10-cross-platform.md` lists what to check).
