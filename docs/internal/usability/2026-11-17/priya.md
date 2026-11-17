# Priya — The Glass Orchard

**Verdict: with workarounds.** Yes, I'd run tonight's tech on it on the Windows box, and probably the run after it. The import was honest about the MSC cue, the rain, thunder dip and phone stop played exactly as in QLab, and my notes took minutes. The lighting GO is the risk: I rebuilt it as a MIDI cue I've never heard reach a desk, and the blackout coming across as a "Memo that does nothing" made me trust it less than it deserved.

Ratings: learn 4 · speed 4 · clarity 4 · trust 3

| Task | Outcome | Notes |
|---|---|---|
| bring | done | Summary named the two losses (MSC cue → Memo, empty hotkey). Everything else came across. |
| verify | done | Rain -12 looping, Q3 dips to -22 and returns, Q5 stops the phone. |
| repair | done with trouble | Playlist, its fade, act 2 group, blackout already worked. MSC rebuilt as MIDI `msc go 9`, Memo deleted, auto-continue set. Reset fought me. |
| notes | done | All six; Q13 needed nothing. |
| save | done | .ecshow folder with all ten sounds in use in media/. |
| run | done | Show mode 0.5–7; early GO on 7 recovered with three clicks. |
| undo | done | Deleted 6.5 and saved; other notes intact. |

## Findings, worst first

1. **Major: the MSC GO did not import, and the reason given doesn't fit an MSC cue.** "9 LX console GO (MSC): was a MIDI cue whose message this does not send (MIDI timecode, or an empty SysEx): kept as a Memo." The app does send MSC, so I rebuilt it from memory. I can't see whether the importer or my QLab cue is at fault.
2. **Minor: Check says "Nothing wrong" right after that import.** The lost cue is only in the summary I'd already dismissed.
3. **Minor: Reset took several clicks over ~10 s to stop anything.** It turned into "Sure? Reset" (and grew sideways), and kept saying that while sound played on. I saw it once and may have mis-timed a click.
4. **Minor: the blackout is a Memo whose inspector says "A note. Does nothing."** It has Fade & stop others 3 s (all) and does fade everything. I nearly rebuilt it.
5. **Minor: recovering from an early GO takes three clicks.** I stopped 7 and its auto-continued 8 with their row ■ buttons, then re-selected 7. It was clean, but there's no single "back one".
6. **Polish: a running fade is called "waiting"**, e.g. `"Rain returns" is waiting (0:01.3 of 0:03.0)`.
7. **Polish: an Audio cue's Level sits below the waveform** and the tab has to be scrolled.

## What worked well

- The import told the truth about what it dropped, and the rest played right: playlist, the start-first-and-enter group, loops, levels, the fade dips, the Stop cue, and the blackout's fade-others.
- QLab hands work: Space GO, Esc panic (twice to stop dead), Cmd+D, double-click a duration in the list, Cmd+S.
- At a glance: "THIS GO: 2 OF 2 · Thunder, close", "DISARMED · GO SKIPS IT", the Active cues panel with levels and times, a dot on each unsaved row, and Save · N listing the changes.
- Saving copies exactly the sounds in use, including the new letter v2.wav.

## Rig

- I couldn't see inside the QLab file, so the MSC cue number and act 2's original mode are guesses.
- Clicks made while the inspector was scrolling sometimes landed on the old position.
