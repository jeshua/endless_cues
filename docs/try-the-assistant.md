# Try the assistant and the Rig: ten minutes, no hardware

This is a walk from an empty folder of sounds to a show with cues, a piece of equipment, a cue that makes the
equipment do something, a page that says whether everything is ready, firmware for a prop, and a folder a
coding agent can work in. A stand-in prop on this computer plays the part of the equipment. Every step below
was done in the window as written, and "you should see" is what was seen.

It needs two Terminal windows in the repository's folder, and the app run from source (`npm start`). Do not do
this on a computer that is running a show.

## Before you start

**A folder of sounds.** Any new, empty folder with a few sound files in it will do. To make one:

```
node bin/ec.js sounds ~/Desktop/Lighthouse
```

That writes six short tones named as a real folder is (`01 sea wash.wav`, `02 gulls FINAL.wav` …).

**A stand-in prop.** In the second Terminal window, and leave it running:

```
node bin/ec.js fake-prop --name lantern
```

It behaves as an ESP32 light running the prop kit's firmware would, and prints every message it is sent.
(The app asks it "are you there?" every two seconds; it prints the first of those and counts the rest.)

## 1 · Start from a folder

`npm start`. On the start screen press **Start from a folder…** and choose the folder (or *File ▸ Start from a
Folder…*).

You should see: the window's title is the folder's name, the cue list is empty, and the Assistant drawer has
opened by itself: QIRX-G drawn flat (a robot puppet from Endless Forms: the assistant’s face),
**"6 sounds not in a cue yet."** and one button. The same eye is in the side panel above the
mixer, beside "Ask the assistant": clicking it opens and shuts the drawer. In Finder, a
`show.json` is now beside the sounds; nothing was moved or copied.

If no assistant has been chosen on this computer, the eye is unlit and milky and the drawer also asks **Who should
answer?** in four rows. Choose **Built-in helper** for this walk (no model, no internet); the eye lights. Claude
Code is offered there too if it is installed; the end of this page says what changes with a model.

What the eye says, here and through the walk: lit low is ready; brightening and dimming slowly is thinking; a
yellow dot and "1 change to look at" beside it is a change waiting for you; unlit is off, or Show mode. To have a
bare window, right-click it ▸ *Hide the QIRX* (Settings ▸ Assistant ▸ *Show the QIRX* brings it back).

## 2 · Cues from the sounds

Press **Make cues from these 6 sounds**.

You should see: a short reply saying what it did and what it guessed ("Each is named after its file, without
the number and without words like FINAL… I did not make it loop"), and a yellow card, **Proposed change · 6
added**. Nothing has changed yet. Press **Accept**: six cues, 1 to 6, in order. ⌘Z would undo all six.

## 3 · Find the prop

Type **look for props** in the drawer and press Enter. (Or: the **Rig** tab at the top, then **Look for props**,
then **Add it** on the row that appears. Both do the same thing.)

You should see: "One prop answered that the show does not have yet: lantern at 127.0.0.1 (a light, firmware
1.0)", and a card, **Proposed change · 1 device**: `Lantern · prop · 127.0.0.1:53100 · 7 commands · asked
every 2 s`. Accept it.

## 4 · The Rig page

Press **Rig** in the title bar (⇧⌘R).

You should see: a row for each thing the show depends on (the show is saved, backups, every cue can run, where
sound goes, every file is found), and under Equipment the row **Lantern** reading *answering*, with a green dot, within three
seconds. "The show is saved" has a yellow mark until you save.

Click the Lantern row. Its editor opens: its address, how it is asked whether it is there, what it reports
(firmware 1.0, signal, battery), and its seven commands, each with the exact message it sends. Press **Try** on
**Identify** (the last one). The fake prop's Terminal prints one line, `/ec/identify … blinks white for 2 s`. A
real lantern would blink. (It was sent three times with one id and acted on once: that is what the `#…` is.)

## 5 · A cue that sends it

Back in the drawer, press **Add a cue: Identify to Lantern** (it is offered under the conversation),
and accept. Go to the **Edit** tab: there is a new row, `◈ Lantern ▸ Identify`, numbered, after cue 1. Click it and press
**Space**: the Terminal prints `/ec/identify` again. Press **Esc** to stop the sound if one is playing.

The **+cue** button beside any command in the Lantern's editor does the same without the assistant, with the
values showing: try it with **Effect** set to *breathe*.

## 6 · Is everything ready?

Save (⌘S). On the Rig page the top line now reads **All 6 are ready** and the Rig tab has no dot. In the
drawer, **Is everything ready?** says the same in words.

## 7 · Pull the plug

In the prop's Terminal press Ctrl-C.

You should see, within about six seconds: Lantern's row turns to a red ✕, "not answering", with what to do
under it ("Check its power, and that it is on the show's network"); the Rig tab gets a red dot; and one notice
at the bottom of the window, "Lantern has stopped answering", once. The drawer now offers **Why is Lantern not
answering?**, which asks it again and says what is likely.

Start the prop again (up-arrow, Enter). Within a few seconds the row is green and the dot is gone.

## 8 · Firmware for a real one

On the Rig page, click Lantern, and at the foot of its editor press **Write firmware…**. Choose a board and how
many LEDs, and press **Review the files**.

You should see: the drawer with **Proposed change · 6 files** (`props/lantern/lantern.ino`, `config.h`,
`secrets.h`, `README.md` …). Click a file name to read it before accepting. Accept: the files are in the show
folder under `props/lantern/`, and the drawer says to open `README.md` there, which has the steps for the
Arduino IDE. The Wi-Fi password is never asked for: you type it into `secrets.h` yourself.

## 9 · Hand the show over

Type **hand the show over**. Accept the two files. You should see `AGENTS.md` and `CLAUDE.md` in the show
folder, and in the drawer the two lines to type in a terminal (`cd` to the folder, then `claude`). `AGENTS.md`
describes this show, its Lantern and its commands, the rules for changing it, and the command lines that give
a coding agent the app's own tools. This is for what the app will not do itself: an odd protocol, firmware
beyond the kit's, a program beside the show.

## With a model

In the drawer's **Who should answer?** (or Settings ▸ Assistant) choose **Claude Code** if it is installed and
signed in: one click, nothing to pay here. Then the same walk can be had in your own words. These were tried,
each answered in under a minute with a short, true reply and a change to review:

- "Here are my sounds: make me a show."
- "my lantern is at 127.0.0.1" (it asks the address whether it is there, then proposes the device)
- "add a cue that makes it breathe"
- "fade the storm out over 4 seconds when the bows start"
- "is everything ready?"
- "I'm building the lantern myself: an ESP32-C3 with 24 LEDs. Can you write its firmware?"
- "I also need the show to switch on a projector that only speaks HTTP" (it says the app cannot, and offers
  the hand-over)

## What is not real yet

- **No board has ever run the kit's firmware.** It compiles for ESP32 and ESP32-C3 with `arduino-cli`; it has
  never been flashed. The steps in each prop's `README.md` are written, not walked.
- **Devices have met only the stand-in prop, on this computer.** No lighting desk, mixer or real prop has
  answered an "are you there?" or received a Device cue from this app.
- **Look for props on a real network is untried**: whether the one broadcast hello reaches a prop through a
  given router (many keep Wi-Fi clients apart).
- The hand-over's command lines from an installed app were run against an unsigned test build only.
- The built-in helper understands a short list of phrasings and nothing else. Asked anything outside it, it
  says what it does.
- The assistant never sends a device a command and never plays or saves the show: Try and GO are yours.
