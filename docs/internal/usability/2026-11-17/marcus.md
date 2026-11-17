# Marcus, playback operator: report

**Verdict: with workarounds.** "It vamps, counts a section and leaves the vamp at the end of the pass, track and click together, so the thing that matters works. But the clicks came in sitting on the house bus at -inf instead of on 3 and 4, and I only caught it by digging to the bottom of the Audio tab. I'd run the backup on it once I've checked every click's outputs by hand and rebuilt the keys patch change."

Ratings: learn 4 · speed 4 · clarity 3 · trust 3

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| bring | done with trouble | The import summary is clear. The click routing didn't come across and the summary describes it wrongly. The keys patch change became a Memo without its program number. |
| click | done with trouble | The clicks were on the Effects bus (1-2) at -inf. I fixed it with Own outputs > 3-4 and Level 0 on each. |
| vamp | done | Endless loop 0:16-0:24, track and click in step. The Devamp mid-pass leaves at 0:24 (I ran it twice). |
| counted | done | Slice 1 plays 4 times, "pass 2 of 4", then holds. The bows vamp is 0:20-0:30, not the MD's 0:30-0:38. |
| rehearse | done | Cmd+T, "25", Enter, Space. The time is remembered: four presses to go again. |
| renumber | done | Cmd+R on 30-33 gave 300-305 (children included), and the targets followed. |
| levels | done with trouble | Double-click and type on "-6" was silently ignored. Cmd+A and type worked live, and Save keeps it. |
| panic | done | Esc fades, Esc again stops dead. Clicking the group row gets the number back on standby (in Show mode too). |

## Findings, worst first

1. **Major (import bug): the click routing isn't imported, and the clicks land on a house bus at -inf.** The summary says "played only on outputs of its own, with its main level down", but the inspector shows "On its bus", "On its bus's pair.", an empty matrix and Bus Effects. Raising the level as the summary says would put the click in the house. (001.png, 008.png)
2. **Major (import bug): the MIDI program change became a Memo.** The summary says "(MIDI timecode, or an empty SysEx)" for what is a patch change, which the app's MIDI cue sends ("pc 3 ch 2"). The memo doesn't keep the program number or the channel, so I can't rebuild the cue without QLab. (001.png)
3. **Minor (bug): double-click on a negative level, type, Enter: ignored silently.** It stayed "-6" (and "-9" the second time). It looks like the double-click selects only the digits. (054.png)
4. **Minor: the list scrolls by itself after GO.** A click a moment later hit "22 Reverb return up" and moved the standby there.
5. **Minor: the Finale bows vamp is 0:20-0:30, the MD says 0:30-0:38.** It may be the file and not the import; I couldn't tell. (038.png)
6. **Polish: Own outputs is buried** under "More (11)" at the bottom of the Audio tab.
7. **Polish: Reset's "Sure? Reset" confirm is easy to miss.** I pressed GO thinking it had reset.

## What worked well

- Vamp and Devamp: leaving at the end of the pass, the click in step with the track (026.png).
- The counted section says "pass 2 of 4 of a counted section", then HOLDING with a Let go button (038.png).
- Load to Time: Cmd+T as in QLab, it remembers the time, and "LOADED TO 0:25.0 · this GO only" over GO.
- Renumber renumbered everything inside the group and kept the targets.
- The import sheet lists every cue that changed and says "The QLab file is unchanged." The Save button lists unsaved changes ("Save · 3").
- Multi-select edits: two clicks routed in one go.

## Rig

- The test run pretends eight outputs on the MacBook speakers, so I couldn't see a warning about routing to 3-4 on a 2-output device.
- `hear` doesn't say which outputs a sound is on, so I checked the house rule only from the inspector.
