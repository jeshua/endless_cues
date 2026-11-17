# Dana: stage manager, dance company

**Verdict: yes.** Yes, I would run the tour on this. I built the whole evening in one sitting with nobody to ask, the screen told me in big letters what each GO would do, and the saved folder carries its own music. What I would watch is my own hand in Show mode: a click on the progress bar or on a row still changes things.

Ratings (1 to 5): learn 4, speed 4, clarity 5, trust 4.

## Tasks

| Task | Outcome | Notes |
|---|---|---|
| build | done | New show, Audio, chose all seven files; numbered and named each in the inspector. Puzzled by the Music/Effects bus message. |
| house | done | Whole sound loop switch on Time & Loops; a Fade cue targeted and named itself; 8 s and stop when done. Heard it loop past 0:40 and fade to silence. |
| trim | done-with-trouble | Looked for Start at / End at on Time & Loops, where the text mentions them; they are on the Audio tab. Then right first time. |
| follow | done | auto-follow plus Post-wait 3 on Driftwood, a guess that proved right on playing it. |
| level | done | Level -4 on Salt's Audio tab; Audition played at -4.0 dB. Not visible in the list. |
| save | done | Saved to the desk as Autumn tour.ecshow; reopened by itself with everything intact. |
| rehearse | done-with-trouble | Found Load to Time… in the Tools menu. First take fine; the second played from the top until I loaded again. |
| perform | done | Show mode, Reset, then Space through the evening; every GO sounded what Standing by said. Skipped ahead with the Active cues bar. |
| help | done | Help > Keyboard Shortcuts: Space, Esc, and ↑ ('Move the playhead'). |

## Findings, worst first

### [major] In Show mode one click on a playing cue's progress bar jumps the music, with no confirmation

*confusing · show-mode · task perform*

**Expected:** With the show locked ('SHOW MODE — editing is locked'), nothing I brush with the mouse should change what the audience hears, short of GO and the stop buttons.

**Happened:** In Show mode the bar under the running cue in Active cues ('Click to skip there') moved Tide from 0:01 to 0:45 on a single click. Handy for me in this test, but it sits a few pixels above the pause and stop buttons and beside the mixer. The big waveform at the bottom says 'Click the waveform to mark a place' while the small bar skips; two bars, opposite meanings.

**Steps:** New show, add a sound, switch to Show, GO, click near the right end of the thin bar under the cue's name in Active cues. The sound jumps there.

**Suggestion:** In Show mode, make skipping need a modifier or a second click.

Evidence: shots/044.png

### [minor] Six of seven music tracks were put on the Effects bus, and the message about it uses words I don't know

*confusing · import · task build*

**Expected:** All seven files are music; I expected them treated alike, or to be asked.

**Happened:** A message appeared briefly: '1 of 7 added on the Music bus (a sound over a minute long is taken for music; the Bus is on the cue's Audio tab).' Only Salt (1:00) shows 'music' in the TARGET column; the others are on 'Effects'. So the Music knob in the Mixer would turn down only Salt, and the Effects knob the rest of my music. I do not know what a bus is. I left it as it was.

**Steps:** New show, Audio, pick files of which one is 60 s or longer and the others shorter.

**Suggestion:** Ask once on import, or put everything added together on the same bus.

Evidence: shots/004.png

### [minor] Time & Loops talks about 'Start at' and 'End at' but those boxes are on the Audio tab

*confusing · inspector · task trim*

**Expected:** A tab named Time & Loops, with a waveform and the sentence 'goes round from Start at to End at', to hold the start and end times.

**Happened:** I scrolled the tab looking for them (only Markers, Loop regions, Whole sound, Play count). They are on the Audio tab, next to Level and Bus, with Fade in and Fade out. Once found they worked first time: 12, 40 and a 5 s fade out gave Duration 0:28.0 and it played from 0:12.1 and faded at 0:35.

**Steps:** Select an Audio cue, open Time & Loops, look for Start at.

**Suggestion:** Show Start at / End at on Time & Loops too, or have the waveform show them.

Evidence: shots/015.png

### [minor] Load to time is used up by one GO and nothing says so

*confusing · transport · task rehearse*

**Expected:** 'Then again': select Salt, GO, and hear it from 0:30 again, since I had just loaded it there.

