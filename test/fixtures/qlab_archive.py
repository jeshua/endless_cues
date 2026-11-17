"""The shape QLab 5 saves a workspace in (a keyed archive with its cue lists as a second archive inside), enough
of it to write made-up workspaces for the importer's tests and for the virtual users (test/users)."""
import os, plistlib
from plistlib import UID


class Archive:
    def __init__(self):
        self.objects = ['$null']
        self.classes = {}
        self.seen = {}

    def cls(self, name, parents):
        if name not in self.classes:
            self.objects.append({'$classname': name, '$classes': [name] + parents})
            self.classes[name] = UID(len(self.objects) - 1)
        return self.classes[name]

    def add(self, v):
        if v is None:
            return UID(0)
        if isinstance(v, Obj):
            if id(v) in self.seen:
                return self.seen[id(v)]
            self.objects.append(None)
            uid = UID(len(self.objects) - 1)
            self.seen[id(v)] = uid
            out = {'$class': self.cls(v.name, ['Cue', 'NSObject'] if v.name.endswith('Cue') else ['NSObject'])}
            for k, x in v.fields.items():
                out[k] = x if isinstance(x, (bool, int, float)) else self.add(x)
            self.objects[uid.data] = out
            return uid
        if isinstance(v, dict):
            self.objects.append(None)
            uid = UID(len(self.objects) - 1)
            keys = [self.add(k) for k in v]
            self.objects[uid.data] = {'$class': self.cls('NSMutableDictionary', ['NSDictionary', 'NSObject']), 'NS.keys': keys, 'NS.objects': [self.add(x) for x in v.values()]}
            return uid
        if isinstance(v, list):
            self.objects.append(None)
            uid = UID(len(self.objects) - 1)
            self.objects[uid.data] = {'$class': self.cls('NSMutableArray', ['NSArray', 'NSObject']), 'NS.objects': [self.add(x) for x in v]}
            return uid
        if isinstance(v, bytes):
            self.objects.append({'$class': self.cls('NSMutableData', ['NSData', 'NSObject']), 'NS.data': v})
            return UID(len(self.objects) - 1)
        self.objects.append(v)
        return UID(len(self.objects) - 1)

    def dump(self, root):
        top = self.add(root)
        return plistlib.dumps({'$version': 100000, '$archiver': 'NSKeyedArchiver', '$top': {'root': top}, '$objects': self.objects}, fmt=plistlib.FMT_BINARY)


class Obj:
    def __init__(self, kind, **fields):
        self.name, self.fields = kind, fields


def knob(row, column, level):
    return Obj('AudioLevelKnobs', row=row, column=column, initialLevel=level, trimLevel=1.0, gang=None)


def matrix(main, extra=()):
    entries = {0: knob(0, 0, main), 1: knob(0, 1, 1.0), 2: knob(0, 2, 1.0), 1026: knob(1, 1, 1.0), 2052: knob(2, 2, 1.0)}
    for i, k in enumerate(extra):
        entries[5000 + i] = k
    return Obj('AudioLevelMatrix', entries=entries, rows=1025, columns=1025, gangs={})


def cue(kind, uid, number='', name='', **more):
    base = dict(uniqueID=uid, number=number, name=name, notes=Obj('NSAttributedString', NSString=more.pop('notes', '')),
                colorName=more.pop('colorName', 'none'), flagged=False, armed=more.pop('armed', True),
                preWait=float(more.pop('preWait', 0)), postWait=float(more.pop('postWait', 0)), continueMode=more.pop('continueMode', 0),
                useHotKey=more.pop('useHotKey', False), useMIDITrigger=False, useWallClock=False, useTimecode=False, duckOthers=False,
                secondTriggerAction=0, skipIfDisarmed=False, fadeAndStopOthers=more.pop('fadeAndStopOthers', False), fadeAndStopOthersTime=float(more.pop('fadeAndStopOthersTime', 1)),
                cueTarget=more.pop('cueTarget', None), cueTargetUniqueID=None, fileTarget=None)
    if base['cueTarget'] is not None:
        base['cueTargetUniqueID'] = base['cueTarget'].fields['uniqueID']
    base.update(more)
    return Obj(kind, **base)


def audio(uid, number, name, path, level=1.0, **more):
    return cue('AudioCue', uid, number, name, levels=matrix(level, more.pop('extra', ())),
               fileTarget=Obj('F53Alias', bookmark=b'', lastKnownPath=path, relativePath='audio/' + os.path.basename(path)),
               startTime=float(more.pop('startTime', 0)), endTime=float(more.pop('endTime', 60)), lastSeenFileDuration=60.0, infiniteLoop=more.pop('infiniteLoop', False),
               playCount=more.pop('playCount', 1), rate=float(more.pop('rate', 1)), slices=more.pop('slices', []), doFade=False, effects=[], **more)


def fade(uid, name, target, to, duration, mode=0, stop=False, **more):
    entry = Obj('FadeValueEntry', row=0, column=0, startValue=0.0, endValue=to, live=True, valueMapping=0, gang=None, userOrder=0)
    return cue('FadeCue', uid, more.pop('number', ''), name, cueTarget=target, duration=float(duration), mode=mode, stopTargetWhenDone=stop, targetMode=0,
               doRate=False, doOpacity=False, doTranslation=False, doScale=False, doRotation=False,
               fade=Obj('Fade', entries={0: entry}, stopTargetWhenDone=stop, duration=float(duration)), **more)


def group(uid, number, name, mode, cues, **more):
    return cue('GroupCue', uid, number, name, groupMode=mode, cues=cues, syncToTimecode=False, **more)


def write_workspace(path, name, lists, settings=None, version='5.6.3'):
    """lists: the cue lists (groups of mode 0, or 5 for a cart)."""
    root = group('[root group of cue lists]', '', '', 3, lists)
    count = [0]
    def walk(o):
        count[0] += 1
        for c in o.fields.get('cues', []):
            walk(c)
    for l in lists:
        for c in l.fields['cues']:
            walk(c)
    workspace = {'workspaceName': name, 'QLabShortVersionString': version, 'QLabBuildNumber': 5603, 'uniqueID': 'WS-' + name, 'totalCues': count[0],
                 'settings': settings or {'General': {'minTimeBetweenGOs': 0.5, 'panicDuration': 2.0}, 'Network': {'networkPatches': []}},
                 'cueLists': Archive().dump(root)}
    with open(path, 'wb') as f:
        f.write(Archive().dump(workspace))
