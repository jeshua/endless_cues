/**
 * Double-GO protection, for every way a GO can arrive.
 *
 * QLab's "minimum time between GOs" covers its GO button and key; a cue's own trigger (a hotkey, an OSC or MIDI
 * message) is not covered, so a bouncing button or a sensor that sends twice starts a cue twice. Here one setting
 * (Settings ▸ General ▸ Double-GO protection, `settings.go.doubleGoProtection`, seconds) covers both:
 *
 *   - a GO, whoever sends it (the GO button, Space, the web remote, OSC /go, a MIDI or MSC GO, a remote built for
 *     QLab), within the time of the last GO that went, is ignored;
 *   - a cue started by its own trigger is not a GO (it never locks GO, and GO never locks it), but the same trigger
 *     starting the same cue again within the time is ignored. A different trigger, or a different cue, goes.
 *
 *   const guard = createGoGuard({ now: () => ms, secs: () => setting })
 *   guard.go(from)            → true: it goes. false: ignored (and kept in `ignored()`)
 *   guard.trigger(key, from)  → the same for one trigger of one cue (`key` names both: "osc /sm/thunder · <cue id>")
 *   guard.lockLeft()          → ms the GO button stays locked for (it is drawn red meanwhile)
 *   guard.ignored()           → the last ones ignored, newest last: [{ at, kind: 'go' | 'trigger', key, from, after }]
 *
 * Pure: the clock is given.
 */
function createGoGuard({ now = () => Date.now(), secs = (): number => 0.3, keep = 50 } = {}) {
  let lastGo = -Infinity;
  const lastBy = new Map<string, number>();          // trigger key -> when it last started its cue
  const dropped: Ignored[] = [];
  const windowMs = () => Math.max(0, Number(secs()) || 0) * 1000;
  const drop = (kind: Ignored['kind'], key: string, from: string, after: number) => {
    dropped.push({ at: now(), kind, key, from: from || '', after: Math.round(after) });
    if (dropped.length > keep) dropped.shift();
    return false;
  };
  return {
    go(from = '') {
      const t = now(), w = windowMs();
      if (w > 0 && t - lastGo < w) return drop('go', 'GO', from, t - lastGo);
      lastGo = t;
      return true;
    },
    trigger(key: string, from = '') {
      const t = now(), w = windowMs();
      const was = lastBy.has(key) ? lastBy.get(key)! : -Infinity;
      if (w > 0 && t - was < w) return drop('trigger', key, from, t - was);
      lastBy.set(key, t);
      if (lastBy.size > 500) for (const [k, at] of lastBy) if (t - at > w) lastBy.delete(k);     // (old keys forgotten)
      return true;
    },
    lockLeft() { return Math.max(0, windowMs() - (now() - lastGo)); },
    ignored() { return dropped.slice(); },
  };
}

/** A GO or a trigger that was ignored: when, which, from where, and how soon after the last (ms). */
export interface Ignored { at: number; kind: 'go' | 'trigger'; key: string; from: string; after: number }
export type GoGuard = ReturnType<typeof createGoGuard>;

export { createGoGuard };
