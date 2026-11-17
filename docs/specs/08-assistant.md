# 08 · The assistant

Source: `core/assistant/` (`tools.ts`, `assistant.ts`, `helper.ts`, `starters.ts`, `guide.ts`, `mcp.ts`) and `core/kit/`, tested by `test/assistant.test.ts`, `test/assistant-tools.test.ts`, `test/assistant-rig.test.ts`, `test/starters.test.ts`, `test/kit.test.ts` and `test/guide.test.ts`; the review UI is `app/renderer/Drawers.ts`.

> [15 · The assistant and the rig](15-assistant-and-rig.md) is the design for the assistant beyond cues: the show
> folder, the script, devices, the Rig, a prop's firmware, the hand-over, and the first screen. **Its assistant part
> is built** (sections "Beyond cues", "The first screen" and "The built-in helper" below say what is there and how
> it was checked); 15 remains the reference for why each thing is as it is.

## What it is for

Building and changing a show by describing the change.

> "Duck the rain under the thunder and bring it back after four seconds."
> "Add a five-second fade-out after every music cue in act two."
> "Renumber from the interval in tens, and name the fades after what they fade."
> "Why does cue 14 cut off the underscore?"

A cue list is a structure with rules (targets, groups, continue modes) that takes a while to learn and is tedious to restructure by hand. A model that knows the rules and can see the whole show is good at exactly that. It is bad at knowing what a show should *sound* like, so it does not get to decide.

## An agent, on a draft

The assistant is an agent: it works in steps (look, change, check, fix) until the job is done, rather than answering once. It works on a **draft**, a private copy of the show that starts as the show is now.

