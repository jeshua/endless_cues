# 0002 · Versions are files beside the show, not rows in a CMS

**Status:** accepted. The hosted layer is open.

## Context

The show needs history: checkpoints, a readable diff between any two, going back. The brief suggested something like Payload CMS, which gives versioned documents, drafts and an admin UI out of the box.

## Decision

Versions are whole snapshots of `show.json`, content-addressed, in `versions/` inside the show folder, with an index (`core/show/versions.js`). Diffs are computed from two snapshots by our own differ, which speaks cues and fields rather than lines (`core/show/diff.js`).

## Why not a CMS for this

- **A show must open with no server.** Payload needs Node, a database (Postgres or MongoDB) and, in practice, its Next.js app. A booth laptop on a network with no internet cannot depend on any of that, and bundling a database into a desktop app to store kilobytes of JSON is a great deal of machinery for the job.
- **The show should be a thing you can hold.** Copy the folder to a USB stick and the history comes with it. Put it in git and git works. Neither is true of rows in a database.
- **The diff we need is domain-specific.** "Cue 3: level 0 dB → −8 dB; Rain returns moved into Thunder" is not what a CMS's version compare produces. We had to write the differ either way.
- **Size is not a problem.** Tens of kilobytes per version; a thousand versions is a few megabytes.

## Where a CMS does fit

The *hosted* side: accounts, shared shows, a browsable history on the web, a device library that staff edit. Payload is a sensible way to build that back office, on Cloudflare (it runs on Workers with D1) or anywhere else. The app's side would not change: it already produces immutable, hash-named blobs and an index, which upload as-is. So this decision leaves the door open; it only refuses to make the server a requirement for a feature that works without one.

## What would change this

Real-time collaboration, if it arrives, needs a server-side document. Even then the local version store stays, as the offline truth.
