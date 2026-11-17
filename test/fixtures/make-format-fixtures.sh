#!/bin/sh
# The sounds the smoke run plays to check each file format end to end (test/fixtures/formats/): three seconds of a
# 440 Hz tone that fades in, mono, 22.05 kHz, so the waveform has a shape and the files are small. Made with
# ffmpeg and (for CAF) macOS's afconvert; the results are committed, so the smoke run needs neither.
set -e
cd "$(dirname "$0")/formats"
ffmpeg -v error -y -f lavfi -i "sine=frequency=440:duration=3:sample_rate=22050" -af "volume=0.5,afade=t=in:d=1.5" -ac 1 -c:a pcm_s16le tone.wav
ffmpeg -v error -y -i tone.wav -c:a pcm_s16be tone.aiff
ffmpeg -v error -y -i tone.wav -c:a libmp3lame -b:a 32k tone.mp3
ffmpeg -v error -y -i tone.wav -c:a aac -b:a 32k tone.m4a
ffmpeg -v error -y -i tone.wav -c:a flac tone.flac
ffmpeg -v error -y -i tone.wav -ar 48000 -c:a libopus -b:a 24k tone.opus
ffmpeg -v error -y -i tone.wav -ac 2 -c:a vorbis -strict -2 -b:a 48k tone.ogg
afconvert -f caff -d LEI16 tone.wav tone.caf
ls -l
