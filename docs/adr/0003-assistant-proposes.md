# 0003 · The assistant proposes; it never edits or plays

**Status:** accepted, and widened: the assistant is now an agent that edits a private draft in as many steps as it needs, with tools to search, check and dry-run it. What has not changed is the promise: it cannot play the show or save it, and its work reaches the show only as a proposal. ("Apply at once" is an opt-in, per-computer setting that skips the review; it is never the default and never applies in Show mode.)

## Decision

The assistant's only write path is `propose_changes`, which stages a batch of edit operations as a diff for a person to accept or reject. It has no tool that modifies the show and no tool that fires, stops or moves anything in the running show.

## Why

- **The cost of a wrong edit is paid in front of an audience.** A sound that does not play, or plays twice, cannot be taken back. Review before landing is cheap; trust after the fact is not.
- **A diff is the right size to review.** An operator can read "three cues added, one level changed" in seconds. They cannot audit a regenerated show file.
- **The same validation as a human edit.** Operations go through `applyOps`, so the model cannot produce a state the app itself could not. Errors go back to the model, not to the person.
- **It keeps the feature honest.** The model cannot hear. It can structure, sequence, rename, wire up and explain; a person with ears decides whether it is right.

## Consequences

- Latency is fine: nothing the assistant does is on the GO path.
- "Agentic" multi-step work is still possible: the model can read, propose, be corrected by a validation error and propose again, all before the person sees anything. What it cannot do is accept its own proposal.
- A future "apply without review" preference is a line we do not cross for edits to a show in Show mode, and would need its own decision record for Edit mode.

## Not chosen

Letting the model call edit operations directly with undo as the safety net. Undo is a good second line; it is a poor first one when the person did not see what changed.
