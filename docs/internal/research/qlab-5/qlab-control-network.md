# QLab 5 feature inventory: networking, control, scripting, collaboration, remote

Source: the official QLab 5 manual, https://qlab.app/docs/v5/ (fetched 2026-11-13). Every bullet is taken from the page named under its heading. Licence notes are marked **[licence: …]**. "Any licence" means audio, video or lighting — each unlocks MIDI, networking, show control, scripting and workflow features (https://qlab.app/docs/v5/general/licenses/, https://qlab.app/docs/v5/general/features/).

Coverage notes are at the end.

---

## 1. Licence tiers for this area
https://qlab.app/docs/v5/general/features/ · https://qlab.app/docs/v5/general/licenses/

- Remote control via OSC, MIDI, MSC and the iOS app is in the feature table under "Networking & Show Control" (the table's tick marks are images and did not survive text extraction; per-feature pages below state the tier).
- Network cues, MIDI cues, MIDI File cues, Timecode cues, Script cues each state "require a license of any kind". **[licence: any]**
- Timecode triggers (incoming) need an Audio, Video or Bundle licence per the cue-list Timecode tab page. **[licence: audio/video/bundle]**
- Show control broadcast via MSC and OSC is a listed licensed-table feature.
- Act as Collaboration Primary / Remote: available free with limits (see Collaboration).
- Demo Mode: all licensed features for 60 minutes in a new workspace; copying cues/settings into the demo workspace is disabled; expires on save/close/reopen.
- Standard licence installs on two computers at once; rent-to-own priced per day; site licences (10-activation minimum); USB-drive licences; offline activation.
- QLab 5 licences also work with QLab 4.7+ (no 5.x features there); not with QLab 3 or earlier.

## 2. Network cues
https://qlab.app/docs/v5/networking/network-cues/

### Message types
- Network cue sends a message over the Mac's network connections to other software/devices, or back to QLab itself. **[licence: any]**
- Transport is TCP or UDP (chosen on the patch).
- Three raw message types: OSC message, Plain Text (ASCII only), Hex Code (0-9, A-F only).
- Plus "network device descriptions": a patch type that gives a device-specific inspector (pop-ups, text fields, checkboxes, sliders, 1D and 2D fade curves) with the device's full command library.
- Built-in device descriptions (list on the page): QLab 5; Go Button 3; Adamson Fletcher Machine; Alcorn McBride (AV Binloop HD, X-series, AMI/Pioneer protocol V-Series); Amadeus Acoustics; Audio Definition Model (ADM); Audioström LiveProfessor; atemOSC; Behringer WING / X-Air / X32 and Midas M32; BitFocus Companion; Blackmagic Videohub; Borealis Vor; Chamsys MagicQ; Christie (RS232C-over-network protocol) and Christie HS Series; Cockos Reaper; Creative Conners Spikemark 5 and 6; CueCam; CuePoints; d&b DS100 (Soundscape); D::Light; Dan Murfin ShowPlay; Dataton Watchout 7; DiGiCo SD and Quantum; DirectOut Maven and Prodigy; disguise; Elation Obsidian Onyx; ETC ColorSource AV; ETC EchoTouch; ETC Eos Family (two definitions as of 5.6: Eos v2 and Eos v3); ETC Foundation; Flamingo Atlas; Flux Spat Revolution; Fulcrum One; GarageCube MadMapper 5 and 6; Glypheo; Grapes 3D Audio Control; High End Hog 4; L-Acoustics L-ISA; Lawo mc2; Lightkey 4; Liminal ZoomOSC and ZoomISO; MA grandMA3; MOTU AVB interfaces; Meyer GALAXY (Normal and Spacemap modes); Millumin 4 and 5; Mixeffect; OBSBot Center/Tail Air/Talent; OSCPoint; PJLink; PresentationTools CueTimer; Q-SYS; Right On Cue STAGE|Tracks; RME TotalMix FX; ShowTrak Server; Shure Axient Digital / P10T / ULX-D; Synthe FX Luminair 4; TiMax panLab and panLab Console; TheatreMix 3; VISCA-over-IP; Yamaha DM3, DM7, Rivage, Sound xR (AFC Image); zactrack.
- The "QLab 5" device description: enter a cue number and pick a command from a menu (extra argument fields appear per command) — used for QLab-to-QLab or QLab-to-itself control without typing OSC.
- Examples shown: QLab 5 workspace GO; ETC Eos "channel 10 at 50%"; ETC Eos fade channel 10 from 50% to 0% (1D fade); d&b DS100 2D position loop; Yamaha Rivage enable delay on input 8.
- Figure 53 takes requests for new device descriptions and ships them in later releases.

### Inspector (Settings tab)
- Inspector has Basics, Triggers and Settings tabs.
- Patch pop-up: pick a configured network patch, "(unpatched)" (cue will not play), "Open Network Settings to edit patch list…", or "New patch with network device" (creates and selects a new patch).
- A patch with several destinations sends the cue's message to all of them simultaneously (e.g. main and backup device from one cue).
- Fade pop-up: No Fade (default when no duration), Resend (default when the cue has a duration), 1D Fade, 2D Fade.
- Duration editable in the Settings tab, Basics tab, or the cue list Duration column.
- Send button test-sends the message (same as previewing the cue).
- The completed outgoing message is displayed near the bottom of the Settings tab with a Copy button (per OSC dictionary `/message`); an invalid message shows a yellow error there (`/messageError`).

### OSC message syntax
- One OSC command per cue, typed in a single text field.
- A single space separates the address from the first argument and arguments from each other.
- String arguments containing spaces must be in quotation marks.
- Digits only → integer; digits with decimal separator → float.
- OSC 1.1 arguments supported: `\T` true, `\F` false, `\I` impulse, `\N` null.
- If the Mac's locale uses a comma decimal separator, QLab silently substitutes a period in outgoing OSC.

### OSC with a duration: resend and fades
- Resend: the message is sent repeatedly for the cue's duration at a chosen rate, 1 to 120 messages per second (fps pop-up).
- 1D Fade: one value fades over the duration; `#v#` token in the message is replaced by the computed value on each send.
- 1D fade has From and To fields, an editable fade curve, custom or linear curve shape, reset-to-default.
- 1D/2D fade values can be sent as integers or floats (floats to six decimal places).
- The `#v#` token may be used in the OSC address as well as in arguments.
- 2D Fade: two values fade at once; `#x#` and `#y#` tokens are replaced by the path's X and Y.
- 2D path canvas: start drawn as green triangle, end as red square, points as yellow circles, direction carets along the path.
- 2D tools: select (single point with numeric X/Y fields, or drag a selection box), draw (click to add points, drag for freehand, ⌥ inserts mid-path, double-click finishes), circle (two clicks for diameter; ⌥ for centre + radius), flip vertical, flip horizontal, rotate 90°, reverse point order, help button listing shortcuts.
- Axis alignment menu: origin at centre (default) or in a corner — display only.
- Width and Height fields set the value range of the canvas.
- Smooth path checkbox (curved interpolation between points).
- Loop checkbox: the cue loops the path until stopped; jumps from end to start if they differ.
- Canvas zoom (buttons, pinch, ⌥-scroll) and pan (two-finger swipe, middle-button drag).
- Reset Points returns the path to the cue template's default.
- 2D fade can have a background image (a missing image raises a non-breaking warning; "Remove Background" clears it).
- Live Preview: with live fade preview on, dragging in a 2D fade transmits OSC in real time.
- Plain Text and Hex Code messages cannot have a duration, be faded or be resent.

### OSC queries inside outgoing messages
https://qlab.app/docs/v5/scripting/osc-queries/

- `#/some/osc/query#` inside a Network cue's message is replaced, at send time, with the live result of that query on QLab itself (e.g. `/device/standby #/cue/selected/number#`).
- If the cue has a duration, the query is re-evaluated continuously for as long as the cue runs.
- A query can carry a re-scaling range: `#/cue/10/liveAverageLevel/1 0 100#` maps the result into 0–100 (or `50 100`).
- Combined with a `localhost` patch, queries let one live value drive another (example: mic cue level drives a light's intensity via `/dashboard/setLight`).
- Which OSC methods can be used as queries is marked per method in the OSC dictionary ("query" column).

### Cue templates per patch
- The Network cue template stores separate default settings for each network patch; switching a new cue's patch brings up that patch's stored defaults — effectively several templates for one cue type.

### Broken-cue states and warnings
- No patch; incomplete network patch; missing message; missing values (device description parameter empty); invalid OSC message; invalid hex codes; licence required — each breaks the cue.
- Non-breaking warnings: missing 2D background image; external network output disabled by Override Controls; local network output disabled by Override Controls.

## 3. Network patches (Workspace Settings ▸ Network ▸ Network Outputs)
https://qlab.app/docs/v5/fundamentals/workspace-settings/ (Network section)

- A workspace can hold any number of network patches; every Network cue uses exactly one.
- A new blank workspace starts with one patch preconfigured to send OSC to QLab itself.
- New Output Patch button, or ⌘N while the tab is in front.
- Patch columns: drag handle, Patch name (optional free text), Type (generic OSC message, plain text, or a device description), add-destination button, Network (TCP or UDP), Interface (specific NIC or "automatic"), Destination (IP or mDNS name such as `qlab-computer.local`, plus port), Passcode, delete.
- A patch can have any number of destinations, each with its own transport, interface, IP, port and passcode.
- Destination `localhost` routes the message back into QLab with the lowest latency — it never leaves QLab.
- Destination `127.0.0.1` routes to other software on the same Mac.
- Passcode field lets the patch talk to a QLab workspace that requires an OSC passcode.
- Patches can be deleted, reordered by drag, duplicated by ⌥-drag, copied to another workspace by dragging into its patch list, and exported by dragging to Finder (creates a settings file).
- Shift/⌘ multi-select of patches to act on several at once.
- A QLab Settings file dragged from Finder into a patch list imports matching patches without replacing existing ones.
- Workspace settings (per section) can be imported/exported: from a settings file, another open workspace, or QLab defaults, with a checkbox list of sections.

## 4. OSC access, passcodes and ports (Workspace Settings ▸ Network ▸ OSC Access)
https://qlab.app/docs/v5/fundamentals/workspace-settings/ (OSC Access) · https://qlab.app/docs/v5/scripting/osc-dictionary-v5/

- Master checkbox turns OSC access on/off for the workspace (also governs plain-text commands); on by default.
- The tab shows the Mac's current IP address(es).
- Three permission switches per connection type: View (read workspace information), Edit (create/delete cues, change cue parameters, adjust workspace settings), Control (move playhead, start/stop cues).
- "No Passcode" row sets what passcode-less clients may do; default is all three unchecked, i.e. no passcode-less connection.
- New workspaces get one randomly generated passcode with full access.
- Any number of passcodes, each with its own view/edit/control set; Add Passcode generates a random one; passcodes are four-digit numbers and editable; deletable.
- OSC listening port per workspace: default 53000 (TCP and UDP), changeable to 1–65535.
- UDP replies go to port 53001 regardless of the listening port, unless the client sends `/udpReplyPort x`.
- Plain-text listening port per workspace: default UDP 53535; text such as `/cue/selected/start` is interpreted as OSC; no replies are sent to plain-text messages.
- QLab the application always listens on 53000 for application-level messages, even if the workspace port is changed.
- TCP framing is double-END SLIP (RFC 1055), per OSC 1.1.
- UDP: one OSC message per datagram.
- Port-conflict detection: a warning when a port cannot be bound (commonly two copies of QLab); from 5.6 a per-port reset button retries the bind, with a disconnection warning.
- Warns about port collisions with NDI where it can.
- `/connect` with wrong passcodes introduces a progressively longer delay before the next attempt is accepted (brute-force protection).
- UDP clients are forgotten after 61 seconds of silence (passcode must be re-sent) unless `/forgetMeNot` / `/udpKeepAlive` is on, or any message such as `/thump` is sent in time; TCP clients stay connected until `/disconnect` or socket close.
- Preference "Duplicate OSC message interval": identical OSC messages received within this interval (default 0.1 s) are discarded; adjustable (https://qlab.app/docs/v5/general/qlab-preferences/).
- Stream Deck plugin cannot send a passcode, so it needs "No Passcode" permissions enabled.

## 5. Controlling QLab by OSC — concepts
https://qlab.app/docs/v5/networking/using-osc/ · https://qlab.app/docs/v5/scripting/osc-dictionary-v5/

- Incoming OSC accepted over TCP and UDP on the local network.
- Workspace-level messages (`/go`, `/panic`, `/save`…) behave exactly like the corresponding button/menu item.
- Every open workspace listening on a port receives messages sent to that port (changed from QLab 4, where only the front workspace did).
- Target one workspace with a per-workspace port, or the prefix `/workspace/{id}/…` where `{id}` is the workspace unique ID or its display name without `.qlab5` (name must be OSC-legal: no spaces/unicode).
- Cue addressing: `/cue/{number}`, `/cue_id/{uniqueID}`, `/cue/selected`, `/cue/playhead` (= `/cue/playbackPosition`), `/cue/active` (all running or paused cues).
- Commands sent to `/cue/selected` are applied only to the selected cues that can accept them; inapplicable messages are silently ignored.
- OSC pattern matching in cue numbers: `?` (one char), `*` (zero or more), `[abc]`, `[1-5]` ranges, `[!…]` negation, several bracket sets side by side, `{a,b,c}` alternatives; combinable.
- `/cue/[*]/…` addresses only cues that have a cue number.
- Cue numbers with spaces, unicode or emoji cannot be addressed by OSC.
- Three uses named by the docs: simple remote control, two-way integration (replies + updates), and show control broadcast (since 5.3).
- Replies: `/reply/{invoked/address} json_string`, JSON with `workspace_id` (optional), `address`, `status` (`ok` / `error` / `denied`), `data`.
- Action messages (`/go`, `/panic`…) send no reply unless `/alwaysReply` is on.
- Per-method access table in the dictionary: view / edit / control columns (read, read/write, read only, allowed, not allowed), plus query, +/- and live columns.
- Read form = send the address with no argument; write form = send with argument.
- Increment/decrement syntax: `/cue/x/property/+ {delta}` and `/- {delta}`; from 5.5 the delta may be in the address (`/cue/10/preWait/+/1`).
- From 5.5, +/- on a finite option list rolls over (e.g. continueMode cycles).
- "Live" form: append `/live` to change the running value without altering the saved cue, without marking the document edited and without an undo entry; reverts on cue/workspace reset; cheaper for high-rate streams.
- +/- and live combine, live last: `/cue/x/opacity/+/live 10`.
- Booleans accepted as OSC true/false, numbers (0 = false, anything else true), or strings (N/n/F/f/0… false; Y/y/T/t/1-9… true).
- From 5.2 any boolean method accepts the argument `toggle` or a `/toggle` address suffix.
- Large replies (`/cueLists` etc.) may exceed a UDP datagram; TCP recommended.

## 6. OSC dictionary — application messages
https://qlab.app/docs/v5/scripting/osc-dictionary-v5/ (Application Messages)

- If every open workspace requires a passcode, a client must connect to one before application messages are accepted — except `/version` and `/workspaces`, which always answer.
- `/alwaysReply {number}` — reply to every message, including ones that normally send none.
- `/disconnect` — client says goodbye.
- `/fontNames`, `/fontFamiliesAndStyles` — list installed fonts.
- `/forgetMeNot {bool}` / `/udpKeepAlive {bool}` — keep a UDP client (and its settings) remembered beyond the 61 s timeout.
- `/overrides/…Enabled {bool}` and `/overrides/toggle…` for: dmxOutput, midiInput, midiOutput, mscInput, mscOutput, sysexInput, sysexOutput, networkExternalInput, networkExternalOutput, networkLocalInput, networkLocalOutput, timecodeInput, timecodeOutput.
- `/overrideWindow {bool}`, `/toggleOverrideWindow` — show/hide the Override Controls window.
- `/replyFormat {format_string}` — custom reply format with tokens `#workspace_id#`, `#address#`, `#status#`, `#data#`; empty string resets.
- `/timecodeWindow {bool}`, `/toggleTimecodeWindow` — show/hide the Timecode window.
- `/udpReplyPort {number}` — per-client UDP reply port (0 resets to 53001).
- `/updates {bool}` — subscribe to push updates (any permission level).
- `/version` — QLab's version.
- `/workingDirectory {path}` — get/set the directory used by open/save (full or `~` paths).
- `/workspaces` — array of open workspaces: uniqueID, displayName, port, udpReplyPort, version.

### Push updates (after `/updates 1`)
- `/update/workspace/{id}` — reload cue lists / workspace changed.
- `/update/workspace/{id}/cue_id/{cue_id}` — reload that cue (and children if a group/list).
- `/update/workspace/{id}/cueList/{list_id}/playbackPosition {cue_id}` — playhead moved (no argument if none).
- `/update/workspace/{id}/disconnect` — client must disconnect (workspace closing).

## 7. OSC dictionary — workspace messages
(all optionally prefixed `/workspace/{id}`)

- `/connect {passcode}` — returns `ok`, `badpass` or `error`; without a passcode grants the no-passcode permissions.
- `/go` — GO the current list; `/go {cue_number}` (must be a string argument) or `/go/{cue_number}` — jump the playhead to that cue then GO; a list's number makes that list GO; no effect for cart cues.
- `/auditionGo` (+ cue-number forms) — audition GO through the audition outputs.
- `/panic` (fade out then hard stop; a second panic during the fade hard-stops), `/panicInTime {seconds}`.
- `/stop` (lets effect tails decay), `/hardStop` (cuts effects immediately), `/pause`, `/resume`, `/reset` (stops all, playhead to top, restores temporary/live changes).
- `/playhead/{cue_number}`, `/playheadID/{cue_id}` (aliases `/playbackPosition…`); `/playhead/next`, `/previous`, `/nextSequence`, `/previousSequence`, `/none`, `/active` (first active cue), `/selected`.
- `/select/{cue_number}`, `/select_id/{id}`, `/select/next`, `/select/previous`.
- `/cueLists`, `/selectedCues`, `/runningCues`, `/runningOrPausedCues` — arrays of cue dictionaries including group children; variants `/shallow`, `/uniqueIDs`, `/uniqueIDs/shallow`.
- `/currentCueList {number}`, `/currentCueListID {id}` — get/set the list or cart shown in the main window.
- `/new {cue_type}` (+ optional after-cue ID, cart row, cart column) — create a cue of any type (audio, mic, video, camera, text, light, fade, network, midi, midi file, timecode, group, start, stop, pause, load, reset, devamp, goto, target, arm, disarm, wait, memo, script, cue list, cart); returns the new unique ID; the new cue is selected.
- `/move/{cue_id} {new_index} {new_parent_id}` — reorder or re-parent a cue; replies with new parent and index.
- `/delete/{cue_number}`, `/delete_id/{id}`, `/delete/selected`, `/delete/active`.
- `/renumber {start} {increment} {prefix} {suffix}` — renumber selected cues.
- `/save`, `/undo`, `/redo`.
- `/showMode {bool}`, `/toggleEditShowMode`.
- `/fullScreen {bool}`, `/toggleFullScreen`.
- `/alwaysAudition {bool}`; `/auditionMonitors {bool}`, `/toggleAuditionMonitors`.
- `/liveFadePreview {bool}`, `/toggleLiveFadePreview`.
- `/lightDashboard {bool}`, `/toggleLightDashboard`.
- `/doubleGoWindowRemaining` — seconds until the next GO is allowed under double-GO protection.
- `/basePath` — folder containing the workspace.
- `/thump` — heartbeat; returns `thump`.
- Light dashboard: `/dashboard/setLight {instrument[.param]} {setting} {time}` (also `/live` and address-argument forms; optional fade time; virtual params such as `pantilt(20,30)`), `/dashboard/clear`, `/revert`, `/undo`, `/redo`, `/mode {sliders|tiles}`, `/nextMode`, `/newCueWithAll`, `/newCueWithChanges`, `/recordAllToLatest`, `/recordAllToSelected`, `/updateLatestCue`, `/updateOriginatingCues`, `/updateSelectedCues`.

### Workspace settings messages (`/settings/…`)
- `/settings/general/minGoTime {number}` (double-GO protection), `/settings/general/selectionIsPlayhead {bool}` + toggle, `/settings/general/undo|redo`.
- `/settings/network/patchList`, `/settings/midi/patchList`, `/settings/mic/patchList`, `/settings/light/patch`, each area with its own `/undo` and `/redo`.
- About 345 further `/settings/audio/…` and `/settings/video/…` methods (audio maps, filters, objects, stages) exist — outside this area, names only seen.

## 8. OSC dictionary — cue messages (all cue types)

- Transport per cue: `/start` (also `/cue/start {number}`, `/cue_id/start {id}`), `/go`, `/stop`, `/hardStop`, `/pause`, `/hardPause` (no effect-tail decay), `/resume`, `/togglePause`, `/panic`, `/panicInTime {s}`, `/reset`, `/preview`, `/auditionGo`, `/auditionPreview`.
- Loading: `/load`, `/loadAt {seconds}` (negative = from the end) or `{h} {m} {s}`, `/loadActionAt`, `/loadFileAt`, `/loadAndSetPlayhead`, `/startAndAutoloadNext`.
- `/soloCueInTime {s}` — fade and stop all other cues in the same list.
- Basics get/set: `/number`, `/name`, `/notes`, `/duration`, `/preWait`, `/postWait`, `/continueMode` (0 none, 1 auto-continue, 2 auto-follow), `/armed`, `/flagged`, `/autoLoad`, `/skipIfDisarmed`, `/colorName` (+ `/live`), `/secondColorName`, `/useSecondColor`, `/colorCondition`.
- Targets: `/cueTargetNumber`, `/cueTargetID`, `/fileTarget`, `/patchTargetID`, `/targetMode`; temporary retargeting `/tempCueTargetNumber`, `/tempCueTargetID`; read `/currentCueTarget…`.
- `/tempDuration {s}` — temporary duration until reset; `/currentDuration`.
- Trigger-side behaviours: `/fadeAndStopOthers` (0 off, 1 peers, 2 list, 3 all) + `/fadeAndStopOthersTime`; `/duckOthers`, `/duckLevel`, `/duckTime`; `/secondTriggerAction` (0 nothing, 1 panic, 2 stop, 3 hard stop, 4 hard stop & restart, 5 devamp, 6/7 playlist next/previous); `/secondTriggerOnRelease`.
- Timecode trigger: `/timecodeTrigger` (+ `/hours`, `/minutes`, `/seconds`, `/frames`, `/bits`, `/text`), `/captureTimecode` (set trigger to the currently incoming frame).
- Read-only state: `/isRunning`, `/isPaused`, `/isLoaded`, `/isBroken`, `/isWarning`, `/isOverridden`, `/isPanicking`, `/isAuditioning`, `/isActionRunning`, `/isTailingOut`, `/isCrossfadingOut`, `/isNextInPlaylist`.
- Read-only progress: `/actionElapsed`, `/percentActionElapsed`, `/preWaitElapsed`, `/percentPreWaitElapsed`, `/postWaitElapsed`, `/percentPostWaitElapsed`, `/maxTimeInCueSequence`.
- Read-only identity: `/uniqueID`, `/type`, `/displayName`, `/listName`, `/defaultName`, `/parent`, `/children` (+ shallow / uniqueIDs variants), `/cartPosition` (row/column), `/hasCueTargets`, `/hasFileTargets`, `/canHavePatchTargets`, `/allowsEditingDuration`.
- `/valuesForKeys "[\"key\",…]"` — fetch a custom set of properties in one reply; `/valuesForKeysWithArguments` — the same for keyed properties with arguments (e.g. `{"level":[0,0]}`).
- Live audio meters as queries: `/cue/x/liveAverageLevel/{output}` (cited on the OSC queries page).
- Example from the cookbook: `/cue/selected/level/0/0 -10` sets the main level of every selected cue.

### Group / cue list / cart messages
- `/mode {number}` (group mode), `/collapse`, `/expand`, `/isChildFlagged`, `/isChildAuditioning`.
- Per-list playhead: `/cue/{list}/playhead {number}`, `/playheadID`, `/playhead/next|previous|nextSequence|previousSequence|none`.
- Cart: `/cartRows`, `/cartColumns`, `/moveCartCue/{child} {row} {column}`.
- Playlist groups: `/playlist/currentCue`, `/currentCueID`, `/next`, `/previous`, `/doShuffle`, `/doLoop`, `/doCrossfade`, `/crossfade/duration`, `/shuffle`.
- Timecode sync per list: `/timecodeSyncMode`, `/timecodeSMPTEFormat`, `/timecodeStartBehavior`, `/timecodeStopBehavior`, `/timecodeFreewheelTime`, `/timecodeLookbackTime`, and incoming `/currentTimecode` (+ hours/minutes/seconds/frames/bits/text).

### Network cue messages
- `/customString` (OSC or plain-text body), `/message` (the completed outgoing message), `/messageError`.
- Patch: `/networkPatchName`, `/networkPatchNumber` (0 = unpatched), `/networkPatchID`; `/patch` and `/patchList` deprecated.
- Fades: `/fadeType` (0 none/resend, 1 1D, 2 2D), `/fadeNumberType` (0 int, 1 float), `/fps` (1–120), `/fadeFrom`, `/fadeTo`, `/fadeEntries` (curve/path points as `"{x,y}"`, `[x,y]` or JSON), `/pathWidth`, `/pathHeight`, `/pathLoop`, `/pathSmooth`.
- Device-description parameters: `/parameterValue/{index|key}`, `/parameterValues` (array), `/parameterFadeEnabled/{index|key}`, `/parameterFadesEnabled`; menu values by display name or key; point values in three formats.

### MIDI, MIDI File, Timecode, Script cue messages
- MIDI cue: `/messageType` (1 voice, 2 MSC, 3 SysEx), `/status` (0 Note Off … 6 Pitch Bend), `/channel` (1–16), `/byte1`, `/byte2`, `/byteCombo` (0–16383), `/doFade`, `/endValue`, `/rawString` (SysEx hex), MSC fields `/commandFormat`, `/command`, `/deviceID`, `/qNumber`, `/qList`, `/qPath`, `/macro`, `/controlNumber`, `/controlValue`, MSC timecode `/hours` `/minutes` `/seconds` `/frames` `/subframes` `/timecodeFormat` `/timecodeString`; patch `/midiPatchName|Number|ID`.
- MIDI File cue: `/rate`, `/midiPatchName|Number|ID`.
- Timecode cue: `/outputType` (0 MTC, 1 LTC), `/framerate` (0–7: 24, 25, 30 nd, 30 drop, 23.976, 24.975, 29.97 nd, 29.97 drop), `/startTime`, `/endTime` (timecode string or seconds), `/ltcChannel`, `/audioOutputPatchName|Number|ID`, `/midiPatchName|Number|ID`.
- Script cue: `/scriptSource` (read), `/compileSource`.
- Devamp cue: `/devampType`, `/startNextCueWhenSliceEnds`, `/stopTargetWhenSliceEnds`. Reset cue: `/targetMode` (cues or patches), `/patchTargetID`, `/audioMapTargetID`.
- Light cue: `/setLight`, `/lightCommandText`, `/replaceLightCommand`, `/removeLightCommandsMatching`, `/prune`, `/safeSort`, `/collateAndStart`, `/alwaysCollate`, `/subcontroller`.

## 9. Show control broadcast (status out)
https://qlab.app/docs/v5/networking/show-control-broadcast/

- Optional, per workspace; reports show status via MSC and/or OSC for monitoring or for slaving another device.
- MSC broadcast: enable checkbox plus any number of destinations (Workspace Settings ▸ MIDI ▸ MSC Broadcast); each has a MIDI output patch, an MSC command format (device category) and a device ID (127 = all-call).
- MSC destinations can be added (⌘N), deleted, reordered, ⌥-drag duplicated, dragged to another workspace, exported to Finder.
- MSC messages sent: GO → `MSC GO {cue number}`; Panic All / Stop All / HardStop All → `ALL_OFF`; Reset All → `RESET`.
- OSC broadcast is subscription-based: a client sends `/listen` (all events) or `/ignore`; must be re-sent after the workspace is reopened.
- Events with arguments: `/qlab/event/workspace/{event} {number} {name} {uniqueID} {type}` for `go`, `auditionGo`, `cue/start`, `cue/stop`, `playhead`.
- Each such event is also sent as four single-argument messages: `…/number`, `…/name`, `…/uniqueID`, `…/type`.
- GO vs start: a cue started by GO reports `go`; any other start (Start cue, trigger, preview) reports `cue/start`.
- `cue/stop` is reported whether a cue is stopped by hand, by a Stop cue, or runs out.
- `playhead` is reported whenever the current list's playhead moves.
- Events without arguments: `pauseAll`, `resumeAll`, `panicAll`, `stopAll`, `hardStopAll`, `resetAll`.
- Scoped subscription: `/listen/{event}` and `/listen/{event}/{number|name|uniqueID|type}`, with matching `/ignore/…` forms.
- `/eventFormat "…"` sets a per-client custom outgoing format with tokens `#workspace_id#`, `#address#`, `#status#`, `#data#`; only single-argument messages are then sent; no argument returns the current format; empty string resets.
- Documented recipes: `/eventFormat "/cue/#data#/start"` to slave another QLab; `/eventFormat "/eos/cue/#data#/fire"` to fire an ETC Eos console.
- Broadcast messages are plain OSC, not the JSON reply format.
- UDP subscribers need the keep-alive message to survive the 61 s timeout.

## 10. MIDI cues (out)
https://qlab.app/docs/v5/networking/midi-cues/

- Three message types: MIDI Voice Message, MIDI Show Control (MSC), MIDI SysEx. **[licence: any]**
- MIDI Patch pop-up: configured patches, "(unpatched)", open MIDI settings, "New patch with MIDI device".
- Send Message button test-sends.
- Voice commands: Note On, Note Off, Program Change, Control Change, Key Pressure (Aftertouch), Channel Pressure, Pitch Bend Change; each with channel.
- Control Change, Key Pressure, Channel Pressure and Pitch Bend can fade: "Fade over duration" checkbox, duration, start Value, "Fade to value", editable curve (custom/linear, reset).
- MSC: Command Format (device category), Command, Device ID (127 = all-call), Q Number, Q List, Q Path.
- MSC command set selectable (per the parameter reference): GO, STOP, RESUME, TIMED_GO, LOAD, SET, FIRE, ALL_OFF, RESTORE, RESET, GO_OFF, GO/JAM_CLOCK, STANDBY_+/-, SEQUENCE_+/-, START/STOP/ZERO/SET_CLOCK, MTC_CHASE_ON/OFF, OPEN/CLOSE_CUE_LIST, OPEN/CLOSE_CUE_PATH (https://qlab.app/docs/v5/scripting/parameter-reference/).
- MSC commands can carry timecode (hours/minutes/seconds/frames/subframes, format 24/25/30 drop/30 non-drop), macro, control number/value (per OSC dictionary).
- SysEx: free hex text field; QLab adds the leading `F0` and trailing `F7`.
- Broken states: no MIDI patch, incomplete patch, invalid SysEx length, invalid SysEx characters, licence required.

## 11. MIDI File cues
https://qlab.app/docs/v5/networking/midi-file-cues/

- Plays a standard MIDI file (Type 0 and Type 1; Type 2 not supported) to a single MIDI output. **[licence: any]**
- Any number of tracks and all 16 channels, but one MIDI port per cue.
- Playback rate multiplier applied to all tempi (0.5 = half speed).
- Target can be an IAC bus so MIDI events loop back into QLab and trigger other cues, or route to another app.
- Timing runs on the computer's internal clock, not an audio/video device clock.
- Offered as the way to get tempo/meter-based timelines, since QLab has no native tempo map.
- Broken states: no file, missing file, invalid file, file in Trash, no/incomplete MIDI patch, licence required.
- When saving into a project folder, MIDI files are copied into a `midi` subfolder (https://qlab.app/docs/v5/fundamentals/managing-workspaces/).

## 12. MIDI patches (Workspace Settings ▸ MIDI ▸ MIDI Outputs)
https://qlab.app/docs/v5/fundamentals/workspace-settings/ (MIDI)

- Any number of MIDI patches; shared by MIDI cues, MIDI File cues, MTC Timecode cues and MSC broadcast.
- A new workspace gets one patch per MIDI output present on the Mac at creation.
- Each patch: optional name, pop-up of all available MIDI destinations.
- Add (⌘N), delete, reorder, ⌥-drag duplicate, drag to another workspace, drag to Finder to export, multi-select.
- A patch whose interface is unplugged raises a disconnection warning in Workspace Status.

## 13. Incoming MIDI and MSC control
https://qlab.app/docs/v5/networking/using-midi-and-msc/ · https://qlab.app/docs/v5/fundamentals/workspace-settings/ (Controls ▸ Workspace MIDI)

- Workspace MIDI channel: one of 1–16 or "Any"; listens to all MIDI devices connected to the Mac.
- "Use 'Musical' MIDI Voice Messages" checkbox enables a table mapping MIDI messages to workspace commands (GO, Pause All, Panic, Load, etc. — the full command list is a screenshot).
- Mappable message types: Note On, Note Off, Program Change, Control Change; two data bytes per mapping.
- Byte fields accept `>n` / `<n` ranges and the word `any`.
- Capture button per command: listens for the next compatible incoming message and assigns it ("Waiting…" shown; click again to cancel).
- Docs warn that `any` velocity with Note On double-triggers on devices that send Note On velocity 0 as Note Off.
- "Use MIDI Show Control" checkbox with a workspace MSC Device ID (0–126); also answers device ID 127.
- Responds to MSC in categories Lighting (General), Sound/Audio (General), Video (General).
- MSC in: GO (plain GO), GO {cue} (start that cue, playhead not moved), STOP (pause all) / STOP {cue}, RESUME / RESUME {cue}, LOAD / LOAD {cue}, ALL_OFF (panic/stop all), STANDBY+/- (playhead next/previous), SEQUENCE+/- (next/previous cue sequence), RESET (workspace reset; with a cue number resets that cue).
- MSC cue numbers are matched as exact strings (`1` ≠ `1.0`).
- MIDI channel and MSC device ID are independent of each other.
- Workspace MIDI/OSC playback controls act on the active cue list or cart; "all" commands and cue triggers work in every list (https://qlab.app/docs/v5/fundamentals/cue-carts/).
- Per-cue MIDI trigger (Triggers tab): Note On/Off, Program Change, Control Change with bytes, `>`/`<`/`any`, Capture; channel = workspace channel, a specific channel, or any; pitch bend cannot be a trigger (https://qlab.app/docs/v5/fundamentals/inspector/).
- Light Dashboard MIDI tab: map incoming MIDI to instrument/group parameters, a "selected" row (whatever is selected in the Dashboard), a subcontrollers row; own Light MIDI channel (follow workspace, specific, any); Capture; command filter.
- "Send MIDI feedback" for the Light Dashboard so motorised faders follow.
- Docs recommend only iConnectivity, Kenton or ESI MIDI interfaces for show-critical use.

## 14. Workspace OSC controls (Workspace Settings ▸ Controls ▸ OSC)
https://qlab.app/docs/v5/fundamentals/workspace-settings/ (Controls)

- For devices that cannot send custom OSC: assign any incoming OSC message to each workspace command in a table (GO, Panic, Load, … — list is a screenshot).
- Type/paste the message or use Capture to learn the next incoming OSC message.
- Requires OSC access to be enabled; from QLab 5 these custom messages work with passcode-protected workspaces too.

## 15. Keyboard controls (Workspace Settings ▸ Controls ▸ Keyboard)
https://qlab.app/docs/v5/fundamentals/workspace-settings/ (Controls) · https://qlab.app/docs/v5/general/keyboard-shortcuts/

- Per-workspace remappable shortcuts for core control and editing commands; saved with the workspace.
- Defaults: GO space; Preview Selected V; Audition GO ⌥space; Audition Preview ⌥V; Load Last Selected L (playhead jumps there); Panic Selected S (double-tap = hard stop); Pause/Resume Selected P; Pause All [; Resume All ]; Panic All escape.
- Editing defaults: cue number N, name Q, notes O, target T, cycle target type ⌥T, pre-wait E, duration D, post-wait W, cycle continue mode C, flag/unflag F.
- Shortcuts may include ⌘ ⇧ ⌃ ⌥ modifiers; a shortcut can be removed; QLab does not prevent duplicates.
- Escape is fixed: single press = panic, double press = hard stop; cannot be reassigned.
- Up/down arrows cannot be shortcuts; left/right can.
- With "always audition" on, GO/Preview shortcuts become Audition GO/Preview; this does not affect MIDI, MSC, OSC or AppleScript commands.
- Double-GO protection ("minimum time required between each GO"): applies to click, GO key, and workspace MIDI/MSC/OSC GO; not to cue triggers or AppleScript; red border and flash feedback.
- "Require a key up before re-arming GO" (keyboard GO only).
- Per-cue hotkey trigger: any free key or modifier combination starts that cue regardless of playhead; cannot use Esc, up/down arrows, bare modifiers, or keys taken by Controls ▸ Keyboard (https://qlab.app/docs/v5/fundamentals/inspector/).
- "Second trigger on release" (hotkey, MIDI trigger, or cart): releasing the key/note acts as a second trigger — sampler-style hold-to-play.
- Wall clock trigger: start a cue at a time of day, optionally only on chosen weekdays (AM/PM or 24-hour).
- Toolbox order determines the ⌘-number shortcuts for creating cue types.

## 16. Override Controls
https://qlab.app/docs/v5/tools/override-controls/

- Window ▸ Override Controls (⇧⌘O): temporarily suspend input and/or output per signal type.
- Independent input and output overrides for: "Musical" MIDI voice messages, MSC, MIDI SysEx, network messages to/from other devices, network messages within QLab / to other software on the same Mac, timecode.
- Art-Net and USB DMX: output override only (QLab does not accept incoming Art-Net/DMX).
- Input override engaged → red message in the workspace footer.
- Output override engaged → affected cues show a red circle in the status column and a non-breaking warning.
- Overrides are global to the application (all open workspaces).
- Controllable by OSC (`/overrides/…`), AppleScript (`overrides` of application) and Stream Deck ("Set overrides").

## 17. Timecode cues (out)
https://qlab.app/docs/v5/networking/timecode-cues/

- Generates MTC or LTC; any number of simultaneous independent timecode streams, each its own cue. **[licence: any]**
- MTC: choose a MIDI patch (no channel).
- LTC: choose an audio output patch and an output channel; channel defaults to 0 (invalid) as a safety so it must be set on purpose.
- Frame rates: 24, 25, 30 drop, 30 non-drop, and video-speed 23.976, 24.975, 29.97 drop, 29.97 non-drop.
- Start time field (first frame sent); optional End time; duration editable from Basics / cue list and kept in step with end time.
- With an end time/duration the cue stops itself; without, it runs until stopped.
- LTC is clocked by the audio device (no drift against that device); MTC by the computer's internal clock.
- Broken states: no/incomplete MIDI patch, no/bad audio patch, invalid output channel, licence required.
- Docs advise preroll and using hour 1 as the timeline start.

## 18. Incoming timecode (chase / triggers)
https://qlab.app/docs/v5/networking/using-timecode/ · https://qlab.app/docs/v5/fundamentals/cue-lists/ (Timecode tab) · https://qlab.app/docs/v5/fundamentals/inspector/ (Triggers)

- Enabled per cue list or cart: "Sync cues in this list to incoming timecode". **[licence: audio, video or bundle]**
- Sync source: MTC (pick a MIDI device) or LTC (pick an audio device and input channel); VITC not supported.
- SMPTE format (frame rate) selected per list.
- View button opens the Timecode Status window; a text status shows incoming timecode or "waiting…".
- Per-cue timecode trigger: a checkbox and a time, entered as timecode `h:m:s:frames` or real time `h:m:s.decimals`.
- Capture button records the currently incoming frame as the trigger.
- A trigger set while timecode is running becomes active only after timecode stops and restarts.
- QLab 5 chases: cues can start mid-way according to incoming timecode and follow jumps ahead or back.
- On Start options: do not start cues that precede the timecode (but cues that should still be running start part-way in); start cues since the most recent minute; since the most recent hour; cues preceding by a custom X seconds (lookback); start all preceding cues.
- A cue whose duration ended before the lookback point is never started.
- On Stop options for timecode-triggered cues: pause, stop, or keep running.
- Freewheel time 0–2 s: dropouts shorter than this are ignored.
- Different lists can sync to different timecode sources at once.

### Timecode Status window
https://qlab.app/docs/v5/tools/timecode-status-window/

- One window for all incoming and outgoing timecode across open workspaces; empty when nothing is configured.
- Incoming: each syncing list shown with workspace, LTC/MTC, input, running icon and current timecode; "waiting" state.
- Freewheel shown as an elapsing disc: red (will stop), yellow (will pause), grey (do nothing).
- Outgoing: every running Timecode cue listed.
- Show buttons open a large resizable timecode monitor (most recently started incoming / outgoing stream).

### Timecode Tools (downloadable utility cues)
https://qlab.app/docs/v5/tutorials/timecode-tools/

- Capture incoming frame as the selected cue's trigger.
- "Capture and GO": capture triggers while running cues.
- Export timecode triggers to CSV; import triggers from CSV.

## 19. Script cues and AppleScript
https://qlab.app/docs/v5/scripting/script-cues/ · https://qlab.app/docs/v5/scripting/applescript-dictionary-v5/ · https://qlab.app/docs/v5/scripting/examples/

- Script cue runs AppleScript from inside the cue list; AppleScript is the only scripting language documented. **[licence: any]**
- Script tab: text editor with AppleScript formatting, Compile Script button, inline error message.
- New Script cues start with the default script from the Script cue template.
- All Script cues are compiled when the workspace opens; hold ⌃⌥ while opening to skip.
- "Run in separate process" (default on): script runs in an invisible helper so long scripts do not block QLab; unchecking runs inside QLab for tighter timing.
- Broken states: script empty, AppleScript error, not compiled, licence required.
- Scripts can also be run from outside (Script Editor etc.), addressing `application id "com.figure53.QLab.5"`.
- Dictionary classes: application, workspace, cue, cue list, group cue, audio, mic, video, camera, text, light, fade, network, midi, midi file, timecode, script, devamp, load, reset, target cues, light dashboard, override controller.
- Application: `overrides`, `preferences`, `version`; elements workspace/document/window; open, quit.
- Workspace properties: active cues, selected (get/set), current cue list, current light dashboard, edit mode, show mode, always audition, live fade preview, inspector visibility, unique id.
- Workspace commands: go, audition go, start, stop, hardStop, pause, panic, reset, load (to time), make (new cue), move, delete, movePlayheadUp/Down (and …ASequence), moveSelectionUp/Down, undo, redo, save.
- Cue commands also include preview, audition preview, capture timecode, collapse/expand, compile, shuffle, setLevel/getLevel, setGang/getGang, setMute/getMute, setSolo/getSolo, set/getInputChannelName.
- Light dashboard commands: setLight, clear, revert, prune, newCueWithAll, newCueWithChanges, recordAllToLatest/Selected, updateLatestCue/OriginatingCues/SelectedCues, collateAndStart, replaceLightCommand, removeLightCommandsMatching.
- Cue properties scriptable: number, name, notes, colours, armed, flagged, autoload, continue mode, pre/post wait, duration (read) and temp duration, cue target, file target, parent / parent list, running / paused / loaded / broken, elapsed times and percentages, cart position, skip if disarmed.
- Trigger properties are scriptable only in AppleScript beyond what OSC offers: hotkey trigger on/off; MIDI trigger on/off, command, bytes, channel; wall clock trigger hours/minutes/seconds; timecode trigger fields and "show as timecode".
- Cue list properties: playhead / playback position, sync to timecode, sync mode, MTC source name, LTC channel, SMPTE format, start/stop behaviours, current timecode text.
- Network cue properties: parameter values, parameter fades enabled, fade type/from/to/fps/number type, fade entries, path width/height/loop/smooth, network patch id/name/number.
- Script cue property `script source` get/set — a script can rewrite another Script cue; it recompiles on set.
- Override controller: every input/output override plus window visibility.
- Elements addressable by name, index, range, whose/where filters and unique ID.
- Cookbook examples (batch edits): set the main level of all selected cues; disarm a cue by number; create a cue and move it into a group with a dialog prompt; create fade-in cues for every selected audio/video/text cue.
- Cues created by OSC, AppleScript or paste are not auto-numbered.
- GO via AppleScript bypasses double-GO protection.
- Parameter reference lists script indexes for MSC commands, MSC command formats, video blend modes and video effects (https://qlab.app/docs/v5/scripting/parameter-reference/).
- No Shortcuts app actions, URL scheme, JavaScript or other scripting language are mentioned in the sections read.

## 20. Collaboration (multi-user editing)
https://qlab.app/docs/v5/networking/collaboration/ · https://qlab.app/docs/v5/fundamentals/workspace-settings/ (Collaboration)

- Several people on several Macs work on one workspace live over the local network; the host is the "primary", others are "remotes".
- Discovery by Bonjour; works over wired, Wi-Fi and VPN (rule of thumb: if file/screen sharing works, so does this).
- Connect from the Launcher's "Connect to Workspace", File ▸ Connect to Workspace…, or ⇧⌘K; a list of available workspaces appears.
- Three permissions per collaborator: Connect & View (may flag/unflag and edit notes only), Edit (all cue parameters and workspace settings, no transport), Control (start/stop/pause/resume and move the playhead, no editing).
- Primary settings: "Allow Collaboration connections" (unchecking disconnects everyone at once); "Ask before allowing a new collaborator to connect"; "When in Show Mode, restrict all collaborators to view-only".
- New-collaborator prompt on the primary: accept with default permissions (return), accept with a specific permission set, or reject.
- Once accepted, a remote reconnects later without approval.
- Collaborator table: default-permissions row, then one row per collaborator (Collaboration Name, Machine ID, IP) with editable permission checkboxes; disconnect, or disconnect-and-forget.
- Collaboration Name is set in QLab Preferences ▸ General (defaults to the macOS user name).
- **[licence]** Unlicensed primary: licensed Macs connect with any access but behave as unlicensed; unlicensed Macs get view only.
- **[licence]** Licensed primary: each licence on the primary lets one unlicensed Mac connect with any access; licensed Macs connect with any access; further unlicensed Macs view only.
- **[licence]** Every collaborator behaves according to the primary's licences while connected.
- Remote window is marked: purple title bar with "Remote", purple GO border, footer icon with current permissions (click for primary's IP and details).
- Collaboration column in the cue list: a coloured dot per collaborator on the cue each has selected.
- Inspector tabs show a coloured indicator for the tab another collaborator is viewing on the same cue.
- Selection is per collaborator (unlocked from the playhead by default); the playhead is shared.
- A control-permission remote moves the playhead by clicking the status column or pressing L; optional per-remote "lock playhead to selection".
- Edits are last-edit-wins.
- Undo history is per collaborator for cue lists and carts; one shared history for the Light Dashboard; one shared history per settings area.
- Creating, deleting and moving cues cannot be undone while collaborating (QLab explains when it happens).
- File targets from a remote: a collaboration file browser showing only the primary's workspace folder and subfolders, filtered to valid file types; the primary must have been saved once.
- Cues always run on the primary; a remote's GO or preview is executed there.
- Audio effects can be edited remotely from 5.4 if the effect is installed on both machines.
- Error messages: Access Denied, Action Rejected (no control), Change Rejected (no edit), Connection Rejected, View Permission Disabled.

## 21. QLab Remote (iOS / iPadOS)
https://qlab.app/docs/v5/networking/qlab-remote/

- iOS app (iPhone, iPad, iPod touch; iOS 15+); works with QLab 3, 4 and 5 (QLab 3 unsupported).
- **[licence]** Free app; Read-Only mode is free: view the cue list, edit notes and flags only.
- **[licence]** In-app purchase "Show Control & Editing": run cues, move the playhead, edit cue parameters, adjust video stage geometry.
- **[licence]** In-app purchase "Light Tools": Light Keypad and Light Instrument Check; does not need the other purchase.
- **[licence]** Editing video stages needs a Video or Bundle licence in QLab.
- Connection: same network with ports 53000/53001 (or the workspace's custom OSC port) open, or a USB cable; Bonjour discovery; manual IP entry ("Other").
- Requires OSC access on in the workspace; passcode keypad on connect, with a "No passcode" option when allowed.
- Encrypted network communication with QLab 5.
- Recovers from brief disconnections and reconnects to the same Mac.
- Main screen: GO button, standby indicator, notes field, reset all / pause all / resume all / panic all, and the cue list.
- Swipe right on a cue to move the playhead; swipe left or double-tap to edit; long-press and drag to reorder.
- Cue carts: tap to start, two-finger double-tap to edit, two-finger long-press to move a cue to another cell, pinch to zoom.
- Workspace actions: show/hide toolbox (add new cues), Save, Undo, Redo, lock playhead to selection, enable/disable Read-Only mode, Edit Stages, Load to time…, Disconnect, preferences (log level, text size), contact support with logs.
- Load To Time tool as in QLab.
- Resize Controls: enlarge, shrink or hide the GO button, transport controls and footer.
- Cue Lists menu switches lists and carts; Active Cues view with progress bars.
- Editing: basics of any cue; audio levels; video geometry (surface, rotation, etc.); light levels; fade cue absolute/relative mode and per-level activation; triggers and second-trigger options; assign file targets to audio and video cues.
- Audio levels set from Remote are validated against the workspace's minimum volume limit.
- Edit audio output maps (QLab 5.5+), with heatmap shortcuts.
- Audition GO and audition preview (QLab 5+).
- GO from Remote is subject to double-GO protection; Remote respects Show/Edit mode; shows override status indicators.
- Light Keypad: the Dashboard's command line (iOS or hardware keyboard), "over time" fade field (sneak), instrument/group picker, parameter picker in fixed columns (intensity, colour, beam, custom), keypad with cue/pass/home keys, record and update buttons, revert, clear all, jump to cue.
- Light Instrument Check: steps through each instrument and group at 100%, 50% or 10%, from home.
- Hardware keyboard shortcuts: GO space, Preview V, Audition GO ⌥space, Panic escape or backtick, toolbox ⌘K, Load to time ⌘T, Active Cues ⌘L, Save ⌘S, Undo/Redo, Edit Stages ⌘,, Disconnect ⌘W; hold ⌘ to list them.
- iPad Split View and multiple windows; some features only when screen space allows.

## 22. Stream Deck
https://qlab.app/docs/v5/networking/stream-deck/

- Official QLab plugin (v1.0.0.1) for Elgato Stream Deck software 6.4+, macOS 10.15+; all Stream Deck models, encoders on Stream Deck Studio slightly limited.
- Talks OSC to QLab; cannot send a passcode, so no-passcode permissions must be enabled for the actions used.
- Every action has Address and Port (default 127.0.0.1:53000), so one deck can drive QLab on any Mac on the network.
- Key actions — workspace transport: GO, Audition GO, Panic, Pause All, Resume All, Reset All.
- Key actions — selected cue transport: Preview, Audition Preview, Panic, Hard Stop, Pause, Resume, Pause/Resume toggle, Reset, Load.
- Move selection (previous/next); move playhead (previous/next cue or cue sequence).
- Start a cue by number or OSC wildcard pattern, with a key colour.
- Create a new cue of a chosen type; set continue mode; set cue colour or second colour; flag/unflag/toggle; auto-load on/off/toggle; arm/disarm/toggle.
- Capture timecode (as the Triggers tab button); add slice marker.
- Bump/reset rate; bump/reset a level crosspoint (row/column); mute/solo an output.
- Video bumps: layer, crop per side, opacity, translation/scale/anchor per axis, rotation per axis; smooth on/off; lock scale axes; reset a geometry parameter.
- Workspace toggles: lock playhead to selection, live fade preview, show mode, fullscreen, audition monitor windows, Light Dashboard, Override Controls window.
- Set overrides (any override on/off/toggle).
- Custom OSC message (Network-cue syntax).
- Dial actions: Selection (rotate to move, press to move playhead there); Playhead (rotate, press to lock/unlock to selection, tap for by-cue/by-sequence).
- Dial: Load to time (rotate to scrub; press cycles 1 / 0.1 / 0.01 s per tick; tap picks selected / playhead / active cues; hold resets to 0).
- Dials for Duration, Pre-wait, Post-wait, Start time, End time, Rate, Level (crosspoint, 1 or 0.1 dB), Layer, Opacity, Translation, Scale, Rotation, Anchor, Crop — rotate to change, press for resolution, hold to reset.
- Bitfocus Companion and Go Button 3 appear as Network cue device descriptions (QLab driving them), not as input integrations.

## 23. Status, logs, warnings
https://qlab.app/docs/v5/tools/workspace-status-window/ · https://qlab.app/docs/v5/general/qlab-preferences/

- Workspace Status window with six tabs: Warnings, Logs, Triggers, Art-Net, Video Metrics, Info.
- Warnings: broken cues, flagged cues, non-breaking warnings, breaking warnings, disconnection warnings (missing hardware/software).
- A broken cue in a sequence does not play but still runs its pre-wait, duration, post-wait and continue so the sequence stays intact.
- Inspect Cue button jumps to the cue; for settings warnings the button opens the right settings tab; Open Help… opens the relevant manual section.
- Hide individual warnings; "Show hidden" checkbox.
- Logs tab, four switches: cue triggers (including GOs blocked by double-GO protection), MIDI input, OSC input, OSC output (Network cues, broadcast, replies).
- Log filter field; the four switches are saved with the workspace from 5.5.
- Triggers tab: one sortable table of every cue trigger and workspace control; Edit jumps to the cue's Triggers tab or the Controls settings.
- Info tab: workspace ID (for OSC/AppleScript) and machine ID (for licensing).
- Preference: debug logging level 0–3 to the macOS system log (OSC/MIDI detail from level 1; timecode and MSC handling at level 3).
- Preference: "Log media playback" writes a CSV of audio/video playback for rights reporting.

## 24. Art-Net and network interface selection
https://qlab.app/docs/v5/general/qlab-preferences/ (Hardware) · https://qlab.app/docs/v5/tools/workspace-status-window/ (Art-Net) · https://qlab.app/docs/v5/lighting/light-patch-editor/

- Art-Net network interface: Automatic or a specific interface, set app-wide in QLab Preferences ▸ Hardware.
- "Use broadcast mode for Art-Net": for nodes without polling support and for other Art-Net software on the same Mac; off reduces traffic.
- Workspace Status ▸ Art-Net tab: scans the network (when the workspace has at least one instrument) and lists discovered nodes with name, IP and output info.
- Each instrument is patched to Art-Net (universe / sub-net / net) or to a USB DMX device (device + universe).
- QLab sends Art-Net and USB DMX only; it does not respond to incoming Art-Net or DMX.
- Network cue patches choose their own interface per destination (see section 3).
- **[licence]** More than 16 patchable DMX addresses needs a lighting licence.

## 25. Related tools in these sections
https://qlab.app/docs/v5/fundamentals/group-cues/ · https://qlab.app/docs/v5/fundamentals/cue-carts/ · https://qlab.app/docs/v5/tools/tools-menu/ · https://qlab.app/docs/v5/general/new-in-qlab-5/

- Timeline groups: all children start together; a Timeline tab shows each child as a lane with icon, number, name, colour, slices, loop counts and fade curves.
- Timeline editing: drag to change pre-wait with snapping to other cues' starts/ends/slices and to the current playback time (⌘ disables snapping); nudge ⌥←/→ 0.1 s and ⇧⌥ 0.01 s; trim start/end; slip (⌥) for unsliced audio/video; per-lane and whole-view vertical scale; pin cues to the top; preview the selected cue; zoom.
- Record Cue Sequence: play cues by hand and QLab writes a group of Start cues with the recorded timing (Timeline group, or Start-First group with auto-continues).
- Cue carts: grid from 1×1 to 15×15; no playhead, no auto-continue/auto-follow, no Group cues; unlimited carts; three cell sizes; cart in its own window; in a cart, clicking a cell starts the cue.
- Carts can sync to incoming timecode and their cues take hotkey, MIDI, wall-clock and timecode triggers like any cue.
- Live fade preview is per workspace (from 5.4) and applies to Fade cues and 2D Network cues.
- Audition: each output category (audio, video, MIDI, MTC, LTC, network, light) can audition to the usual output, no output, or an alternate patch.
- "When workspace opens, start cue number" and "Before workspace closes, start cue number" hooks; preference to prompt before the open cue; ⌃⌥ while opening skips it.
- Show-file compatibility: QLab 5 opens/converts QLab 4 workspaces (video-related OSC and Script cues from v4 usually need revising; DS100 background images must be reconnected); QCart files are not imported directly.
- "Save workspace and media to a new project folder" copies targets so a show moves between machines whole; fonts and AudioUnits are not copied.

---

## Coverage notes

- Read in full: Network Cues, MIDI Cues, MIDI File Cues, Timecode Cues, Using OSC, Using MIDI & MSC, Using Timecode, Show Control Broadcast, Collaboration, QLab Remote, Stream Deck, OSC Queries, Script Cues, Override Controls, Timecode Status Window, Workspace Status Window, Cue Carts, Timecode Tools, Zero To Network, and the Controls / Collaboration / Network / MIDI / Light Dashboard MIDI / General sections of Workspace Settings.
- OSC dictionary (1,214 method headings): read in full for the introduction, application, workspace, show control broadcast, Network / MIDI / MIDI File / Timecode / Script / Reset / Devamp cue sections; method names only for the general cue, group/list/cart, light and fade sections (a few bodies spot-read); audio, mic, video, camera, text cue sections and the ~345 `/settings/audio|video` methods were not read (other areas).
- AppleScript dictionary: read the intro, command list, and the application, workspace, cue, cue list, network cue, script cue and override controller classes; other classes by name only.
- OSC & Scripting Examples: all four examples read; the long line-by-line commentary was skimmed.
- Read in part (relevant sections only): Inspector (Triggers tab), Cue Lists (Timecode tab), Group Cues (Timeline), Licenses, Features by License, Preferences, Tools Menu, Managing Workspaces, New in QLab 5, Keyboard Shortcuts, Light Patch Editor, Basic Networking tutorial (ETC address table only).
- Not recoverable as text: the Features-by-License tick marks, and the command lists in the Controls ▸ Keyboard, Workspace MIDI and OSC tables (all screenshots or icons).
- The change log page was only keyword-searched, not read.
- No page failed to load.
