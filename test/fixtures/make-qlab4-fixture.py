#!/usr/bin/env python3
"""Writes test/fixtures/small.qlab4: a made-up workspace in the shape QLab 4 saves, for the importer's tests.
The shape (where QLab 4 differs from QLab 5) was read from a real QLab 4.7 workspace; nothing in this file is from it.

    python3 test/fixtures/make-qlab4-fixture.py
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from qlab_archive import *

here = os.path.dirname(os.path.abspath(__file__))

def audio4(uid, number, name, rel, level=1.0, **more):
    # QLab 4: the path beside the workspace is on the cue; the file record only knows where it last saw the file;
    # there is always an end time, and nothing says how long the file is
    return cue('AudioCue', uid, number, name, levels=matrix(level), relativePath=rel,
               fileTarget=Obj('F53Alias', bookmark=b'', lastKnownPath='/Users/someone-else/Show/' + rel),
               startTime=float(more.pop('startTime', 0)), endTime=float(more.pop('endTime', 60)), infiniteLoop=more.pop('infiniteLoop', False),
               playCount=1, rate=1.0, slices=[], doFade=False, effects=[], patch=1, **more)

bed = audio4('A-1', 'Q1', 'Bed', 'audio/four-bed.wav', level=0.5, endTime=2.0, continueMode=1, postWait=3.0)
sting = audio4('A-2', 'Q2', 'Sting', 'audio/four-sting.wav', startTime=0.5, endTime=1.0)
entry = Obj('FadeValueEntry', row=0, column=0, startValue=0.5, endValue=0.25, live=True, gang=None, userOrder=0)
dip = cue('FadeCue', 'F-1', 'Q3', 'Dip the bed', cueTarget=bed, cueTargetUniqueID='A-1', duration=2.0, mode=0, stopTargetWhenDone=False,
          fade=Obj('Fade', fadeType='relative', entries={0: entry}, stopTargetWhenDone=False, duration=2.0))
osc = cue('OSCCue', 'N-1', 'Q4', 'Lights', customString='/eos/cue/1/5/fire', patch=1, messageType=1, duration=0.0)
main = group('L-MAIN', '', 'Main Cue List', 0, [bed, sting, dip, osc])
root_group = group('[root group of cue lists]', '', '', 3, [main])
settings = {
    'General': {'minTimeBetweenGOs': 0.0, 'panicDuration': 1.5},
    'OSC': {'clientState': [{'useTcp': False, 'userData': '', 'interface': '', 'host': '10.0.0.20', 'port': 8000}], 'types': {'1': 'address'}},
}
workspace = {'workspaceName': 'Small Four', 'QLabShortVersionString': '4.7', 'QLabBuildNumber': 4700, 'uniqueID': 'WS-4', 'totalCues': 4,
             'settings': settings, 'cueLists': Archive().dump(root_group)}
with open(os.path.join(here, 'small.qlab4'), 'wb') as f:
    f.write(Archive().dump(workspace))
# the two sounds beside it, so that "found beside the workspace" has something to find (a few samples of silence each)
import struct
os.makedirs(os.path.join(here, 'audio'), exist_ok=True)
for name in ('four-bed.wav', 'four-sting.wav'):
    data = b'\x00\x00' * 8
    with open(os.path.join(here, 'audio', name), 'wb') as f:
        f.write(b'RIFF' + struct.pack('<I', 36 + len(data)) + b'WAVEfmt ' + struct.pack('<IHHIIHH', 16, 1, 1, 8000, 16000, 2, 16) + b'data' + struct.pack('<I', len(data)) + data)
print('wrote small.qlab4')
