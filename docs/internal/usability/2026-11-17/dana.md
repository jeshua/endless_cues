# Dana, stage manager: usability report

**Verdict: with workarounds.** "I built the whole evening in an afternoon without asking anyone, and the top of the screen always told me what GO would do next, including 'then, when it ends: 6 · Lantern'. What holds me back is Show mode: I could pull the Master fader to silence with a small slip, and then the app refused to let me put it back until I left Show mode. I'd tour with it, but I'd be nervous with my hand near that fader."

Ratings (1 bad, 5 good): learn 4 · speed 4 · clarity 4 · trust 3

## Tasks

| Task | Outcome | Notes |
|---|---|---|
| build | done | Start from a folder, then "Make cues from these 7 sounds" in the Assistant drawer, then Accept. Cues came out numbered 1 to 7 and named from the files. I didn't expect the drawer step. |
| house | done | Time & Loops ▸ Whole sound loop. A new Fade cue already targeted House music, to -inf, with stop on; I only typed 8. |
| trim | done | Start · End 0:12 to 0:40, Fade out 5. Checked in the run: started at 0:12, the fade began at 0:35, silent at 0:40. |
| follow | done | Driftwood on auto-follow, Lantern with a 3 s Pre-wait. It worked in the run. |
| level | done | Level -4 on the Audio tab. hear: "Salt at -4.0 dB". |
| save | done with trouble | Saved and reopened intact, but the show had been put inside the music folder as "tour music" without me choosing. |
| rehearse | done | Load to Time 0:30, twice. Clear, and it remembered the time. |
| perform | done with trouble | The whole evening ran right in Show mode, but the Master fader can still be moved there. |
| help | done | Help ▸ Keyboard Shortcuts: Space, Esc, ↑ (or "-"). |

## Findings, worst first

### Major: in Show mode the Master fader can be dragged to silence, but its reset button is refused (bug, show-mode)
In Show mode, with Bows playing, an 84 px drag on Master took it to "−∞" and a 34 px drag took it to "−20". "Save · 1" appeared, so the show itself had changed while "editing is locked". Clicking ↺ ("Put back to 0") only brought up a toast, "Show mode: editing is locked", and the fader stayed at −20. To fix it I had to switch to Edit. (069.png)
Steps: click Show, GO a sound, drag Master a little to the left, click ↺.

### Minor: Start from a folder puts the show inside the music folder, named after it, without asking (confusing, files)
The title became "tour music" and Save was already "Saved". show.json and a logs folder were added among my WAVs. I never chose a name or a place.

### Minor: Start from a folder makes no cues; they are offered in the Assistant drawer (confusing, import)
The button's hint says "A folder of sounds becomes the show", but the list said "No cues yet". The cues were offered in the Assistant drawer, and I had to accept a "Proposed change". It worked, but the word "Assistant" made me wonder whether it was the paid AI. (003.png, 004.png)

### Minor: the inspector is a short strip, so most fields need scrolling (confusing, inspector)
The loop switch and Level were below the visible area. "▸ More" rearranges the fields, so Pre-wait wasn't where I had left it on the next cue. Most of the window above was an empty cue list. (006.png, 030.png)

### Polish: music tracks go on the "Effects" bus by default (wording, audio)

### Polish: Show mode leaves Edit one click away with no confirmation, and hides Reset (show-mode)
Clicking Edit mid-cue unlocked straight away. With "Reset" gone, I clicked row 1 to go back to the top.

## What worked well
- **The Standing by line**: "then, when it ends: 6 · Lantern" told me exactly what GO would do.
- **The Fade cue**: added under House music, it was already a fade-out and stop of that cue.
- **Load to Time**: "LOADED TO 0:30.0 · this GO only", and it remembered 0:30 for the next run.
- **Skipping in Show mode**: clicking the waveform only sets a mark; nothing moves until I click Skip.
- **Help ▸ Keyboard Shortcuts**: the keys I needed were found in one step, in plain words.
- **Reopening**: after closing and reopening, every setting was as I left it.

## Rig
- Quit is not available from the app menu in a test session, so I used the rig's stop and start.
- hear ignores the Master fader: with Master at −∞ it still reported 0 dB.
- Windows, the reason Dana came, could not be tried: the session runs on a Mac.
