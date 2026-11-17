# Dana: stage manager, dance tour

**Verdict: with workarounds.** I built the whole evening in one sitting and the run went as the notes ask, so yes, I could tour on this. But twice it frightened me: my tracks vanished until I saved, and the house fade showed no fade until I typed in a level it already seemed to have. I would rehearse every cue before trusting it in front of an audience.

Ratings (1 to 5): learn 3, speed 4, clarity 4, trust 3.

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| build | done-with-trouble | Seven files added in one go, but the list stayed empty until I saved the show; numbers typed then Tab were lost and had to be redone with Enter. |
| house | done-with-trouble | Loop found on the Audio tab after looking in Time & Loops. The fade cue needed its target chosen and its To level typed before it reported a real fade. |
| trim | done | Start at 12, End at 40, Fade out 5 on one line; duration became 0:28.0 and it played from 0:12. I could not check the fade-out itself (rig). |
| follow | done | auto-follow plus Post-wait 3; confirmed in the run: 3 seconds of silence, then Lantern with no GO. |
| level | done | Level -4 on the Audio tab; plays at -4.0 dB. Not visible in the list. |
| save | done | Saved as Tides tour.ecshow on the desk (it copies the music in). Reopening the app brought the show back exactly. |
| rehearse | done | Load to Time 0:30, GO, stop, and again. Works only in Edit mode. |
| perform | done | Show mode locked delete and rename. House loop, 8 s out, Tide, Salt at -4, Undertow from 0:12, Driftwood into Lantern, Bows all sounded as expected; moved on with the Active cues bar "Click to skip there". |
| help | done-with-trouble | No Help menu; found Settings > Keys: GO Space, Panic Esc (again: stop dead), playhead ↑ ↓. |

## Findings, worst first

### [major, bug] Sounds added to a new, unsaved show do not appear in the cue list until the show is saved

Task: build. Area: import.

**Expected:** After New show > Audio > choosing seven files, seven cues in the list, as QLab does on an untitled workspace.

**Happened:** The top bar said "7 unsaved" and Undo read "Undo add 7 sounds", but the list still said "No cues yet" and the footer "0 cues". A second try with one file gave "8 unsaved", still "No cues yet". Only after Save (to a folder on the desk) did all eight rows appear at once, including the duplicate "01 Tide-2" I then had to delete. Nothing on screen said a save was needed.

**To see it:** Start the app. New show. Click ♪ Audio, choose any wav. Look at the list: "No cues yet", chip says "1 unsaved". Save the show to a folder: the cue appears. (Seen twice in one session: 7 files, then 1 file.)

**Suggestion:** Show the cues at once in an unsaved show, or ask for a folder before the first sound is added.

Evidence: shots/004.png

### [major, bug] A Fade cue with To level left as the grey "-inf" does not fade: it holds the level, then cuts

Task: house. Area: audio.

**Expected:** The To level box shows "-inf", so I took it as already set to fade to silence over my 8 seconds.

**Happened:** With target House music, Duration 0:08.00, Stop target when done on, and To level untouched, `hear` reported "House music at 0.0 dB (fading to NaN dB)" through the whole 8 seconds, then "Silence." After I typed -inf into the box myself it reported "fading to -60 dB". I cannot hear the rig, so I am not certain the sound really stays at full level, but the target is "NaN" until the box is typed in.

**To see it:** Add an audio cue, add a Fade, choose the audio cue as Target, set Duration 8, leave To level alone. GO the audio, GO the fade, hear: "fading to NaN dB". (Run three times.)

**Suggestion:** Make the shown -inf the real default value.

Evidence: shots/020.png

### [minor, bug] A cue Number typed and left with Tab is thrown away, and the old text stays in the box for the next cue

Task: build. Area: inspector.

**Expected:** Type the number, Tab to Name, type the name: both kept. That is how every form works.

**Happened:** Typed 0, Tab, typed "House music", Enter. The name was kept, the NUMBER column stayed blank though the box still read "0". Selecting the next cue and typing 1 made the box read "01"; again nothing in the list. Typing the number and pressing Enter does keep it.

**To see it:** Select a cue, click Number in Basics, type 1, press Tab. The list shows no number. Select another cue: the Number box still shows the 1. (Twice: cue 0 and cue 1.)

**Suggestion:** Keep a field's value when it loses the keyboard.

Evidence: shots/011.png

### [minor, bug] The row of the cue that is playing shrinks to a small tag at the left edge of the list

Task: perform. Area: cue-list.

**Expected:** The playing cue stays a full row, marked as playing, so I can see where I am in the running order.

**Happened:** With Bows playing in Show mode its row was a small box reading only "Bows" at the far left, with no number or time, where the other rows are full width. Seen in one picture; in the text the live row always sat at x=17 instead of with the others, so it may be every time.

**To see it:** Open a show in Show mode, GO the last cue, look at its row.

Evidence: shots/045.png

### [minor, confusing] Clicking the middle of a Fade row with no name does not select it; the inspector stays on the previous cue

Task: house. Area: cue-list.

**Expected:** A click anywhere on a row selects that cue and the inspector shows it.

**Happened:** I clicked the Fade row in its name area and went to the inspector to type the level. The inspector was still Tide's, and my "-inf" went into Tide's File box: "Its file is missing." Clicking the row near its left edge did select it. The unnamed Fade row shows an open name box that swallows the click.

