# Security

If you find a security problem in Endless Cues, please email **jeshua@endlessformspuppetry.com** rather than
opening a public issue.

Please include:

- the version (Settings ▸ About, or `version` in `package.json` if you run from source) and your system
- what the problem is and what someone could do with it
- the steps to show it, or a small show file that does
- whether you have told anyone else

You will get a reply within a week. Once it is fixed, the fix is described in `CHANGELOG.md`, with your name if
you want it there. There is no bug bounty.

## What is in scope

The app in this repository: the cue engine, the show file and its folder, the network listeners (the web remote,
OSC and MIDI control, main and backup), the files the app writes (prop firmware, the guide for coding agents), the
assistant's tools and the command-line programs in `bin/`.

The hosted service at endlesscues.com (accounts and the hosted assistant) is run separately, from a different
repository. Problems with it are welcome at the same address, but this repository cannot fix them.
