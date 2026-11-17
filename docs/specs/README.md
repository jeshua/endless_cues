# Endless Cues: specifications

What the product is, how it is built, and why. The code is the source of truth for behaviour; these say what the code is for.

| # | Document | Read it when |
|---|---|---|
| 00 | [Simple until asked](00-defaults.md) | Before adding anything that analyses, decides or acts by itself, or a view beside the cue list. Every such behaviour, its default (off) and its switch; what is free. |
| 01 | [Product](01-product.md) | You want to know who this is for and what it will not try to be. |
| 02 | [Architecture](02-architecture.md) | Before touching `app/`. The processes, what lives where, and the rules that keep a show safe. |
| 03 | [The show file](03-show-file.md) | Before touching `core/show/`. The format, edit operations, diff, versions, proposals. |
| 04 | [The cue engine](04-cue-engine.md) | Before touching `core/engine/`. What every cue type does at run time. |
| 05 | [Audio](05-audio.md) | Before touching `app/audio/`. The signal path, what is sample-exact, where it must go next. |
| 06 | [Control surfaces](06-control-surfaces.md) | Writing a module, or driving the show from outside: host commands, OSC, the web remote. |
| 07 | [Design system](07-design-system.md) | Before touching `app/renderer/`. |
| 08 | [The assistant](08-assistant.md) | Before touching `core/assistant/`. What it may and may not do. |
| 09 | [QLab parity](09-qlab-parity.md) | Deciding what to build next. |
| 10 | [Cross-platform](10-cross-platform.md) | Packaging, signing, and what differs per OS. |
| 11 | (not here) | The service's design lives with the service, in the private `endless_cues_service` repository. |
| 12 | [Roadmap](12-roadmap.md) | The order things are meant to happen in. |
| 13 | [Video and the stage](13-video.md) | Before touching `app/stage/` or `core/video/`. The output window, why a video is a sound with a picture, what formats play. |
| 14 | [Lighting](14-lighting.md) | Before touching `core/light/`. DMX out, the patch, Light cues that hold levels, and the test scripts for real equipment. |
| 15 | [The assistant and the rig](15-assistant-and-rig.md) | Before building devices, Device cues, the Rig page (the pre-show check), the assistant's folder, script, equipment and prop tools, or the hand-over to coding agents. A design with its build plan; not built yet. |
| 16 | (not here) | The hosted assistant's design and costs live with the service, in the private `endless_cues_service` repository; what the app sends it is in 17. |
| 17 | [The service protocol](17-service-protocol.md) | Before the app talks to endlesscues.com's service: reports ("Report a problem"), sign-in and device tokens, the admin API, the hosted assistant's endpoints. A copy of `PROTOCOL.md` in the private service repository (change both together); usable under the MIT licence. |

Decisions that were not obvious are recorded in [`../adr/`](../adr): one short file each, with what was chosen, what was not, and what would change the answer.
