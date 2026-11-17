/**
 * How cues run one after another: the parts of the cue engine that are about sequence rather than sound.
 *
 *  - the playhead to the next or the previous cue that needs a GO of its own (`=` and `-`);
 *  - what a cue does when it is fired again while it is still running (its "second trigger"), and what
 *    letting go of its hotkey does;
 *  - a cue that ducks (or boosts) everything else for as long as it runs;
 *  - how far "fade & stop others" reaches (everything, the cue's list, its peers);
 *  - "start one at random" as a deal: every child once before any comes again;
 *  - Reset and Target cues;
 *  - a Devamp that starts the next cue when the loop ends.
 *
 * These are methods of CueEngine (cue-engine.js installs them); they are here so that file stays about
 * what a cue does and this one about when.
 */
import type { CueEngine, EngineCue } from './cue-engine';
import { geometryOf } from '../video/stage';

export function sequencing({ SILENT_DB }: { SILENT_DB: number }) {
  return {

    // ── the playhead ──────────────────────────────────────────────────────

    /** `=` and `-`: the playhead to the next (or the previous) cue that needs a GO: one the cue before it does
     *  not continue into. Returns whether there was one. */
    moveSequence(step: number) {
      const top = this.steps();
      const starts = top.map((c, i) => i).filter((i) => i === 0 || !(top[i - 1].autoContinue || top[i - 1].autoFollow));
      let at = top.findIndex((c) => c.id === this.playhead);
      if (at < 0) at = step > 0 ? -1 : top.length;            // off the end of the list: "previous" is the last sequence
      const to = step > 0 ? starts.find((i) => i > at) : starts.filter((i) => i < at).pop();
      if (to === undefined) return false;
      this.setPlayhead(top[to].id);
      return true;
    },

    /** The cue after `id` where it sits: the next stop of its list, or the next child of its group. */
    nextOf(id: string): EngineCue | null {
      const l = this.lists.find((x) => x.cues.some((c) => c.id === id));
      const beside = l ? this.steps(l.name) : (this.byId.get(this.parentOf.get(id)) || {}).children || [];
      const i = beside.findIndex((c) => c.id === id);
      return i >= 0 ? beside[i + 1] || null : null;
    },

    /** A cue that is about to be started by another takes the playhead past itself, as a continue does. */
    passHead(id: string) {
      const l = this.homes.get(id);
      if (!l || this.heads.get(l.name) !== id) return;
      const next = this.nextOf(id);
      this.heads.set(l.name, next ? next.id : null);
    },

    // ── a second trigger ──────────────────────────────────────────────────

    /** A cue fired again while it is running, with a `secondTrigger` other than "restart": that happens, and the
     *  cue is not started again. (nothing | panic: out over the panic time | stop: dead | devamp: out of its loop) */
    secondAction(cue: EngineCue) {
      const id = cue.id;
      this.log(`second trigger on ${cue.number || id} ${cue.name}: ${cue.secondTrigger}`);
      switch (cue.secondTrigger) {
        case 'panic': this.panicCue(id); break;
        case 'stop': this.following.delete(this.topOf(id)); this.leavePlaylists(id); this.stopTree(id); break;
        case 'devamp': for (const k of [...this.running.keys()]) if (this.within(k, id)) this.devamp(k); break;
        default: break;                                        // 'nothing'
      }
    },

    /** The key (or the note) that fired a cue was let go. A cue with `secondOnRelease` takes that as its second
     *  trigger: a sound that plays for as long as a key is held down. */
    released(id: string) {
      const cue = this.byId.get(id);
      if (!cue || !cue.secondOnRelease || !this.isLive(id)) return false;
      if (!cue.secondTrigger || cue.secondTrigger === 'restart') this.start(id);
      else { this.secondAction(cue); this.changed(); }
      return true;
    },

    /** One cue out as Esc takes everything out: what is sounding under it fades over the panic time and stops;
     *  what was waiting in it, or to follow it, does not happen. */
    panicCue(id: string) {
      this.following.delete(this.topOf(id));
      this.leavePlaylists(id);
      for (const k of [...this.waits.keys()]) if (this.within(k, id)) this.cancelWait(k);
      for (const [k, f] of [...this.fades]) if ((f.wait || f.run) && this.within(f.target, id)) { this.clock.clearTimeout(f.timer); this.fades.delete(k); }      // (and running timecode or a MIDI file: the host sees its entry go)
      for (const [k, r] of [...this.running]) {
        if (!this.within(k, id)) continue;
        if (r.pausedAt != null || !(this.panicFade > 0)) this.stopAudio(k);
        else this.fadeAudio(k, SILENT_DB, this.panicFade, true, `panic:${k}`);
      }
    },

    /** A sound out of its loop: one going round a section (or about to) plays on after this pass; one that loops
     *  whole finishes this pass and ends. Returns what it did, or null for a sound that is not looping. */
    devamp(key: string): 'let go' | 'disarmed' | 'armed' | 'last pass' | null {
      const r = this.running.get(key);
      if (!r) return null;
      if (r.region || r.loopTo) return this.holdOrLetGo(key, 'let go');
      if (!r.loop) return null;
      r.loop = false;
      this.audio.setLoop && this.audio.setLoop(key, false);
      this.log(`  ↳ ${(this.byId.get(key) || {}).name || key}: last pass`);
      return 'last pass';
    },

    // ── ducking the others while a cue runs ───────────────────────────────

    /** A cue with `duckOthers` has fired: every other sound moves by that many dB (down, or up for a boost) over
     *  `duckTime`, and comes back the same way when the cue has finished (checkDucks). The move is a layer of its
     *  own in the audio backend (`audio.duck`), so the sounds' own levels, fades and trims are not touched. */
    startDuck(cue: EngineCue) {
      const secs = Number(cue.duckTime) >= 0 && cue.duckTime != null ? Number(cue.duckTime) : 1;
      this.ducks.set(cue.id, { db: Number(cue.duckOthers), secs });
      this.applyDucks(secs);
    },

    /** Every running sound held where the cues ducking it say: the sum of them, a cue's own sounds left out. */
    applyDucks(secs: number) {
      for (const [k, r] of this.running) {
        if (r.still) continue;                                 // a still, a title or a camera has no sound to move
        if (this.busRule(k).live) continue;                    // a bus set to be left alone (its `noDuck`: microphones) is not one of "the others"
        let want = 0;
        for (const [id, d] of this.ducks) if (!this.within(k, id)) want += d.db;
        if (want === (r.duck || 0)) continue;
        r.duck = want;
        this.audio.duck && this.audio.duck(k, want, secs);
      }
    },

    /** A ducking cue that has finished (nothing waiting, sounding or fading under it): the others come back. */
    checkDucks() {
      if (!this.ducks.size) return;
      for (const [id, d] of [...this.ducks]) {
        if (this.byId.has(id) && this.isLive(id)) continue;
        this.ducks.delete(id);
        this.applyDucks(d.secs);
      }
    },

    // ── fade & stop others: how far it reaches ────────────────────────────

    /** Which cues are "the others" of a cue with `fadeOthersScope`: all of them, those of its list, or its peers
     *  (the cues beside it in its group; a top-level cue's peers are its list). */
    othersOf(cue: EngineCue): (id: string) => boolean {
      const home = this.homes.get(cue.id);
      const parent = this.parentOf.get(cue.id);
      if (cue.fadeOthersScope === 'peers' && parent) return (id: string) => this.isInside(id, parent);
      if (cue.fadeOthersScope === 'list' || cue.fadeOthersScope === 'peers') return (id: string) => this.homes.get(id) === home;
      return () => true;
    },

    // ── start one at random ───────────────────────────────────────────────

    /** The child a "start one at random" group fires: dealt like cards, so each plays once before any plays again,
     *  and a new round never opens with the child the last one closed on. */
    deal(cue: EngineCue, armed: EngineCue[]): EngineCue | null | undefined {
      if (!armed.length) return null;
      const d: { left: string[]; last: string | null } = this.dealt.get(cue.id) || { left: [], last: null };
      d.left = d.left.filter((id) => armed.some((c) => c.id === id));
      let from = d.left;
      if (!from.length) {
        d.left = armed.map((c) => c.id);
        from = d.left.length > 1 ? d.left.filter((id) => id !== d.last) : d.left;
      }
      const id = from[Math.floor(this.random() * from.length)];
      d.left = d.left.filter((x) => x !== id);
      d.last = id;
      this.dealt.set(cue.id, d);
      return this.byId.get(id);
    },

    // ── Reset and Target cues ─────────────────────────────────────────────

    /** A cue (and everything in it) put back as the show file has it: stopped, not loaded to any time, armed or
     *  disarmed as written, aimed where it was written to aim, a group back at its first child; and a Fade's
     *  effect undone: the sounds it moved, if they are still playing, are back at their own level (and a picture
     *  it moved is back where its own cue puts it). */
    resetCue(id: string) {
      const cue = this.byId.get(id);
      if (!cue) return false;
      this.following.delete(this.topOf(id));
      this.leavePlaylists(id);
      this.stopTree(id);
      const each = (c: EngineCue) => {
        this.loads.delete(c.id);
        this.loadAt.delete(c.id);
        if (this.loaded && this.loaded.id === c.id) this.loaded = null;
        this.armTouched.delete(c.id);
        if (c.armed === false) this.disarmed.add(c.id); else this.disarmed.delete(c.id);
        this.entered.delete(c.id);
        this.dealt.delete(c.id);
        this.ducks.delete(c.id);
        if (this.retargets.has(c.id)) { c.target = this.retargets.get(c.id)!.was; this.retargets.delete(c.id); this.holdsCache = new Map(); }
        for (const k of this.moved.get(c.id) || []) {
          const r = this.running.get(k);
          if (!r) continue;
          for (const fid of [c.id, `${c.id}:${k}`]) if (this.fades.has(fid)) { this.clock.clearTimeout(this.fades.get(fid)!.timer); this.fades.delete(fid); }
          if (r.band) this.fadeBand(k, 0, 0, `band:${k}`);
          if (!r.still) this.fadeAudio(k, Number((this.byId.get(k) || {}).gainDb) || 0, 0, false, `level:${k}`);
          if (r.pic) this.movePicture(k, geometryOf(this.byId.get(k) || {}), 0);      // (and its picture is back where its cue puts it)
        }
        this.moved.delete(c.id);
        for (const k of c.children || []) each(k);
      };
      each(cue);
      this.applyDucks(0);
      this.log(`RESET ${cue.number || id} ${cue.name}`);
      return true;
    },

    /** A Target cue: cue `id` is aimed at `to` from now on (until Reset, a Reset cue on it, or an edit to its
     *  target in the show). Refused when either is gone or `id` is a cue that has no target. */
    retarget(id: string, to: string) {
      const cue = this.byId.get(id);
      if (!cue || !('target' in cue) || !(this.byId.has(to) || this.listAt(to))) { this.log(`target cue: cannot aim ${id} at ${to}`); return false; }
      if (!this.retargets.has(id)) this.retargets.set(id, { was: cue.target, to });
      this.retargets.get(id)!.to = to;
      cue.target = to;
      this.holdsCache = new Map();
      this.log(`  ↳ ${cue.number || id} ${cue.name} now targets ${(this.byId.get(to) || this.listAt(to))!.name || to}`);
      return true;
    },

    /** After a reload: a cue a Target cue re-aimed stays re-aimed, unless its target was edited in the show
     *  meanwhile (the edit is the last word) or the cue it was aimed at has gone. */
    keepRetargets() {
      for (const [id, t] of [...this.retargets]) {
        const cue = this.byId.get(id);
        if (!cue || cue.target !== t.was || !(this.byId.has(t.to) || this.listAt(t.to))) { this.retargets.delete(id); continue; }
        cue.target = t.to;
      }
    },

    /** Whether a cue's sounds are decoded ahead while it stands by (`autoLoad`, on it or on a group it is in). */
    autoLoads(c: EngineCue) {
      for (let x: EngineCue | undefined = c; x; x = this.byId.get(this.parentOf.get(x.id))) if (x.autoLoad) return true;
      return false;
    },
  } satisfies ThisType<CueEngine>;
}

export type Sequencing = ReturnType<typeof sequencing>;
