# 0004 · What is open and what is paid

**Status:** accepted. Bring-your-own-key covers Anthropic, OpenRouter, OpenAI, any OpenAI-compatible service, and local models through Ollama.

## Decision

Everything that runs on your computer is open source, including the assistant's client code, its prompts and its tools. What is paid is what runs on ours: the hosted assistant (an account, no key to manage, the model's cost included), and later other things that need a server.

The rule: **a feature is paid only if it costs us money each time it is used.** Nothing is withheld from the open app to make the paid tier attractive.

## Why

- **The audience is small and talks to each other.** Theatre technicians trust tools that do not hold their shows hostage. "The app is free and whole; the convenient hosted thing costs money" is a position people defend on forums. "The good features are locked" is the opposite.
- **The moat is not the client.** The prompt and tools are a few hundred lines; anyone could rewrite them. What a designer in tech week will pay for is not having to get an API key, set an environment variable and watch a usage dashboard.
- **Open client code is a safety feature.** People can read exactly what is sent and verify that the assistant cannot play their show.

## The uncomfortable part: bring your own key

The open app can talk to a model directly with the user's own credentials (Anthropic, OpenRouter, OpenAI, a custom endpoint, or a local model). That is a free substitute for the paid tier, for anyone technical enough to use it.

Recommendation: keep it. It is the honest floor (a developer could add it in an afternoon regardless), it is how contributors will work on the assistant, and the people who use it were not going to pay. It is presented as a developer option, not hidden and not promoted.

If this proves wrong (most would-be customers use their own key), the response is to make the hosted tier better (shared history, collaboration, multiple seats), not to remove the option.

## What would change this

A funding model that needs more than the assistant can carry. Then the candidates for paid are, in order: hosted history and sharing, collaboration relay, main/backup pairing across sites, priority support. Never the cue engine, the file format or any offline capability.