| Tool | Does |
|---|---|
| `read_show` | The outline of the draft (every cue: id, number, type, name, its fields, what targets what; buses and their outputs, patches, every setting, modules), a run of cues in full (`from`, `count`), or one cue as JSON. |
| `read_reference` | The reference in full, a part at a time: a cue type's every field with its values and help, every setting path, the device fields, a model's commands (see "Prompt size"). |
| `find_cues` | Search by type and by text, in everything written on a cue (any text field in the cue-type table). Hits come with their settings. For long shows. |
| `list_media` | The sound files in the show folder, their lengths, which cues use each, and which are missing. |
| `edit_show` | Apply [edit operations](03-show-file.md#edit-operations) to the draft. Atomic per call; returns what changed, the ids of new cues, and any problem the batch has just caused (a target that is gone, a bus that does not exist). As many calls as the job needs. |
| `check_show` | What is broken in the draft: missing targets and files, wrong target types, missing patches, duplicate numbers. |
| `simulate` | A dry run of the draft on the real cue engine (`core/engine/dry-run.ts`): press GO n times from a cue, and read what plays at what level, what fades, what is sent where, and what is still sounding. No sound, no waiting. |
| `propose_changes` | Finish: hand the draft over as one change for the person to review. |

Beyond cues (below) it has eight more: `list_folder`, `read_file`, `rig_status`, `read_monitor`, `ask_device`, `find_devices`, `make_prop_files`, `hand_off`. `read_show` also takes `device`; `edit_show` and `propose_changes` take the three device operations.

The operations can do anything to a show: add, change, remove, move, duplicate and renumber cues; restructure groups and lists; set any setting (buses, network patches, GO behaviour) and any module option.

`simulate` is what makes it more than a text editor. A model cannot hear, but it can read "0.00 s Thunder plays · 0.00 s Rain → −16 dB over 0.4 s · 4.00 s Rain → −6 dB over 2.5 s" and see whether the duck it built does what was asked, or that the fade it aimed at a cue does nothing because that cue is not playing at that point.

## The safety design

What the assistant cannot do is the design:

- **It cannot play the show.** There is no tool that fires, stops or moves anything in the running show.
- **It cannot save.** Whatever it does is, at most, a pending edit like any other.
- **Its edits are to a draft.** Nothing reaches the show until `propose_changes`, and then only as a proposal: a diff (cues added, removed, changed field by field, moved) with Accept and Reject.
- **A wrong edit never reaches the person.** An invalid batch is refused whole and the reason goes back to the model, which corrects itself.
- **"Applied" means it happened.** The operations themselves refuse what cannot be applied. The assistant's tools also refuse what *can* be applied and would do nothing or the wrong thing, because a model does send these: a key an operation does not take (`to` on a `cue.move`, which would otherwise land the cue at the end of the list), a `cue.set` with no `props`, a move with no destination, a setting of the wrong kind (`panicFade: "fast"`), a bus or patch with no id, a bus index that is not there. A bus or a patch can be named in a `show.set` path by its id (`settings.audio.buses.music.out`).
- **The person's own edits are not undone.** The draft is a copy of the show from the moment of the first edit, and a person can change the show while the agent works (an agent outside the app may hold a draft for an hour). Before every tool call the draft is compared with the show; if the show has moved on, the draft is rebuilt on the show as it is now by applying the turn's batches again, and the model is told (with the new ids of the cues it added). If they no longer fit, the draft is dropped and the model is told to look again. Without this a proposal titled "rename the memo" would also quietly put back the level the person had just ridden.
- **Accepting is one undo step**, and is not kept until the show is saved. The worst case of a bad acceptance is ⌘Z.
- **A stale proposal cannot land.** If the show changed while it waited, accepting is refused.
- **It never invents media.** The instructions forbid it, `list_media` says what exists, and `check_show` flags a file that is not on disk.

**Apply at once** is a per-computer setting, off by default. On, a finished proposal is accepted without the review step. It is still one undo step, still unsaved, and it never happens in Show mode. It exists for building a show quickly in rehearsal; review is the default because the cost of a wrong edit is paid in front of an audience.

The principle: the model's work is *edits in the show's own edit language*, checked by the same code that checks a person's edits, and shown before it lands.

## Beyond cues

Since [15](15-assistant-and-rig.md) a show has equipment and a folder, and the assistant can see both. Every tool is one of three classes, and there are only three:

| Class | Tools | |
|---|---|---|
| **Look** | `read_show`, `read_reference`, `find_cues`, `list_media`, `list_folder`, `read_file`, `check_show`, `simulate`, `rig_status`, `read_monitor` | Changes nothing, sends nothing. `list_folder` and `read_file` stay inside the show folder (`core/rig/folder.ts` refuses the rest with a sentence); `rig_status` is the Rig page as text, worst first, with each device's reports and this computer's outputs, displays, MIDI ports and networks; `read_monitor` is the network monitor and the unknown senders. |
| **Change** | `edit_show`, `propose_changes`, `make_prop_files`, `hand_off` | Reaches the show, or its folder, only through a proposal and a person's Accept. Devices are edited with `device.add` / `device.set` / `device.remove`. The two file tools call the app's own generators (`core/kit/kit.ts`, `core/assistant/guide.ts`) with a few settings: **the model writes no file**. Staged files ride on the turn (`ctx.files`) and are written when the proposal is accepted; a proposal may be files alone; an existing `secrets.h` is left out. |
| **Ask** | `ask_device`, `find_devices` | The one thing sent to equipment: "are you there?". |
| **Point** | `show_in_app` | Rings a place in the window for the person (below). Changes nothing, sends nothing, and nothing at all in Show mode. |

**The ask, exactly.** `ask_device {device}` sends the `alive.send` of a device that is *in the show* (a device only in the draft is refused: a person has not accepted it). `ask_device {host, port, probe}` sends the built-in test message of a model (`probe` is a model id) to an address written as numbers on this computer or a private network (10/8, 172.16/12, 192.168/16, 169.254/16, 127/8); a name is refused, since it could resolve anywhere. It can never choose the message. `find_devices` is the one fixed hello of the prop kit, and is refused while a cue runs. All three are refused in Show mode ("Show mode: an assistant sends nothing to the equipment"), with no app running, and after 30 asks in a turn (for an agent outside the app, which has no turns, the count starts again after five minutes without an ask). Hold Back holds them and the answer says so. **It can never send a device a command**: that is a person's click on Try, or a cue.

**The outline** gains one line a device (`core/rig/devices.ts` `line`; more than 12 devices: ids and names, and `read_show {"device": …}` for one) and at most three more: `Rig:` (the script and its marks, the checklist, what the folder holds), `Rig now:` (only with the app running: the summary and what is not ready), and the show's notes when it has them (an imported show's notes say what did not come across). File names are not in it. The device list is kept off the Settings line.

