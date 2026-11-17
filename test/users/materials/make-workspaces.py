#!/usr/bin/env python3
"""Writes the QLab 5 workspaces two of the virtual users bring with them (test/users/README.md). Both are
made up: no cue in them comes from a real show. Their sound files are made by ../materials.js.

    python3 test/users/materials/make-workspaces.py
"""
import os, sys
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(here, '..', '..', 'fixtures'))
from qlab_archive import *

DB = lambda db: 10 ** (db / 20.0)
A = lambda name: '/Users/sound/Shows/' + name          # where "QLab last saw" the file; the copies sit in audio/ beside the workspace

# ── a play: the sound designer's workspace ────────────────────────────────
walk1 = audio('P-W1', '', 'Walk-in 1', A('walkin-1.wav'), level=DB(-10))
walk2 = audio('P-W2', '', 'Walk-in 2', A('walkin-2.wav'), level=DB(-10))
preshow = group('P-PRE', '0.5', 'Preshow music', 6, [walk1, walk2], notes='House opens at the half.')
pre_out = fade('P-PREOUT', 'Preshow out', preshow, 0.0, 6, stop=True, number='1', notes='With house lights.')
rain = audio('P-RAIN', '2', 'Rain bed', A('rain.wav'), level=DB(-12), infiniteLoop=True, colorName='blue', notes='"It never stops in this town."')
thunder = audio('P-THUN', '', 'Thunder', A('thunder.wav'), level=DB(-3))
dip = fade('P-DIP', 'Rain dips', rain, DB(-22), 0.5)
back = fade('P-BACK', 'Rain returns', rain, DB(-12), 3, preWait=6)
storm = group('P-STORM', '3', 'Thunder (rain dips under it)', 3, [thunder, dip, back], colorName='orange')
phone = audio('P-PHONE', '4', 'Phone rings', A('phone.wav'), level=DB(-6), infiniteLoop=True, notes='Until she picks up.')
phone_stop = cue('StopCue', 'P-PSTOP', '5', 'Phone answered', cueTarget=phone)
door = audio('P-DOOR', '6', 'Door slam', A('door.wav'), preWait=0.5)
letter = audio('P-LETTER', '7', 'Underscore: the letter', A('letter.wav'), level=DB(-8), continueMode=1, colorName='purple')
letter_out = fade('P-LOUT', 'Underscore out', letter, 0.0, 8, stop=True, number='8', preWait=20)
msc = cue('MIDICue', 'P-MSC', '9', 'LX console GO (MSC)', continueMode=1)
rain_out = fade('P-ROUT', 'Rain out', rain, 0.0, 10, stop=True, number='10')
interval = audio('P-INT', '11', 'Interval music', A('interval.wav'), level=DB(-10), useHotKey=True)
wind = audio('P-WIND', '', 'Wind', A('wind.wav'), level=DB(-9), infiniteLoop=True)
thunder2 = audio('P-THUN2', '', 'Thunder, close', A('thunder.wav'), startTime=0.5)
act2 = group('P-ACT2', '12', 'Act 2: the storm returns', 1, [wind, thunder2])
blackout = cue('MemoCue', 'P-BO', '13', 'Blackout: everything out', fadeAndStopOthers=True, fadeAndStopOthersTime=3)
bows = audio('P-BOWS', '14', 'Curtain call', A('bows.wav'), level=DB(-4))
main = group('P-MAIN', '', 'Main Cue List', 0, [preshow, pre_out, rain, storm, phone, phone_stop, door, letter, letter_out, msc, rain_out, interval, act2, blackout, bows])
stings = group('P-CART', '', 'Rehearsal stings', 5, [audio('P-S1', 'S1', 'Doorbell', A('door.wav')), audio('P-S2', 'S2', 'Thunder', A('thunder.wav'))])
write_workspace(os.path.join(here, 'glass-orchard.qlab5'), 'The Glass Orchard', [main, stings])

# ── a musical: the playback operator's workspace ──────────────────────────
def song(n, name, track, click, slices=(), **more):
    t = audio('M-T%d' % n, '', name + ' track', A(track), level=DB(-6), slices=list(slices), **more)
    c = audio('M-C%d' % n, '', name + ' click', A(click), level=0.0, extra=[knob(0, 3, 1.0), knob(0, 4, 1.0)])     # the click goes to outputs 3 and 4 only
    return t, group('M-G%d' % n, str(n * 10), name, 3, [t, c], colorName='green')

open_t, opening = song(1, 'Opening', 'opening.wav', 'click-opening.wav', [Obj('AudioSlice', time=16.0, playCount=1, infiniteLoop=False), Obj('AudioSlice', time=24.0, playCount=1, infiniteLoop=True)])
opening.fields['notes'] = Obj('NSAttributedString', NSString='Vamp bars 9-12 until the scene change is done.')
open_devamp = cue('DevampCue', 'M-D1', '11', 'Out of the vamp', cueTarget=open_t, devampType=1, fireNextCueAtMomentLoopEnds=False)
open_out = fade('M-F1', 'Opening button', open_t, 0.0, 2, stop=True, number='12')
ballad_t, ballad = song(2, 'Ballad', 'ballad.wav', 'click-ballad.wav')
patch = cue('MIDICue', 'M-MIDI', '21', 'Keys 2 patch change')
verb = cue('MicCue', 'M-MIC', '22', 'Reverb return up')
ballad_out = fade('M-F2', 'Ballad out', ballad_t, 0.0, 4, stop=True, number='23')
finale_t, finale = song(3, 'Finale', 'finale.wav', 'click-finale.wav', [Obj('AudioSlice', time=20.0, playCount=4, infiniteLoop=False), Obj('AudioSlice', time=30.0, playCount=1, infiniteLoop=True)], rate=1.0)
fin_devamp = cue('DevampCue', 'M-D3', '31', 'Out of the bows vamp', cueTarget=finale_t, devampType=1, fireNextCueAtMomentLoopEnds=False)
fin_load = cue('LoadCue', 'M-L3', '32', 'Rehearsal: Finale from bar 33', cueTarget=finale_t, loadTime=30.0, armed=False)
fin_out = fade('M-F3', 'Finale button', finale_t, 0.0, 1.5, stop=True, number='33')
ltc = cue('TimecodeCue', 'M-TC', '40', 'Timecode to the lighting desk')
tracks = group('M-MAIN', '', 'Tracks', 0, [opening, open_devamp, open_out, ballad, patch, verb, ballad_out, finale, fin_devamp, fin_load, fin_out, ltc])
write_workspace(os.path.join(here, 'songbook.qlab5'), 'Songbook', [tracks])
print('wrote glass-orchard.qlab5, songbook.qlab5')
