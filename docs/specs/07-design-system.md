# 07 · Design system

This document describes the design system of the operator's window: the tokens in `app/renderer/styles.css` (values quoted as they are in the file), its three themes, the components built from them in `app/renderer/` (`app.js`, `CueList.js`, `Inspector.js`, `Sidebar.js`, `Drawers.js`, `Settings.js`, `lib.js`), and the interaction rules the code implements. Descriptions were checked against screenshots of the running app in the LAB and OCEAN themes. The web remote's page (`app/main/modules/remote.html`) carries its own fixed palette and is noted where it differs.

## 1. Principle: four colours carry meaning

Only four colours say something, and they say the same thing everywhere and in every theme:

| Token | Means |
|---|---|
| `--go` | Running; GO. Green means GO and nothing else. |
| `--standby` | Standing by, loaded, paused, armed, unsaved, waiting for review. |
| `--danger` | Panic, broken, delete, clipping. |
| `--accent` | Selected, focused, switched on. |

Everything else is a neutral from the surface ramp (`--bg-0` … `--bg-4`, `--line`, `--line-soft`, `--text-0` … `--text-3`). Each of the four has a wash for backgrounds, mixed into the panel colour and so derived per theme: `--go-wash` 16%, `--standby-wash` 11%, `--danger-wash` 16%, `--accent-wash` 17% (all `color-mix(in srgb, <colour> N%, var(--bg-1))`). `--on-accent` and `--on-go` are the text colours on a filled accent or go surface.

Where the four are used beyond their strict meaning, as implemented: `--accent` fills the primary button (`.btn.primary`: "New show", "Send") and outlines the picked theme card; `--go` fills the affirmative button (`.btn.go`: "Accept") and colours the word "Cues" on the welcome screen; in a diff, added / removed / changed / moved lines are signed in go / danger / standby / accent.

One drawn thing has colours of its own: the assistant's eye (`--qirx-milk`, `--qirx-lamp`, `--qirx-rest`, `--qirx-frame`; [`docs/brand-assistant.md`](../brand-assistant.md)). Its lamp is the puppet's own yellow, which is close to `--standby`: those colours fill that pentagon and nothing else, it is low at rest, and its state is always said in words beside it.

### Themes

There are three themes. Only colours, fonts and the wash change; sizes, spacing and timing are shared. LAB is the default, on `:root`; the others are `:root[data-theme="ocean"]` and `:root[data-theme="graphite"]`. The theme belongs to the computer, not the show: Settings ▸ General calls the shell op `theme` (`ec.app({ op: 'theme', theme })`, saved as `config.theme` in `app/main/main.js`), `ec.init()` returns `theme` and `themes`, and `app.js` sets `document.documentElement.dataset.theme`.

