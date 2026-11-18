#!/usr/bin/env python3
"""Writes test/fixtures/qlab-built/fields.qlab5: a made-up workspace whose cues keep each setting under the name,
and in the form, that QLab 5.6.3 saved it in workspaces built with QLab itself for the purpose (by AppleScript, from
nothing: test/qlab-compare). One cue per thing the importer once missed. Nothing here comes from a real show.

    python3 test/fixtures/make-qlab-built-fixture.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qlab_archive import *


def tc(ticks, fps, drop=False):
    # QLab keeps a time as frames over its frames a second, in 48 million ticks a second
    return Obj('F53Timecode', F53TimecodeFramerate=Obj('F53Framerate', F53FramerateFramesPerSecond=fps, F53FramerateDropFrame=drop, F53FramerateVideoSpeed=False), F53TimecodeCommonTicks=ticks)


def days(on):
    names = ['wallSunday', 'wallMonday', 'wallTuesday', 'wallWednesday', 'wallThursday', 'wallFriday', 'wallSaturday']
    return {n: (n in on) for n in names}


def knobs(main, crosspoints):
    entries = {0: knob(0, 0, main), 1: knob(0, 1, 1.0), 2: knob(0, 2, 1.0), 3: knob(0, 3, 1.0), 4: knob(0, 4, 1.0)}
    for i, (r, c, g) in enumerate(crosspoints):
        entries[100 + i] = knob(r, c, g)
    return Obj('AudioLevelMatrix', entries=entries, rows=1025, columns=1025, gangs={})


here = os.path.dirname(os.path.abspath(__file__))
# (where QLab last saw them is made up: they are found beside the workspace, as QLab finds a moved project folder)
tone = '/shows/fields/audio/tone-stereo.wav'
song = '/shows/fields/one-note.mid'

a1 = audio('A-1', '1', 'ducks, restarts, keeps pitch', tone, rate=1.5, doPitchShift=0, duckOthers=True, duckLevel=0.31622776601683794, duckTime=2.0,
           secondTriggerAction=5, secondTriggerOnRelease=True, autoLoad=True, fadeAndStopOthers=1, fadeAndStopOthersTime=3.0,
           colorName='crimson', useSecondColor=True, secondColorName='yellow')
a2 = audio('A-2', '2', 'main level down, outputs as ever', tone, level=0.0)
a3 = audio('A-3', '3', 'main level down, on outputs 3 and 4', tone, level=0.0)
a3.fields['levels'] = knobs(0.0, [(1, 1, 0.0), (2, 2, 0.0), (1, 3, 1.0), (2, 4, 1.0)])
a4 = audio('A-4', '22', 'main level down, one input up', tone, level=0.0)
a4.fields['levels'] = knobs(0.0, [(1, 0, 2.0), (1, 1, 1.0), (2, 2, 1.0)])
vid = cue('VideoCue', 'V-1', '4', 'a picture', fileTarget=None, opacity=1.0, layer=1000)
styled = Obj('NSAttributedString', NSString='Hello stage', NSAttributes={
    'NSFont': Obj('NSFont', NSName='HelveticaNeue-Bold', NSSize=72.0, NSfFlags=16),
    'NSColor': Obj('NSColor', NSColorSpace=1, NSRGB=b'1 0.5 0\x00'),
    'NSParagraphStyle': Obj('NSMutableParagraphStyle', NSAlignment=0, NSTabStops=None)})

cues = [
    a1, a2, a3, a4, vid,
    cue('TitlesCue', 'T-1', '5', 'words', titlesAttributedString=styled, lastSeenFontNames=['Helvetica Neue Bold'], opacity=1.0, layer=1000),
    cue('TimecodeCue', 'TC-1', '6', 'ltc', startTimecode=tc(178711680000, 25), outputType=1, LTCChannel=1, duration=10.0),
    cue('TimecodeCue', 'TC-2', '7', 'mtc', startTimecode=tc(1726272000000, 30, drop=True), outputType=0, LTCChannel=-1, duration=60.0),
    cue('MemoCue', 'M-1', '8', 'wall clock', useWallClock=True, wallHours=13, wallMinutes=45, wallSeconds=0, wallClockMode=0, **days(['wallMonday', 'wallFriday'])),
    cue('MemoCue', 'M-2', '9', 'timecode trigger', useTimecode=True, timecode=tc(173280000000, 30)),
    cue('MIDICue', 'MI-1', '10', 'empty sysex', messageType=3, rawString='', status=1, channel=1),
    cue('MIDICue', 'MI-2', '11', 'nothing saved'),
    cue('MIDICue', 'MI-3', '12', 'msc set', messageType=2, command=6, commandFormat=1, deviceID=0, controlNumber=3, controlValue=90, qNumber='', qList='', qPath=''),
    cue('MIDICue', 'MI-4', '13', 'msc timed go', messageType=2, command=4, commandFormat=1, deviceID=127, qNumber='3', qList='', qPath='', hours=1, minutes=2, seconds=3, frames=4, subframes=0),
    cue('MIDIFileCue', 'MF-1', '14', 'midi file', fileTarget=Obj('F53Alias', bookmark=b'', lastKnownPath=song, relativePath='one-note.mid'), playbackRate=1.2),
    cue('ResetCue', 'R-1', '15', 'reset', cueTarget=a1, targetMode=0),
    cue('TargetCue', 'TG-1', '16', 'target', cueTarget=a2, targetCueNumber='3'),
    cue('DevampCue', 'D-1', '17', 'devamp', cueTarget=a1, fireNextCueAtMomentLoopEnds=True, devampType=1, stopTargetWhenDone=False),
    cue('LoadCue', 'L-1', '18', 'load from the end', cueTarget=a1, loadTime=-1.5),
    cue('ScriptCue', 'S-1', '19', 'script', source='-- nothing\nreturn 1'),
    cue('FadeCue', 'F-1', '20', 'fade the picture', cueTarget=vid, duration=1.5, mode=0, stopTargetWhenDone=False, targetMode=0, doRate=False,
        doOpacity=True, opacity=0.0, doTranslation=True, translationX=10.0, translationY=0.0, doScale=False, scaleX=1.0, scaleY=1.0, doRotation=False, rotation=0.0, rotationType=0,
        fade=Obj('Fade', entries={}, stopTargetWhenDone=False, duration=1.5)),
    # (QLab 4 keeps a Video cue's sound on an Audio cue inside it: here with its level all the way down)
    cue('VideoCue', 'V-2', '23', 'a QLab 4 picture, its sound down', fileTarget=None, audioCue=Obj('AudioCue', levels=matrix(0.0))),
    cue('LightCue', 'LI-1', '24', 'a colour', commandText='front = 50\nfront.color = rgbw(100, 0, 0, 0)', duration=2.0),
    cue('MemoCue', 'MT-1', '25', 'cc 22 at 127 only', useMIDITrigger=True, midiTrigger=Obj('MidiTrigger', status=176, byte1=22, channel=5, byte1Operator=0, byte2=127, byte2Operator=0)),
    cue('MemoCue', 'MT-2', '26', 'note 60 at any velocity', useMIDITrigger=True, midiTrigger=Obj('MidiTrigger', status=144, byte1=60, channel=0, byte1Operator=0, byte2=0, byte2Operator=1)),
    cue('MemoCue', 'MT-3', '27', 'note 60 above 64', useMIDITrigger=True, midiTrigger=Obj('MidiTrigger', status=144, byte1=60, channel=0, byte1Operator=0, byte2=64, byte2Operator=3)),
    group('G-1', '21', 'playlist', 6, [cue('MemoCue', 'G-1a', '21.1', 'one', continueMode=1), cue('MemoCue', 'G-1b', '21.2', 'two')]),
]
write_workspace(os.path.join(here, 'qlab-built', 'fields.qlab5'), 'Fields', [group('MAIN', '', 'Main Cue List', 0, cues)])
print('wrote qlab-built/fields.qlab5')
