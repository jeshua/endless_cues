# 04 · The cue engine

This document describes the cue engine: the object that decides what happens on GO, what is running, and when things end. It covers `core/engine/cue-engine.ts` (the `CueEngine` class and the helpers `busOf`, `isCall`, `encodeOsc`), the cue-type table in `core/show/cue-types.ts`, the translation from a show file to the engine's document in `core/show/show.ts` (`toEngineDoc`), and the behaviour pinned by `test/engine.test.ts`. Everything here was read from that code; where a behaviour is reachable in the engine but not from a show file, or was not exercised, it says so.

## 1. Shape

`CueEngine` is plain Node (an `EventEmitter`), with no Electron, no audio and no sockets. Sound, the network, the mixer, the lighting desk and the clock are injected, so the tests drive it with a fake clock (`test/helpers.ts`). The host (`app/main/host.ts`) owns one engine. The engine emits one event, `'change'`, after anything that alters what a UI would show; `changed()` also runs the auto-follow check (section 4) before emitting.

### 1.1 Injected dependencies

`new CueEngine({ audio, send, mix, lights, clock, log, panicFade })`

| Dependency | Signature | Notes |
|---|---|---|
| `audio.play` | `(key, { file, gainDb, from, loop, exact, bus })` | Required. `key` is the audio cue's id. `loop`: loop the whole file. `exact`: the cue has `loops` or `loop`, so the backend should play it from a decoded buffer. `bus` from `busOf(cue)`. |
| `audio.fade` | `(key, db, secs, range?)` | Required. `range === 'voice'` moves the sound's voice-band dip instead of its level. |
| `audio.stop` | `(key)` | Required. |
| `audio.pause`, `audio.resume` | `(key)` | Optional (called only if present). |
| `audio.seek` | `(key, t)` | Optional. |
| `audio.cut` | `(key, at)` | Optional. Told `CUT_LEAD` ahead of a `cutAt`; the backend silences at that file position. |
| `audio.setLoop` | `(key, on)` | Optional. Whole-file looping off (a devamp). |
| `audio.setRegion` | `(key, start, end)` | Optional. Loop `start`–`end` to the sample; `(key, null, null)` lets go. |
| `audio.move` | `(key, { to, region, sync: { at, lead, xf, blend } })` | Optional. When the sound reaches `sync.at` s into its file (about `sync.lead` s from now) it crossfades inside itself to `to` over `sync.xf` s as `'cut' \| 'fade' \| 'dj'`, then loops `region` if given. |
| `audio.duck` | `(key, db, secs)` | Optional. Holds the sound `db` from its level on a gain of its own (a cue that ducks the others while it runs); 0 lets it back. |
| `send` | `(message, cue)` | A Network cue fired. `message` is text: `"/address 1 2.5 word"`. |
| `mix` | `(cue)` | A Mix cue fired. |
| `lights` | `(cue)` | A light cue fired while light cues are on. |
| `clock` | `{ now() → seconds, setTimeout(fn, ms), clearTimeout(id) }` | Default: `Date.now() / 1000` and the globals. |
| `log` | `(line)` | One line per thing the engine did. |
| `panicFade` | number (s) | Default `PANIC_FADE`. The host overwrites `engine.panicFade` from `settings.go.panicFade` on every document change. |

The backend calls back into the engine: `audioEnded(key)` (the file reached its end), `setDuration(file, secs)`, `setMissing(file)`, `setExact(key, exact)` (whether `key` is playing from a decoded buffer). Exceptions thrown by `send`, `mix` and `lights` are caught and logged; exceptions from `audio.*` are not caught by the engine.

### 1.2 Constants

| Constant | Value | Meaning |
|---|---|---|
| `BEAT_LEAD` | 0.08 s | A downbeat closer than this to the GO is skipped for the next one. |
| `PANIC_FADE` | 1.0 s | Default panic fade. |
| `PANIC_HARD_WINDOW` | 1.5 s | A second panic inside this stops dead. |
| `SILENT_DB` | −60 | The engine's silence. |
| `CUT_LEAD` | 0.3 s | How far ahead the backend is told of a `cutAt`. |
| `SYNC_LEAD` | 0.25 s | How far ahead a move on the beat is handed to the backend. |
| `NOW_LEAD` | 0.03 s | The lead of a move made "now". |
| `BLEND_WITHIN` | 4 | Downbeats a `'best'` jump looks ahead. |
| `BLEND_MAX_WAIT` | 5.0 s | ...and no later than this (the next downbeat always counts). |
| `GOOD_JUMP` | 0.8 | A departure scoring this well is taken at once. |
| `LOW_GRID` | 0.3 | Below this grid confidence the crossfade is `AMBIENT_FADE`. |
| `AMBIENT_FADE` | 3.0 s | The crossfade over an ambient stretch. |

