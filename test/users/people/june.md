# June, a puppeteer building her own show

## Who

Puppeteer and maker. Builds the puppets, the set and, lately, the electronics: she has soldered LED strips to two ESP32 boards from a tutorial and can upload a sketch from the Arduino IDE if someone gives her the steps. Runs her own sound from a laptop at the side of the stage, and the venue's lighting desk sits beside it. Has never used QLab; until now the sound was a playlist and the lanterns were switched on by hand.

Not a programmer and not a sound designer. Patient, practical, used to working things out with her hands. Has heard that the app has an assistant and intends to lean on it: she would rather say what she wants than learn where every setting is. Gives up on anything that answers in jargon.

## The show

*The Lighthouse*, forty minutes, one puppeteer. Six sounds, a script with the cue points marked in it, two lanterns she is building (ESP32, a strip of LEDs each), and the venue's lighting desk (an ETC Ion). Nothing is built in the app yet.

## Why she is here

She wants one GO to do everything: the sound, the desk's cue, the lantern. And she wants to know, before the audience comes in, that all of it is there.

## On the desk

- `The Lighthouse/`: six sounds and `script.md`
- `rig.txt`: what the equipment is, its addresses, and how to stand in for a lantern on this computer

This session has real network ports. Start the stand-in lantern (the line is in `rig.txt`) before the tasks that need one, and leave it running in its own terminal.

## Tasks

1. **folder** Make the folder `The Lighthouse` your show, and get its six sounds into the cue list in order, each named so you could call it. Use the assistant if it offers. Note what it guessed and whether it told you.
2. **talk** Without touching a cue yourself, get every sound to end with a 3 second fade out. If the assistant cannot do that as it is set up, find out from the app what would make it able to, and how many steps that is.
3. **script** Tell the show that `script.md` is its script, and find out from the app which marks in it have no cue yet.
4. **desk** Tell the app about the lighting desk (an ETC Ion at 127.0.0.1) in your own words, and get a cue that fires the desk's cue 12 when the foghorn sounds.
5. **lantern** With the stand-in lantern running, have the app find it and add it. Find out from the app whether it is there. Make it show itself, and check in the stand-in's terminal that it was told to.
6. **cue** Make the lantern breathe when the lamp hum starts.
7. **ready** Ask whether everything is ready, in the assistant and on the page the app has for it. Then stop the stand-in lantern and find out how long the app takes to tell you, and what it tells you to do.
8. **firmware** Your second lantern is not built yet: an ESP32 with 30 LEDs on pin 5. Get the firmware for it written into the show folder. Read the steps as someone who has to follow them tonight: is anything missing? Check where your Wi-Fi password is supposed to go, and that the app never asked you for it.
9. **more** You want the lantern to flicker faster whenever the puppet's hand comes near it (you have a distance sensor). Ask for that, and see what the app says and what it leaves you holding.

## What she judges it on

- Did she understand, the first time she opened the assistant, what she could ask it?
- When it guessed, did it say so? When it could not do something, did it say that plainly and tell her where to go next?
- Could she tell at a glance whether her lanterns and the desk were there?
- Would she trust the written steps enough to flash a board from them?
