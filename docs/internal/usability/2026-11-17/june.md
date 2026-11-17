# June: The Lighthouse

**Verdict: with workarounds.** One GO does fire the sound, the desk's cue 12 and the lantern, and the Rig page tells me at a glance what is there and what is not. But the assistant I came for knew a short list of sentences, so I built the desk cue, the lantern's breathing and the second lantern by hand in the inspector. I would run The Lighthouse on it, once a friend has checked my cues.

Ratings (1–5): learn 3 · speed 3 · clarity 3 · trust 3

| Task | Outcome | What happened |
|---|---|---|
| folder | done | Start from a folder, then one button: 6 cues, and it said what it guessed (file order, dropped FINAL/v2, did not loop the hum, did not read script.md). |
| talk | gave up | The helper said plainly it has no model. "fade out cue 1 over 3" adds a separate Fade cue. I could not find what a real model needs; choosing Anthropic gave a raw SDK error. |
| script | gave up | I found nowhere to tell the show script.md is its script. |
| desk | done with trouble | Got "N ETC Ion". The helper's own "Fire cue" suggestion failed ("list must be a number"). Did it by hand with a Device cue and auto-continue; the desk got /eos/cue/1/12/fire. |
| lantern | done | Look for props found it; the Rig row said "answering"; Identify blinked the stand-in. |
| cue | done with trouble | The helper said there is no "breathe" command. By hand: Device cue, Effect breathe, auto-continue. The lantern got /ec/effect breathe. |
| ready | done | The assistant and the Rig page agreed. The stopped lantern turned red after about 35–40 s with "Check its power, and that it is on the show's network." |
| firmware | done with trouble | Rig ▸ Add a device ▸ From a model ▸ Prop light, then Write firmware. A clear dialog and good README, and the password is kept out of the app. But it is named prop_light, not Lantern B. |
| more | not possible | It gave the standard list, then a "hand the show over" that means a terminal and `claude`. |

## Findings, worst first

**Major**
1. **Settings shows "Built-in helper, ready" while another provider answers.** I chose Anthropic (Claude) and the drop-down snapped back to Built-in helper, but the panel header said "anthropic". My next message got: "Could not resolve authentication method. Expected one of apiKey, authToken, credentials, config, or profile to be set…" and "Something went wrong. Report it?" stayed in the status bar. (Run once; the snap-back may be the rig's.)
2. **There is no way to tell the show which file is its script.** It isn't in the menus, Settings ▸ Show, the Rig page or the helper's list, although the helper knew script.md was there ("I did not read script.md").

**Minor**
3. The helper's suggestion "Add a cue: Fire cue to N ETC Ion" fails with "That would not send: list must be a number." The inspector sends list 1 for the same command without asking.
4. "add an ETC Ion at 127.0.0.1" names the device **N ETC Ion**.
5. Firmware for a prop I renamed Lantern B still goes into `props/prop_light/` and answers as `prop_light`. A second kit light would get the same name.
6. The firmware steps don't cover the USB driver, how to tell which port is the board, or holding BOOT. `esptool.py read_flash` comes with no explanation.
7. "fade out cue 1 over 3" adds a separate Fade cue (one more GO) instead of a fade at the end of the sound.
8. When the helper can't do something, it lists its sentences but doesn't point me to the screen that can. Breathe is under Effect; "second lantern" needs adding on the Rig page first.
9. The first time I opened the assistant it said only "An empty show." I saw what I could ask only after a request failed.
10. "Hand the show over" is a terminal command for programmers, and the path in it is cut off at the edge of the bubble.

**Polish**
11. Grey placeholders look like values: Pin "5" in the firmware dialog, Cue list "1" in the Device cue.
12. Every readiness answer said "(checked 15:49:31)", minutes out of date, though what it said was current.
13. A lost lantern shows only as a dot on the Rig tab. The cue that uses it shows nothing in Edit view.

## What worked well
- **The Rig page.** "answering · 1 ms · firmware 1.0 · signal -52 dBm", Try: Identify, and a red "not answering (last heard 44 s ago)" when the lantern goes. Exactly what I want before the house opens.
- **The assistant is honest.** It says what it guessed ("I took that from your words, so reject this if it is something else") and what it didn't do. Nothing changes until I press Accept.
- **The firmware dialog.** "Never yet run on a board: a first draft." The Wi-Fi password goes only in secrets.h and the app never asked for it. The wiring notes (a separate 5 V supply, 1.8 A) and the 2.4 GHz warning are what a maker needs.
- One GO on the Foghorn really did fire the desk, and one GO on the Lamp hum made the lantern breathe.

## Rig
- The assistant is the canned built-in helper, so the tasks that lean on it mostly test its fixed sentences.
- Help ▸ Manual opens a website, and the manual file named in the brief was missing.
- The Who answers drop-down didn't keep my choice.
- The desk stand-in can't answer pings, so the desk was always "not answering".
