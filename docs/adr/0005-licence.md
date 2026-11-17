# 0005 · Licence

**Status:** decided: AGPL-3.0-or-later, with the contributor agreement in `CONTRIBUTING.md`. The repository stays private until the owner makes it public.

## The choice

| | What it means here |
|---|---|
| **AGPL-3.0** | Anyone can use, modify and redistribute; anyone who distributes a modified version, or runs one as a network service, must publish their changes. A company cannot take the code closed. (LivePlay, the nearest open-source neighbour, is AGPL.) |
| **GPL-3.0** | The same without the network clause. For a desktop app the practical difference is small. (Linux Show Player is GPL.) |
| **MPL-2.0** | File-level copyleft: changes to our files stay open, but they can be combined with closed code. A middle path. |
| **Apache-2.0 / MIT** | Do anything, including a closed commercial fork. Maximum adoption; no protection. |

## Recommendation

**AGPL-3.0 for the application, with a contributor licence agreement** (or copyright assignment) so the project can also offer a commercial licence to someone who needs one, and so the hosted service is not itself bound in awkward ways.

Reasons: the realistic risk for a tool like this is not that nobody adopts it because of copyleft (venues and designers run software; they do not embed it); it is that an established vendor ships it with their own name on it. AGPL prevents that and costs users nothing. The show file format is separately declared free to implement by anyone, so that no one's shows are tied to this code.

Vendored code (`app/renderer/vendor/preact-htm.js`: Preact, MIT; htm, Apache-2.0) keeps its own licences, which sit beside it.

## Before going public, regardless of licence

- Check the history: this repository has never contained the private snapshot it was ported from (`reference/` is gitignored), and the ported files' comments were rewritten. A final read of `core/engine/cue-engine.ts` and `app/audio/audio.html` for anything show-specific is still worth doing.
- Have the contributor agreement in `CONTRIBUTING.md` looked at by someone qualified before accepting outside code; it is plain language, not a lawyer's text.
