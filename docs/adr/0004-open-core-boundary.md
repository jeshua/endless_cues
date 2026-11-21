# 0004 · What is free, and what a hosted assistant would be

**Status:** accepted; revised 2026-11-21. Nothing is paid. The app, all of it, is free and open source.
Bring-your-own-key covers Anthropic, OpenRouter, OpenAI, any OpenAI-compatible service, and local models through
Ollama, and the assistant also runs through Claude Code or Codex.

## Decision

Everything that runs on your computer is open source and free, including the assistant's client code, its prompts
and its tools. There is no tier, licence check, trial or "pro" switch anywhere in the code ([00](../specs/00-defaults.md#is-every-integration-free)).

The code also has a client for a hosted assistant (the `cloud` provider: an Endless Cues account, signed in from the
app, with no key to manage), and the service it talks to lives in the private `endless_cues_service` repository
([17](../specs/17-service-protocol.md)). It is optional. It isn't running for everyone yet: if people want it, the
owner may host it so they can try the assistant and use it for a while without a key of their own.

The rule, if anything is ever hosted: **only what needs a server is hosted**, and nothing is withheld from the open app
to make a hosted thing attractive.

## Why

- **The audience is small and talks to each other.** People who run shows trust tools that do not hold their shows
  hostage. The app is free and whole, and that stays true whatever happens to a hosted assistant.
- **A hosted assistant is a convenience, not a feature.** The prompt and tools are a few hundred lines and are all
  here. What hosting would save someone is getting an API key, setting it up and watching a usage page.
- **Open client code is a safety feature.** People can read exactly what is sent and check that the assistant cannot
  play their show.

## Bring your own key

The open app talks to a model directly with the user's own credentials (Anthropic, OpenRouter, OpenAI, a custom
endpoint, or a local model), or through Claude Code or Codex. That is the main way to use the assistant, it is how
contributors work on it, and it stays.

## What would change this

Hosting costs money each time it is used. If a hosted assistant ever outgrows what the owner can run for free, the
answer is a limit on the hosted thing, never on the app: never the cue engine, the file format or anything that works
offline.
