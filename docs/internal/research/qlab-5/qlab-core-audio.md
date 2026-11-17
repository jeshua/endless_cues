# QLab 5 feature inventory: fundamentals and audio

Source: the official QLab 5 manual, https://qlab.app/docs/v5/ , fetched 2026-11-13 (manual current to QLab 5.6.5). Every bullet is taken from a page that was read in full; the page is named at each section. Nothing is from memory.

Licence tags: **[Free]** = works with no licence; **[Audio]** = needs an Audio licence; **[Any licence]** = needs an Audio, Video or Lighting licence (any one); **[Video]** = needs a Video licence. No tag = the manual does not gate the feature (it is in the free program).

Gaps in the manual (looked for, not found on any page read) are listed at the end under "Not documented".

---

## 1. Licensing and tiers

Docs: https://qlab.app/docs/v5/general/licenses/ and https://qlab.app/docs/v5/general/features/

### Licence model
- QLab 5 is a free program; optional features are unlocked by installing a licence.
- Three functional licence types: Audio, Video, Lighting.
- Each of the three licence types also unlocks MIDI, networking, show control, scripting and workflow features.
- Licences are sold singly, in pairs, or as a bundle of all three (pairs/bundles are only a discount).
- Standard licence: one-time purchase, perpetual, installable on up to two computers at once.
- Rent-to-own licence: priced per day with a chosen start and end date; behaves as a standard licence in that range (two computers); self-deactivates after the end date.
- Rent-to-own: a one-day rental is the calendar date, valid until midnight, not 24 hours from purchase.
- Rent-to-own: can be bought and installed ahead with a future start date; it "wakes up" on the day.
- Rent-to-own: each day's rental becomes store credit at midnight; enough rental days equals owning the standard licence at no extra cost.
- Rent-to-own: an ongoing rental can be ended early for store credit; rentals are not subscriptions.
- Site licence: priced per activation, ten-activation minimum, on request.
- Educational discounts and special licence types exist.
- Each licence type in a pair/bundle activates independently (audio part on two machines, video part on two others, etc.).
- Trade-in: any standard QLab 5 licence can be exchanged for its purchase value toward another purchase; trading in deactivates it everywhere.
- Store credit and trade-ins buy standard licences only, not rent-to-own.
- QLab 4 licences can be traded in toward QLab 5 (fixed trade-in values).
- Account-based licensing: sign in with email and password in the License Manager to install or remove.
- License Manager (QLab menu > Manage Your Licenses…, or Launcher's Licenses button) shows installed licences and the Machine ID without signing in.
- Install destination "This Computer": licence available to all user accounts on the Mac; optional one-line note stored with the installation.
- Install destination USB drive: only drives from a listed set of manufacturers (Corsair, HGST, HP, Kingston, LaCie, Lexar, OCZ, SanDisk).
- USB licence: temporary (with an expiry date, after which the seat returns to the account) or permanent; cannot be removed from the key before expiry.
- Offline "remote activation": enter the Mac's Machine ID on the account web page, download an activation file, double-click it or drag it onto QLab.
- Remove a licence from the License Manager (must be signed in as the owning account, Mac online).
- Remote deactivation from the account web page for a lost/broken Mac; the seat uninstalls itself next launch.
- No internet needed to run a licensed copy; licences only contact the server on install and removal.
- QLab 5 licences also work in QLab 4.7+ (one activation per Mac covers both).
- Demo mode (QLab menu > Start Demo Mode…): new workspace with every licensed feature on for 60 minutes; copying cues and settings into the demo workspace is disabled; ends on expiry or on save/close/reopen.

### What each tier unlocks (Features by License table)
- Channels of audio output: 2 [Free], 128 [Audio], 2 with Video or Lighting only.
- Channels of audio per file: 2 [Free], 24 [Audio].
- Audio waveform view [Free].
- Unlimited slices per Audio or Video cue [Free].
- Sample-accurate playback sync [Free].
- Audio fades [Free].
- Audio playback rate fading [Audio].
- Edit audio output patch routing [Audio].
- Edit audio output patch channel names [Audio].
- Edit audio input channel names per cue [Free].
- Output mute and solo buttons [Free].
- Audio effects on cues [Audio].
- Audio effects on cue outputs [Audio].
- Audio effects on device outputs [Audio].
- Audio effects fading [Audio].
- Audio output patch fading [Audio].
- Mic cues [Audio].
- Object audio [Audio].
- Remote control via OSC, MIDI, MSC, iOS app [Free].
- Network cues, MIDI cues, MIDI File cues [Any licence].
- Timecode cues [Any licence].
- Timecode triggers [Any licence].
- Show control broadcast via MSC and OSC [Free].
- Automatic workspace backups [Free].
- Media logging [Free].
- Unlimited cue lists [Free].
- Unlimited cue carts [Free].
- Live fade previews [Free].
- Pause cues [Any licence].
- Devamp cues [Any licence].
- Target cues [Any licence].
- Arm and Disarm cues [Any licence].
- Script cues [Any licence].
- Workspace settings import and export [Any licence].
- "Fade patch parameters" [Any licence] (the table lists this separately from "Audio output patch fading" [Audio]).
- By omission from the table, free: Group, Audio, Fade, Start, Stop, Load, Reset, GoTo, Wait, Memo cues.
- A cue that uses a licensed feature without the licence shows as broken ("License required") rather than silently degrading; object audio is the exception (non-breaking warning, rest of cue plays).

---

## 2. The workspace window

Docs: https://qlab.app/docs/v5/fundamentals/workspace/

### Document model
- A document is a "workspace": one or more cue lists and/or cue carts, plus settings that travel with the file.
- A workspace can have several windows (main window, secondary list/cart windows, inspectors, status, settings).
- Title bar shows workspace name followed by the name of the visible list or cart.
- Unsaved changes shown as a dot in the close button; closing with unsaved changes prompts to save.

### GO button
- GO starts the standing-by cue, then advances the playhead to the next cue.
- GO button shows a green border when a cue is standing by (GO will do something).
- GO button shows a red border while double-GO protection is blocking GOs.
- A GO received during double-GO protection flashes the area round the button red (received but disregarded).
- When a cart is the active view, the GO button becomes a "Preview" button.
- When "always audition" is on, the GO button becomes a blue "Audition" button.
- Default GO shortcut is Space; changeable; it always operates the button whatever its current label.
- The GO button and its shortcut apply only to the active list.

### Standby display and notes
- Standby display beside GO shows the standing-by cue: number, a bullet, then name.
- Each cue list has its own playhead and its own standing-by cue.
- Notes field under the standby display shows the standing-by cue's notes (operator instructions).
- Notes are editable in the masthead while the cue stands by, or in the inspector, or with shortcut O.
- Notes are rich text: styled, formatted, can include emoji and images.
- Notes are searchable by Find.

### Toolbar, toolbox, masthead
- Toolbar: one button per cue type; click creates that cue in the current list.
- The toolbar space is shared with the Find tool and the Load to Time tool.
- Masthead (GO, standby, notes, toolbar) is resizable by dragging its divider; dragged to the top it hides.
- Masthead show/hide from View menu (GO Button / Standby Display / Toolbar) and a footer button.
- Toolbox: optional left mini-sidebar listing cue types (View menu, Cmd-K, footer button).
- Toolbox cue types can be reordered; the first ten always get Cmd-0…Cmd-9, so reordering reassigns those shortcuts.
- Reordering the toolbox reorders the Cues menu but not the toolbar.

### Cue list table
- Cue list is a table, one row per cue, top-to-bottom play order.
- Columns: status, type icon, number, name, target, pre-wait, duration, post-wait, continue mode.
- Clicking the status column of a cue moves the playhead there.
- Status icon: playhead (light triangle at far left) for the standing-by cue.
- Status icon: green triangle = active/running.
- Status icon: yellow pause bars = paused.
- Status icon: yellow disc = loaded.
- Status icon: yellow slope = stopped but an audio effect is tailing out.
- Status icon: red X = broken; hovering shows a tooltip explaining why.
- Status icon: yellow triangle with ellipsis = non-breaking warning.
- Status icon: red circle with slash = output suppressed by an override.
- Status icon: yellow flag = flagged.
- Status icon: yellow double slope = crossfading (Playlist groups only).
- Status icon: hollow green triangle in parentheses = being auditioned.
- Cue type icon varies by mode for Group and Fade cues.
- Cells editable by double-click: number, name, target, pre-wait, duration, post-wait; continue mode by click pop-up.

### Footer
- Edit / Show mode buttons in the footer.
- Footer buttons: show/hide toolbox, show/hide masthead.
- Footer centre: cue count plus number of lists and carts.
- Footer centre also shows status text for demo mode, always-audition, and override controls.
- Footer right: open Workspace Settings, show/hide sidebar, show/hide inspector.
- Footer warnings button appears only when the workspace has a broken cue or a warning; opens the Warnings tab.

### Sidebar
- Sidebar (View > Lists / Carts & Active Cues, Cmd-L, footer button) with two tabs: Lists/Carts and Active Cues.
- Shift-Cmd-L toggles between the two sidebar tabs.
- Sidebar Reset button: hard stops all cues, resets all temporary properties, returns every list's playhead to its first cue, loads the first cue of every list; does not re-run the workspace open cue.
- Sidebar Pause All button (yellow when cues are running).
- Sidebar Resume All button (green when cues are paused).
- Sidebar Panic button: fade and stop everything over the panic duration.
- Lists/Carts tab label shows the count of lists and carts.
- New List and New Cart buttons at the bottom of the sidebar.
- Delete a list or cart (and all its cues) with Edit > Delete or Cmd-Delete; undoable.
- Open in New Window (button or contextual menu) opens a list/cart in a secondary window.
- Secondary windows: no toolbar, no inspector, footer has only a list/cart chooser, shows "SHOW MODE" in the footer when the workspace is in show mode.
- Secondary windows can still edit cues in edit mode via the basic editing shortcuts and the contextual menu.

### Active Cues
- Active Cues tab lists every cue in the workspace that is playing or paused.
- Each active-cue row shows number, name, elapsed time and remaining time.
- Active-cue row shows the cue's colour on its left edge.
- Active-cue row has a pause/resume button on the left.
- Active-cue row has a panic button on the right.
- Active-cue row is a progress bar: green while playing, yellow while paused.
- Hovering an active cue shows a draggable yellow line at the progress edge to scrub the cue backward or forward.
- Active cues are listed in start order, newest at the bottom; a setting reverses it (newest at top).

---

## 3. Edit mode and Show mode

Docs: https://qlab.app/docs/v5/fundamentals/workspace/ , https://qlab.app/docs/v5/general/qlab-preferences/ , https://qlab.app/docs/v5/general/preparing-your-mac/

- Two workspace modes: Edit (default) and Show; switched by footer buttons or Shift-Cmd-[ / Shift-Cmd-].
- Show mode disables: the inspector.
- Show mode disables: the toolbar.
- Show mode disables: the toolbox.
- Show mode disables: Load to Time.
- Show mode disables: Find (entering show mode also clears find results).
- Show mode disables: adding, deleting and moving cues.
- Show mode disables: editing, copying and pasting any cue property by mouse or keyboard.
- Show mode does not disable: quitting, opening/closing/saving workspaces, the Escape key, editing by AppleScript/OSC, viewing and changing workspace settings.
- Show mode asks for confirmation before closing the workspace or quitting.
- Show mode is a safety against accidents, not a security lock.
- Preference "Disable disruptive OS features in Show Mode": prevents App Nap (reports itself latency-critical).
- Same preference: prevents the Mac sleeping.
- Same preference: blocks Cmd-Tab task switching.
- Same preference: blocks Mission Control / Spaces / Show Desktop hot corners, gestures and shortcuts.
- Same preference: enables automatic Dock hiding (per "Preparing Your Mac").
- Collaboration setting: in Show mode restrict all collaborators to view-only.

---

## 4. Cues: basics, numbering, names, targets

Docs: https://qlab.app/docs/v5/fundamentals/cues/ , https://qlab.app/docs/v5/fundamentals/workspace/ , https://qlab.app/docs/v5/fundamentals/inspector/

### Cue types that exist
- Group, Audio, Mic, Video, Camera, Text, Light, Fade, Network, MIDI, MIDI File, Timecode.
- Start, Stop, Pause, Load, Reset, Devamp, GoTo, Target, Arm, Disarm, Wait, Memo, Script.

### Making cues
- Click a cue type in the toolbar.
- Drag a cue type from the toolbar into the list at a chosen position.
- Double-click a cue type in the toolbox, or drag it into the list.
- Choose a type from the Cues menu.
- Cmd-0…Cmd-9 for the first ten cue types (default: Group, Audio, Mic, Video, Camera, Text, Light, Fade, Network, MIDI).
- Drag audio/video files from Finder into the list to create cues.
- Drag a folder of media from Finder into the list to create cues.
- Files dragged in are ordered as Finder sorts names (9.wav before 10.wav).
- Option-drag a cue in the list to copy it.
- Cues can be created by OSC and AppleScript.
- Cut / Copy / Paste / Delete / Select All of cues (Edit menu).
- Move selected cues up/down with Option-Cmd-Up/Down.
- Creating a cue-targeting cue with one cue selected: the new cue targets the selected cue.
- Creating a cue-targeting cue with several selected: QLab asks — one new cue after each selected cue, all new cues after the last selected cue, or a single new cue; answer by button or number key; the last choice becomes the default.
- Creating a Group with two or more cues selected puts them inside the new Group.

### Cue numbers
- A cue number is any text (digits, letters, punctuation, emoji) or empty.
- Cue numbers must be unique in the workspace.
- Numbers need not be consecutive or in order; reordering never renumbers.
- "1", "1.0" and "1.00" are three different numbers (text compare).
- Changing a cue's number does not affect cues that target it.
- Digits only if controlled by MIDI/MSC; ASCII without OSC-reserved characters if controlled by OSC.
- Edit number: double-click column, inspector field, or shortcut N.
- Setting: auto-number new cues with a configurable increment (see Workspace Settings).
- Renumber selected cues tool: start at, increment by, optional prefix, optional suffix (Cmd-R).
- Renumber skips numbers already used elsewhere in the workspace.
- Delete numbers of selected cues (Cmd-D).

### Cue names
- A cue name is any text or empty; need not be unique.
- Default names are generated per type: Audio/Video/MIDI File = file name; Text = its text; Fade = "fade <target name>" or "fade and stop <target name>"; Network = the command; MIDI = message type; Timecode = start frame; Start/Stop/Pause/Load/Reset/GoTo/Arm/Disarm = "<type> <target name>"; Wait = "wait <duration>".
- Renaming a target cue updates the default names of cues that target it; custom names are left alone.
- Deleting a name resets it to the default name.
- Default names are drawn in darker text than custom names in the Basics tab.
- Edit name: double-click column, inspector, or shortcut Q.

### Targets
- A cue has at most one target; cues that need one are broken without it.
- File targets: Audio, Video, MIDI File cues.
- Cue targets: Fade, Start, Stop, Pause, Load, Reset, Devamp, GoTo, Target, Arm, Disarm.
- Fade cues can target Group, Audio, Mic, Video, Camera and Text cues.
- Start/Stop/Pause/Load/Reset/GoTo/Arm/Disarm can target any cue (including a Group or a cue list).
- Fade and Reset cues can instead target a workspace setting: an audio output patch or an audio map (affects every cue using it).
- Fade/Reset target-type pop-up (Cue / Patch / Map) in the Basics tab; Option-T cycles the target type.
- Set file target: click the round target button in the Target column to pick a file.
- Set file target: shortcut T.
- Set file target: double-click the Basics tab target field.
- Set file target: drag a file from Finder onto the cue row or onto the inspector target field.
- Set cue target: type the target's cue number in the Target column or inspector field.
- Set cue target: drag the cue onto its target, or the target onto the cue (bi-directional; uses the Target column).
- Target column shows the target's cue number, or its name if it has no number, or "?" if missing.
- Dragging cues onto a Group sets the Group as the target, not its children.
- Inspector: clear-target button; reveal-target button (reveal file in Finder, or move selection to the target cue).
- Tools > Jump to selected cues' targets.
- Tools > Highlight Related Cues: grey highlight on every cue that targets or is targeted by the selection.
- A file target that is deleted or moved to the Trash breaks the cue.

### Timing fields
- Pre-wait: delay between being started and the action starting.
- Duration (action): editable for some cue types; cues with instantaneous actions show none.
- Post-wait: delay before the next cue starts under auto-continue; begins elapsing when the cue's action begins.
- Shortcuts: E pre-wait, D duration, W post-wait, C cycle continue mode.
- All times are millisecond-precise; displayed to hundredths or tenths.
- Time entry accepts seconds, mm:ss, or hh:mm:ss with decimals; reformatted on entry (100 → 01:40.00).
- Integer fields silently drop any decimal part.
- dB entry without a sign is taken as negative (12 → -12); positive needs an explicit "+".

### Cue behaviour rules
- A cue runs until its action ends or it is told to stop.
- A running cue ignores further start commands by default (configurable per cue: second triggers).
- GO advances the playhead; the next GO starts the next cue.

---

## 5. Cue sequences and continue modes

Docs: https://qlab.app/docs/v5/fundamentals/cue-sequences/ , https://qlab.app/docs/v5/fundamentals/inspector/

- Three continue modes per cue: Do not continue (default), Auto-continue, Auto-follow.
- Auto-continue: starting the cue also starts the next cue, after this cue's post-wait.
- Auto-continue with no post-wait starts both cues simultaneously.
- Auto-follow: the next cue starts when this cue completes.
- Auto-follow displays a non-editable post-wait equal to the cue's duration.
- Continue mode set from the Basics tab pop-up, the list column pop-up, shortcut C, or contextual menu Edit > Continue Mode.
- Continue-mode icons in the list column (straight arrow, flagged arrow).
- A "cue sequence" is cues chained by auto-continue/auto-follow, or a Timeline group.
- After GO on a sequence the playhead moves to the first cue after the whole sequence.
- Disarmed cues in a sequence keep their pre-wait, post-wait and follow, but do nothing.
- Broken cues in a sequence: QLab still runs the broken cue's pre-wait, duration, post-wait and continue so the sequence survives.
- Started by GO: cue and the rest of its sequence play; playhead moves past the sequence.
- Started by hotkey, MIDI, timecode or wall-clock trigger: cue and sequence play; playhead does not move.
- Started by Audition GO: sequence plays to audition outputs; playhead moves past the sequence.
- Started by Preview: only that cue plays, alone; pre-wait skipped; no continues; playhead does not move.
- Started by Audition Preview: only that cue plays, to audition outputs; playhead does not move.
- Move playhead to next / previous sequence ("=" and "-" keys).

---

## 6. Group cues

Docs: https://qlab.app/docs/v5/fundamentals/group-cues/

- Group cue contains child cues of any type, including other Groups (nesting).
- Groups collapse/expand with a disclosure triangle; behaviour is identical either way.
- Expand all groups ">" ; collapse all groups "<".
- Five modes, set in the Mode tab; new Groups default to Timeline.
- Each mode has its own outline colour/shape in the list (green square, orange square, blue rounded, blue square, purple square).
- Mode Timeline: all children start simultaneously (each after its own pre-wait); playhead goes to the next cue after the Group.
- Mode Playlist: first child starts, playhead goes past the Group, children then play one at a time in order.
- Mode Start First And Enter: first child starts and the playhead moves to the next child inside the Group; after the last child, to the cue after the Group.
- Mode Start First (and go to next cue): first child starts and the playhead moves past the Group; other children run only via auto-continue/auto-follow.
- Mode Start Random (and go to next cue): starts a random child that is armed and not currently playing; playhead moves past the Group.
- Start Random is round-robin: every armed child plays once before any repeats.
- Start Random's memory resets each time the workspace opens.
- Cue carts cannot contain Group cues.

### Timeline tab (Timeline groups)
- Visual timeline editor: one row ("lane") per child, in list order, showing type icon, number, name and cue colour.
- Slices of Audio/Video children are drawn; finite repeats drawn N times with a grey bar; infinite repeats drawn once with an infinity sign; zero-count slices not drawn.
- Integrated fade curves are drawn on the timeline.
- Drag a cue left/right to change its pre-wait.
- While dragging, blue guidelines appear at the start/end of other cues and at their slices; the dragged cue snaps to them.
- Dragging over one cue's lane limits guidelines to that cue.
- Dragged cues also snap to the current playback time (vertical yellow line).
- Hold Cmd while dragging to disable snapping.
- Nudge selected cues: Option-Left/Right = 0.1 s; Shift-Option-Left/Right = 0.01 s.
- Trim: drag a cue's start edge (changes start time and pre-wait together) or end edge (changes end time).
- Slip: Option-drag an Audio/Video cue to shift start and end time without changing pre-wait or duration (cues without slices only).
- Scale: drag a cue's bottom edge to change its row height (visual only).
- Scale the whole timeline vertically: Option-scroll, or Shift-Cmd-minus / Shift-Cmd-equals.
- Pin / unpin selected cues to the top of the timeline; Cmd-click to multi-select.
- Preview-selected-cue button on the timeline.
- Zoom in/out buttons; pinch; Option-horizontal-scroll; Cmd-minus / Cmd-equals.
- The load position updates live on the timeline while dragging the Load to Time slider.
- A child of a Timeline group set to auto-continue or auto-follow makes the Group broken.

### Playlist tab (Playlist groups)
- Children are forced to auto-continue with a non-editable post-wait equal to their duration.
- Any cue type may be in a Playlist group.
- Auto-shuffle: children randomly reordered each time the Group is loaded or started; shuffled order shown in italics; not saved; unchecking restores true order.
- Tools > Shuffle order of cues in Group (Playlist groups only).
- Loop until stopped: restarts at the first child when the last ends; last child shows a U-shaped arrow as its continue mode.
- A looping Playlist needs at least one child with non-zero duration, else the Group and children are broken.
- Crossfade: crossfades main audio level and video opacity between consecutive children.
- Crossfade duration is settable (minimum 0.05 s in the view); a child shorter than the crossfade is broken.
- Independent curve-shape pop-ups for the fade-out (yellow) and fade-in (blue).
- Crossfade curve editor: drag corner control points to change each curve's start and end time.
- Crossfade curve editor: click to add control points on Custom or Linear shapes and drag them.
- Crossfade curve editor: selected control point's time (and, for mid points, fade percentage) shown and typeable.
- Second trigger "plays next": a GO/trigger while a child plays starts the next child (respecting crossfade and loop).
- Second trigger "plays previous": steps back to the previous child.
- With second trigger "does nothing", re-triggering a Playlist does not restart the current child.

### Broken groups
- Broken if any child is broken.
- Broken if a Timeline child has a continue mode.
- Broken if a Playlist child is too short for the crossfade.

---

## 7. Cue lists

Docs: https://qlab.app/docs/v5/fundamentals/cue-lists/ (the page as served ends mid-sentence in the Timecode tab's "On Stop" paragraph; see end)

- Unlimited cue lists per workspace [Free]; a new workspace has one, "Main Cue List".
- Cue lists have a name and a cue number, like cues, edited the same way.
- Only one list or cart is "active" (shown in the main window) at a time.
- Active-only: its selected cues appear in the main inspector.
- Active-only: toolbar, Find and Load to Time act on it.
- Active-only: workspace MIDI controls and OSC controls for playback and playhead act on it.
- Active-only: View-menu playhead/selection shortcuts act on it.
- Inactive lists and carts still run: their cues' triggers work.
- Inactive lists and carts respond to "all" commands (Panic All, Pause All) and to OSC/AppleScript not addressed to the active list.
- Starting a cue list is the same as pressing GO in that list.
- A hotkey or MIDI trigger on a cue list makes a list-specific GO button.
- A Start cue targeting another list presses GO on that list.
- A Fade cue targeting a list fades every cue playing in that list.
- Selecting a list shows three inspector tabs: Basics, Triggers, Timecode.

### Cue list Timecode tab [Any licence; the page says Audio, Video or Bundle]
- Checkbox "Sync cues in this list to incoming timecode" enables timecode triggers for cues in the list.
- Sync source: MTC or LTC (no VITC).
- MTC: choose the MIDI device to listen to.
- LTC: choose the audio device and the input channel number.
- SMPTE format (frame rate) pop-up.
- View button opens the Timecode Status window; a text indicator shows incoming status or "waiting…".
- On Start: do not start cues which precede the timecode (cues that should still be running start part-way in).
- On Start: start cues since the most recent minute of timecode.
- On Start: start cues since the most recent hour of timecode.
- On Start: start cues which precede the timecode by X seconds (custom look-back).
- On Start: start all cues which precede the incoming timecode.
- Any cue whose duration ended before the look-back time is never started.
- On Stop: timecode-triggered cues pause, stop, or keep running when timecode stops.
- Freewheel time 0–2 s: drop-outs shorter than this are ignored (for pause/stop).
- Timecode-triggered cues chase: they start mid-cue and skip ahead or back when timecode jumps.

---

## 8. Cue carts

Docs: https://qlab.app/docs/v5/fundamentals/cue-carts/

- A cart is a grid of cues with no playhead and no order; any cue any number of times.
- Unlimited carts per workspace [Free].
- Carts hold every cue type except Group cues.
- Cart cues cannot auto-continue or auto-follow (no sequences inside a cart); a Start cue in a cart can run a sequence elsewhere.
- Cart cues can have pre-waits; cells show duration and pre-wait when not playing.
- Carts have a name and number like cues.
- Cart cell size: three sizes (Workspace Settings > General > Display).
- Edit mode: masthead button reads "Preview" and starts the selected cue(s).
- Edit mode: each cell has a preview button in its corner; Space or V starts the selected cell.
- Show mode (or a cart in a secondary window): the masthead is not visible (the page does not spell out how a cell is fired in show mode).
- "Second trigger on release" applies to cart cells (hold-to-play sampler behaviour).
- Starting a cue cart (as a target) loads all the cues in the cart.
- Selecting a cart shows inspector tabs Basics, Triggers, Grid Size.
- Grid Size tab: rows and columns from 1×1 to 15×15.
- A cart cannot be resized smaller than its cues need; if forced by script, it shows a warning.
- Flagged cart cues show the flag inside the cell.

---

## 9. The inspector

Docs: https://qlab.app/docs/v5/fundamentals/inspector/

### General
- Tabbed inspector below the list; show/hide Cmd-I, View menu, footer button, or drag its divider to collapse.
- Tabs shown depend on the type (and number) of selected cues; Basics and Triggers are always present, also for lists and carts.
- Pop-out button detaches the main inspector into its own window; pop-in returns it.
- Secondary inspector windows pinned to one cue: View > Inspector for Selected Cue, Shift-Cmd-I, or contextual "Open in new inspector window".
- With several cues selected, one secondary inspector opens per cue.
- Secondary inspector footer: pop-up to choose which cue it inspects.
- Secondary inspector footer: Float checkbox (stay above other windows).
- Secondary inspector footer: Clone button.
- Main inspector shows the count of selected cues in its corner.
- Tab indicator: collaborator underline on tabs a collaborator is viewing.
- Tab indicator: grey dog-ear on Levels and Objects tabs when any routing is above -inf.
- Right-click on a cue or an inspector control: contextual menu with relevant actions and in-line help linking to the manual.

### Basics tab
- Number field.
- Duration field.
- Pre Wait field.
- Post Wait field.
- Continue pop-up (Do not continue / Auto-continue / Auto-follow).
- Name field.
- Target field: file path for file-target cues (double-click to choose, or drop a file).
- Target field: cue number for cue-target cues, with the target's name shown beside it.
- Target type pop-up (Cue / Patch / Map) for Fade and Reset cues.
- Target field shows "(not applicable)" and is disabled for cue types without targets.
- Clear-target and reveal-target buttons.
- Notes field (rich text, images, emoji; shown in the masthead on standby).
- Colour: twenty colours (eight basic, twelve extended, chosen to suit colour-vision differences).
- Second Colour: unlock to choose a colour the cue shows after it has been started once.
- Second colour persists until the workspace is reopened, the cue is reset, or the workspace is reset.
- Change log: cue colours can show always, only before the cue has played, or only after it has played.
- Flagged checkbox: flag icon in the status column (or cart cell); adds the cue to the Warnings tab; shortcut F.
- A Group containing a flagged cue shows a hollow flag (visible when collapsed).
- Auto-load checkbox: load this cue automatically after the previous cue is played.
- Armed checkbox (default on): a disarmed cue does not act, but its auto-continue/auto-follow still fire.
- Disarmed cues drawn with a diagonal pattern in the list.
- "Skip if disarmed" checkbox: a disarmed cue is skipped entirely as if absent (drawn with a wavy vertical pattern).

### Triggers tab — left side (ways to start the cue)
- Triggers start the cue wherever the playhead is and do not move the playhead; any combination can be enabled; each has an enable checkbox.
- Hotkey trigger: nearly any key, optionally with modifiers.
- Hotkey restrictions: not Escape, not Up/Down arrows (Left/Right allowed), not a bare modifier, not a key assigned in Controls > Keyboard.
- Hotkey clear button.
- MIDI trigger: Note On/Off, Program Change, Control Change, with byte values; channel can be "any".
- MIDI trigger Capture button records the next incoming message.
- MIDI trigger values accept ">" and "<" comparisons and "any" (e.g. any velocity).
- Wall clock trigger: start at a time of day (hours, minutes, seconds), AM/PM or 24-hour.
- Wall clock trigger: restrict to chosen days of the week ("Every Day" button).
- Wall clock trigger runs as long as the workspace is open.
- Timecode trigger [Any licence]: fire at a timecode, entered as hh:mm:ss:frames or as real time hh:mm:ss.decimals.
- Timecode trigger Capture button records the current incoming frame.
- Timecode triggers work only if the enclosing list/cart has incoming timecode enabled; a trigger set while timecode runs needs timecode restarted.

### Triggers tab — right side (what happens when the cue runs, however it was started)
- "Fade & stop others over time": on start, fade and stop other cues over a given time.
- Fade & stop scope: Peers (same level: same list/cart, or same Group).
- Fade & stop scope: List or cart.
- Fade & stop scope: All (whole workspace).
- "Duck/Boost audio of other cues in this list while running": by a dB amount, fading over a given time.
- Duck/boost label switches automatically: negative number = duck, positive = boost.
- Duck/boost begins after the cue's pre-wait.
- Duck/boost applies to all other cues with audio in the same list or cart.
- Second trigger: does nothing (default).
- Second trigger: panics (fade out and stop).
- Second trigger: stops.
- Second trigger: hard stops (stop and cut audio effect tails).
- Second trigger: hard stops & restarts.
- Second trigger: devamps (exit the current loop at the end of this iteration; nothing if not devamp-able).
- Second trigger (Playlist groups only): plays next / plays previous.
- "Second trigger on release": for hotkey or MIDI triggers and cart cells, releasing the key/note counts as the second trigger (press = start, release = stop).
- A second trigger is any start signal while running: triggers, GO, OSC.

---

## 10. Batch editing, paste properties, find

Docs: https://qlab.app/docs/v5/fundamentals/cues/ , https://qlab.app/docs/v5/tools/paste-cue-properties/ , https://qlab.app/docs/v5/tools/find/

### Batch editing
- With several cues selected, shared properties can be edited at once; all selected cues get the same value.
- The inspector shows only tabs with batch-editable properties; mixed types show only Basics and Triggers.
- Batch edit via the inspector, the contextual menu, or the property's keyboard shortcut.
- Editing a cell with the mouse in the list changes only that one cue, even in a multi-selection.
- Batch-edit start/end times by dragging waveform handles across several selected cues.
- Batch-edit waveform start, end and slice times when all selected files are the same duration.

### Paste Cue Properties ("fancy paste")
- Copy a cue, select targets, Edit > Paste Cue Properties… (Shift-Cmd-V).
- Sheet lists properties by category with checkboxes; irrelevant categories hidden for the selected types.
- Keyboard navigation: arrows, Space toggles, Enter applies, Escape cancels.
- Presets list on the right, each toggled by a key; "p" recalls the most recently used set.
- Presets include "audio levels only" and "audio objects only".
- Default-preset pop-up decides which boxes are ticked when the sheet opens.
- Pasting a fade curve shape includes its audio domain.
- Tools > Paste audio levels (skips the sheet).
- Tools > Paste integrated fade shape (skips the sheet).
- Edit menu also has Paste and Match Style, Copy Style, Paste Style (text styling).

### Find
- Edit > Find (Cmd-F) puts the Find tool in the toolbar area; the command cycles show / focus field / close.
- Searches cue names, cue numbers, file names of Audio/Video targets, notes, Text cue contents, Network cue contents, Script cue contents.
- Search scope is one list or cart at a time.
- Previous/next arrows move the selection through matches (Cmd-G / Shift-Cmd-G).
- "Select Found" selects all matches at once.
- Done clears the search and closes the tool.
- Found cues get a yellow highlight; a found cue's playhead is drawn black.
- View > Select cue… (Cmd-J): jump the selection to a cue; Cmd-P inside it picks the cue at the playhead.
- View > Move playhead to cue… (Shift-Cmd-J).

---

## 11. GO protections, playhead, panic, pause, load, preview

Docs: https://qlab.app/docs/v5/fundamentals/workspace-settings/ , https://qlab.app/docs/v5/general/keyboard-shortcuts/ , https://qlab.app/docs/v5/tools/tools-menu/ , https://qlab.app/docs/v5/other-cues/transport-cues/

### Double-GO protection
- "Minimum time required between each GO": any duration, including zero.
- While it is in force the GO button has a red border; blocked GOs flash red.
- Applies to: clicks on GO, the GO shortcut, and workspace MIDI/MSC/OSC messages that trigger GO.
- Does not apply to: individual cue triggers and GOs via AppleScript.
- "Require a 'key up' before re-arming GO" (keyboard GO only).
- Blocked GOs are recorded in the cue-trigger log.

### Playhead and selection
- Playhead and selection are independent by default (edit one cue while standing by on another).
- Setting "Lock playhead to selection" makes them move together.
- Move playhead to next/previous cue (Shift-Cmd-Down/Up); select next/previous cue (Cmd-Down/Up).
- "Load Last Selected" (L) loads the most recently selected cue and moves the playhead to it.
- GoTo cue moves the playhead from within a sequence.
- Workspace-open cue does not move the playhead.

### Panic, stop, hard stop
- Panic = fade out and stop over the workspace's panic duration.
- Panic duration is a workspace setting.
- A second panic during a panic stops everything that is fading immediately.
- Escape = Panic All; fixed, cannot be reassigned.
- Double-tap Escape = hard stop all; fixed.
- Panic Selected (S); double-tap S = hard stop the selected cues.
- Hard stop = stop and also cut audio effect tails immediately.
- Per-cue panic buttons in Active Cues.
- A stopped cue with effects shows a "tailing out" status until the effect tail ends.

### Pause / resume
- Pause/Resume Selected (P).
- Pause All ([) and Resume All (]); also sidebar buttons.
- Per-cue pause/resume buttons in Active Cues.
- Paused cues show yellow bars and a yellow progress bar.

### Loading
- Loading prepares a cue to start with minimum latency (everything up to actually starting).
- Loaded cues show a yellow disc.
- Loading a sequence loads every cue in it.
- Auto-load per cue, and "enable auto-load for new cues" as a workspace default.
- Reset loads the first cue of every list.

### Load to Time
- Tools > Load to Time (Cmd-T) puts a time field and a slider in the toolbar area; the command cycles show / focus / close.
- Loads the standing-by cue or sequence to a time so that GO starts from there.
- Type a time or drag the slider.
- Negative time loads that far back from the end of the cue or sequence.
- Clicking in an Audio cue's waveform loads to that time, correctly through looped slices and past infinite loops.
- Load cue does the same thing as a cue (see Control cues).
- Disabled in Show mode.

### Preview
- Preview Selected (V): plays the selected cue(s) alone, skipping pre-waits, ignoring continues, playhead unmoved.
- Preview button in the Time & Loops tab becomes a pause button while playing.
- Preview button on the Timeline tab and on cart cells.

### Reset
- Reset (sidebar button, Reset cue, OSC) clears temporary changes: fade-applied parameters, Target-cue retargets, second/"after" colours, OSC "temp" changes.

---

## 12. Auditioning

Docs: https://qlab.app/docs/v5/tools/auditioning-cues/ , https://qlab.app/docs/v5/fundamentals/workspace-settings/ (Audition)

- Audition = play a cue through alternate outputs (e.g. headphones) outside the show.
- Audition settings table, one row per output type: Audio, Video, MIDI, Timecode (MTC), Timecode (LTC), Network, Light.
- Per-type option: Leave output unchanged.
- Per-type option: No output (not offered for Light).
- Per-type option: Alternate patch (Audio, Video, MIDI, MTC, LTC; not Network or Light), with an Edit… button for that patch.
- Per-type option: Redirect to Audition window (Video only) / Audition tab of the Light Dashboard (Light only).
- Alternate patch for video needs a Video licence.
- Audition GO (Option-Space): standing-by cue/sequence through audition outputs; playhead advances.
- Audition Preview Selected (Option-V): selected cue(s) alone through audition outputs.
- Cues started normally while others audition go to normal outputs.
- A cue that is auditioning and is then started normally stops and restarts on normal outputs at once.
- Tools > Turn on always audition (Shift-Cmd-A): GO becomes a blue Audition button, footer says "Audition"; GO and Preview become their audition versions.
- Always audition does not affect workspace MIDI/MSC/OSC controls or OSC/AppleScript commands.
- Auditioned cues show a hollow green triangle in parentheses.
- The manual has no separate "audition window" for audio in v5: the old Audition Window was replaced by these tools.

---

## 13. Tools menu and other workflow tools

Docs: https://qlab.app/docs/v5/tools/tools-menu/ , https://qlab.app/docs/v5/tools/workspace-status-window/ , https://qlab.app/docs/v5/tools/file-target-search/ , https://qlab.app/docs/v5/tools/override-controls/ , https://qlab.app/docs/v5/tools/launcher-window/ , https://qlab.app/docs/v5/tools/monitor-windows/ , https://qlab.app/docs/v5/tools/timecode-status-window/

### Tools menu (context-sensitive)
- Load to time… (Cmd-T).
- Renumber selected cues… (Cmd-R).
- Delete numbers of selected cues… (Cmd-D).
- Jump to selected cues' targets.
- Record cue sequence…
- Turn on/off always audition (Shift-Cmd-A).
- Turn on/off live fade preview (Shift-Cmd-P).
- Highlight related cues (toggle).
- Black out desktop backgrounds / Restore saved desktop backgrounds.
- With a Group selected: Shuffle order of cues in Group.
- With an Audio/Video cue selected: Open target file in external editor.
- With an Audio/Video cue selected: Reveal target file in Finder.
- With an Audio/Video cue selected: Open file target search tool.
- With an Audio/Video or Fade cue selected: Paste audio levels; Paste integrated fade shape.
- With a Fade cue selected: Set Parameters From Target (opens the paste sheet).
- With a Fade cue selected: Set Audio Levels From Target (Shift-Cmd-T).
- With a Fade cue selected: Set Video Geometry From Target.
- With a Fade cue selected: Revert Fade Action (Shift-Cmd-R).

### Record Cue Sequence
- Records the timing of cues you fire by hand (Start Recording / Stop Recording).
- Output option: a Timeline Group of Start cues with pre-waits relative to the sequence start.
- Output option: a Start First Group of Start cues chained by auto-continue with pre-waits relative to the previous cue.
- The new Group is created below the selected cue; the original cues are untouched and are targeted by the Start cues.

### Live fade preview [Free]
- When on, edits to a Fade cue are heard/seen immediately if its target is playing.
- When off, a Fade cue can be prepared silently while its target plays.
- Per-workspace setting (since 5.4); on by default.

### Workspace Status window (Shift-Cmd-W), six tabs
- Warnings tab lists every problem in the workspace.
- Warning kind: broken cues (will not play).
- Warning kind: flagged cues (so the flagged list can be worked through).
- Warning kind: non-breaking warnings.
- Warning kind: breaking warnings (e.g. a misconfigured audio patch that breaks cues).
- Warning kind: disconnection warnings (missing hardware/software that was connected).
- Warning kind: network port in use (OSC / plain-text listening port conflict).
- Warning kind: workspace open/close cue set to a cue that does not exist.
- "Inspect Cue" button selects the broken cue and opens the inspector.
- For non-cue warnings the button adapts (e.g. opens the relevant settings tab).
- "Open Help…" opens the manual section relevant to the selected warning.
- Hide checkbox per warning; "Show hidden" checkbox; header text notes when warnings are hidden.
- Logs tab: checkbox to log cue triggers (every GO/trigger of a cue, list or cart, its source, and GOs blocked by double-GO protection).
- Logs tab: checkbox to log MIDI input.
- Logs tab: checkbox to log OSC input.
- Logs tab: checkbox to log OSC output (all output, including Network cues and broadcast).
- Logs tab: filter field; checkbox states saved with the workspace.
- Triggers tab: one sortable table of every cue trigger and workspace control; Edit button jumps to the cue's Triggers tab or the Controls settings.
- Art-Net tab (lighting) and Video Metrics tab (video).
- Info tab: Workspace ID and Machine ID, copyable.
- The window remembers its selected tab between sessions.

### File Target Search tool
- Finds replacements for cues with missing file targets by searching a chosen folder and its subfolders for matching file names.
- Opened from Tools, or from a missing-file warning in the Warnings tab.
- Shows the candidate's name and full path to approve or reject; several candidates are listed to choose from.
- Per-cue checkbox to include or exclude from the relink; relinks one or many cues at once.

### Override Controls window (Shift-Cmd-O)
- Independent input and output overrides for: MIDI voice messages.
- …for MIDI Show Control.
- …for MIDI SysEx.
- …for network messages to/from other devices.
- …for network messages within QLab / to other software on the same Mac.
- …for timecode.
- …for Art-Net and USB DMX (output only).
- Input override on: red message in the workspace footer.
- Output override on: affected cues show a red circle status icon.
- Overrides are global across all open workspaces.

### Launcher window
- Shows QLab's version and links (Documentation, Tutorials, Support, website).
- Buttons: Open Workspace, New Workspace, Connect to Workspace, Licenses.
- Recent Workspaces tab (double-click to open; right-click to reveal in Finder).
- Templates tab (double-click to create from a template; Manage button).
- Appears on direct launch (not when launched by opening a workspace), closes on open/new, reappears when the last workspace closes; Window > Launcher Window (Shift-Cmd-1).

### Monitor windows
- Map monitor window: live view of an audio map and all its objects (cue objects appear only while their cue plays).
- All monitor windows have a Float checkbox and a Clone button.
- (Video output, video input and audition monitor windows are video features.)

### Timecode Status window
- Lists every cue list set to sync to incoming timecode: workspace, type (LTC/MTC), input, status, current timecode.
- Lists every running Timecode cue's outgoing stream.
- "Show" buttons open large resizable timecode displays for incoming and for outgoing timecode (most recent stream).
- Freewheel shown as a disc: red (will stop), yellow (will pause), grey (do nothing).

---

## 14. Workspace settings (ten sections)

Docs: https://qlab.app/docs/v5/fundamentals/workspace-settings/

### General
- Settings belong to the workspace and travel with the file; opened with Cmd-comma or File > Workspace Settings.
- Import settings from a settings file, another open workspace, or QLab defaults, choosing sections by checkbox [Any licence].
- Export chosen sections to a settings file [Any licence].
- Drag a settings section to Finder (creates a settings file) or into another workspace's settings window.
- Drag a settings file onto a patch list to add its patches without replacing existing ones.

### General > General tab
- Minimum time required between each GO.
- Require a "key up" before re-arming GO.
- Panic duration.
- "When workspace opens, start cue number …" (plays its sequence; playhead unaffected).
- Hold Control-Option while opening to skip the open cue (also skips compiling Script cues).
- "Before workspace closes, start cue number …": on close, a dialog offers run the cue, close without it, or cancel.
- "Auto-number new cues with increment …" (inserts between neighbours, e.g. 2.5 between 2 and 3); not applied to cues made by OSC, AppleScript or paste.
- "Enable auto-load for new cues".
- "Lock playhead to selection".

### General > File Management tab
- "Copy files into project folder when adding to workspace" (on by default); identical files are reused, not duplicated.
- "Automatically make backup copies of this workspace" (on by default) [Free].
- "Make a backup copy of this workspace before saving" (on by default).
- "Rotate backups": keep 20 most recent in the last hour, latest per hour for the last day, latest per day beyond.
- "Reveal Backups Folder in Finder" button, with the folder's current size shown.

### General > Display tab
- Cue list row size: small / medium / large.
- Cue cart button size: small / medium / large.
- Sort Active Cues: most recent at the bottom or at the top.

### Controls > Keyboard tab
- Reassign or remove the shortcut for each core command, per workspace; modifiers allowed.
- Commands listed: GO, Preview Selected, Audition GO, Audition Preview Selected, Load Last Selected, Panic Selected, Pause/Resume Selected, Pause All, Resume All, edit number / name / notes / target, cycle target type, edit pre-wait / duration / post-wait, cycle continue mode, flag/unflag.
- Escape (panic) and double-Escape (hard stop) are fixed and cannot be reassigned.
- Up/Down arrows cannot be shortcuts; Left/Right can.
- QLab does not block a shortcut that clashes with another meaning.

### Controls > Workspace MIDI tab
- Workspace MIDI channel: one channel or "any".
- "Use MIDI Show Control" with a Device ID (also answers all-call 127); listens to Lighting, Sound and Video general categories.
- MSC GO → GO; GO <n> → start cue n without moving the playhead.
- MSC STOP → pause all; STOP <n> → pause cue n.
- MSC RESUME → resume all; RESUME <n> → resume cue n.
- MSC LOAD → load standing-by cue; LOAD <n> → load cue n.
- MSC ALL_OFF → panic.
- MSC STANDBY+ / STANDBY- → playhead down/up one cue.
- MSC SEQUENCE+ / SEQUENCE- → playhead down/up one sequence.
- MSC RESET → stop all and playhead to top.
- "Use 'Musical' MIDI Voice Messages": assign Note On/Off, Program Change or Control Change to each workspace command, typed or by Capture.
- Byte 2 accepts 0–127, ">" / "<" ranges, or "any".

### Controls > OSC tab
- Assign an arbitrary incoming OSC address to each workspace command (typed, pasted or by Capture), for devices that cannot send QLab's own dictionary.

### Audition
- See section 12.

### Collaboration
- Allow collaboration connections; ask before admitting a new collaborator; in Show mode restrict collaborators to view-only; per-collaborator view/edit/control permissions; disconnect / forget.

### Templates > Cue Templates tab
- A template per cue type: pick the type and edit it in a copy of the inspector; every new cue of that type in this workspace starts with those values (names, notes, targets, levels, curve shape, durations, script text…).
- Default Fade duration (5 s) is changed here.
- "Set Default Levels" on an Audio cue re-applies the Audio cue template's levels.

### Templates > Workspace Templates tab
- Shortcut to the Workspace Template Manager.

### Audio > Audio Outputs tab
- Any number of audio output patches per workspace.
- New Output Patch button (Cmd-N in this tab).
- A new blank workspace gets one output patch per connected output device.
- Several patches may use the same device, each with its own routing and effects.
- A patch may use the "system output" (whatever macOS Sound output is selected).
- Delete a patch; reorder by drag; Option-drag to duplicate.
- Drag a patch into another workspace's list to copy it; drag to Finder to export it.
- Shift-click / Cmd-click to multi-select patches.
- Edit button opens the Audio Output Patch Editor [Audio].
- A disconnected device's name is still shown, so offline devices can be worked with.
- Volume limits: workspace Max level, -30 dB and up, default +12 dB.
- Volume limits: workspace Min level, -180 to -40 dB, default -60 dB; the minimum is treated and displayed as -inf (silence).
- Limits bound every level control, Fade cue, AppleScript and OSC level in the workspace.

### Audio > Audio Inputs tab
- Any number of audio input patches (for Mic and Camera cues); New Input Patch (Cmd-N).
- A new workspace gets one input patch per connected input device.
- Same delete / reorder / duplicate / copy-between-workspaces / export actions.

### Audio > Audio Maps tab
- Any number of audio maps (object audio); New Audio Map (Cmd-N); same list actions; Edit opens the Audio Map Editor.

### Video, Light
- Out of this audit's scope (video stages/routes/devices/inputs; light patch/definitions/dashboard MIDI).

### Network
- Network Outputs tab: any number of network patches (name, type, destinations, TCP/UDP, interface, address:port, passcode).
- OSC Access tab: enable/disable incoming OSC and plain text.
- OSC access permissions per passcode: View, Edit, Control; a "No Passcode" row; any number of four-digit passcodes.
- OSC listening port (default 53000) and plain-text UDP listening port (default 53535), both changeable; UDP replies on 53001.
- Port-conflict warning with a retry-bind button.

### MIDI
- MIDI Outputs tab: any number of MIDI patches (shared by MIDI, MIDI File and MTC Timecode cues).
- MSC Broadcast tab: destinations that receive MSC for show events.

---

## 15. Saving, project folders, backups, templates, preferences

Docs: https://qlab.app/docs/v5/fundamentals/managing-workspaces/ , https://qlab.app/docs/v5/fundamentals/workspace-templates/ , https://qlab.app/docs/v5/general/qlab-preferences/ , https://qlab.app/docs/v5/general/keyboard-shortcuts/

### Saving and collecting media
- Save / Save As… with three modes in the save dialog.
- Mode "Save workspace and media to a new project folder" (default): creates a project folder holding the workspace.
- That mode copies all targeted media into "audio", "video" and "midi" subfolders.
- From then on, every newly targeted file is copied into the project folder; identical existing copies are reused.
- Backups folder lives inside the project folder.
- Mode "Save workspace only".
- Mode "Customize settings": separate checkboxes for "save into a new project folder" and "copy media files into project folder when necessary".
- File > Workspace Files > Copy media files into project folder (on-demand collect).
- Not copied: fonts used by Text cues, AudioUnits used as effects.
- Moving a show = copy the project folder.

### Backups / autosave [Free]
- Timestamped backup copies "<name> (Backup yyyy-mm-dd_hhmmss).qlab5backup" in a "<name> backups" folder; the workspace file itself is never auto-saved over.
- Automatic backup waits for the autosave interval after the last change; at least one every ten minutes during continuous work.
- Autosave interval is an application preference, 5–600 s.
- Automatic backups only happen once the workspace has been saved manually at least once.
- Backup-before-save keeps the state as it was at the previous save/open.
- At most one backup per minute.
- Optional rotation of old backups.

### Undo
- Undo / Redo (Cmd-Z / Shift-Cmd-Z) in the Edit menu.
- Deleting a cue list or cart is undoable.
- The audio patch editor supports undo and redo.
- Deleting marks, filters and map objects in the map editor is undoable.
- Revert Fade Action is a separate, fade-only undo of what a Fade cue did at run time.

### Workspace templates
- File > Save As Template saves the current workspace (settings, cue templates, cues, lists, carts) as a template.
- File > New From Template (Shift-Cmd-N) opens the Template Chooser.
- File > Manage Templates: rename, delete, set default.
- The default template is used by New Workspace (Cmd-N).
- Right-click a template: set default, show the templates folder, export, rename, delete.
- Unusable template files are listed as invalid.

### Application preferences — General tab
- Preferences apply to all workspaces on the Mac and do not travel with workspaces.
- Collaboration Name.
- At launch: show the Launcher window.
- At launch: restore most recent workspaces.
- At launch: create a new blank workspace.
- At launch: create a new workspace from the default template.
- At launch: do nothing.
- Automatically prompt about updates (never auto-downloads).
- Send aggregate usage data (currently does nothing).
- Disable disruptive OS features in Show Mode.
- Autosave interval (5–600 s).
- Log media playback: CSV log of all audio and video file playback using cue info and file metadata (for rights reporting) [Free].
- Duplicate OSC message interval (default 0.1 s; 0 disables the filter).
- Prompt before running the workspace open cue.
- Debug logging level 0–3 (to the system log).

### Application preferences — Hardware tab
- Lists every audio device with its sample rate and input/output channel counts.
- Per-device buffer size pop-up (default 512 samples).
- Art-Net network interface; Art-Net broadcast mode (lighting).

### File / Edit / View / Window menu items named in the manual
- File: New Workspace, New From Template…, Open Workspace…, Open Recent (with Clear Menu), Connect to Workspace…, Close, Save, Save As…, Save As Template, Manage Templates, Workspace Settings submenu (per section, plus import/export), Workspace Files > Copy media files into project folder.
- Edit: Undo, Redo, Cut, Copy, Paste, Paste Cue Properties…, Paste and Match Style, Delete, Select All, Find…, Find Next, Find Previous, Show Fonts, Bigger, Smaller, Show Colors, Copy Style, Paste Style.
- View: Enter/Exit Full Screen, GO Button / Standby Display / Toolbar, Inspector, Inspector for Selected Cue, Toolbox, Lists / Carts & Active Cues, toggle between those two, Warnings (Cmd-B), Select cue…, Select next/previous, Select next/previous tab (Cmd-Right/Left), Move playhead to cue…, Move playhead to next/previous cue, Move playhead to next/previous sequence, Move selected cues down/up, Enter Edit Mode, Enter Show Mode.
- Window: Minimize, Workspace Status, Override Controls, Light Dashboard, Launcher Window, Timecode.
- QLab menu: Preferences…, Manage Your Licenses…, Start Demo Mode…, Hide, Hide Others, Quit.
- Imports QLab 4 workspaces; imports Go Button show files (disabled hits become disarmed + skip-if-disarmed); does not import QCart files.
- Requires macOS 11 or later; follows macOS Dark Mode.

---

## 16. Default keyboard shortcuts

Docs: https://qlab.app/docs/v5/general/keyboard-shortcuts/

- Space GO; V Preview Selected; Option-Space Audition GO; Option-V Audition Preview.
- L Load Last Selected; S Panic Selected (double = hard stop); P Pause/Resume Selected.
- [ Pause All; ] Resume All; Escape Panic All (double = hard stop all).
- N number; Q name; O notes; T target; Option-T cycle target type.
- E pre-wait; D duration; W post-wait; C continue mode; F flag.
- Cmd-0…9 create the first ten cue types in toolbox order.
- Cmd-T Load to time; Cmd-R Renumber; Cmd-D Delete numbers; Shift-Cmd-A always audition; Shift-Cmd-P live fade preview.
- Cmd-I inspector; Shift-Cmd-I secondary inspector; Cmd-K toolbox; Cmd-L sidebar; Shift-Cmd-L toggle sidebar tab; Cmd-B warnings.
- Cmd-J Select cue…; Shift-Cmd-J Move playhead to cue… (the Tools page gives Option-Cmd-J for Jump to selected cues' targets; the shortcuts page lists Shift-Cmd-J for it too — the manual is inconsistent).
- Cmd-Down/Up select next/previous; Shift-Cmd-Down/Up move playhead; = / - next/previous sequence; Option-Cmd-Down/Up move cues.
- Shift-Cmd-[ Edit mode; Shift-Cmd-] Show mode; Shift-Cmd-F full screen.
- Shift-Cmd-W Workspace Status; Shift-Cmd-O Override Controls; Cmd-comma Workspace Settings.
- > expand all groups; < collapse all groups.
- Waveform: Shift-I set start to current time; Shift-O set end; M add slice; Cmd-plus/minus zoom.
- Integrated fade curve: Left/Right select control point; Option-arrows move it; Shift-Option-arrows move it finely.
- Timeline tab: Cmd-=/- zoom horizontally; Shift-Cmd-=/- zoom vertically; Option-Left/Right nudge 0.1 s; Shift-Option nudge 0.01 s.
- 2D canvas: Control toggles tool; Cmd disables snapping; Option reverses rotate; Option-scroll zoom; arrows select/nudge; Shift coarse / axis-lock / aspect-lock; Option-click inserts a point; Cmd-A selects all points.
- Some shortcuts are co-opted by other windows (Light Dashboard, Workspace Settings, Workspace Status), always indicated on screen.

---

## 17. Audio engine concepts

Docs: https://qlab.app/docs/v5/audio/introduction-to-audio/ , https://qlab.app/docs/v5/general/system-recommendations/

- Audio sources: audio files, the audio track of video files, live device inputs, audio in an NDI stream.
- Audio outputs: built-in output, any Core Audio interface, network audio via Dante (Dante Virtual Soundcard), macOS AVB, and NDI audio.
- Output resolution 16 or 24 bit at sample rates up to 192 kHz.
- More than two output channels needs [Audio].
- Two-stage matrix: every audio cue has a cue matrix mixer (file/input channels × cue outputs) feeding the patch matrix mixer (cue outputs × device outputs).
- Matrix controls: per-input level, per-output level, per-crosspoint level, and one main level.
- 0 dB is unity; levels are dBFS; levels along a path add.
- One cue output can feed several device outputs at different levels (e.g. fills derived from mains).
- Cues on the same output patch stay sample-accurately in sync (driven by that device's clock) [Free].
- Cues started by one action (Timeline group, or auto-continue with no waits) start simultaneously.
- Wait times use the system clock, not the audio clock, so a waited cue is in sync but offset.
- Cues on different patches/devices drift apart unless the devices share word clock.

---

## 18. Audio cues

Docs: https://qlab.app/docs/v5/audio/audio-cues/

### Files
- Plays any Core Audio file type: AIFF, WAV, CAF (recommended), AAC, MP4, M4A.
- Plays MP3 (not recommended: unpredictable start delay).
- Can target any video file type; plays its audio only.
- Will not play DRM-protected files.
- Up to 24 channels per file [Audio]; first 2 channels [Free].
- Sample rates 8–192 kHz, bit depths 8–32 bit.
- Automatic on-the-fly sample-rate and bit-depth conversion to the output device; mixed rates in one workspace.

### I/O tab
- File Target field (double-click to choose, or drop a file), clear and reveal-in-Finder buttons.
- Format readout for the file: file type and codec, channel count, sample rate.
- Audio Output pop-up: choose an output patch.
- Audio Output pop-up: "(unpatched)" to guarantee silence.
- Audio Output pop-up: "Open Audio Settings to edit patch list…".
- Audio Output pop-up: "New patch with audio device" creates and selects a new patch.
- Edit… button opens the patch editor for the selected patch.
- Format readout for the device: channel count and sample rate.

### Time & Loops tab
- Waveform view of the target file [Free].
- Start time field; draggable start marker; Shift-I sets start to the current/clicked time.
- End time field; draggable end marker; Shift-O sets end to the current/clicked time.
- Drag-select a region of the waveform, then Shift-I and Shift-O to crop to it.
- Play count: any whole number of plays of the start–end range.
- Infinite loop option.
- Waveform contextual menu: "Open with external editor" submenu listing every installed audio editor.
- Waveform contextual menu: "Select channel to view" — sum of all channels (default) or any single channel, using input names.
- Slices: Add Slice button or M adds a slice marker at the clicked time [Free, unlimited].
- With a region selected, Add Slice makes markers at both ends.
- Each slice has its own play count, edited by double-clicking the number under it; Tab moves between slice counts.
- Slice infinite loop: type any letter as the count.
- Slice count 0: the slice is skipped seamlessly (tinted dark).
- At least one slice must have a count above 0, else the cue is broken.
- Drag a slice marker's handle to move it, or select it and type its time.
- Slice markers cannot be closer than 0.05 s.
- Markers embedded in AIFF/WAV files are imported automatically as slice markers.
- Delete a slice marker with Delete or by dragging its handle up out of the view.
- "Delete All" removes all slices (file markers untouched).
- Rate field (type, or drag up/down): 0.03 to 33; changes pitch like tape by default.
- "Preserve pitch" checkbox: change rate without changing pitch.
- Integrated fade envelope checkbox: a volume curve drawn over the waveform.
- Envelope control points added by clicking the line and dragged; keyboard selection and nudging.
- Envelope shape pop-up: Custom Curve (smooth) or Linear Curve (sharp corners).
- Envelope option "Lock fade to start/end": stretch the envelope to the cue's start/end times instead of the file's natural length.
- Envelope edits made while playing are heard only after a restart.
- Zoom buttons; pinch; Option-scroll; scroll wheel zoom.
- Reset button: stops the cue and clears its temporary properties.
- Preview button (V); becomes pause while playing.
- Clicking in the waveform loads the cue to that time (the "current time" that Shift-I, Shift-O and M act on).

### Levels tab
- Matrix mixer: rows = file channels, columns = cue outputs, top-left = main level.
- Each level set by typing or by click-dragging in the field; changes are live while the cue plays.
- Dragging stops at 0 dB; higher values (up to the workspace max) must be typed.
- An empty level field means -inf.
- Unsigned typed numbers are taken as negative.
- Cue outputs routed to a device output have a yellow fader handle; unrouted ones grey.
- "Set Default Levels" button (from the cue template).
- "Set all silent" button.
- "Inputs" button: name each input row, per cue [Free].
- "Gangs" button: type the same text in several level fields to gang them; ganged fields get matching colours and move together.
- Ganged levels at different values keep their offsets until one hits a limit.
- "Edit Audio Patch" button.
- Cue outputs beyond the first two need [Audio].
- Meters: audio meters on the main level control in the Levels tab.
- Meters of cue outputs move while Fade cues run (controls stay at programmed values).
- Mute and solo of cue outputs [Free] (listed in the licence table and "new in 5"; no page describes the controls).

### Objects tab [Audio]
- List of the cue's own objects ("cue objects"), named A, B… by default, renameable; + and - buttons.
- Objects matrix mixer: rows = file channels, columns = cue objects then map objects.
- Map canvas to position cue objects by drag or by typed coordinates; map objects visible but not movable here.
- Per-object spread and colour.
- Monitor button; zoom; help button listing canvas shortcuts.
- Main level and input names are shared with the Levels tab; gangs and other levels are not.
- Levels and Objects routing can be used together in one cue.

### Trim tab
- Post-fader trim per main output, per cue output and per object.
- Trims cannot be changed by Fade cues, MIDI, OSC or any automation: they stay as set.
- Use: offset one output across a whole fade sequence, or compensate for re-normalised replacement files.
- Trims on map objects affect only this cue's send to them.
- Meters shown in the Trim tab.

### Audio FX tab [Audio]
- Insert AudioUnit effects on a cue ("Add Audio Effect…" pop-up).
- An AudioUnit must be an effect (not a generator) and report a tail time.
- Effect channel count must match the file's channel count.
- Each effect opens its own AudioUnit editor window; Edit button reopens it.
- Bypass checkbox per effect (also "Enabled" in the effect window).
- Remove button per effect.
- Effects applied in list order; drag to reorder.
- Effects can be edited on disarmed cues and with the device disconnected.
- A generic control interface is used if the AudioUnit's own interface fails.

### Broken / warned Audio cues
- No audio file selected.
- Missing audio file.
- File target in Trash.
- File lacks read permission.
- No audio output patch.
- Issue with the audio output patch.
- Missing cue audio effect (AudioUnit not installed).
- Invalid slice play counts (all zero).
- Licence required (more than two cue outputs, effects, timecode triggers).
- Object audio without a licence: non-breaking warning only.

---

## 19. Mic cues [Audio]

Docs: https://qlab.app/docs/v5/audio/mic-cues/

- Mic cue passes live audio input through QLab with the same cueing, routing and effects as Audio cues.
- Sources: built-in mic, line input, interface inputs, Dante or AVB channels.
- Runs until stopped unless given a finite duration.
- Requires macOS microphone permission for QLab.
- I/O tab: Audio Input patch pop-up (with "(unpatched)", open settings, new patch with device).
- I/O tab: channel count, from 1 up to the input patch's channels, maximum 24.
- I/O tab: first input channel number (channel offset).
- I/O tab: Audio Output patch pop-up and Edit… button, device format readout.
- Input and output may be different devices without an aggregate device; drift is bounded to about the two buffer sizes (0–3 ms measured over two hours).
- Levels, Objects, Trim and Audio FX tabs identical to Audio cues.
- Main level of a new Mic cue defaults to -inf.
- QLab turns audio inputs off when no cue or input patch uses them.
- Broken reasons: no microphone access; input patch has too few channels; missing effect; no input patch; issue with input patch; no output patch; issue with output patch; licence required.

---

## 20. Fade cues (audio)

Docs: https://qlab.app/docs/v5/audio/fading-audio/

- A Fade cue changes parameters of its target over its duration ("a change in value over time").
- Audio fades [Free].
- Targets for audio: Audio, Mic, Video, Camera cues, Group cues and cue lists (fades everything inside), or an audio output patch / audio map.
- Default duration 5 s (cue template).
- Must have at least one active parameter or it is broken.
- Inspector shows only the tabs relevant to the target's type.

### Curve tab
- Two curves: one for levels that rise, one for levels that fall; time on the horizontal axis, percent complete on the vertical.
- Shape: S-Curve (default, ease-in/ease-out).
- Shape: Custom Curve (click to add control points; smooth bends; Delete removes a point).
- Shape: Parametric Curve with an Intensity value.
- Shape: Linear Curve (control points make sharp corners; multi-step fades).
- Shape: 2D Path (not available for fades targeting Audio or Mic cue levels).
- "Reset to Default Shape" button.
- Lock button mirrors the rising and falling curves; unlocked they can differ (Custom/Linear).
- Audio Domain pop-up: Slider domain (console-fader law).
- Audio Domain: Decibel domain (logarithmic).
- Audio Domain: Linear domain.
- Equal-power fade = parametric curve in linear domain; equal-gain fade = linear curve in linear domain.
- Default curve shape comes from the Fade cue template.

### Levels tab
- Matrix mirroring the target's rows and input names (or the patch's routing matrix for a patch target).
- A level takes part in the fade only if "active" (yellow); click a level to activate/deactivate; inactive (grey) levels are untouched.
- Any crosspoint, input, output or main level can be faded, each to its own value, in one cue.
- Typing a value at or below the minimum, or any non-number, activates the level at -inf.
- "Set Levels from Target" (opens the paste sheet preset to Audio; Shift-Cmd-T skips the sheet).
- "Set All Silent Levels" clears every active level.
- "Assign Gangs".
- "Stop Target When Done" checkbox (fade-and-stop; default name becomes "fade and stop …").
- Absolute / Relative pop-up.
- Absolute fade: active levels arrive at the stated values whatever they were.
- Relative fade: adds or subtracts the stated dB from current levels; icon changes.
- Relative fades are clamped by the workspace max level.
- An absolute fade overrides and clears earlier relative changes.
- Preview button reflecting the live-fade-preview setting.
- Several Fade cues on one target with different active controls run at once without interfering.
- Panning = one Fade cue lowering one output's level while raising another's.

### Objects tab [Audio]
- Fade object levels in an objects matrix.
- Fade an object's position along a drawn 2D path (start = green triangle, end = red square, points = yellow circles).
- Live-position and home-position indicators.
- Path tools: select, draw (click points or freehand), circle, flip vertical, flip horizontal, rotate 90°, reverse.
- Fade spread.
- "Smooth path" checkbox.
- "Loop" checkbox: the path fade repeats until stopped.
- "Merge" percentage: how much of the fade is spent easing from the object's current position onto the path (0% = snap).
- Reset path to template default.

### Audio FX tab
- Lists the target cue's effects; tick an effect to fade its whole state to the values set in the Fade cue [Audio].
- "Set Audio FX from Target" copies the effect's current state first.
- Per-effect Edit button opens the Fade cue's own copy of the effect editor.
- Fades cannot adjust effects on cue outputs or device outputs.
- "Fade rate to" checkbox and target rate (0.03–33) for Audio/Video targets [Audio].

### Patch fades
- A Fade cue can target an audio output patch and fade its routing matrix and main level, affecting every cue on that patch [Audio per the licence table; the fade page says audio or video licence].
- A Reset cue targeting a patch returns it to its saved levels.

### Other
- Revert Fade Action (Shift-Cmd-R): returns the target's levels to what they were before this Fade cue ran, except levels changed since by something else.
- Live fade preview while editing.
- Broken reasons: missing target; no parameters set to fade; missing audio effect; licence required.

---

## 21. Audio output patch editor [Audio]

Docs: https://qlab.app/docs/v5/audio/audio-output-patch-editor/

- Opened from Audio settings (Edit), a cue's I/O tab (Edit…), or a cue's Levels tab (Edit Audio Patch).
- Patch Name field.
- Cue Outputs field: 1 to 128 cue outputs per patch (fewer costs less CPU).
- Audio Device pop-up.
- "Set from other patch or defaults…" pop-up: copy any of four groups of settings from another patch, or reset to defaults.
- Done button commits and closes.
- Cue Outputs tab: rename each cue output (two lines with Option-Return); names appear under the output sliders in cues' Levels tabs.
- Cue Outputs tab: insert AudioUnit effects on a cue output; several per output, applied left to right.
- Cue Outputs tab: channel-count pop-up groups a cue output with the next so a stereo-only effect can be used.
- Patch Routing tab: matrix of cue outputs (rows, up to 128) × device outputs (columns, as many as the device has, up to 128), with crosspoint levels.
- Patch Routing tab: patch main level.
- Any cue output to any combination of device outputs (e.g. an effects-send bus).
- Device Outputs tab: AudioUnit effects on device outputs, same controls; device outputs cannot be renamed.
- Copy audio effects between cue outputs and between device outputs.
- Audio meters shown in the patch editor; meters of muted and unrouted channels are grey.
- Mute and solo on patch outputs (stated in "new in 5"; controls not described on the page).
- Patch warnings: no device selected; device missing (disconnection warning); device has no outputs.

---

## 22. Object audio and the audio map editor [Audio]

Docs: https://qlab.app/docs/v5/audio/object-audio/ , https://qlab.app/docs/v5/audio/audio-map-editor/

- Object mixer alongside the channel mixer (since 5.5); either or both in any cue.
- Map: a 2D virtual space (default 1000 × 1000, unit-less; objects may leave its bounds).
- Mark: a position with a set of cue-output levels ("an object here sounds like this").
- Object: a movable source; cue objects belong to one cue, map objects are shared by every cue on the map.
- Without a licence maps can be viewed but not edited.
- Map name, width and height fields.
- Background image for the map (drag in; resize; invert; offer to resize the map to the image).
- Add / rename / reorder / delete marks.
- Mark properties: position, levels per cue output, gravity (0.1–5, default 1), shadow (0–90°).
- Filters: lines that stop marks on one side influencing objects on the other.
- Filter properties: position, angle, width (how gradual), per-cue-output pass-through checkboxes.
- "Always show marks on map" checkbox.
- "Show outputs for patch" pop-up to audition the map through a patch; Open Patch button.
- Heatmap of any cue output's level across the map (23-step scale).
- Option-hover shows the levels an object would get at the pointer.
- Map objects: add, rename, reorder, delete; spread and colour; Reset returns moved objects to home.
- Test object: play a chosen audio file as a draggable object with its own level.
- Meters in the map editor.
- Object names must be unique within a cue or map.
- Fade cues move objects along paths; map monitor window shows them live.

---

## 23. Control cues

Docs: https://qlab.app/docs/v5/other-cues/transport-cues/ , https://qlab.app/docs/v5/other-cues/devamp-cues/ , https://qlab.app/docs/v5/other-cues/goto-cues/ , https://qlab.app/docs/v5/other-cues/target-cues/ , https://qlab.app/docs/v5/other-cues/arm-and-disarm-cues/ , https://qlab.app/docs/v5/other-cues/wait-cues/ , https://qlab.app/docs/v5/other-cues/memo-cues/ , https://qlab.app/docs/v5/scripting/script-cues/

### Transport cues (Start, Stop, Pause, Load, Reset)
- All need a cue target (any cue); broken without one; none moves the playhead.
- Start cue: starts its target, or resumes it if paused.
- Stop cue: stops its target.
- Pause cue: pauses its target [Any licence].
- Load cue: loads its target.
- Load cue's Load Time tab: a time to load the target to; the rest of the target's sequence follows that time.
- Load cue: negative time loads back from the end.
- A Load cue created while a loaded-to-time cue is selected targets it and copies its loaded time.
- Reset cue: stops its target and discards its temporary changes (fade changes, Target-cue retargets, before/after colours, OSC "temp" parameters).
- Reset cue can target an audio output patch or audio map.
- Transport cues can target Groups and cue lists (Start on a list = GO on that list).

### Devamp cue [Any licence]
- Targets an Audio or Video cue; acts when the target reaches the end of the current slice (or of the cue).
- Setting "Devamp currently looping slice": exit the current slice's loop and play on.
- Setting "Devamp looping cue": ignore slices; act at the end of the cue; a looping cue stops.
- Checkbox "Start next cue when target reaches the end of the current slice": starts the following cue at exactly that moment (post-wait computed live).
- Checkbox "Stop target when it reaches the end of the current slice" (only with start-next): hands off from the target to the next cue on the beat.
- Several Devamp cues can release several loops in turn.
- Slice markers on beats let actions land on bars and beats.

### GoTo cue
- Moves the playhead to its target cue; the next GO starts it. Broken only without a target.

### Target cue [Any licence]
- Changes another cue's target at run time to the cue number given in its Cue Number tab.
- The change is temporary: not saved, does not dirty the workspace, reverted by reset.
- Cannot target a Fade cue; the new target must have a cue number.

### Arm and Disarm cues [Any licence]
- Arm / disarm their target cue at run time; Basics and Triggers tabs only.

### Wait cue
- Does nothing but elapse; post-wait automatically equals its duration; default name "wait <duration>".

### Memo cue
- Does nothing when started; holds operator notes or acts as a visual separator; never broken.

### Script cue [Any licence]
- Runs AppleScript; Script tab with a text editor and a Compile Script button showing errors.
- Default script comes from the Script cue template.
- "Run in separate process" checkbox (default on); off runs inside QLab for tighter timing.
- All Script cues are compiled when a workspace opens (skipped with Control-Option held).
- Broken reasons: empty script, AppleScript error, not compiled, no licence.

---

## 24. Timecode cues and timecode [Any licence]

Docs: https://qlab.app/docs/v5/networking/timecode-cues/ , https://qlab.app/docs/v5/networking/using-timecode/

- Timecode cue generates outgoing LTC or MTC; any number of independent streams at once.
- Type: MTC, with a MIDI patch pop-up.
- Type: LTC, with an audio output patch pop-up and a cue-output channel number (defaults to 0 = invalid, as a safety).
- Framerate pop-up: 24, 25, 30 drop, 30 non-drop and the video-speed variants 23.976, 24.975, 29.97 drop, 29.97 non-drop.
- LTC is clocked by the audio device; MTC by the computer clock.
- Start time (first frame sent).
- End time (optional) or duration; without one the cue runs until stopped.
- Monitoring through the Timecode window (most recently started stream).
- Broken reasons: no/incomplete MIDI patch; no/faulty audio patch; invalid output channel; no licence.
- Incoming LTC or MTC can start cues (timecode triggers) per cue list or cart — see section 7.
- QLab chases incoming timecode: responds to stop, skip ahead and skip back.

---

## 25. Not documented, or inconsistent, in the v5 manual pages read

- No page describes a standalone "Audio levels" / VU meter window; meters are described only inside the Levels tab main control, Trim tab, patch editor, map editor and on effects.
- No normalisation or loudness tool is documented (the word appears only as an example of external file preparation).
- No waveform editing beyond start/end, slices, rate and the integrated fade envelope; destructive editing is delegated to "open in external editor".
- No "Bundle Workspace" command in v5; its role is taken by project-folder saving and File > Workspace Files > Copy media files into project folder.
- No page for the Window menu or the File menu; their items above are collected from the shortcuts page and cross-references.
- No dedicated page on Undo; statements above are scattered across pages.
- Mute and solo of cue outputs and patch outputs are listed (licence table: free; "New in QLab 5") but no page read describes where the buttons are or how solo behaves.
- "Hard stop" is defined only in passing (Triggers tab, shortcuts, sidebar reset); there is no separate description of plain Stop versus Panic for audio tails.
- Pausing has no page of its own: only the shortcuts, the sidebar/Active Cues buttons, the Pause cue and MSC STOP/RESUME mapping.
- Licence inconsistencies inside the manual: the licence table puts audio output patch fading, rate fading and audio effect fading under Audio only, while the Fade page says "an audio or video license" for objects, rate, effects and patches; the table says timecode triggers need any licence while the Cue Lists page says Audio, Video or Bundle.
- Shortcut inconsistency: "Jump to selected cues' targets" is Shift-Cmd-J on the shortcuts page and Option-Cmd-J on the Tools page; Shift-Cmd-J is also listed for "Move playhead to cue…".
