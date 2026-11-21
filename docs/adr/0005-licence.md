# 0005 · Licence

**Status:** decided: GPL-3.0-or-later, with the contributor agreement in `CONTRIBUTING.md` (changed from AGPL-3.0-or-later on 2026-11-21, for every version after 0.3.0-alpha.6; versions published before stay under the AGPL).

**The change, 2026-11-21.** The owner does not mind the program being run for others as a service, so the AGPL's network clause buys nothing he wants and makes some people wary. The GPL keeps what the decision below was for: nobody can ship it closed under their own name. The contributor agreement is unchanged.

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

- Nothing show-specific is in the code: `reference/` (the private snapshot the engine came from) is gitignored and stays so. A final read of `core/engine/cue-engine.ts` and `app/audio/audio.html` for anything show-specific is worth doing.
- Have the contributor agreement in `CONTRIBUTING.md` looked at by someone qualified before accepting outside code; it is plain language, not a lawyer's text.