Only `DUCK_HOLD`, `PANIC_FADE` and `SYNC_LEAD` are exported, with `CueEngine`, `encodeOsc`, `busOf` and `isCall`.

## 2. The document the engine plays

`load(doc)` takes `{ format: 'ec-cuelist', lists: [{ name, cues: [...] }] }`. It throws on anything else, on two cues with one id, and on a truthy `target` that is not in the list. A reload keeps the playhead on the same cue if it is still a top-level cue of the current list, cancels waits and fades of cues that no longer exist, and leaves sounds playing (a sound whose cue has gone carries on until stopped). `armed: false` puts a cue in the disarmed set, unless the operator has flipped that cue by hand since launch (`armTouched`).

`toEngineDoc(showDoc)` (`core/show/show.ts`) makes that document from a show file. Per cue it:

- copies every field, sets `name` to the cue's name or `defaultName()`, and `number` to `''` when absent;
- turns `continue: 'auto-continue' | 'auto-follow'` into `autoContinue: true` / `autoFollow: true`;
- renames the type by `engineType` (only `devamp` → `release`);
- on groups, drops `onBeat` when it is `'now'` or unset and drops an empty `blend`;
- on audio cues, sets `bus` to the cue's bus if the show has it, otherwise the second bus (or the only one);
- leaves out every **section** (`type: 'section'`, a heading in the list, `core/show/sections.ts`), at any level: the engine never sees one, so GO, `steps()`, `movePlayhead`, auto-continue and auto-follow go from the cue before a section to the cue after it, a list that starts with sections stands by its first cue, and one that ends with them ends at its last cue. A `target` that is a section is set to `null` (and is an error in `problems()`). What names a section from outside the engine is turned into its first cue by the host (`sections.landingIn`: the next cue after it, past empty sections): Stand By Here, the playhead command, Load to Time, and Jump to cue, which also takes a section's name ("act two", or the start of it);
- sets a `target` that no longer exists to `null`, and marks any cue with an error-level problem `broken: '<why>'`, so a broken cue never stops the list loading (it fires and does nothing).

Only fields named in `core/show/cue-types.ts` survive `normalise()`, so only those reach the engine from a show file. What the engine once read beyond that table has been given a field or taken out (section 12).

## 3. Lists, the playhead, GO

- **Lists.** The engine holds every list; `listName` is the one on screen. Each list has its own playhead (`heads`: list name → cue id; `playhead` is the accessor for the list on screen). `selectList(name)` switches the list on screen and leaves both playheads where they were. A list that is not on screen keeps running: waits, sounds, fades and continues are not tied to `listName`. `go(name)` is the GO of any list on its own playhead; a Start cue aimed at a list (`target` = the list's id) calls it. `homes` maps every cue to its list; `within(id, target)` is true for a cue at or under `target`, where a target that is a list holds every cue in it.
- **Top-level cues.** `top()` is the active list's cues. Only top-level cues are places the playhead stops; children fire through their group.
- **`steps()`** is `top()` without light cues (`isCall`: `type: 'light'`) while `skipLights` is on. GO, `movePlayhead`, auto-continue, Reset and reload all go through it. `stopFrom(id)` is the first stop at or after `id`.
- **`go()`** fires the cue at the playhead and moves the playhead to the next step (`null` at the end of the list; GO then does nothing and returns `null`). In order: lets go of Hold if `held`; records `lastGo`; starts the show clock (`showStartedAt`) on the first GO in the first list since Reset; advances the playhead; `fire(id)`; clears `loaded`; `continueAfter(id)`. It returns the fired cue's id. Double-GO protection is the host's, not the engine's (`core/engine/go-guard.ts`): one time between GOs for every way a GO arrives, and the same for a cue's own trigger repeating; a trigger is not a GO and does not lock it.
- **`setPlayhead(id)`** puts the playhead of the cue's own list on it (top-level ids only; the list on screen does not change). `setPlayhead(null)` leaves the list on screen with no cue standing by, and a reload keeps it so (`parked`). **`movePlayhead(step)`** (clamped to the ends), **`moveSequence(±1)`** (to the next or previous cue that the cue before it does not continue into: `=` and `-`), **`jumpTo(number)`** (matches a top-level cue's number, else id, case-insensitively, in any list, and switches list; `"lq 2"` is read as `"lq2"`).
- **`fire(id, offset = 0, preWaited = false)`** is the one way a cue starts: skipped with a log line if disarmed; otherwise its pre-wait (section 5) is put in `waits`, or `act(cue)` runs at once. `fire` does not move the playhead and does not run continues.