| Token | LAB (default) | OCEAN | GRAPHITE |
|---|---|---|---|
| `--bg-0` (the window) | `#0d0907` | `#070a07` | `#0c0d0f` |
| `--bg-1` (panels) | `#15100c` | `#0b100b` | `#131518` |
| `--bg-2` (raised) | `#1e1712` | `#121a12` | `#1a1d21` |
| `--bg-3` (inputs, buttons) | `#281f18` | `#1a241a` | `#23272d` |
| `--bg-4` (pressed, control borders) | `#3a2d22` | `#27352a` | `#2e333b` |
| `--line` | `#33271d` | `#1f2c1d` | `#24282e` |
| `--line-soft` | `#231a13` | `#151d14` | `#1b1e23` |
| `--text-0` | `#efe4d2` | `#e2e8da` | `#eef0f3` |
| `--text-1` | `#c2b099` | `#a8b8a2` | `#a8aeb8` |
| `--text-2` | `#8a7862` | `#71806c` | `#6c737f` |
| `--text-3` | `#5f5140` | `#4b5747` | `#4a505a` |
| `--go` | `#a3c98f` | `#96c7a0` | `#35d07f` |
| `--standby` | `#ecd25e` | `#d9b877` | `#f4c64e` |
| `--danger` | `#e4604b` | `#d9705f` | `#ff5f56` |
| `--accent` | `#d39a6a` (copper) | `#7fb3a4` | `#5b9dff` |
| `--on-accent` | `#1c1008` | `#06140f` | `#07111f` |
| `--on-go` | `#0c1a08` | `#06140a` | `#05170d` |
| `--wash` (opacity) | `0.55` | `0.30` | `0` |
| `--wash-image` | `images/table-copper.webp` | `images/algae.webp` | `none` |
| `--wash-position` | `50% 40%` | `30% 18%` | (inherits LAB's; unused) |
| `--wash-filter` | `saturate(1.05) brightness(0.55) contrast(1.15)` | `saturate(0.7) brightness(0.5)` | (inherits LAB's; unused) |
| `--slab-image` | `images/table-pewter.webp` | `none` | `none` |
| `--slab-mix` | `88%` | `82%` | `100%` |
| `--sheet-mix` | `84%` | `80%` | `100%` |
| `--font` | `'Jost', 'Avenir Next', 'Segoe UI', system-ui, sans-serif` | as LAB | `-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif` |
| `--display` | `'Bricolage Grotesque', var(--font)` | as LAB | `var(--font)` |

In LAB the whole room is warm, so `--standby` is pushed to a clear yellow well away from the copper accent: "selected" must not read as "standing by". A new theme has to keep that separation, and keep standby and danger the only clear yellow and red on screen.

### The wash, slabs and the sheet

One image sits under every surface: `.wash`, a fixed layer behind the app showing `--wash-image` at `--wash-position`, at opacity `--wash` through `--wash-filter`, vignetted into `--bg-0`. Chrome panels (title bar, masthead, toolbar, inspector, sidebar, drawers, playing strip, footer, the list's header) are **slabs**: `--bg-1` at `--slab-mix` opacity over `--slab-image` (a grain, tiled 900 px wide). The cue list is a **sheet**: `--bg-0` at `--sheet-mix`, nearly solid, because a dense table of numbers has to read first. GRAPHITE sets the wash to 0 and both mixes to 100%, which makes every surface flat.

### Cue label colours are labels, not states

A cue's `color` is one of `none, red, orange, yellow, green, teal, blue, purple, pink, grey`, drawn from a separate set of tokens that is the same in every theme: `--c-red #e5484d`, `--c-orange #f08a3c`, `--c-yellow #e6c229`, `--c-green #46b56c`, `--c-teal #2bb3a8`, `--c-blue #4a8fe8`, `--c-purple #9a6be0`, `--c-pink #e069a8`, `--c-grey #7b828c`. The inspector and the list's right-click menu offer six (`PALETTE`: none, red, orange, yellow, green, blue) and "…", which opens the system's colour wheel for any other; a colour chosen there is kept as `#rrggbb` and drawn as chosen, and the other names (teal, purple…, from older shows and QLab) stay valid (`cleanColor` in `core/show/cue-types.js`, `colorCss` in `app/renderer/tidy.js`). It appears in exactly two places: a 3 px bar at the row's left edge (`.swatch`) and the picker in the inspector. It never tints the row, the text or a status mark, so a red label cannot be mistaken for a broken cue.

## 2. Type, numbers, sizes

Every size on an operator surface is a token on `:root` in `styles.css`. A new rule uses one of them; a literal
size is a bug, with the few exceptions listed under each scale.

### Type scale

| Token | Size | For |
|---|---|---|
| `--fs-xs` | 10.5 px | section labels in capitals (letter-spacing .08–.12em, `--text-2`), column headers, badges, tags |
| `--fs-s` | 11.5 px | secondary words: a row's second line, chips, meta, units, help |
| `--fs-m` | 12.5 px | controls, field labels, tabs, small text, mono numbers (`.num`, `.mono`) |
| `--fs-base` | 13.5 px | body (line-height 1.35) |
| `--fs-l` | 15 px | a row's label read from a step back (the Rig), a first line (the assistant) |
| `--fs-h` | 18 px | the heading of a page, a Settings pane, a sheet |
| `--fs-xl` | 25 px | the cue standing by (its number in mono, its name in `--display`) |

Outside the scale, on purpose: GO (34 px, weight 750, `--display`), the welcome title (38 px), the imported title
(28 px), the show clock's mono (18 px is `--fs-h`), and the tiny marks drawn as text (fader ticks, the Live view's
device chips, a glyph's size inside a row: 8–9.5 px, and a large row's glyph at 16 px).

`--font` is Jost in LAB and OCEAN and the system UI font in GRAPHITE; `--display` is Bricolage Grotesque (the show
title, GO, the standby name, headings); `--mono` for anything counted. Both families are bundled as woff2 with
`font-display: block`, so the app needs no network to draw.

**Numbers are mono and tabular.** Anything that counts or is compared down a column uses `.num` or `.mono`: cue
numbers, times, levels, addresses, OSC messages, version ids, file paths. Times are formatted by `clock()` in
`lib.js` (`m:ss.t`; a true minus `−` for time remaining), levels by `db()`.

### Control heights

| Token | Height | For |
|---|---|---|
| `--h-s` | 22 px | a small control: `.btn.small`, a `.seg` button, a chip, a tab in the title bar |
| `--h` | 26 px | a control: `.btn`, every input and select, an add-cue tool |
| `--h-l` | 32 px | a large control: the transport (Pause all, Panic, Fade all, Reset), the welcome's buttons |
| `--row` | 30 px | a row of the cue list and the Rig (22 compact, 38 large: Settings ▸ General) |

A button that holds a sentence (an assistant's ask) is a `.btn` that grows: `height: auto; min-height: var(--h)`.
The list's header is 24 px; the title bar 40 px; a drawer's head 40 px; the footer 26 px; the GO button 148 × 84.

### Spacing

Spacing steps are 2, 4, 6, 8, 10, 12, 14, 16, 20, 24 px. Inside a control 6–10 px; between controls in a row 6–8 px;
a panel's padding 10–14 px (a Settings pane 20–24); a form's gaps 10 px × 18 px; a field is a 96 px label then its
control. Rows inside a sheet have a 16 px side gutter (the Rig) or 8 px cell padding (the list).

### Radii

| Token | Radius | For |
|---|---|---|
| `--radius-xs` | 3 px | tags, marks, the Live view's small buttons |
| `--radius-s` | 5 px | controls, inputs, boxes inside a card |
| `--radius` | 7 px | cards, the review card, a version |
| `--radius-l` | 12 px | anything floating or framed: Settings, a sheet, a popover, a toast, the checks list, the GO button |

Pills (chips, the suggestion pills) are half their height. One shadow (`--shadow`) for anything floating; one easing
(`--ease`). Text is not selectable (`user-select: none` on `body`) except in inputs and where it is content.

### Words

The owner's rule, for every surface: **say little.** A heading is two to four words. A settings row has a title and at
most one short line under it, usually none. No sentence explains what a labelled button does; no parenthetical
asides; an empty state is one line and at most one button; a tooltip is what the control does in a few words, then
its key (`keys('… (⌘K)')`). What carries a safety meaning is kept, shortened: what Show mode locks, that nothing is
sent while held back, a destructive confirmation, that nothing is kept until you save, that nothing is written until
you accept.

### Wrapping and truncation

A name that can be long is cut with an ellipsis where it sits in a column (a cue's name and target in the list, a
standby name, a device's name in the editor's head, a command's name, a chip in the title bar) and carries its whole
text as its `title`; it wraps where it is the content of a row (a Rig row's label and text, the assistant's lines, a
review card's file path, a cart button, up to three lines). Nothing is ever wider than its box: the smoke run checks
the Rig with a 60-character device name at 1024 wide, and the title bar with every warning on at once.

## 3. Layout

The window opens at 1480 × 940 (minimum 980 × 620); every surface is checked at 1024 × 700 and 1600 × 1000.
`.app` is a four-row grid:

```
┌──────────────────────────────────────────────────────────────┐
│ title bar                                              40 px │
├──────────────────────────────────────────────────────────────┤
│ masthead: GO 148 px │ standby 1fr │ transport auto     auto  │
├─────────────────────────────────────┬───────────┬────────────┤
│ centre (1fr)                        │ sidebar   │ drawer     │
│   toolbar            (Edit only)    │ 320 px    │ 400 px     │
│   cue list   the rest, ≥ 4 rows     │           │ (if open)  │
│   playing strip      (if sounding)  │ active    │            │
│   inspector ≤ 268 px (Edit only)    │ resident  │            │
│                                     │ sent      │            │
│                                     │ mixer     │            │
├─────────────────────────────────────┴───────────┴────────────┤
│ footer                                                 26 px │
└──────────────────────────────────────────────────────────────┘
```

The centre is a column (flex): the toolbar, the Playing strip and the inspector take their own height, and the list
takes the rest, never less than its header and four rows (`--list-min`). In a short window the inspector gives way
first (down from 268 px; its body scrolls). Under 760 px of list, its fixed columns narrow so the name keeps room. In
the side panel, Active cues scrolls in its own space, so the resident and the mixer never lie over it.

On macOS the title bar leaves 84 px for the window's own buttons (`.mac .titlebar`); on Windows and Linux the native frame and menu bar stay. Settings is a modal over a blurred scrim; toasts float above the footer.

## 4. Components

### Title bar

Show title (600), then a chip "not saved to a folder" for an untitled show. Then **the tabs**: Edit · Rig · Show, and
Live when that view is switched on (`.tabs-main`, `[data-tabs]`, each `[data-tab]`):

- **Edit** is the cue list in Edit mode; **Show** is the cue list in Show mode; **Rig** and **Live** are pages.
  Choosing Edit or Show sets the mode (the host's `mode`); choosing Rig or Live keeps whichever mode the app is in.
  So the Rig opened from Show is under Show mode's locks, and only Edit unlocks.
- The tab on is raised (`--bg-1` with a ring). The Show tab is drawn in standby colours: filled with `--standby-wash`
  when it is the page, and its word stays yellow while Show mode holds on another tab. In Show mode a 2 px
  `--standby` rule runs under the whole title bar. Colour still means one thing: yellow is standby.
- Keys: ⇧⌘M goes between Edit and Show (from any tab), ⇧⌘R between the Rig and the list, ⌘L the Live view.
- The Rig tab carries a 7 px dot: `--danger` while the show has a problem, `--standby` while something is to be
  looked at, else none. Unsaved changes are not counted (Save says so), so a brand-new show wears no dot.

A list select appears only when the show has more than one list. On the right: one chip per running module, the
warning chips (blackouts, held back, solo, muted, audio output problem), undo and redo (Edit mode), **Save**
carrying the count of unsaved changes ("Save · 28", standby colours; its tooltip lists them; "Saved" when clean),
**⋯** (a menu: Versions ⇧⌘V, the light dashboard ⇧⌘D, the Network and MIDI monitor ⇧⌘N, Network in the side panel,
Report a Problem; each is also in the app's menus), Assistant (not in Show mode), Settings. A module's chip is there
only while that module is switched on.

### Masthead

- **GO button** (148 × 84, radius 12): `--go` border and text on `--go-wash` when a cue stands by; filled `--go` with `--on-go` text while pressed and for 120 ms after any GO (`.flash`); grey border and `--text-3` text at the end of the list (`.idle`). `.go-btn.locked` (danger) is defined in the CSS but nothing applies it. The button never takes focus (`mousedown` is prevented).
- **Standby display**: a small label ("Standing by" / "End of list"), with warnings in `--standby` beside it ("DISARMED — this GO will skip it", "LOADED TO …") and, for a Light cue, the call to make; the cue's number (mono, `--standby`) and name; then its notes, or if it has none, "then <next cue>".
- **Transport**: show clock (only once the show has started), **Panic** large (danger text, `--h-l`, 176 px), and under it small: Pause all (becomes "Resume all" in standby colours while anything is paused), Fade all, and in Edit mode only Reset (asks "Sure? Reset" in standby colours if sound is playing; a second click within 3 s does it).

### Toolbar (Edit mode)

Five cue types (Group, Audio, Fade, Stop, Memo), glyph then label, in `TYPE_ORDER`, then **+**: a short list of
every other type with a field that has the keyboard; typing narrows it (any type, by its name or summary), ↑ ↓
choose, Enter adds, Esc closes (`AddCue.js`, `matchTypes` in `tidy.js`). Every type keeps its ⌘ key.
"Group selection" appears when two or more cues are selected, "Ungroup" when a group is. The Audio button opens the
file dialog; the others add a cue after the selection, numbered, and open its name for typing.

### Cue list

A fixed-layout table with a sticky header. Columns: status 34 px, type glyph 26 px, Number 76 px (mono 600), Name (flexible), Target 150 px, Pre-wait / Duration / Post-wait 88 px each (right-aligned, mono), continue 34 px. Children are indented 18 px per level; a group has a caret that collapses it (a collapsed group shows its child count as a tag). Names that are defaults (not typed) are `--text-2`. Small outlined tags after the name state behaviour: `LIGHTS`, `loop`, `fade others Ns`, `on the bar`.

| Row state | How it is drawn |
|---|---|
| Hover | `--bg-1` background. |
| Selected (`.sel`) | `--accent-wash` background. |
| Playhead (`.head`) | `--standby-wash` background, a 3 px `--standby` bar inset at the left, `➤` in the status column. Selected as well: a mix of the two washes. |
| Live (`.live`) | `▶` in `--go`; a 2 px `--go` progress line along the row's bottom edge; the Duration cell shows time remaining in `--go`. A cue still in its pre-wait has the line in `--standby`. |
| Paused | `❙❙` in `--standby`. |
| Disarmed (`.off`) | Text in `--text-3` and faint diagonal stripes; also drawn on the children of a disarmed group. |
| Broken | `✕` in `--danger`, the reason as its tooltip. |
| Warning | `▲` in `--standby`, the reason as its tooltip. |
| Flagged | `⚑` in `--standby`, beside whatever else the status column shows. |
| Child (`.child`) | Text in `--text-1`. |
| Proposed change / removal | While a proposal waits: a faint standby tint for a cue it changes; a faint danger tint and strike-through for one it removes. Cues it would add are not in the list (they are in the review card); `.proposed-add` is styled but never applied. |
| Drop target | A 2 px `--accent` line above or below the row, or a 2 px accent outline for "into this group". Dragging files over the list outlines the whole list. |

The status column shows one mark, in this order of precedence: problem, paused, live, playhead. Empty list: a centred two-line hint.

**The section heading** (`app/renderer/Sections.js`). A section is a row across all nine columns, 8 px taller than a cue row, on a `--bg-2` tint: a caret, the name at `--fs-l` 500 in `--text-0`, and the section's own colour (a cue label colour, or `--line` with none) as the 3 px rule at the left. Folded, it adds the count of its top-level cues as a tag. It never hides what matters: a `▶` in `--go` when a cue in it is running; a hollow flag or a `✕` when a folded one holds a flagged or broken cue; and the cue standing by in it as `➤ <number> <name>` in `--standby` on a `--standby-wash` row while folded (a lone `➤` while open). A plain click on the row folds it and selects it (never the playhead); ⌥-click on any caret folds or opens every one like it (every section; a group's siblings); ← and → fold and open the selected section or group; `<` `>` and View ▸ Fold All / Unfold All do every section and group. In Show mode the section holding the playhead is drawn open whatever was folded, and folds again when the playhead leaves (only if it had been folded). What is folded is this computer's view of that show (`config.json` `folds`, by show folder), never the show file's.

**Chains** (`app/renderer/ListTools.js`, the arithmetic in `app/renderer/list-view.js`, unit-tested in `test/list-view.test.js`). Cues linked by their continue modes carry a 2 px line in `--text-2` down the left of the status column (7 px in; a group's children 5 px further per level): solid where a cue auto-continues (the next starts with it), dotted where it auto-follows (the next starts when it ends), with a short tick on each linked cue. The line runs past what GO passes over (a section heading, a light cue only called while light cues are skipped, a group's open children); a folded section stands for the part of the chain inside it. The next cue is the next GO would stand by on, and inside a group only where the group starts its first child (enter, first, random). The masthead says `GO · N cues` beside "Standing by" when the GO sets off more than one. When a delete or a cut takes a cue out of the middle of a chain, the cue before it and the cue it now links to flash on a `--bg-4` tint for 2.4 s, their line in `--text-0`, and the toast says "1 now auto-continues into 3 · ⌘Z undoes it".

**A playing row** carries, at the right of its Name cell, a 34 × 4 px meter of that sound's own level (after its fader, in `--go`; `cueLevels` in the state, read by the audio window 15 times a second) whose title says where it goes (its bus and that bus's pair, or its own outputs, and the device), "NO OUTPUT" in `--danger` when the device, or an output it needs, is not there, and a stop: `■` in `--danger` in a thin danger outline (filled while that stop fades it). A click fades the sound out over the panic time; a second click while it fades, or ⌥-click, stops it dead. The stop never takes the keyboard and never selects or moves the playhead. In Show mode it is 34 px wide and the row's height, far from GO.

**Find** (⌘F): each match (as typed, Enter, ⇧Enter) unfolds the sections and groups hiding it, is selected (never the playhead) and brought to the middle of the list, and flashes once in `--accent` (0.9 s; anything gone to does).

**Zoom.** A pinch (or ⌘-scroll), ⌘− and ⌘=, and the `−` / `+` button in the continue column's header zoom the list between its normal rows and the whole show in the window, on a log scale, the row under the pointer kept still. As the rows shrink their contents shrink with them and fade out; below about 14 px a row is a bar: the Name cell in the cue's colour (or `--bg-4`), the cue standing by in `--standby` and running cues in `--go`, each at least 6 px; headings keep 18 px and stay readable; chains stay drawn. Zoomed out that far a click zooms back in with that row brought to the middle, selecting nothing. ⌘0 is back to normal size while the list is zoomed out (at normal size it stays the tenth cue type's key). How far is kept per show on this computer (`config.json` `listZoom`), never in the show.

**The section strip**: when a list has sections, one quiet line above the list's header, the sections' names in `--text-2` at `--fs-s`, each with its colour as a 2 px rule; the one holding the playhead in `--standby`; it scrolls sideways when the names do not fit. A click brings that heading to the top of the list and selects it. Chosen over the side panel because the side panel is narrow at 1024 px and holds Active cues, which the operator needs more.

### Playing strip

Appears between the list and the inspector while any sound plays. It shows the selected cue's sound if it is playing, otherwise the longest sound running. Header: a dot (`--go`, or `--standby` when paused), top-level number and name, a "⟳ HOLDING" chip in standby while a section is held, position / length in mono (with the bar.beat count in `--text-2` before it when the sound has a tempo), Pause and Stop. The waveform has a light line at each bar when there is a tempo. Under it, one row of small controls (`.ptools`): Loop 1 2 4 8 bars (a tempo only; replaced by a standby "Let go" while a loop is held or armed), a button per marker, the marked place with Skip and Fade to, and at the right "Find the tempo" (no tempo only) and More. More folds out a second row: shorter loops (or loops in seconds), "+ here", "on the bar". A sound with no tempo shows nothing of bars. The row wraps in a narrow window.

### Waveform and loop lane

The waveform is drawn on a canvas, 84 px tall (64 px in the playing strip): peaks in `--bg-4` with RMS inside in `--text-2`; the part already played in `--go`; the parts before Start and after End dimmed. A 1 px white cursor marks the position; markers are dashed vertical lines with their names. Clicking skips there (or sets Start, in the inspector, when the cue is not playing).

Above it, when the cue has loop regions, the **loop lane**: one 18 px block per region, positioned by time.

| Block state | Drawn |
|---|---|
| Idle | `--bg-2`, grey border, `--text-2` label. |
| Armed (`.armed`) | `--standby` border and text: the track will loop here when it arrives. |
| Holding (`.holding`) | Filled `--standby`, dark text, `⟳` before the name: the track is looping here now. |

Clicking a block arms it, disarms it, or lets go, according to where the track is.

### Inspector (Edit mode)

Up to 268 px tall (less in a short window: see Layout). Tabs: Basics, then the cue type's own tab, then "Time & Loops" for a single Audio cue; the active tab has a 2 px accent underline. The right of the tab row says what the selection is (glyph and summary, or "N cues selected") and has Audition. The body is a form in auto-filling columns (minimum 250 px), label 96 px then control. Fields are drawn from the cue-type table by `kind`:

| Kind | Control |
|---|---|
| `text`, `file`, `patch`… default | Text box (`mono` for OSC messages and file paths); `file` adds "Choose…". |
| `longtext` | Three-row text area, full width. |
| `seconds`, `db`, `number` | Mono text box with a unit (`s`, `dB`); the default shows as the placeholder. |
| `bool` | Switch (accent when on). |
| `enum` | Segmented control for four options or fewer, otherwise a select; colour is a row of round swatches. |
| `cue` | Select of eligible cues, "number · name". |
| `bus`, `patch` | Select from the show's buses / network patches. |
| `levels` | One mono box per bus. |
| `markers`, `regions`, `envelope`, `automation` | Not in the form: on the Time & Loops tab, drawn on the waveform (`WaveEdit.js`): markers in a strip above it and loop regions in the lane above that, both dragged where they go; the lines over it, chosen in its lane picker. The chips below it are the same markers and regions, typed. |
| `shape` | A select (Linear, S-curve, Custom) and the curve drawn beside it; a custom curve's points are added, dragged and removed there (`Curves.js`). |

Fields marked `advanced` fold under "More (N)". Pre-wait is on Basics only while a selected cue has one; Post-wait only while one has it or is set to auto-continue (the only time it matters); otherwise both are under More. With several cues selected, a field whose values differ shows "(mixed)" and an edit applies to all. Problems of the selected cues are boxes at the top: danger wash for errors, standby wash for warnings.

### Sidebar

- **Active cues.** With nothing playing, the panel's head says "Nothing playing" in `--text-2` and there is nothing under it; the mixer stays where it is either way, so it never moves under a hand when a cue starts. One block per running sound: number, name, time remaining (`−m:ss.t`; elapsed with `⟳` for a loop), a 4 px bar in `--go` (`--standby` when paused) that skips on click, pause and stop buttons, a "⟳ holding" chip, and the level in mono (`−∞ → −6 dB` while fading). Waits and fades are slimmer rows: waits in `--standby`, fades in `--text-1`.
- **Network.** Hidden until this viewer asks for it (⋯ ▸ Network in the Side Panel, kept in this window's storage): the last four Network cue sends, mono; a failed one in `--danger` with `✕`.
- **The resident.** "Ask the assistant ⌘K" with QIRX-G's head before it, 18 px tall (about the words' height).
- **Mixer.** A round knob per bus and nothing beside it: drag (Shift: finer) or scroll; double-click (on the knob or its value) types a level; ⌥-click sends it to 0 dB; Tab reaches it, and then ↑ ↓ step 1 dB (Shift 0.5) and Enter types. Then Master (bold): name 74 px, fader, value 48 px (mono). The fader is a 10 × 20 px light thumb over a 6 px meter; range −60 to +12 dB with more travel near the top, 0.5 dB steps, a tick at 0 dB, double-click for 0 dB. Meter colour runs `--go` to 78% of the travel, `--standby` to 94%, `--danger` above. The Master shows two thin meters (left and right). A `LIMIT` badge turns `--danger` while the safety limiter is reducing.

### Drawers

A 400 px column to the right of the sidebar: a 40 px header, a scrolling body, an optional composer.

- **Assistant.** One scroller: the drawer's body (the review card and a file's text in it grow, nothing scrolls inside
  them). A model's name in the head is shown as written, not in capitals. The asks are ordinary `.btn`s that hold a
  line of words. User messages are right-aligned bubbles in accent wash; replies left-aligned in `--bg-2`; an error reply has a danger border. Three blinking dots while it works. Suggestion pills before the first message. The composer is disabled in Show mode. Before the first message the body is about this show (`.first`): one line (14.5 px, medium), its asks as full-width `.btn`s (text wraps), and one quiet line in `--text-2` for what could be asked next. With nobody chosen to answer, under those: "Who should answer?" and a bordered row per choice (a bold name, a sentence), and no composer.
- **Review card** (`.review`). A staged proposal: standby border and wash, "PROPOSED CHANGE · counts" in `--standby`, the summary in bold, the diff (one line per cue, signed `+` go, `−` danger, `~` standby, `↕` accent, with `old → new` per field), and a footer stating that nothing has changed yet, with Reject and Accept (`.btn.go`). Under the cue changes, each only when it has something: **Devices** and **Files** (`.rpart` section labels): a device as one line (`+ Lantern A · prop · 10.0.0.42:53100 · 7 commands · asked every 2 s`), a file as its path in mono with a dotted underline (click: its text in a mono box that scrolls only sideways), a replaced one signed `~`.
- **Version card** (`.version`). Mono id, an author badge (accent-tinted for the assistant), "current" when it is the newest and nothing has changed since, relative time, the note, the cue count, "Compare with now" (opens the diff inline) and Restore (disabled for the current version and in Show mode). The current one has an accent-tinted border. With unsaved changes, a "now" card at the top takes an optional note and saves.

### The Rig

The Rig tab in the title bar (see Title bar for its dot and for how it keeps Show mode).

- **The list** (`.rig-list`) is a sheet like the cue list. A sticky header: "The rig" in the display face, then the counts, each behind its mark with the digits in mono ("● 6 of 10 ready  ✕ 1 problem  ◐ 2 to look at  ○ 1 cannot be told"), then *Check again* (its tooltip says when it last checked) and *Look for props* (both the default grey button: neither is a GO).
- **A row** (`.rig-row`, at least 30 px): mark, the label (`--fs-l`, medium: an assertion such as "Every file is found", or for a device its name alone, "Lantern A", with its state in the text, "answering · 3 ms"), its text in `--text-1`, and its actions as small buttons at the right. A row that is not ready has what to do on a second line in `--text-1`, never coloured. **The mark is the only colour on a row, and it is a shape as well:** `●` `--go` ready, `◐` `--standby` to look at, `✕` `--danger` a problem, `○` `--text-3` cannot be told. A device's row is clickable (hover as a cue row, selected in `--accent-wash`) and carries the 5 px unsaved dot while the device has unsaved changes; a report with a warning follows its text behind a `◐`.
- **Narrow.** Under 520 px of list the actions drop to a line of their own under the text. Labels and texts wrap (`overflow-wrap: anywhere`); nothing is cut.
- **Group labels** (`.rig-gl`) are section labels (10.5 px, uppercase, `--text-2`); Equipment's carries *Add a device ▾*, a popover (`.rig-pop`) of rows with a bold name and a line of `--text-2` under it.
- **An empty Equipment** is one line, "No devices yet.", and *Add a device ▾*.
- **A prop that answered** a look, or a sender heard on the network, is a row like a device's: the same columns,
  height and indent, the mark `●` (it answered) or `○` (a sender), its button at the right. The checklist with no lines is one input whose placeholder says what it is for.
- **The device editor** (`.rig-editor`): a slab beside the list, 400 px wide, 360 px when the page is under 900 px
  (so at 1480 with a drawer open both fit); under 720 px it takes the list's place and its close button becomes
  "‹ The rig". Head: the name (a text box, 14 px semibold), the kind. Fields are a 96 px label and a control, as the inspector's. The state is a bordered line with the mark. A command is one row (name, cut with its title; a control per value: number 50 px, text 110 px, a select for a choice; *Try*, *+cue*, and a pencil that opens the command's own settings in place), and under it in mono the exact message it sends, cut with its title. "Held back" and Show mode are said in a `--standby-wash` note above the commands, in words.
- **Controls stay where they are.** The "Is it there" row keeps the height of its second line whichever way is chosen; a command's own settings open under it and move nothing above.

### Settings modal

`min(880px, 92vw)` × `min(640px, 88vh)`, a 190 px nav on `--bg-0` and a scrolling pane. Seven entries: **General**
(GO and safety, then Appearance), **Show**, **Audio**, **Integrations** (a row of sub-tabs: Network · Video · Light ·
Triggers · Modules), **Assistant**, **Keys**, **About**. Every section id a caller opens (`'go'`, `'appearance'`,
`'network'`, `'modules'`…) lands on its entry and sub-tab. A setting is a row: a title, at most one short line, the
control on the right (`.setting`). In Show mode a standby box at the top says the show's settings are locked.
Clicking the scrim or Esc closes it.

### Footer, toasts, welcome

Footer (26 px, `--text-2`): cue count; "✕ N broken" in danger and "▲ N warnings" in standby, each selecting the first such cue; "SHOW MODE — editing is locked" in standby; on the right the output device (opens Settings ▸ Audio), **Report** (always: the Report a Problem form) and the version. When the app logs that something went wrong (an error, a sound that could not play, an output gone, a window that died and was made again: `core/report/issues.js`), the footer says "Something went wrong. Report it?" in `--standby` with a Report button and ×; Report opens the form with that line attached (each attachment can be unticked). In Show mode it is only a 7 px standby dot until Edit: it never takes focus or a key. A toast is one centred line above the footer for about 3 s; refusals from the host have a danger border. The welcome panel covers the list for an empty untitled show: the app's mark, the name in the display font, one sentence, three buttons, recent shows.

### Controls

`.btn` (default grey), `.ghost` (no chrome until hover), `.primary` (accent fill, `--on-accent` text), `.go` (go fill, `--on-go` text), `.danger` (danger text, wash on hover), `.standby` (standby wash and text), `.on` (accent wash: a toggle that is on), `.small`, `.icon`. `.switch` (30 × 18, accent when on), `.seg` (segmented), `.chip` (22 px pill; `.warn`, `.bad`), `.badge`, `.kbd`, `.dot` (7 px; `.go`, `.standby`, `.danger`). Inputs sit on `--bg-3` with no border until hover; focus is an accent border on `--bg-2`.

## 5. Interaction rules (as implemented)

- **Space is GO everywhere but a text field.** The key handler listens on `window` in the capture phase, so a focused button, select or fader never receives Space or the arrows. Auto-repeat does not GO.
- **A click leaves no control holding focus.** On every `mouseup`, the focused element is blurred unless it is a text field or a select. The GO button refuses focus outright.
- **Esc in a field never panics.** While typing, Esc discards the draft and leaves the field (`TextBox`, `Inline`: each ignores the blur that follows its own Esc); the window's handler does nothing with Esc while a field is being typed in.
- **Esc elsewhere is Panic**, except that with Settings open it closes Settings.
- **Selection follows the playhead** when something other than the selection moved it (a GO, a remote, a GoTo cue), unless the playhead lands inside a multi-selection. Selecting a single top-level cue moves the playhead to it; selecting a child does not. The playhead row is scrolled into view when it moves.
- **Edits commit on Enter or blur.** One-line boxes commit on Enter; text areas on ⌘Enter; both on losing focus. Switches, segmented controls and selects commit at once. Each commit is one undoable edit with a label.
- **Faders are live while dragged and saved on release**: `input` moves the sound, `change` writes the show.
- **Show mode** is the Show tab. It hides the toolbar and the inspector (`.show-mode`), stops rows being dragged, renamed or having their continue mode cycled, disables the assistant's composer and Restore, and swallows the editing keys. The host refuses edit commands regardless of what the window does.
- **Destructive transport asks once**: Reset while sound plays needs a second click; quitting while sound plays needs a second ⌘Q.
- **The view holds no show state.** Selection, collapsed groups, the open drawer and the inspector tab are the window's; everything else is drawn from pushed state.

## 6. Do / Don't

**Do**

- Use a token for every colour. If a state needs a colour, it is one of the four; if it does not fit one, it is a neutral.
- Check a change in all three themes. A theme defines the whole set of colour tokens and nothing else.
- Put every number in `.num` / `.mono`, formatted with `clock()` or `db()`.
- Add a field to `core/show/cue-types.js` and let the inspector draw it; add a `kind` to `Field` only when no existing control fits.
- Keep live controls in the main view and set-once options in Settings.
- Give every icon-only button a `title`, written with `keys()` so shortcuts read correctly per platform.
- Send every change through `cmd` / `edit` and draw only what the host pushes back.
- Make a new row state a class on the row, with its mark in the status column.

**Don't**

- Don't tint a row, a name or a status mark with a cue's label colour.
- Don't use `--go`, `--standby` or `--danger` for emphasis or decoration; `--accent` is the only one that may mark "this is the thing to press".
- Don't let a control keep focus after a click, and don't bind Space, Esc or the arrows on a component.
- Don't hold show data in component state or `localStorage`.
- Don't hide a refusal: a `{ error }` from the host is shown as a toast.
- Don't add hard-coded colours. Those left in the file are the dark text on a holding loop block (`#1c1503`), the scrim, and a few translucent black and white overlays (stripes, shadows, the cursor's glow). `remote.html` and the window's `backgroundColor` in `app/main/main.js` carry their own fixed dark-grey values, which match none of the themes exactly.
- Don't put text straight on the wash. Chrome is a slab and the list is a sheet; anything new sits on one of them.

## Pending changes, knobs and the waveform marker

A control whose value differs from the saved show carries a small `--standby` dot (`.was`); its tooltip gives the saved value, and ↺ beside it puts that one control back. A cue row with pending changes carries the same dot in its status column; a knob's ring turns `--standby`. The title bar shows "N unsaved" (it opens the list of pending changes) and a Save button. Yellow means here what it means everywhere: not yet committed.

The mixer's bus levels are round knobs, side by side (`Knob` in `Sidebar.js`): drag up or down (Shift for fine), scroll, double-click for 0 dB; − and + stacked on its left step by 1 dB. Master is a slider. Defaults puts every level to 0 dB, pending like any change.

Every knob is drawn by one face (`DialFace` in `Knob.js`): a track from 7 o'clock round to 5, an arc from the setting's origin (0 for a gain or a pitch, else the bottom of the range), a needle. The sound-design devices use `ParamKnob` (the same file): the setting's short name above, its value and unit below; drag up or down (Shift: ten times finer), scroll, or the arrow keys; double-click the dial for the default, double-click the value to type one ("1.8k", "350 ms", "30%"). A frequency, a long time or a ratio turns along a ratio, a level or a mix along a line (`dial.js`, unit-tested in `test/dial.test.js`).

The Sound design tab is a rack (`SoundDesign.js`): one device per tool in use, left to right in the order they run, scrolling sideways inside the tab when they do not fit. A device's title bar has its power button (`--accent` when on: "switched on"), its name, ‹ › for the settings beyond its first four knobs, and × to remove it. A device that is off is dimmed and keeps its settings. A device changed since the save carries the `--standby` dot and border; a knob changed, its ring and name. Bypass lit in `--standby` (the whole chain out: a state to notice), Tail in `--accent`. The add list and the presets list are popovers that close on a click outside them, never on Esc (Esc is Panic).

On a playing track's waveform a click leaves a marker (`.pin`, `--accent`) with its time. Skip jumps to it, Fade to crossfades to it inside the track over 1.5 s, and the marker stays until Clear, so Skip again returns to the same place.