**To see it:** Add a Fade and leave it unnamed. Select another cue. Click the Fade row around the NAME column. The inspector does not change.

Evidence: shots/030.png

### [minor, confusing] Load to Time does nothing in Show mode and says nothing

Task: rehearse. Area: show-mode.

**Expected:** Picking a track up from a time is a rehearsal thing I do with the show locked; or else a word saying it is not available.

**Happened:** In Show mode ⌘T and Tools > Load to Time… opened no bar and showed no message; only the footer "SHOW MODE — editing is locked". In Edit mode the same command works.

**To see it:** Switch to Show. Select an audio cue. Tools > Load to Time…. Nothing appears. (Tried by key and by menu.)

**Suggestion:** Allow it in Show mode, or grey the menu item.

### [minor, missing] There is no Help menu; the keys are under Settings > Keys

Task: help. Area: help.

**Expected:** A Help menu, or a ? on the window, with the keys and a link to the manual.

**Happened:** The menu bar is App, File, Edit, View, Tools, Window. I found the list by opening the ⚙ and trying "Keys". The list itself is good: "GO Space", "Panic (again: stop dead) Esc", "Move the playhead ↑ ↓". There is no entry called "back one cue"; I took ↑ to be it.

**To see it:** Look through the menu bar for help.

**Suggestion:** Add a Help menu with Keys and the getting-started page.

### [minor, confusing] Loop is on the Audio tab, not on the tab called Time & Loops

Task: house. Area: inspector.

**Expected:** The loop switch under "Time & Loops".

**Happened:** Time & Loops has a waveform, Markers and "Loop regions: None. A region is a stretch that loops cleanly…" with no button to make one and no plain loop switch. The Loop switch is on the Audio tab. Once on, the row gets a clear "loop" tag.

**To see it:** Select an audio cue, open Time & Loops.

Evidence: shots/016.png

### [minor, confusing] In Show mode a click on a row still moves the playhead, and Reset sits beside Panic

Task: perform. Area: show-mode.

**Expected:** Locked means a stray click cannot change what GO does next.

**Happened:** Show mode did stop Backspace deleting and double-click renaming. But one click on Undertow made it the standing-by cue, and "Reset" ("Stop everything; playhead to the top") is one button below Panic with no confirm that I saw. The mixer knobs stay live too.

**To see it:** Show mode; click any row.

Evidence: shots/041.png

### [polish, confusing] A new Fade has no target though it was added with the sound selected

Task: house. Area: inspector.

**Expected:** QLab targets the cue I had selected.

**Happened:** The Fade came in with ✕ and "No target."; I chose "0 · House music" from the list. Clear enough, one extra step. Choosing it also moved every field up a line, so my next click missed.

**To see it:** Select an audio cue, click ◢ Fade.

### [polish, confusing] The toolbar offers 17 kinds of cue, drawn so dim they look switched off

Task: build. Area: cue-list.

**Expected:** The three or four I know (Audio, Fade, Stop) easy to see.

**Happened:** Group, Audio, Fade, Stop, Start, Pause, Devamp, Load, GoTo, Arm, Disarm, Wait, Memo, Network, Light, Mix, Jump in dark grey on dark brown. "Devamp", "Arm", "Network" and "Jump" are not my words.

**To see it:** New show; look at the toolbar.

Evidence: shots/002.png

### [polish, missing] A cue's level is not shown in the list, and a follow is only a small arrow

Task: level. Area: cue-list.

**Expected:** To see from the list that Salt is at -4 and that Driftwood goes on by itself.

**Happened:** Salt's -4 dB is only in the inspector's Audio tab (and in Active cues once it plays). Driftwood shows "0:03.0" and a ⤓; standing by on it says "then 5 · Lantern" with no word that Lantern follows without a GO.

**To see it:** Set a level and an auto-follow; look at the list in Show mode.

Evidence: shots/041.png

## What worked well

- **Load to Time is exactly what a dancer's "from 0:30" needs.** Tools > Load to Time… (⌘T), typed 0:30, Enter: "LOADED TO 0:30.0" by Standing by; GO played Salt from 0:30 at -4 dB. The second time took four keys. It does not remember 0:30 from the last time.
- **The standing-by line and the save chip say what will happen.** "Standing by 0 House music — then House out" in large type; "9 unsaved" with the list of what; after saving "Saved v2 — … House out added …"; reopening the app brought the show back as left, playhead at the top. The ↺ "Put back to media/01 Tide.wav" rescued a field I had wrecked.
- **Auto-follow with a post-wait did what the choreographer asked, first time.** Continue: auto-follow, Post-wait 3 on Driftwood. In the run: Driftwood ended, "Lantern is waiting (0:02.3 of 0:03.0)", then Lantern played. Start at / End at / Fade out for Undertow were three boxes on one line and the row's duration became 0:28.0.

## Rig

- `hear` shows a cue's set level, not where a fade-out inside the cue has got to, so Undertow's 5-second fade out could not be checked.
- I ran well over the 150 actions (about 390 journal lines with looks, waits and hears): several clicks were sent in batches by position and missed after the layout moved, and had to be redone.
- The run was stopped and restarted once before the first task (the show's own app was open; the owner's go-ahead was relayed).