## 4. Continue modes

`continueAfter(id)` runs after a top-level cue fires from `go()` or from a chain. If the cue has `autoContinue` or `autoFollow` and there is a next step:

- the playhead, if it is on that next cue, passes it;
- **auto-continue**: the next cue fires `postWait` s later (at once with none). If the cue is itself waiting (an `onBeat` or blended GO), that wait is added, so the next cue comes `postWait` after the cue lands. The wait is an entry in `waits` under the *next* cue's id and shows in Active Cues;
- **auto-follow**: `{ next, post }` is stored in `following`. `checkFollows()` (run on every `changed()`) fires the next cue, after `postWait`, once the cue is no longer live. If both flags are set, auto-follow wins.

"Finished" is `!isLive(id)`: no wait and no running sound at or under the cue, and no fade whose *target* is at or under it. A Wait cue counts (its timer is filed as a fade on itself). A chain continues: the cue it fires runs `continueAfter` too.

What does not follow on: `panic()`, `fadeAll()`, `reset()` and `stopCue()` remove the pending follow, and a group's `fadeOthers` removes every other cue's. A disarmed cue still passes its continue on (it is never live, so an auto-follow from it fires at the next change).

A caveat found while documenting: a Fade cue is not live while its fade runs (the fade's target is the audio cue, elsewhere in the list), so `auto-follow` on a Fade cue fires the next cue immediately, not when the fade lands. QLab waits for the fade's duration.

### 4.1 Second triggers, and cues that duck the others

- **`secondTrigger`** (`restart` by default). `fire(id)` on a cue that is live, with any other value, does that instead of starting it again and returns `'second'`, so `go()`, `start()` and a Start cue do not run its sequence a second time: `nothing`; `panic` (`panicCue`: what sounds under it fades over `panicFade` and stops, what waited in it is dropped); `stop` (`stopTree`); `devamp` (every sound under it is let out of its loop). **`released(id)`** is the host saying the hotkey or MIDI note that fired the cue was let go: with `secondOnRelease` it is taken as the second trigger.
- **`duckOthers`** (dB, negative to duck, positive to boost) with `duckTime`. When the cue acts it is filed in `ducks`; `applyDucks()` holds every running sound that is not under the cue at the sum of the ducks on it, through `audio.duck(key, db, secs)`: a gain of its own in the backend, so levels, fades and trims are untouched. A sound that starts under a duck is ducked at once. `checkDucks()` (on every `changed()`) ends a duck when its cue is no longer live, and the others come back over `duckTime`.
- **`autoLoad`** on a cue (or a group it is in) makes its sounds `exact` (played from a decoded buffer) and puts them in `wantedFiles()` while the cue stands by in any list.

## 5. Pre-waits

`preWaitOf(cue)` decides how long `fire` waits:

| Cue has | Wait |
|---|---|
| `blend` (a group holding a Jump) | The blend plan's wait (section 9). A numeric `preWait` on such a group is served first, then the plan is made from where the track is then. |
| `onBeat` | `beatPlan(cue).wait` (section 8). A numeric `preWait` is ignored. |
| numeric `preWait` > 0 | That many seconds. |

A cue waiting is in `waits` (`{ timer, startedAt, total }`). Firing it again restarts the wait, unless the cue has a second trigger (section 4.1).

## 6. Groups

A group fires all its children at once (`mode: 'timeline'`, the default). Each child goes through `fire`, so each waits its own pre-wait. Groups nest. The other modes: `playlist` (one child, then the next when it has finished), `enter` and `first` (the first child, with the children's continues running inside the group), and `random`, which deals its armed children like cards (`deal()`): each once before any again, and a new round never opens with the child the last one closed on.

`fadeOthers` > 0 on any cue (on a group: with no `blend`) does three things when the cue acts: every running sound that is not the cue's own fades to silence over `fadeOthers` s and stops; every wait outside it is cancelled; every other cue's pending auto-follow is dropped. A scene's GO is thereby a crossfade from the scene before. `fadeOthersScope` limits "others" (`othersOf()`): `all` (default), `list` (cues of the same list), `peers` (cues under the same group; for a top-level cue, its list).


## 7. Cue types at run time

### 7.1 Audio

`act` on an audio cue:

1. If its file is in `missing`: logs `MISSING FILE` and does nothing.
2. If it is already running, that instance is stopped first (a cue plays once at a time).
3. Start position: a pending Load (`loadAt`), else `from`, else 0. A Load replaces `from`; it is not added to it.
4. `audio.play` at `gainDb` (0 by default), on `busOf(cue)`. With `fadeIn` > 0 it starts at −60 and fades to `gainDb` over `fadeIn`.
5. Its tail is scheduled (`scheduleTail`).

How it ends by itself:

| Fields | Behaviour |
|---|---|
| none | Plays to the end of the file; the backend calls `audioEnded`. |
| `cutAt` (no `loop`) | Stops dead at `cutAt` s into the file. The backend is told `CUT_LEAD` ahead via `audio.cut`; the engine removes it 30 ms after the cut. A seek past `cutAt` plays on to the file's end. |
| `loop` (no `cutAt`) | Loops the whole file (`loop: true` to the backend) until stopped, faded out or devamped. |
| `loop` + `cutAt` | Loops `from`–`cutAt` to the sample (`armVamp` → `audio.setRegion`). Needs the backend to report the sound `exact`; until then it plays on and the loop engages when `setExact` arrives. |
| `fadeOut` | Fades to silence over its last `fadeOut` s, landing on the file's last sample. Needs the duration (rescheduled when `setDuration` arrives). The sound is then ended by `audioEnded`. |
| `fadeOut` + `fadeAt` | The fade starts `fadeAt` s in and the sound is stopped when it lands. For a loop, `fadeAt` counts time played; a loop with `fadeOut` and no `fadeAt` never fades. If `fadeAt + fadeOut` is not before the file's end, the ordinary end-of-file fade is used. |

Tails are rescheduled on resume, seek, release, `setDuration` and a change of rate. With `rate` other than 1, every wait for a place in the file is divided by it (`positionOf` is `from + elapsed × rate`); `fadeInShape` and `fadeOutShape` shape the cue's own fades; `envelope` is handed to the backend with `play`.


### 7.2 Fade

Targets an audio cue. Its `stopTarget` reaches the engine decided (`show.toEngineDoc`, `cue-types.ts` `stopsTarget`): the cue's own value when it has one, and when it has none, on for a fade to silence (the show's floor or below; not `relative`, not a voice-band duck, not rate-only, not aimed at a Light cue; on a picture, one that names nothing or takes it out of sight and out of hearing), off otherwise. In order:

1. **The last word wins.** Any *other* top-level cue's Fade still waiting (in its pre-wait) on the same target is cancelled. Two ducks fired close together therefore keep the music down: the first one's return is dropped and the second one's return brings it back.
2. If the target is not running, nothing more happens.
3. `relative`: the level is `target.gainDb + db`. Otherwise `db` is absolute. `gainDb` here is the target cue's own level as loaded, so a duck returns to the cue's level, including a level edited while it plays (the host applies such an edit with `trim`, then the reloaded `gainDb` matches).
4. `range: 'voice'` without `stopTarget`: the sound's level is left alone and its voice-band dip moves instead (`audio.fade(key, dip, secs, 'voice')`). The dip is `db` when relative, else `db` minus the sound's current (or fading-to) level, and never above 0.
5. `rate` set: the target's rate moves to it over the duration too (`fadeRate`); with `keepLevel`, only that. An absolute fade also lets go of a voice-band dip the sound still holds. How the target was before is remembered for `revertFade` ([05 · Audio](05-audio.md)).
6. Otherwise `fadeAudio(target, level, duration, stopTarget, cue.id, shape)` (the shape is `shapeUp` when the level asked for is at or above where the sound is, else `shapeDown`; the level goes through the show's limits): `audio.fade`, then when `duration` has passed the sound's `db` is set and, with `stopTarget`, it is stopped. A `duration` of 0 lands at once.

A fade is filed in `fades` under the Fade cue's id, so firing the same Fade cue again replaces its own timer. Two different Fade cues running on one target are not arbitrated: the backend gets both and the later call wins there.

### 7.3 Stop, Start, Pause

- **Stop** → `stopTree(target)`: cancels the target's wait, its fade and Wait timers, stops it if it is audio, and recurses into children. Aimed at a list: every cue in it. A `null` target does nothing.
- **Start** → if the target (or anything under it) is paused, `resume(target)`; otherwise `fire(target)` and, for a top-level target, its continue. The playhead does not move. Aimed at a list it is `go(list)`: that list's standing-by cue fires and its playhead moves on.
- **Pause** → `pause(target)` (section 11).

### 7.4 Load, GoTo, Arm, Disarm

- **Load** → `setLoad(target, at)`: the target's next fire starts `at` s into it, counted as Load to Time counts (through a pre-wait, into a group's children). Any cue can be the target. A negative `at` is that far back from its end (`lengthOf`). The target standing by shows it as `loaded`; any other keeps it in `loads` until it fires.
- **Reset** → `resetCue(target)`: the target and everything under it is stopped, unloaded, armed or disarmed as the document says, re-aimed where the document aims it, a group's entered / dealt state cleared; and if it is a Fade that has run, the sounds it moved that are still playing go back to their own `gainDb` (and their voice band to flat) at once.
- **Target** → `retarget(target, to)`: the target cue's `target` becomes `to` until `reset()`, a Reset cue on it, or an edit of that target in the show (a reload re-applies it otherwise: `keepRetargets`).
- **GoTo** puts the playhead on the target's top-level cue (switching list if needed, and on to the next stop if it is a skipped light cue). The next GO fires it.
- **Arm / Disarm** remove or add the target in the disarmed set and mark it `armTouched`, so a reload does not undo it. `toggleArm(id)` is the operator's version.

### 7.5 Devamp (`release`)

On a running target (`devamp(key)`): a sound going round a section (or with one armed) is let go and plays on after this pass; a sound looping whole has its `loop` flag set off (`audio.setLoop(target, false)`), plays out its pass and ends. With `startNext`, the cue after the Devamp (`nextOf`) is started when that pass ends, and the playhead passes it: for a section, by a wait of `region.end − position` filed under the next cue (it shows in Active Cues; it is the engine's timer, so it lands within the timer's few milliseconds, not to the sample); for a whole loop, on `audioEnded` (`releaseThen`). A Stop of the target before then drops it.

### 7.6 Wait, Memo

- **Wait** does nothing for `duration` s but is live meanwhile (filed in `fades` as `hold:<id>` with `wait: true`), which is what an auto-follow on it waits for. It appears in Active Cues as a wait.
- **Memo** does nothing. Its pre-wait still counts down in Active Cues, which makes a memo with a pre-wait inside a group a visible marker of a moment.

### 7.7 Network, Light, Mix

- **Network** → `send(cue.message, cue)`. Errors are logged.
- **Light** with `levels` → `lightFade`: an entry in `fades` (`light: true`) for its `duration`, and `dmxHook('run', cue)`; `dmxHook('done', cue)` when it has run its time. The host moves the app's own lights by reading that entry ([14 · Lighting](14-lighting.md)), so pause, resume and stop are the engine's as for any fade. A Fade whose target is a Light cue does the same with `dmxHook('fade', fadeCue, lightCue)`. A Light cue with levels is not a call: `skipLights` never skips it. With only levels, the `lights` hook is not called.
- **Light** with a desk cue number → `lights(cue)` unless `skipLights` is on or the cue has `follows` (the desk runs it by itself). With `skipLights` on, light cues are also not stops (section 3); `setSkipLights(true)` with the playhead on one moves it to the next real stop.
- **Mix** → `mix(cue)`. The engine does not interpret `levels` or `duration`.

### 7.7b Script

A Script cue's `script` is text, one command a line (`core/show/script.ts`): `/cue/<number>/start` (and `go`, `preview`, `stop`, `hardStop`, `panic`, `pause`, `hardPause`, `resume`, `togglePause`), `/cue_id/<id>/…`, `/go`, `/panic`, `/pause`, `/resume`, `/playhead/<number>`, `/playhead/next`, `/playhead/previous`, `wait <seconds>`, and `#` notes. The words are the OSC control module's.

It is a list, not a language, and that is the decision: QLab's Script cue runs AppleScript with the user's powers; a show file here can come from anyone (and can be written by an assistant), so nothing in one may run code. A script can do only what an operator could do to this show's transport. No edits, no save, no files, no network of its own, no loops or variables. `parse()` never throws; a line it cannot read is an error on the cue (`show.problems`, with the line number), and is left out of the steps.

`runScript` runs the steps on the engine's clock. The run is filed in `fades` under the cue's id as a wait, so it shows in Active Cues, pauses and resumes with the cue (a wait counts running time), and a Stop on the cue or a panic ends it where it is. A script that starts itself with no wait is stopped by the same depth guard as a loop of Start cues. The dry run plays scripts like anything else.

### 7.8 Unknown types

Any other type does nothing when fired.

## 8. Quantised GO (`onBeat`)

A group with `onBeat` (`'beat'`, `'bar'`, `'best'`; the engine also takes `true`) and no `blend` waits for the grid of the newest running, unpaused audio cue that has one (`beats` for `'beat'`, otherwise `downbeats`: arrays of seconds into the file).

`beatPlan` computes a lead-in: `beatLead` for `'beat'` or when the group's first audio child has `from` > 0; otherwise that child's own first downbeat. The wait is the time to the next grid point at least `lead + BEAT_LEAD` away, minus the lead, so the incoming sound's first downbeat lands on the outgoing one's. With nothing on a grid playing, it fires now. A whole-file loop's grid wraps (up to three laps are searched); while a section is held only the section's own grid points count.

## 9. Jump (`music`)

A Jump moves a playing audio cue (its `target`, "the track") to another place in itself. It lives in a group; the group's `blend` (`'cut' | 'fade' | 'dj'`), `blendSecs`, `onBeat` and `beatLead` shape the move. A Jump outside a blended group still works: it moves as a 30 ms cut, now.

**Planning (`blendPlan`, at the group's GO).** No plan (the move happens now) when the track is not running, is paused or is fading to silence; when the Jump has `stop`, `stay` or `letGo`; when `to` is the end of the loop the track is in or armed for; or for a `hold` not yet reached. Otherwise:

- Crossfade length: `blendSecs` if set; else 0.03 s for `'cut'`; else one bar for `'dj'` and a quarter of a bar for `'fade'` (bar length from the track's `downbeats` around the departure, 2 s if unknown); `AMBIENT_FADE` as a plain fade where the grid confidence is below `LOW_GRID`.
- Departure: with `onBeat`, the next beat (`'beat'`) or downbeat far enough ahead to set up (half the crossfade plus `SYNC_LEAD`); without, as soon as possible (`NOW_LEAD`).
- `'best'` chooses among the next `BLEND_WITHIN` downbeats within `BLEND_MAX_WAIT` and the group's `landings` (precomputed scores of how well each downbeat leaves for each landing): the earliest pair scoring at least `min(GOOD_JUMP, best − 0.05)`. `landings` is engine-only, so from a show file `'best'` behaves as `'bar'`.
- A second planned jump on the same track while the first still waits cancels the first.

The group waits `plan.wait`, then acts; `takePlan` hands the plan to its Jump child.

**Moving (`moveTrack`).** In this order:

| Case | Behaviour |
|---|---|
| Track fading to or at silence | It is stopped and treated as not running. |
| `stop` | A 30 ms fade to silence, then stopped. |
| `stay` | Position unchanged; with `level`, the level fades to `gainDb + level` over the group's `blendSecs` (min 0.05 s). |
| `to` equals the end of the loop it is in or armed for (and no `loop`) | Lets go: the next armed hold becomes current, the pass plays out and the track plays on. |
| `letGo` with nothing to let go | Logged; plays on. |
| `hold` + `loop`, track before `end` | Arms a hold on `to`–`end` (or `loopFrom`–`end`): the track plays on and loops when it gets there, or loops now if inside it. Section 10. |
| Track not running | Started at `to` (fading in over `fadeIn` if set), looping `to`–`end` if `loop`. |
| Track paused | Seeks to `to`, stays paused. |
| Otherwise | `audio.move` with the plan; the engine's position jumps to the landing after the plan's lead. With `loop`, the track loops `to`–`end` after landing. With `level`, it fades to `gainDb + level` over the longer of `blendSecs` and the crossfade. Landing at or past the track's own `cutAt` disables that cut. |

A pause that arrives during a move's lead undoes the move (the engine restores the position it had).

## 10. Holds

A hold loops a section of a running track to the sample until let go. It needs the backend to report the sound `exact`; `wantedFiles()` lists what should be decoded ahead (running cues, and audio children of the group at the playhead, that have `loops` or `loop`).

Per running sound the engine keeps `region` (the section looping now, or about to), `loopTo` (the next armed hold) and `holdQueue` (further armed holds, in time order).

- **`armHold(r, loop)`** adds a hold. Every armed hold still ahead of the track is kept, de-duplicated and sorted by start; the earliest becomes `loopTo`. **`nextHold(r)`** promotes the next after one is let go or skipped past.
- **`toggleHold(id, { start, end })`** is the loop lane's one control. The region must match (within 0.02 s) one of the track's Jump holds (`holdsOf`), its `loops` or its `loopOptions`; anything else is refused. It returns what it did: `'let go'` when the track is looping that section now (this pass plays out, then on); `'disarmed'` when it was armed and not yet reached; `'armed'` when it is ahead of the track or the track is inside it; `null` when it is behind the track or unknown.
- **`setHold(on, { id, index, region })`** is the global Hold: on, it loops the section the hold target is in (else the next one) from the track's `loops`; off, every sound lets go. The hold target (`holdTarget()`) is the newest unpaused sound, preferring ones with `loops`, then ones on the `music` bus. `go()` and `panic()` turn Hold off. The host exposes no command for `setHold`; the app uses `toggleHold`.
- **`release(id)`** lets go: the region is cleared, the position rebased, and tails rescheduled.
- **`debugLoop(id, { start, end })`** loops any stretch of at least 0.2 s with no cleanliness check. Not exposed by the host.
- **`holdsOf(trackId)`** lists every section a Jump in the list loops on that track (`{ id, start, end, number, name }`), cached until the next `load`.

## 11. Transport

- **`panic()`**: clears pending follows, waits, fade timers and `releaseThen`; turns Hold off; fades every running sound to −60 over `panicFade` and stops it. Paused sounds are stopped at once. A second call within `PANIC_HARD_WINDOW` (1.5 s) stops everything dead. Clears `loaded`. The playhead does not move.
- **`fadeAll(secs = 5)`**: the same without the hard second stage, over `secs`.
- **`stopCue(id)`**: `stopTree(id)` and drops its top-level cue's pending follow.
- **`pause(id = null)`** / **`resume(id = null)`**: one cue and everything under it, or everything. Pausing freezes waits, fades and sounds (clocks are rebased on resume; a fade resumes over what was left of it; tails are rescheduled). `isPaused(id)` is true if any sound or wait at or under `id` is paused.
- **`reset()`**: stops everything dead with no fade, clears waits, fades, pending loads, `loaded`, the show clock, `lastGo`, follows and Hold, undoes Target cues, clears loads and ducks, and puts every list's playhead on its first stop. It does not re-arm cues and does not change `listName`.
- **`loadToTime(secs, id = playhead)`**: the next fire of that cue starts `secs` in (cleared by 0; negative: back from its end). For the cue standing by it is `loaded = { id, at }`; for any other it is kept in `loads`. For a group: audio children start at `secs` into their files, other children wait what is left of their pre-wait, and memos whose moment has passed are skipped.
- **`trim(id, delta)`**: moves a running sound's level by `delta` dB from wherever it is (over 0.25 s, or over what is left of a fade in progress, retargeting it). The engine does not save it.
- **`seek(id, t)`**: moves a running or paused sound to `t` (clamped to the file). A seek out of the held region drops the region; past an armed hold promotes the next; back from a tail fade restores the level. Memo siblings in its group are re-timed from the new place (ones behind are dropped). Tails are rescheduled.
- **`moveOnGrid(id, t, { grid = 'downbeats', secs = 0 })`**: a skip (or, with `secs`, a crossfade) that leaves on the track's OWN next bar line (`'beats'`: beat), for the Playing strip's markers "on the bar". The track plays on; `SYNC_LEAD` before the line the move is handed to `moveTrack` as a Jump on the bar is (a 30 ms cut, or a fade centred on the line). Going round a held section, the next of that section's own lines. With no grid on the track, paused, stretched or past its last line it goes now (`seek` / `fadeTo`). Asked again before it went, the last one asked for wins; a track stopped or paused while it waits is not moved. Returns `{ wait, at }`, `{ wait: 0 }` or null (not playing). Host: `seek` / `fadeto` with `on: 'bar' | 'beat'`.

## 12. Read by the engine, not yet by a show

A blended Jump's `landings` and `onBeat: 'best'`: precomputed scores of how well each bar leaves for each landing, so a jump could pick the bar that matches best. The cue-type table has no field for them, so no show reaches them: they are the consumer of match scores, which are still to be made (the tracker's beat-grid line). If they are not, they go.

An audio cue with no `bus` plays on `effects` (`busOf`); `toEngineDoc` always sets one. `holdTarget()` uses the `music` bus to pick the track Hold acts on when no running track has sections.

## 13. What the UI reads

`snapshot()` returns:

| Field | Value |
|---|---|
| `lists` | `[{ name, count, playhead, live }]`: each list's own playhead and how many of its top-level cues have something going on. |
| `listName`, `playhead` | The active list; the standing-by cue's id or `null`. |
| `cues` | The active list's top-level cues (the engine's objects). |
| `skipLights`, `held` | Booleans. |
| `live`, `paused` | Ids of top-level cues that are live / have something paused under them. |
| `disarmed` | Every disarmed id, at any depth. |
| `showStartedAt`, `now` | Clock seconds; the show clock is their difference. |
| `loaded` | `{ id, at }` or `null` (the cue standing by). `loads`: `{ id: at }` for every other loaded cue. |
| `lastGo` | `{ id, at }` or `null`. |
| `active` | See below. |
| `problems` | `[{ id, top, why }]`: missing files and `broken` cues. |
| `durations` | `{ file: seconds }`. |

`active()` returns one entry per wait, running sound and fade, sounds first, then by time left:

- wait: `{ id, kind: 'wait', type, name, number, parent, elapsed, total, paused }` (`parent` is the top-level cue's id; `type` is the waiting cue's type). Wait cues appear as `kind: 'wait', type: 'wait'`.
- sound: `{ id, kind: 'audio', type: 'audio', name, number, parent, elapsed, total, loop, loops, loopOptions, region, exact, holds, holding, armed, db, fadingTo, paused, file, gainDb, markers, duck, topNumber }`. `duck` is the dB a cue that ducks the others is holding it at. `elapsed` is the position in the file; `total` the file's duration (0 if unknown); `holding` is true while the track is inside the section it loops; `armed` is `[{ start, end }]`, next first.
- fade: `{ id, kind: 'fade', type: 'fade', name, number, parent, elapsed, total, paused }`. Fades the engine makes itself (panic, fade-others, tails, fade-ins, level moves) have ids like `panic:<id>`, `others:<id>`, `tail:<id>`, `level:<id>` and the name `'fade out'`.

## 14. Not yet implemented (vs QLab)

The engine lacks the following; `09-qlab-parity.md` has the full matrix.

- A Devamp's "start next" landed to the sample (it is a timer). (A cue cart is the host's and the window's: its buttons start cues by id, whichever list is being run.)
- Group modes other than timeline (start-first-and-enter, start-first, start-random, playlist, cue-list).
- Triggers on lists. (Hotkey, OSC, MIDI, wall-clock and timecode triggers on cues are the host's: it calls `start`, or `fire` with an offset for timecode that arrives part way through a cue.)
- Auto-follow that waits for a Fade cue's duration (section 4).
- Script cues. (Video, Text and Camera cues are in [13 · Video and the stage](13-video.md): a video file is an `audio` cue with a `picture`, the rest are `picture` cues.) Light cues hold levels sent as DMX over Art-Net and sACN ([14](14-lighting.md)); no USB DMX.
- Fade curves (the backend's ramp is linear in dB), fades of rate or of groups, absolute-clears-relative semantics, Revert Fade Action.
- Slices with play counts, playback rate, per-cue output routing (a cue has one bus).
- An event broadcast: the engine has one `'change'` event and a log line per action, not typed events.
