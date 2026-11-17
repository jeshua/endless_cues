# Marcus, playback operator: Songbook

**Verdict: no.** I can't put this on the backup machine for *Songbook*. The click has nowhere to go but the same output as the tracks, and it came across from QLab silent, so the band would have no click at all. The track will vamp and leave the vamp on the bar, but the click doesn't go round with it and my Devamp cues do nothing, so the vamp is a mouse job with the band out of time. Load to Time, renumber and panic are as good as QLab; fix outputs and slices and I'd look again.

Ratings (1 bad, 5 good): learn 3, speed 3, clarity 3, trust 1.

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| bring | done | All 18 cues opened, with a plain list of what did not come across (slice counts, Devamp on slices, MIDI, Mic, Timecode). Nothing about outputs or the click's level. |
| click | not possible | One output device for the whole app; buses are faders only. The click cues came in at −∞, so the rule holds only because the click is silent everywhere. |
| vamp | done with trouble | A loop region 0:16–0:24 made from the imported markers holds only when its block is clicked during playback. The track went round three times and left cleanly at the end of the pass. The click did not loop with it, and GO on the Devamp cue did nothing. |
| counted | not possible | A region has no play count. The import report had said so. |
| rehearse | done | Cmd+T, 25, Enter, Space: track and click from 0:25. Again: Esc, select 20, Cmd+T, 25, Enter, Space. |
| renumber | done | Cmd+R, start at 300: 300–305, targets followed. |
| levels | done with trouble | −9 typed while playing, heard at once, kept after save. The running row could not be clicked where it normally is, and the first save into a folder stopped the track. |
| panic | done | Esc fades (2 s), Esc again is silence. Up three times and Space to go again from the top. |

## Findings, worst first

### Blockers

1. **No output routing: the click cannot go to outputs 3 and 4.** Settings ▸ Audio has one "Output device" and buses that are faders ("Every Audio cue plays on a bus; each bus has a fader in the mixer"). A cue has Level and Bus, no outputs. Nothing says in words that routing is absent; the manual doesn't either. (011.png)
2. **Holding a loop region loops the track but not the click in the same group.** Opening: track "0:17.3 … held in a loop", click "0:41.3". Finale: track 0:26.8, click 0:36.8. No way to hold two cues with one action. Seen twice. (021.png, 057.png)

### Major

3. **Imported click cues arrive at −∞ dB and the import report does not say so.** All three clicks: Level "-inf", "−∞" in Active cues. The band would start with no click. I can't tell whether the importer read the level for outputs 1–2. (003.png)
4. **A Devamp cue does nothing to a held region, silently.** GO on 11 "Out of the vamp" and on 303: playhead moves on, track still "held in a loop". The import report warned ("slices are not here yet"), the GO did not. (023.png)
5. **Leaving a vamp is a mouse click on a small block, not a GO.** The block must be clicked before the track reaches the vamp or it plays through; it shows only while that track is selected. (021.png, 057.png)
6. **No counted vamp.** Regions are hold-until-clicked; no "four times then on". No marker at 0:38 for the bows vamp either. (003.png)
7. **Saving into a new folder stops everything playing.** First Cmd+S on the imported show at 0:29 of the Ballad: "Silence.", playhead back on 10. Save Show As… did the same. A plain Cmd+S on a saved show is fine. (040.png, 046.png)

### Minor and polish

8. **Rows of running cues collapse in the list.** Number, icon and time columns vanish, the name sits at the far left, and a click in the middle of the row selects nothing ("Select a cue to see its settings."). Seen on all three numbers. (021.png, 037.png, 057.png)
9. **A loop region does not say it will not loop until clicked during playback.** I made one, pressed GO, and it played through. (014.png)
10. **Load to Time forgets the last time** (polish). Same number of presses as QLab. (030.png)

## What worked well

- **The import report**: five plain lines naming each cue and what it lost, and the standing-by line repeats it: "(QLab MIDI cue: not in Endless Cues yet. It does nothing here.)". (003.png, 037.png)
- **Load to Time**: Cmd+T on the group, "LOADED TO 0:25.0" beside GO, track and click start together. (030.png)
- **Renumber**: one step, targets follow.
- **Panic, live level, unsaved chip**: Esc/Esc as the hint says; −9 heard at once with "↺ Put back to −6 dB" and "N unsaved"; kept after Save. The "HOLDING — click the block to let go" badge is easy to read. (057.png)

## Rig

- One Up arrow after Space/Esc seemed to do nothing; later ones worked. Probably focus.
- Clicking by coordinates right after GO sometimes hit the neighbouring row because the list scrolls when a group starts.