**The reference** gains DEVICES (every device, command, parameter, alive and report field, written from the tables in `core/rig/devices.ts`; the three operations; the Device cue; making a patch a device) and MODELS (each model's id, usual port, commands and test message), which replaces the old "NETWORK DEVICES". A test adds a field to the table and finds it in the reference.

**The instructions** gain four short parts (equipment, the folder, a prop, beyond this) as 15's section 4.5 has them, with three additions that came from running real turns: replies are plain text (the drawer shows them as typed, so no Markdown); cues made from a folder are numbered in order, and a group of sounds meant to be played one per GO has mode `enter`; and the kit's firmware is said, once, not to be proven on hardware.

**The hand-over** (`hand_off`, or Settings ▸ Assistant ▸ *Write the guide for coding agents*): `AGENTS.md` and a one-line `CLAUDE.md` in the show folder, generated from the show and regenerated whole each time: what the folder is, five rules (change the show only through the tools or `ec apply`; not while `show.unsaved.json` exists; propose, never play or save; send nothing to equipment unasked; never print `secrets.h`), the command lines with this computer's real paths, every device with its commands, the kit's protocol, and what the app will not do (run code, speak HTTP, flash a board) with the usual answer to each (a small bridge program that the show reaches as a device). The reason the model gives is used for nothing but the proposal's title: no model-written text goes into the file.

## How to use the app, and pointing

The assistant knows the window as well as the show. `read_reference {"about": "app"}` (or `"screens"`, `"keys"`) is a short guide to it (`core/assistant/app-guide.ts`): the title bar, the masthead, the add-cue bar, the cue list, the inspector's tabs, the side panel, the footer and Settings' panes, one line a thing a person looks for. The keys part is written from `core/ui/keys.ts`, the one table of keys: the menus are built from it (`main.ts` has no accelerator of its own), the window's handler and Settings ▸ Keys read it (the preload hands it over before the page's modules load), and so the guide cannot name a key the app does not bind. The instructions have one line for it ("Asked how to use the app… read_reference "app", never guess, and show_in_app to point at it"); the guide itself is read only when a question needs it.

`show_in_app {target, say?, cue?}` points. `target` is a name in `core/ui/places.ts`: fixed places (`go`, `panic`, `save`, `more-menu`, `add-cue-more`, `zoom`, `mixer`, `check`, `report`, `assistant-settings`…) and families (`tab:<edit|rig|show|live>`, `add-type:<type>`, `inspector-tab:<basics|type|time|design|triggers>`, `inspector-field:<key>`, `cue:<number or id>`, `settings:<pane>`). Each maps to a selector (a `data-*` attribute wherever one could be had) and, when it is not always on screen, the steps that bring it there: Settings opened at the pane, the cue list shown, a cue selected (the one named, else the selection if it has the field, else the cue standing by, else the first that has it), an inspector tab brought forward, More opened. Every name in the guide's text is in [brackets], and a test checks each is a place. The host pushes the place; the main window (`app/renderer/Point.ts`) does the steps, rings the element with a slow pulse in `--accent` and the words beside it, scrolled into view, and answers whether it could; the ring takes no clicks and goes after six seconds or at any click or key. A place not on screen says why (a row's ■ is there only while it plays; the Live tab only when the Live view is shown), or falls back to where it lives (an update not waiting: Settings ▸ General). A menu item is not ringed: the ⋯ button is, with the item named; a menu-bar item (Find, Load to Time, Run from here) has no place and the tool says so in words. Refused in Show mode (the host, then the window again), and with no window (an agent on a show folder alone). The reply carries the places it pointed at, and the drawer shows a "Show me" for each, which points again. The built-in helper answers the commonest "where is…" and "what is the key for…" from the same guide and points.

