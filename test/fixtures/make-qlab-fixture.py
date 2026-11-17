#!/usr/bin/env python3
"""Writes test/fixtures/small.qlab5: a made-up workspace in the shape QLab 5 saves (a keyed archive with its
cue lists as a second archive inside), for the importer's tests. Nothing in it comes from a real show.

    python3 test/fixtures/make-qlab-fixture.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qlab_archive import *


rain = audio('A-RAIN', '1', 'Rain', '/shows/demo/audio/rain.wav', level=0.5011872336, infiniteLoop=True, colorName='blue', notes='House to half first.')
thunder = audio('A-THUNDER', '', 'Thunder', '/shows/demo/audio/thunder.wav', level=1.0, startTime=1.5, endTime=20, preWait=0.5)
duck = fade('F-DUCK', 'duck the rain', rain, 0.1778279410, 0.3)
back = fade('F-BACK', 'rain back up', rain, 0.5011872336, 2, preWait=8)
storm = group('G-STORM', '2', 'Storm', 3, [thunder, duck, back], fadeAndStopOthers=False)
out = fade('F-OUT', 'Fade out the rain', rain, 0.0, 5, stop=True, number='3', continueMode=1, postWait=1)
osc = cue('OSCCue', 'N-LX', '4', 'House lights', oscString='/eos/cue/1/12/fire', networkPatchID='PATCH-1', fadeType=0, duration=0.0, startValue=0.0, endValue=1.0,
          plainTextString=None, hexCodesString=None, allParameterValues={})
dim = cue('OSCCue', 'N-DIM', '5', 'Dim the fader', oscString='/ch/01/mix/fader #v#', networkPatchID='PATCH-1', fadeType=1, duration=3.0, startValue=0.75, endValue=0.0,
          plainTextString=None, hexCodesString=None, allParameterValues={})
video = cue('VideoCue', 'V-1', '6', 'Title card', continueMode=2, useHotKey=True)
wait = cue('WaitCue', 'W-1', '7', '', duration=4.0, continueMode=2)
playlist = group('G-PL', '8', 'Walk-in music', 6, [
    audio('A-W1', '', 'Walk-in 1', '/shows/demo/audio/walkin1.wav', rate=1.1, playCount=3, slices=[Obj('AudioSlice', time=10.0, playCount=2, infiniteLoop=False)]),
    audio('A-W2', '', 'Walk-in 2', '/shows/demo/audio/walkin2.wav', playCount=2, extra=[knob(1, 2, 0.5)]),
], playlistShuffle=True, playlistLoop=True, playlistCrossfade=True, playlistCrossfadeDuration=2.5)
controls = [
    cue('StartCue', 'S-1', '9', '', cueTarget=storm),
    cue('StopCue', 'S-2', '10', '', cueTarget=rain),
    cue('PauseCue', 'S-3', '11', '', cueTarget=rain),
    cue('LoadCue', 'S-4', '12', '', cueTarget=rain, loadTime=12.5),
    cue('GotoCue', 'S-5', '13', '', cueTarget=storm),
    cue('DisarmCue', 'S-6', '14', '', cueTarget=thunder),
    cue('ArmCue', 'S-7', '15', '', cueTarget=thunder),
    cue('DevampCue', 'S-8', '16', '', cueTarget=rain, devampType=1, fireNextCueAtMomentLoopEnds=False),
    cue('MemoCue', 'M-1', '17', 'Interval', armed=False),
    cue('StartCue', 'S-9', '18', 'points nowhere'),
]
# MIDI cues, a hotkey, a MIDI trigger and the group start modes, with the field names QLab 5.6.3 writes
midi_cues = [
    cue('MIDICue', 'MI-1', '20', 'Keys patch', messageType=1, status=4, channel=2, byte1=12, byte2=64, doFade=False, midiPatchID='', rawString=''),
    cue('MIDICue', 'MI-2', '21', 'LX go', messageType=2, command=1, commandFormat=1, deviceID=3, qNumber='12.5', qList='2', qPath='', macro=0, doFade=False, midiPatchID='', rawString=''),
    cue('MIDICue', 'MI-3', '22', 'Note', messageType=1, status=1, channel=1, byte1=60, byte2=100, doFade=False, midiPatchID='', rawString='',
        useHotKey=True, hotKey=Obj('F53HotKey', QLActionKeyKeyCharacter=55, QLActionKeyShift=True, QLActionKeyOption=False, QLActionKeyCommand=False, QLActionKeyControl=False),
        useMIDITrigger=True, midiTrigger=Obj('MidiTrigger', status=144, byte1=36, channel=10, byte1Operator=0, byte2=0, byte2Operator=0)),
]
entered = group('G-EN', '23', 'Phone call', 1, [cue('MemoCue', 'EN-1', '', 'ring', continueMode=1), cue('MemoCue', 'EN-2', '', 'answer')])
main = group('L-MAIN', '', 'Main Cue List', 0, [rain, storm, out, osc, dim, video, wait, playlist] + controls + midi_cues + [entered])
cart = group('L-CART', '', 'Stings', 5, [audio('A-STING', 'S1', 'Sting', '/shows/demo/audio/sting.wav', cartPosition=[2, 3]),
                                         audio('A-STING2', 'S2', 'Sting 2', '/shows/demo/audio/sting2.wav')], cartRows=2, cartColumns=3)
root_group = group('[root group of cue lists]', '', '', 3, [main, cart])

settings = {
    'General': {'minTimeBetweenGOs': 0.5, 'panicDuration': 2.0},
    'Network': {'networkPatches': [{'identifier': 'com.figure53.qlab.settings.network.patch', 'data': {
        'name': 'Lighting desk', 'uniqueID': 'PATCH-1', 'deviceIdentifier': 'com.figure53.oscmessage',
        'clientStates': [{'host': '10.0.0.20', 'port': 8000, 'useTcp': False}, {'host': '10.0.0.21', 'port': 8000, 'useTcp': False}]}}]},
}
workspace = {'workspaceName': 'Small Show', 'QLabShortVersionString': '5.6.3', 'QLabBuildNumber': 5603, 'uniqueID': 'WS-1', 'totalCues': 24,
             'settings': settings, 'cueLists': Archive().dump(root_group)}
here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, 'small.qlab5'), 'wb') as f:
    f.write(Archive().dump(workspace))
print('wrote small.qlab5')
