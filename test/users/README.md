# Virtual users

*A development note: the harness that has coding agents play invented users. It tests nothing in `npm test`; its reports are in [`docs/internal/usability/`](../../docs/internal/usability).*

Five invented people, each with a different kind of show, most coming from QLab. An agent stands in for each one, uses the app through its window the way that person would, and writes a usability report. The reports are gathered into one page under `docs/internal/usability/`.

The unit tests say the engine is right and the smoke test says the app starts and its doors work. Neither says whether a sound designer can find Load to Time, or whether the import report is something a person can act on. This is the check for that.

## The five

| | Who | Show | Comes with | Looks hardest at |
|---|---|---|---|---|
| [`priya`](people/priya.md) | Sound designer, nine years of QLab | A play, 15 cues, in tech | A QLab workspace | Import, QLab's keys, editing under time pressure, running the show |
| [`marcus`](people/marcus.md) | Playback operator on a musical | Tracks and click, vamps | A QLab workspace | Vamps and devamp, starting mid-number, output routing |
| [`dana`](people/dana.md) | Stage manager, dance company on tour | Five pieces to recorded music | A folder of tracks and a page of notes | Building a first show with nobody to ask; the words on the screen |
| [`theo`](people/theo.md) | Show-control programmer, immersive theatre | Sensors, a lighting desk, a media server | Four sounds and a list of ports | OSC out and in, triggers, the monitor, the show file |
| [`june`](people/june.md) | Puppeteer who builds her own props | Six sounds, a script with marks, two lanterns on ESP32s, the venue's desk | A folder of sounds, a script, and a stand-in prop to run in a terminal | The assistant from a folder to a rig: cues, a device, the Rig page, firmware, the hand-over |

Each person's page says who they are, what is on their desk, their tasks (as goals, never as steps) and what they judge the app on. Some tasks are things the app cannot do yet; finding out how the app says so is the point of them.

To add a person: a page in `people/` with tasks numbered and their ids in bold, and a desk in `materials.ts`.

## How a run goes

```bash
npm run users:prepare              # makes test/users/runs/<today>/<person>/ : a desk and a BRIEF.md each
#  …give each BRIEF.md to an agent: "Read this file and do what it says."
npm run users:collect -- <run>     # checks the reports and writes docs/internal/usability/<run>/summary.md
```

`BRIEF.md` is the person's page followed by [`brief.md`](brief.md): the rules a virtual user works by, the report they write, and the commands they have. Any agent that can run shell commands and read a picture can be a virtual user. In Claude Code, start one subagent per brief.

A run's folder holds the desks (about 170 MB of synthesised sound), every picture taken and each journal. It is not kept in git: delete it once the run is collected.

## Hands, eyes and ears

A virtual user touches the app only through `bin/ec-user.ts`, which talks to a door the app opens when started with `--drive=<session>` (`app/main/drive.ts`). The door offers what a person at the keyboard has:

- **look**: a picture of the window, and a list of what is on it (each button, field, row and line of text, with where it is)
- **click, drag, scroll, type, key**: real mouse and keyboard events sent to the window
- **menu, answer, choose**: the menu bar, file dialogs, message boxes and drop-down lists, which belong to the operating system and so are chosen in by name
- **hear**: what would be coming out of the speakers
- **osc listen / heard / send**: stand-ins for the equipment around the show

There is no command that edits or plays a show except through the window. A session runs like the smoke test: silent, its own settings folder, never the front window, and no network ports unless it was started with `--net` (one such session at a time, and it refuses to start beside a running Endless Cues).

Everything a user does is written to `journal.jsonl`. `collect.ts` counts actions per task from the journal, not from what the user says.

## The report

Each user writes `report.md` and `report.json`. The shape is in [`brief.md`](brief.md) and is enforced by `collect.ts`:

- a **verdict**: would this person run their show on it (`yes`, `with-workarounds`, `no`), and why
- four **ratings**, 1 to 5: learn, speed, clarity, trust
- every **task** with its outcome: `done`, `done-with-trouble`, `gave-up`, `not-possible`, `not-tried`
- **findings**, each one problem: severity (`blocker`, `major`, `minor`, `polish`, `praise`), kind (`bug`, `missing`, `confusing`, `wording`, `slow`), area, what was expected, what happened, pictures, and steps to see it again

`docs/internal/usability/<run>/summary.md` puts them side by side: verdicts and ratings, every task with its outcome and action count, then all findings from worst to least.

## After a run

1. Read `summary.md`. Findings that two people reported separately come first.
2. Reproduce each bug before believing it. An agent can misread a screen.
3. Each finding that stands becomes a line in [`docs/qlab-tracker.md`](../../docs/qlab-tracker.md) or a fix. Something that was hard to see twice becomes a check in `app/main/smoke.ts`.
4. Run it again after the fixes, under a new run name, and compare the two summaries.

## What this is not

- **Not people.** An agent reads every label on the screen, never gets tired, and has read about QLab rather than used it for years. It will miss what annoys a real hand and report things no person would notice. A run is a list of things to look at, not a measure.
- **Not hearing.** A click, a late start or a rough loop is invisible here.
- **Not the operating system.** Menus, file dialogs and drop-downs are stand-ins; how they look and behave on Windows or Linux is untested.
- **Not repeatable to the letter.** Two runs find different things. Compare the task outcomes, which are steadier than the findings.
