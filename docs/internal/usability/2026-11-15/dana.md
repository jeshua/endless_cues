# Dana: stage manager, dance company

**Verdict: with workarounds.** I built the whole evening in one sitting with nobody to ask, and it ran from house music to bows exactly as the notes say, so yes, I would stop borrowing the Mac. What holds me back is that a time I typed was quietly dropped because I pressed Tab instead of Enter, and that in Show mode a stray V still plays a track; I would tape over that key and check every number in the list before a performance.

Ratings (1 to 5): learn 4, speed 4, clarity 4, trust 3.

## Tasks

| Task | Outcome | What happened |
|---|---|---|
| build | done | Add Sounds… took all seven in order; Renumber and Enter-to-rename did the rest. Names had to be typed whole because the rename box opens empty. |
| house | done-with-trouble | Looked for Loop under Time & Loops; it is on the Audio tab. First fade ran 3 s, not 8: the Duration I typed and tabbed out of was dropped. With Enter it was right: 8 s fade, then stopped. |
| trim | done-with-trouble | Start at 12, End at 0:40, Fade out 5 went in easily and it played 0:12 to 0:40. The countdown counted to the file's end, and I could not confirm the fade out from the level readout. |
| follow | done | auto-follow and Post-wait 3 on Driftwood; Lantern waited 3 s and played. Standing by does not mention it. |
| level | done | Level −4 on the Audio tab; plays at −4.0 dB. The level is not visible in the cue list. |
| save | done | Save asked for a place, copied the music into the show folder; after quit and reopen everything was as left. |
| rehearse | done | Tools ▸ Load to Time… 0:30, GO; and again (retyping 0:30). Show stayed Saved. |
| perform | done-with-trouble | Show mode locked editing and the evening ran correctly end to end. But V still plays the selected cue and a click moves the playhead; Reset does ask first. |
| help | done-with-trouble | No Help menu. Found Settings ▸ Keys: Space, Esc (twice: stop dead), ↑. The website's list differs on two keys. |

## Findings, worst first

### [major] A time typed into an inspector box is thrown away unless you press Enter

*bug · inspector · task: house*

- **Expected:** Typing 8 in Duration and pressing Tab or clicking the next control keeps it, as in QLab and every other form.
- **Happened:** I typed 8 in the fade's Duration, pressed Tab and clicked the 'Stop target when done' switch. The box went on showing '8', but the cue list still said 0:03.0, and on GO the house music was gone within 4 seconds instead of 8. Coming back to the cue, Duration was empty again (grey 0:03.00). No warning. Repeated with 9 after it was set to 8: the box showed '9', the list stayed 0:08.0, and reselecting the cue showed 0:08.00. With Enter it is kept and reformatted ('0:08.00').
- **To see it:** New show, File ▸ Add Sounds… one file, click Fade in the toolbar, choose the target, click Duration, type 8, press Tab (or click another control). The DURATION column still says 0:03.0; click another cue and back, Duration is empty.
- **Suggestion:** Keep the value when the box loses the keyboard, or visibly put the old value back.

### [major] In Show mode the V key plays the selected cue on top of the show

*confusing · show-mode · task: perform*

- **Expected:** Show mode says 'editing is locked', and I took it to mean nothing I press by accident can hurt. V is the key directly above the space bar.
- **Happened:** In Show mode with house music playing I clicked the Salt row and pressed V: Salt started playing over the house music ('House music at 0.0 dB' and 'Salt at -4.0 dB' together). Done twice, same result. Nothing on screen in Show mode mentions V.
- **To see it:** Open a show with two sounds, switch to Show, GO the first, click the second row, press V.
- **Suggestion:** In Show mode, leave only GO, Panic, pause and the arrows on single keys, or make the others an option under GO and safety.
- **Pictures:** shots/057.png

### [minor] The countdown on a trimmed cue counts to the end of the file, not to its End at

*bug · transport · task: trim*

- **Expected:** Undertow ends at 0:40, so with 0:38.5 on the clock the countdown should say about -0:01.5. The cue list's DURATION column does say 0:28.0.
- **Happened:** While Undertow played, Active cues and the cue's row both said '−0:06.5' at '0:38.5 / 0:45.0', and the green bar was short of the end. The sound did stop at 0:40. The waveform in the playing strip does grey out the part after 0:40. Seen on one play (the second); I did not look at the countdown on the first.
- **To see it:** Add a 45 s sound, Audio tab: End at 0:40, Enter. GO, and read the countdown near the end.
- **Pictures:** shots/029.png