What it cost: the fixed part went from 6,914 tokens to 7,047 (`gpt-6.1-terra`'s tokenizer, 2026-11-17): 34 for the instructions' line, 99 for the tool. The guide is about 2,700 tokens when read.

## The first screen

`core/assistant/starters.ts` `first()` is what the drawer shows before the first message (`assistant.first` in the state push; `assistant.status(ctx)` computes it, keeping the folder's file names for two seconds and "which agents are installed" for thirty). It is `{ state, line, asks, next, setup, helper }`:

| State | `line` | Asks, each only when true |
|---|---|---|
| `empty` | "An empty show." | *Start from a folder of sounds…* (carries `action: 'start-in-folder'`; its text, if sent instead, is answered by the helper with where the menu item is) |
| `folder` | "11 sounds and 1 text file not in a cue yet." | *Make cues from these 11 sounds* · *Make cues from notes.txt* (the only text file, or the only one that calls itself a script, cue sheet or running order) |
| `cues` | "42 cues, 3 of them broken." | *Fix the 3 broken cues* · *Make cues for 4 unused sounds* · *Renumber Main in tens* (a number missing, repeated, out of order, or a point number) · *Add a fade-out after every Music cue that has none* (two or more Audio cues nothing is aimed at) |
| `devices` | "3 devices: 2 answering, Lantern A is not." (with no live state: their names) | *Why is Lantern A not answering?* · *Add a cue: Identify to Lantern B* (a device no cue uses) · *Is everything ready?* · *Write firmware for Lantern B* (a kit prop with nothing under `props/`, in a saved show) |
| `imported` | "Imported from QLab: 84 cues, 3 network patches, 6 things did not come across." | *What did not come across?* · *Check the show for problems* · *Make “Eos” a device* |

At most four asks. `next` is one quiet line, the rung above. With the provider off the state is `no-model` (`under` names the state beneath): only the asks marked `offline` are offered, `next` says "(That needs a model: below.)", and `setup` holds the rows of 15's 4.6.1 (`{ id, label, says, found, set, open }`: `set` is a provider to switch to at once, `open` the provider to open Settings on), each true of this computer. With the built-in helper answering, the asks are likewise only its own and `next` says what it is. A test presses every ask the first screen offers the helper, round after round as the show grows, and fails if one falls through to its list.

## The built-in helper

The provider `demo`, shown as **Built-in helper** (`core/assistant/helper.ts`): no model, nothing sent anywhere, and a short list of jobs, each a scripted turn through the real tools, so each ends in the same review and each is a test of the tools: cues from the folder's sounds (`starters.folderPlan`: file-name order, numbered, named without numbers, extensions and bounce words such as "FINAL v3"; a sub-folder, or a scene prefix two or more files share, is a group that plays one sound per GO; a file called "loop" is *said*, never set to loop); a device from a model named in words ("add a lantern at 10.0.0.42", "my lighting desk is an ETC Ion at 10.0.0.20"; a thing it does not know becomes a plain device with no commands, and it says so); "look for props"; "add a cue that sends identify to Lantern"; "is everything ready?" and "why is Lantern not answering?"; "write firmware for Lantern"; "hand the show over"; "renumber Main in tens"; "check the show for problems"; "turn the patch Eos into a device"; the five one-line edits it always had; and where a thing is in the window or what its key is ("where is Panic?", "how do I change a cue's colour?", "what is the key for Save?": the guide's line, the key from the table, and the place pointed at). Asked anything else it says what it is, lists its jobs in the words to use, and says where a model is chosen. It never pretends to more.

## One turn

```
ask(text)
  → messages += user: [ <show_…>, text ]                             the show as it is now travels with the question:
                                                                     the whole outline the first time, then only what
                                                                     changed since (see "An append-only conversation")
  → draft = null                                                     (the first edit copies the show), or the proposal
                                                                     still waiting for review: a follow-up builds on it
  → loop (at most 40 steps):
        response = provider.create({ system, tools, messages })
        refusal            → the turn fails with a plain message
        tool_use           → run each tool against the draft; return every result in one user message
        end_turn           → the reply (and the proposal's id, if one was made) goes to the transcript
  → on any failure, the turn's messages are removed and a half-made proposal is withdrawn
```

### An append-only conversation

**No message is changed once it has been sent** (`core/assistant/history.ts`). Every provider caches a request by its
prefix, so an edited earlier message makes the whole conversation after it full price again on every call; and on
Anthropic's current models (Opus 5.5 among them) a thinking block is bound to exactly what came before it, so a
request whose earlier messages were edited can be refused with a 400 ("bound to a different conversation"),
enforced for accounts created on or after 2026-08-31 (Anthropic's *Preserved thinking* and *Prefix checks* pages,
read 2026-11-16). So the system prompt and the tools are built once a session, each reply (thinking blocks, empty
ones too, and the service's `ec_state`) goes back exactly as it came, and what is new goes at the end:

- the first question carries `<show_outline>…</show_outline>`, the whole outline;
- a later one carries `<show_unchanged>` when the outline is as last sent, or `<show_changes>`: a unified diff of the
  outline's lines against the outline as the conversation last left it (`-` gone, `+` new, a kept line before a hunk
  only where it is needed to place it). Each outline line names its cue, so a change reads as one line out, one in;
- the whole outline again when the diff would be more than 40% of an outline, or when the diffs since the last
  whole outline add up to more than 60% of one (so the model never reconstructs the show from a long chain).

A failed turn is removed from the end (nothing before it changes) and what it told the model of the show goes with
it. Settings ▸ Assistant's change of provider, and New conversation, start afresh. The Anthropic request also sets
the top-level `cache_control`, so each call reads the conversation so far from the cache. Claude Code and Codex
keep their own conversation: each question gives them the whole outline (Codex has no session to resume; Claude
Code's own history is append-only already). `test/assistant-history.test.ts` checks, for the app's own form, the
Anthropic SDK's requests on the wire, an OpenAI-compatible service and the Endless Cues assistant, that every
request begins with every earlier one unchanged, and that the notes add up to the show.

Measured on a 60-cue show, five questions (a look, two accepted changes, a plain question, a rename), nine model
calls, characters ÷ 4 of what each request carries: before, 88,569 sent in all and 10,389 in the last request;
after, 88,666 and 10,421 (the same within a third of a percent: a diff of a line or two instead of the stub that
replaced an old outline). What is not a byte-for-byte prefix of the request before it, and so cannot be a cache
read, fell from 16,763 to 10,425 (38% less), and every call after a turn's first now differs from the last only
by what was added.

While it works, the drawer shows what it is doing ("looking for rain", "editing (3 operations)", "dry-running 2 GOs from 12"), and the steps stay with the reply afterwards.

The system prompt is two parts, both stable for the session and therefore cached: the instructions (what the assistant is for, how to behave, how cues work here) and a reference, **in brief**. Both forms of the reference are generated: every cue type and field from `core/show/cue-types.ts`, the operations with the keys each takes (the same table the tools check a batch against), every setting path from the show's own defaults (`show.defaultSettings()`, `defaultModules()`), and the devices and models from `core/rig/devices.ts` and `core/net/devices.ts`. The brief one (`reference()`) names every type and every field, with its kind, values and default for the fields the inspector shows first (one it keeps under Advanced or on its own tab is named only), the operations whole, and a line a model; the full one is `read_reference`'s answer, a part at a time (`lookup()`: a type, `every`, `settings`, `devices`, `models`, a model id, `operations`, `all`). So a new cue type, field or setting is known to the assistant the moment it exists; a test adds a field to the table and looks for it in both. The instructions name no field: they point at the reference. The one hand-written part of the reference is what a bus may carry (`out`, `mute`, `pan`, `eq`), because buses have no table yet.

### Prompt size

What goes with every request, counted by OpenAI's tokenizer for `gpt-6.1-terra` (`/v1/responses/input_tokens`, 2026-11-16):

| Part | Before | After | What moved |
|---|---|---|---|
| Instructions (`SYSTEM`) | 2,389 | 1,840 | Repetition taken out; every rule kept. The opening sentence is unchanged (the service checks it). |
| Reference (`reference()`) | 10,818 | 2,923 | Every field's help and every enum's labels, every settings path, the device, command, parameter, alive and report fields, and each model's commands and notes: into `read_reference`. The colours are named once, not twice. |
| Tools (`TOOLS`) | 3,130 (15) | 2,099 (16) | Descriptions say what the tool does and takes; rules already in the instructions are not repeated; `make_prop_files`' steps are in its answer. One tool more: `read_reference`. |
| **Fixed** | **16,333** | **6,858** | |
| Outline, the demo show with a lantern and two fades | 1,598 | 1,097 | Settings and module options only where they differ from a new show; a numbered cue named by its number alone (`#12`, its id only when the number is shared or missing); a Group's `fadeOthers` said once, not twice. |
| Outline, 400 more cues (the short one) | 8,686 | 4,733 | The same: the ids were half of each line. |

Claude Code and Codex run by the app got the instructions twice, as their system prompt and as the MCP server's instructions: the app now starts the server with `--no-instructions`. A Claude Code request went from about 28,900 tokens a call to about 13,500.

The same eight asks were run before and after on the demo show with a folder of new sounds (`sfx/`), a lantern (`ec-prop-light`) and two more fade-outs, once each through the hosted model (`gpt-6.1-terra`, the Responses API with the service's own request check and translation, effort medium) and once through Claude Code (the app's provider, its MCP server and the bridge, no app window). Tokens in: the first call (fixed part, outline and ask) and the turn's total over every call; for Claude Code the total of its own usage (its system prompt included, cache reads included).

| Ask | gpt-6.1-terra before: calls · first · total | after | Claude Code before: turns · total | after | Right? |
|---|---|---|---|---|---|
| Cues from the sfx folder | 5 · 18,023 · 92,490 | 5 · 8,012 · 47,146 | 4 · 117,705 | 4 · 56,184 | Both, both times. Before, gpt kept "FINAL" and "v2" in two names (the instructions now name such words); after, Claude also took "loop" off "Lamp hum loop" (and said so). |
| Every fade-out that stops its sound: 5 s | 4 · 18,021 · 73,154 | 6 · 8,001 · 67,679 | 2 · 57,759 | 2 · 27,070 | The three Fade cues each time. gpt also set the two Groups' fade & stop others to 5 s after (twice), and before on a second try: the ask is ambiguous, not a change in the prompt. |
| Renumber Main in tens | 2 · 18,028 · 36,507 | 5 · 8,006 · 51,221 | 2 · 58,002 | 4 · 55,739 | The same 13 numbers each time. **Worse after**: gpt re-read the outline it had been sent (twice in two tries) and once looked up the operations it already had; Claude checked its work. |
| A Light cue that auto-follows | 2 · 18,027 · 36,233 | 2 · 8,012 · 16,287 | 3 · 87,029 | 3 · 41,244 | Same: lightCue 7, auto-follow. |
| A desk from a sentence (an M32) | 2 · 18,034 · 36,209 | 2 · 8,014 · 16,175 | 3 · 86,689 | 3 · 40,381 | Same: the x32 model at 192.168.1.40. |
| A Device cue (the lantern breathes) | 3 · 18,020 · 56,094 | 3 · 8,006 · 26,439 | 3 · 88,648 | 3 · 42,580 | Same: effect, name breathe. |
| "Is everything ready?" | 2 · 18,023 · 36,219 | 2 · 7,988 · 16,149 | 4 · 86,714 | 3 · 40,369 | Same answer: the lantern and the patch cannot be told without the app. |
| A Timecode cue: LTC, 25 fps, output 3 | 3 · 18,047 · 54,652 | 3 · 8,018 · 27,078 | 2 · 57,815 | 3 · 40,922 | Same fields (`fps=25 output=ltc channel=3`); after, both looked the type up with `read_reference` first. gpt numbered it 0 after (before: no number). |

So: the fixed part is 42% of what it was, a turn costs half the tokens or less on seven asks of eight, and the answers are the same. The one regression is the renumber's extra calls with gpt. With no app the lantern could not be asked, in both runs alike.

**A follow-up builds on what is waiting.** If a proposal is still on the screen when the next request is sent ("make it five seconds"), the turn's draft starts as that proposal and the model is told so; what it proposes replaces the waiting one and carries both. (Claude Code and Codex keep their own draft, so they are only told that something is waiting and is not in the show.)

**A long show** (more than 250 cues) is sent as a short outline: its top-level cues by id, number, type and name, with a group's contents counted, not listed. `read_show` with `from` and `count` reads a run of cues in full, and `find_cues` returns hits with their settings.

Instructions that matter, and why:

- *Make the change asked for and nothing more.* A model's instinct is to tidy. In a show file, an unrequested renumber breaks the stage manager's book.
- *Follow the show's own numbering and naming.*
- *Ask one question when the ambiguity changes what gets built; otherwise choose the theatre default and say so.*
- *Reply in a sentence or two; say what to listen for.* The diff shows the operations; the reply is for what the diff cannot say.

## Providers

The model is reached through a provider, chosen per computer and never stored in a show.

| Provider | |
|---|---|
| `cloud` | The Endless Cues assistant: an account, signed in from the app (the device flow). Requests go to the Endless Cues service, which chooses the model (OpenAI's, today) and pays for it. Free during the beta. [17 · The service protocol](17-service-protocol.md). |
| `anthropic` | Your own Anthropic key (typed into Settings, or `ANTHROPIC_API_KEY` in the environment). |
| `openrouter` | Your own OpenRouter key; any model OpenRouter carries. You type the model's id. |
| `openai` | Your own OpenAI key. |
| `custom` | Any service that speaks the OpenAI chat-completions protocol: an address, an optional key, a model id. |
| `ollama` | A model running on this computer. No key, no internet. |
| `demo` | No network and no model: the **built-in helper** (above). It does a short list of jobs for real, and is what a test run uses. |
| `off` | The default. Nothing is sent anywhere. |

`anthropic` is the official `@anthropic-ai/sdk`, the Messages API with tool use. (`cloud` used to share it; it is now the OpenAI-compatible path below, pointed at `https://api.endlesscues.com/v1` with the account's token as its key.) The request uses `claude-opus-5-5` with adaptive thinking at medium effort, server-side refusal fallbacks, and a cached system prompt.

`openrouter`, `openai`, `custom` and `ollama` are one other code path: the OpenAI chat-completions protocol with tool calls, over plain `fetch` (`compatibleProvider`). The conversation is kept in one shape inside the app (Anthropic's content blocks) and translated at the edge (`toChat`, `fromChat`), so the turn loop and the tools are the same for every provider. A model that sends tool arguments that are not valid JSON is told so and can try again.

Keys are per computer, sealed with the operating system's keychain (`safeStorage`) in `config.json`, one per provider; each provider also remembers its own model and address. A key in the provider's usual environment variable is used when none is saved.

How well the assistant works depends on the model: it has to follow the operation format and call tools reliably. Nothing in the app can make a weak model good at this; what the app guarantees is that a bad proposal either fails validation (and never reaches the person) or is shown as a diff to be rejected.

## Claude Code, Codex, and other agents

Endless Cues' tools are also an MCP server (`core/assistant/mcp.ts`, started as `bin/ec-mcp.ts`), so an agent that already exists can do the work. There are two ways to use that.

**As the assistant in the app.** Choosing *Claude Code* or *Codex* in Settings ▸ Assistant makes the drawer start that program for each request (`claude -p …` / `codex exec …`). It does the thinking with the account it is already signed in to, so there is no key to give Endless Cues. It is started in an empty temporary folder with only our tools: for Claude Code, `--tools ""` (none of its own: no shell, no file access), `--strict-mcp-config` with one server, and an allow-list of exactly our tools (made from the one table, `TOOLS`); for Codex, a read-only sandbox and our server. Codex keeps its own shell and file reading (its CLI documents no switch that removes them): in the read-only sandbox it can read files anywhere on this computer and run commands that only read, and cannot change anything. Settings ▸ Assistant says so under Codex. The steps it takes show in the drawer as they happen, and its proposal lands in the same review.

**From the agent itself.** With "Let coding agents work on the show" on, someone using Claude Code or Codex in a terminal or an editor can add the server once (`claude mcp add endless-cues -- node …/bin/ec-mcp.js`) and then ask for changes to the show there. The server's instructions carry the same guidance and reference the built-in assistant gets.

Either way the agent reaches the running app through **the bridge**: an HTTP listener on 127.0.0.1, on a port the OS picks, that refuses any request without a token. The port and token are in a file in the app's settings folder that only this user can read; the bridge is closed unless one of the two uses above is on. Each agent session has its own draft; a proposal arrives in the app like any other, with a notice saying who it is from.

`ec-mcp --show My.ecshow` works on a show folder with no app running. With nobody to review in a window, an accepted change is left as *unsaved changes* (the journal), so the next time the show is opened they are there, marked, one Revert away. `--save` writes and versions instead, for scripts.

Verified: Claude Code, live, both ways (it built a duck and dry-ran it; asked to change two cues it also pointed out a double-fire it had not been asked about). Codex is written from its documentation and has not been run.

The rungs of [15](15-assistant-and-rig.md) were each run once or twice through the Claude Code provider against a show folder, a stand-in prop on loopback and a canned monitor (ten turns): cues from a messy folder (it read the notes for the order, grouped by scene prefix, and listed what it guessed and what it left); "every scene ends with a 3 second fade"; a desk from a sentence with a Device cue for its cue 12 in one proposal (it asked the address first, with the model's own ping); a device written from what the monitor had heard and two lines of a manual (it said the port was a guess); two props found and added and a cue for one; "is everything ready?" (worst first, with what uses each thing); firmware for a named board (it left the Wi-Fi password, which it had been told, out, and said so); the script's marks made into cues with the called line quoted; and an HTTP projector (it said "not here" in a sentence, changed nothing, and staged the hand-over when asked). None of this was with real equipment.

## What is sent

When (and only when) the person sends a message: that message, the conversation so far, an outline of the open show (cue numbers, names, types, settings, notes, file *names*, each device's name, address and commands), and whatever it looks at to answer: the names of the files in the show folder, the text of a file it reads there, the Rig's state, and what the monitor has heard. Never audio, never a password (a Wi-Fi password is never asked for and `secrets.h` is not a file it is given), never anything outside the show folder, nothing in the background. Settings ▸ Assistant says this in the app. With the built-in helper nothing is sent anywhere.

## Not yet

- **The assistant's device-making on a real manual page**, and anything it does against real equipment: tried only as above.
- **The hand-over's command lines from a packaged app.** They name `bin/ec-mcp.ts` beside the running code; inside a packaged app that path is in the app's archive, where `node` cannot run it. Until the app ships a command of its own, the guide is right for an app run from its source.

- **The key-based providers against a live service.** The tools and the agent's behaviour are verified live through Claude Code. The Anthropic-SDK path and the OpenAI-compatible path are tested with scripted replies and a local fake server only.
- **Streaming.** The reply appears when the turn is done. With a real model a turn takes several seconds, so the reply and the "reading the show" state should stream.
- **Showing the proposal in the list.** Changed and removed cues are tinted in the cue list while a proposal waits; added cues appear only in the review. A side-by-side "after" view of the list would be better.
- **Partial acceptance.** It is all or nothing. Accepting some changes of a batch is safe only when they are independent; the simple honest version is "reject, and ask for less".
- **Listening.** The assistant cannot hear. Level and timing suggestions are conventions, not judgments; the instructions make it say so.
- **Very long shows.** The short outline still names every top-level cue (about 12 tokens each), and `list_media` lists every file. A show of several thousand cues needs paging there too.
- **Settings have no table.** The tools check a setting against the kind of its default and know what a bus and a patch need; that check belongs in `show.set` itself (`core/show/ops.ts`), with a table of settings beside the table of cue types.
- **Media it can hear about.** Lengths are known; loudness, beat grids and a description of what a file sounds like are not, so it places sounds by name.
- **Importing.** It cannot bring a new file into the show; it works with what is in `media/`.
- **The folder, the script, equipment and the rig.** Designed in [15](15-assistant-and-rig.md): `list_folder`, `read_file`, `rig_status`, `read_monitor`, `ask_device`, `find_devices`, `make_prop_files`, `hand_off`; devices through `edit_show`; a first screen true of the open show; a built-in helper that does a few of these with no model.
