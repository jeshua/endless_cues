#!/usr/bin/env python3
"""Writes test/fixtures/light.qlab5: a made-up workspace with Light cues, for the importer's tests.

The key a real QLab 5 workspace keeps a Light cue's commands under has NOT been seen (no workspace with
Light cues was to hand): `lightCommandText` is the name QLab's OSC dictionary gives the same text. The
importer does not rely on the name: it takes any text on the cue that reads as light commands. One cue
here keeps them under another name to hold it to that. Nothing in this file comes from a real show.

    python3 test/fixtures/make-qlab-light-fixture.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qlab_archive import *

cues = [
    cue('LightCue', 'L-1', '1', 'Opening look', lightCommandText='front = 80\ncyc.red = 100\nall.blue = 25', duration=4.0, notes='Warm.'),
    cue('LightCue', 'L-2', '2', '', someOtherKey='1 - 3 = 50\nfront = home', duration=0.0, continueMode=1),
    cue('LightCue', 'L-3', '3', 'From a palette', lightCommandText='front = cue 1\nside = 40', duration=2.0),
    cue('LightCue', 'L-4', '4', 'Nothing readable', duration=3.0),
]
here = os.path.dirname(os.path.abspath(__file__))
write_workspace(os.path.join(here, 'light.qlab5'), 'Light Show', [group('L-MAIN', '', 'Main Cue List', 0, cues)])
print('wrote light.qlab5')