**Happened:** First take was right ('LOADED TO 0:30.0' beside Standing by, played from 0:31). For the second I selected Salt and pressed GO and it played from 0:01. I had to open Tools > Load to Time… again; the box did still hold 0:30.00, so it was Load, GO. The command is only in the Tools menu; nothing on the cue or the waveform offers it.

**Steps:** Select a sound, Tools > Load to Time…, 0:30, Load, GO, Esc, select the cue again, GO: it plays from the top.

**Suggestion:** Offer 'again from 0:30' after a loaded cue is stopped, or a button for it in the rehearsal view.

Evidence: shots/030.png

### [minor] In Show mode a click on a cue row moves Standing by to it

*confusing · show-mode · task perform*

**Expected:** A locked show to keep its place unless I use the arrow keys or Jump.

**Happened:** Clicking Salt after the run made 'Standing by 2 Salt'. In a show a stray trackpad click would change what the next GO does. The big Standing by text does tell me, which is how I would catch it. (QLab does the same.)

**Steps:** Show mode, click any row.

Evidence: shots/035.png

### [polish] Nothing says where the gap goes for an auto-follow

*confusing · inspector · task follow*

**Expected:** A word of help beside Continue or Post-wait saying which of them makes the silence.

**Happened:** I guessed Post-wait 3 on Driftwood rather than Pre-wait on Lantern. It was right: Lantern 'is waiting (0:01.4 of 0:03.0)' then played. But I only knew by playing 35 seconds of track.

**Steps:** Select a cue, choose auto-follow.

**Suggestion:** A line under Continue: 'the next cue starts by itself when this ends, after the post-wait'.

### [polish] A cue's level is not shown in the cue list

*missing · cue-list · task level*

**Expected:** To see Salt's -4 dB at a glance when I check the show before the house opens.

**Happened:** The row for Salt reads the same as before; I have to select it and open the Audio tab to see '-4'. The Active cues panel shows it only once it is playing.

**Steps:** Set an Audio cue's Level to -4.

### [polish] After the first save the message at the bottom says 'Nothing to save'

*wording · files · task save*

**Expected:** 'Saved to Autumn tour' or similar.

**Happened:** After choosing the folder, the button turned to 'Saved' and the title to 'Autumn tour', but the message at the bottom of the window read 'Nothing to save', which made me doubt it for a moment. Seen once; it may be a second message that replaced a first I did not see.

**Steps:** New show with unsaved cues, Save, choose a folder, read the message at the bottom.

Evidence: shots/024.png

### [polish] The keys page says 'Move the playhead ↑ ↓' for going back a cue

*wording · help · task help*

**Expected:** 'Previous cue / next cue'.

**Happened:** Help > Keyboard Shortcuts opened Settings > Keys at once and GO (Space) and Panic (Esc; 'again: stop dead') were the first two entries. Going back one cue I had to recognise as 'Move the playhead ↑ ↓'. Up did move Standing by from Salt to Tide.

**Steps:** Help > Keyboard Shortcuts.

Evidence: shots/047.png

## What worked well

- **A Fade cue made after a sound targets it, numbers itself and names itself.** Fade, with House music selected, gave '0.5 · fade House music' targeting '0 · House music', fading to silence by default; setting 8 s and 'Stop target when done' renamed it 'fade House music out'. Three clicks and it was right, and hear confirmed silence after 8 s.
- **The Standing by line says what GO will do, including 'then, by itself when this ends: 5 · Lantern'.** Before every GO the screen named the cue in large type with what comes after. For Driftwood it said the next would start by itself. While Driftwood played, Standing by had already moved on to Bows, correctly.
- **Save makes one folder with the music copied in, and the app reopens it as it was.** 'Autumn tour.ecshow' on the desk holds a media folder with all seven tracks. On reopening the app the show was there with the loop, the fade, the trim, the follow and the -4 dB intact. That is what a touring laptop needs.
- **Show mode is plain and the lock is real.** One click on 'Show': toolbar and inspector go away, 'SHOW MODE — editing is locked' at the bottom, Delete does nothing. The whole evening ran right on Space alone.
- **Adding all seven files at once keeps their order and takes names from the files.** Audio > pick seven files gave seven cues in running order with durations. Number, Tab, Name, Enter for each was quick.

## Rig

- Could not judge the keys as they would appear on Dana's Windows laptop; the rig showed Mac keys (⌘).
