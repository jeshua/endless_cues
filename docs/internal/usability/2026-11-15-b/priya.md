# Priya: The Glass Orchard, from QLab to Endless Cues

**Verdict: with workarounds.** "The sound side I would run tonight. The import told me the truth cue by cue, the rain, the dip and the phone behaved exactly as in QLab, and the standby line always said what GO would do. What stops it being a plain yes is the one cue that leaves the computer: I retyped the MSC GO by hand in a syntax I guessed, and the manual itself says MIDI has not been checked against real equipment. So the LX operator takes that cue on their own GO until I have seen the desk respond. About an hour of my evening, not the whole of it."

Ratings (1 to 5): learn 4, speed 4, clarity 5, trust 3.

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| bring | done | One button, one file dialog, a report of six things that did not come across, by cue number, each with what to do. 24 cues, 2 lists, all files found. |
| verify | done | Rain loops at -12 dB; cue 3 dips it to -22 under the thunder and returns it after 6 s; cue 5 stops the phone. |
| repair | done with trouble | Playlist settings re-entered. The preshow fade had in fact come across and worked untouched. MSC rebuilt as a MIDI cue by guessing `msc go 9`; unproven on a desk. Act 2: dragged the second child out as cue 12.5. Blackout: an empty Group with "Fade & stop others" 3 s. Hotkey and cart: not possible. |
| notes | done with trouble | All six done, mostly one field each. One slip: Cmd+A outside a field selected every cue and I numbered all of them -10; one Undo fixed it. |
| save | done | Cmd+S made a `.ecshow` folder with `media/` holding all ten sounds in use, including `letter v2.wav`. |
| run | done | Show mode locked editing. Fired 6.5 a cue early; Up arrow put the playhead back, the rain bed untouched. |
| undo | done with trouble | Undo was empty after saving and Versions had only v1 with all the notes in it. Deleted 6.5 by hand, saved v2 "6.5 cut". |

## Findings, worst first

**Major**

1. **The MSC cue is not read from QLab, and MIDI is untested on equipment.** The report says "its message is not read from QLab yet; kept as a Memo". The memo does not carry the original message's fields. The manual: "MIDI is new and has been checked against the specification, not yet against equipment." The Network panel showing `→ msc go 9 [F0 7F 7F 02 01 01 39 F7] (MIDI)` is the only proof on offer. (003.png, 022.png, 064.png)

**Minor**

2. **The MIDI inspector is one empty text box.** Red bar "No midi message." over a blank "MIDI message" field: no placeholder, no example, no pop-ups. I guessed, then read the manual. (022.png)
3. **Undo is emptied by Save.** After Cmd+S the Undo button is disabled. With one save holding all six notes, there was no way back to "before 6.5" except deleting by hand. (069.png)
4. **After Delete the list jumps to the top and nothing is selected.** Three times out of three; the last time the playhead ended on 0.5. (032.png)
5. **No "Start first and enter" group.** Said plainly in the report, but the fix is manual: drag the child out and number it. No right-click menu, no ungroup. My first drop landed one row too low.
6. **Hotkey triggers and cue carts are not there.** Both reported honestly; I can live without them for this show.
7. **With every cue selected, a Number typed in the inspector goes onto all of them without asking.** I got there by a missed click (the "Number 6 is used twice." bar had moved the fields down) and Cmd+A. Seen once; partly my blind hands.

**Polish**

8. **A second GO straight after the first is ignored with no sign of it.** Probably a double-GO guard; I never set one. Could be the rig.
9. **Target column is empty for audio cues.** QLab shows the file there, which is how I scan a list for a wrong file.

## What worked well (do not break these)

- **The import report.** Six plain lines, cue number first, each with what it was and what to do, and the same words left in the cue's notes so they show on the standby line. "The QLab file is not changed."
- **The standby line.** "DISARMED — THIS GO WILL SKIP IT", "and with it, on the same GO: 8 · Underscore out", "then 6.5 · Door, memory". Active cues showed "−22 → −12 dB" while the rain came back. (064.png)
- **Save.** One folder, sounds inside, first time, no collect step; the unsaved-changes chip and the dots on changed rows told me what was not yet kept.
- **The QLab keys.** Space, Esc, V, Up, Cmd+C/V, Delete, Cmd+S all did what my hands expected. Recovery from an early GO was one key.
- **Fade & stop others on a group** did the 3 s blackout exactly; a fade aimed at the playlist group took the preshow out and stopped it.

## Rig

- A warning bar or a different group mode moved inspector fields down a row and two coordinate clicks missed; a person looking would have seen it.
- Click-by-name with `--nth` chose a different row than the one listed first.
- `hear` shows a fading sound at its starting level "(fading to -60 dB)", so only the end of a fade could be checked.
- MIDI could be checked only by the bytes in the app's own Network panel.
- The app could not be seen on Windows, which is why Priya is here.