### [minor] Nothing shows or reports that a cue's own fade out is happening

*confusing · audio · task: trim*

- **Expected:** During the last 5 seconds of Undertow the level beside the cue should be seen to fall, as it does for a Fade cue ('0 → −∞').
- **Happened:** With Fade out 0:05.00 and End at 0:40.00, the level beside the running cue read '0 dB' and the rig's ear said 'Undertow at 0.0 dB' at 0:37.3, 0:38.1 and 0:40.0, then silence. I cannot tell whether the fade out is applied and simply not shown, or not applied; in a silent test session this is as far as I can check. A Fade cue, by contrast, reports 'fading to -60 dB'.
- **To see it:** Sound with Fade out 5 and End at 0:40; GO; watch the level readout in Active cues over the last 5 seconds.
- **Pictures:** shots/029.png

### [minor] The tab called 'Time & Loops' has nowhere to make a cue loop

*confusing · inspector · task: house*

- **Expected:** To loop the house music I went to the tab with Loops in its name and looked for a tick-box.
- **Happened:** Time & Loops shows a waveform, 'Markers' and 'Loop regions: None. A region is a stretch that loops cleanly; the operator can hold the track there when a scene runs long.' with no button to add one. The plain 'Loop' switch is on the Audio tab. Once found it worked first time and the row shows a 'loop' tag.
- **To see it:** Select an Audio cue, open Time & Loops.
- **Suggestion:** Put the Loop switch (or a pointer to it) on the Time & Loops tab.
- **Pictures:** shots/010.png

### [minor] There is no Help menu; the key list is inside Settings

*missing · help · task: help*

- **Expected:** A Help menu in the menu bar, or a '?' on the window, with the keys.
- **Happened:** The menu bar is Endless Cues / File / Edit / View / Tools / Window. I found the keys by opening ⚙ Settings and seeing 'Keys' in its list: GO 'Space', 'Panic (again: stop dead) Esc', 'Move the playhead ↑ ↓'. The page is clear and complete once found, and ↑ did go back one cue. The GO button also says SPACE on it; Esc shows only when you point at Panic.
- **To see it:** Look through the menus for help; then ⚙ ▸ Keys.
- **Suggestion:** Add Help ▸ Keyboard Shortcuts that opens this page.
- **Pictures:** shots/060.png, shots/061.png

### [minor] The website's key list disagrees with the app's

*wording · help · task: help*

- **Expected:** The Getting started page and the app to give the same keys.
- **Happened:** The website says 'D: Arm or disarm it' and '⌘J: Open the assistant'. The app's Keys page says 'Arm / disarm A', 'Pre-wait · Duration · Post-wait E D W', 'Jump to cue ⌘J', 'Assistant ⌘K'. Someone who learned D from the website would open a Duration box instead.
- **To see it:** Compare site/docs 'Keyboard' with Settings ▸ Keys.
- **Pictures:** shots/061.png

### [minor] Music tracks are put on the bus called Effects

*confusing · mixer · task: build*

- **Expected:** Seven music tracks added to a new show to come up on Music, since the mixer has a knob called Music.
- **Happened:** Every added sound has Bus 'Effects' (options Music / Effects / Vocals). During the run the meter moved on the Effects knob and the Music knob did nothing. If I had reached for Music to turn the show down, nothing would have happened.
- **To see it:** New show, Add Sounds…, select a cue, Audio tab: Bus shows Effects.
- **Pictures:** shots/050.png

### [minor] Standing by does not say that this GO will carry on into the next cue

*confusing · cue-list · task: follow*

- **Expected:** With Driftwood standing by, the big display to tell me that Lantern follows by itself after 3 seconds, since that is the one GO in the evening that does two things.
- **Happened:** It says '5 Driftwood' and 'then 6 · Lantern', the same words as for any cue where 'then' means my next GO. The only sign is a small ⤓ at the far right of the row and 0:03.0 under POST-WAIT. After it ran, the playhead was correctly on 7 Bows.
- **To see it:** Set a cue to auto-follow, put the playhead on it, read the standby area.
- **Suggestion:** Say 'then follows into 6 · Lantern after 0:03'.
- **Pictures:** shots/050.png

