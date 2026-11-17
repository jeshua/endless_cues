#!/usr/bin/env python3
"""Writes test/fixtures/stage.qlab5: a made-up workspace with Video, Text and Camera cues, for the importer's
tests. Nothing in it comes from a real show, AND ITS SHAPE IS A GUESS: no workspace with these cues saved by
QLab itself has been read. The Video cue is given an Audio cue's fields (file, levels, times), and its geometry
under the names QLab's OSC dictionary uses for it. The test only shows that IF a file has those names, they are read.

    python3 test/fixtures/make-qlab-stage-fixture.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qlab_archive import *

film = audio('V-FILM', '1', 'Film', '/shows/demo/video/film.mov', level=0.5011872336, startTime=2.0, endTime=30.0, infiniteLoop=True,
             opacity=0.5, translationX=120.0, translationY=-40.0, scaleX=0.5, scaleY=0.5, layer=7, fillStage=False, holdLastFrame=True)
film.name = 'VideoCue'
plain = audio('V-PLAIN', '2', 'Backdrop', '/shows/demo/video/backdrop.png')
plain.name = 'VideoCue'
title = cue('TextCue', 'T-1', '3', 'Act Two', text='Act Two')
styled = cue('TextCue', 'T-2', '4', 'Interval')
cam = cue('CameraCue', 'C-1', '5', 'Stage cam')
out = fade('F-OUT', 'film out', film, 0.0, 2, stop=True, number='6')
load = cue('LoadCue', 'L-1', '7', '', cueTarget=film, loadTime=10.0)
here = os.path.dirname(os.path.abspath(__file__))
write_workspace(os.path.join(here, 'stage.qlab5'), 'Stage Show', [group('L-MAIN', '', 'Main Cue List', 0, [film, plain, title, styled, cam, out, load])])
print('wrote stage.qlab5')
