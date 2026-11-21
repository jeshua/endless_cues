# Development notes

Working material from building Endless Cues, kept because the specs point back to it. None of it is documentation of
how to use the app (that is the manual at endlesscues.com) or of how it is meant to work (that is
[`../specs/`](../specs/README.md)).

| | |
|---|---|
| [`native-qa.md`](native-qa.md) | The native audio engine ([`../specs/18-native-audio.md`](../specs/18-native-audio.md)) measured on real devices: what leaves it, its latency beside Web Audio's, the two engines compared, load. The scripts are `native/audio/qa/` and `test/native-qa/webaudio.ts`. |
| `usability/` | Where `npm run users:collect` writes a run of the virtual users ([`../../test/users/`](../../test/users/README.md)): invented people, each played by a coding agent, using the app through its window and writing a report in the first person. A run is a list of things to look at, not a measure of how usable the app is. The pictures the summaries link to (`shots/`) stay on the computer that ran them and are not in the repository. |

Elsewhere, also notes for development rather than for users: [`../../CLAUDE.md`](../../CLAUDE.md) (the rules coding
agents follow in this repository), [`../brand-assistant.md`](../brand-assistant.md) (how the assistant looks and
speaks) and [`../../test/users/`](../../test/users/README.md) (the virtual-user harness).