### [minor] In Show mode one click on a row moves the playhead

*confusing · show-mode · task: perform*

- **Expected:** Locked means the next GO stays what it was unless I move it on purpose.
- **Happened:** With house music playing in Show mode I clicked the Salt row; Standing by changed from the fade to '3 Salt'. My next GO would have skipped the house fade and Tide. (QLab does the same in show mode, so this may be intended; it is the thing I would be most likely to do by accident on a trackpad.)
- **To see it:** Show mode, GO, click any other row, read Standing by.

### [polish] A new Fade arrives broken and unnumbered, and points at nothing

*confusing · cue-list · task: house*

- **Expected:** A Fade added while the house music cue is selected to target that cue, as QLab does.
- **Happened:** The Fade appeared under cue 1 with 'No target.', Target '— choose —', and '✕ 1 broken' at the bottom of the window, with no number. Choosing '1 · House music' from the list fixed it; I numbered it 1.5 with N. The words were clear enough to get me there.
- **To see it:** Select an Audio cue, click Fade.
- **Pictures:** shots/013.png

### [polish] Inspector boxes jump when 'No target.' goes away; a label is cut off

*confusing · inspector · task: house*

- **Expected:** Controls to stay where they are while I fill them in.
- **Happened:** After choosing the Fade's target the 'No target.' line vanished and every control moved up a row, so my next click landed on the wrong thing. The switch label reads 'Stop target whe…' on screen.
- **To see it:** Add a Fade, choose its target, watch the row of boxes.
- **Pictures:** shots/013.png

### [polish] Renaming a cue that still has its file's name starts from an empty box

*confusing · cue-list · task: build*

- **Expected:** Enter on '00 house music' to open the box with that text in it so I can fix it.
- **Happened:** The box opens empty (the inspector's Name is empty too, though the list shows '00 house music'), so each of the seven names is typed from scratch.
- **To see it:** Add a sound, select it, press Enter.
- **Pictures:** shots/007.png

### [polish] Load to time does not remember the last time

*missing · transport · task: rehearse*

- **Expected:** For 'again from 0:30', the box to offer 0:30 again.
- **Happened:** Second time, Tools ▸ Load to Time… opened empty and I typed 0:30 again. Otherwise fine.
- **To see it:** Load to Time 0:30, GO, Esc, select the cue, Load to Time again.

## What worked well (do not break)

- **Adding the tracks, numbering them and naming them took minutes.** File ▸ Add Sounds… brought all seven in in file order with their lengths; Tools ▸ Renumber Selected Cues… numbered them 1 to 7 in one go; Enter renames in the row.
- **Standing by, 'then', and the Active cues list say what is happening.** The big number and name beside GO, 'then 2 · Tide' under it, the running cue with its countdown and bar, and a fade shown as '0 → −∞' with its own countdown. Clicking the running cue's bar skips along it, which let me check each ending.
- **Save put the music inside the show folder and the app reopened the show as I left it.** First Save asked where, wrote 'Tour evening.ecshow' with a media folder holding all seven files, and the cues now point at 'media/02 Salt.wav'. After quitting and opening, the show came straight back: loop, 8 s fade with stop, Undertow 0:12 to 0:40 with 5 s fade out, auto-follow + 3 s, Salt −4, all there.
- **Auto-follow with a post-wait did the Driftwood into Lantern gap first time.** Continue 'auto-follow' and Post-wait 3 on Driftwood: at the end of Driftwood, 'Lantern is waiting (0:01.5 of 0:03.0)', then Lantern played, and the playhead went on to Bows.
- **Load to time is obvious and leaves the show untouched.** Tools ▸ Load to Time…, 0:30, Enter: 'LOADED TO 0:30.0' beside Standing by, GO played Salt from 0:30 at −4 dB, and the show stayed 'Saved'.
- **Reset asks 'Sure? Reset' while something is playing.** With a cue playing the button turned into 'Sure? Reset' and nothing stopped. With nothing playing it just goes to the top.

## Rig

- Clicking by coordinates meant a control that had moved (the Fade tab after choosing a target) took a click meant for another; a person would have seen it move. One stray 'n1.5' got typed into a cue name during that muddle and I could not reproduce it, so it is not reported.
- No sound, so whether an Audio cue's own fade out is audible could not be judged; the finding is about what the screen shows.
