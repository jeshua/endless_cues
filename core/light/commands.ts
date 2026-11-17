/**
 * Light commands: the text a Light cue holds its levels as, and what the dashboard's command line takes.
 *
 * One command a line, read top to bottom (a later line wins over an earlier one), in the manner of
 * QLab's light commands so that a person who knows those can read these:
 *
 *   front = 80              an instrument's intensity, as a percentage
 *   wash = 50               a group: each of its instruments
 *   all = 0                 every instrument
 *   cyc.red = 100           one parameter
 *   cyc.colour = #ff8800    red, green and blue at once
 *   1 - 6 = 75              instruments named by numbers, as a range
 *   1, 3, front = 75        a list
 *   mover.pan = home        back to where that parameter rests
 *   front = pass            leave it alone after all (an exception carved out of a group above it)
 *   # a note                a line starting # or // is not a command
 *
 * "full" is 100 and "out" is 0. A value is 0 to 100 whatever the parameter (pan and tilt too).
 * What is not read: QLab's "= cue A" (a level pulled from another cue) is reported as an error.
 *
 * Pure: `parse` knows nothing of the patch; `evaluate` looks the names up in a compiled patch
 * (core/light/patch.ts) and gives the levels, with what it could not understand line by line.
 */
import { keyOf } from './patch';
import type { CompiledPatch } from './patch';

/** What a command sets a parameter to. */
export type LightValue = { kind: 'home' } | { kind: 'pass' } | { kind: 'level'; v: number } | { kind: 'colour'; rgb: number[] };
/** One line of light commands, read. */
export interface LightCommand {
  line: number; text: string; targets: (string | { from: number; to: number })[]; param: string | null; value: LightValue | null; error?: string;
}
/** Levels by 'instrument.parameter', 0–100. */
export type Levels = Map<string, number>;

const round = (v: number, bits: number) => { const q = bits === 16 ? 100 : 10; return Math.round(v * q) / q; };

/** Text → [{ line, text, targets: [name | { from, to }], param, value: { kind, v?, rgb? }, error? }]. */
function parse(text: unknown): LightCommand[] {
  const out: LightCommand[] = [];
  for (const [i, raw] of String(text == null ? '' : text).split(/\r?\n/).entries()) {
    const src = raw.trim();
    if (!src || src.startsWith('#') || src.startsWith('//')) continue;
    const cmd: LightCommand = { line: i + 1, text: src, targets: [], param: null, value: null };
    out.push(cmd);
    const eq = src.indexOf('=');
    if (eq < 0) { cmd.error = 'a command is “name = level”'; continue; }
    let left = src.slice(0, eq).trim();
    const right = src.slice(eq + 1).trim().toLowerCase();
    const dot = left.lastIndexOf('.');
    if (dot >= 0) { cmd.param = left.slice(dot + 1).trim().toLowerCase(); left = left.slice(0, dot).trim(); if (cmd.param === 'color') cmd.param = 'colour'; }
    left = left.replace(/^\[(.*)\]$/, '$1');                 // QLab's ad-hoc group, [1 - 3]: here the same as the list
    for (const part of left.split(',').map((s) => s.trim())) {
      const r = /^(\d+)\s*-\s*(\d+)$/.exec(part);
      if (r) cmd.targets.push({ from: Number(r[1]), to: Number(r[2]) });
      else if (part) cmd.targets.push(part);
    }
    if (!cmd.targets.length) { cmd.error = 'no instrument or group is named'; continue; }
    if (cmd.param !== null && !/^[a-z][a-z0-9_]*$/.test(cmd.param)) { cmd.error = `“${cmd.param}” is not a parameter name`; continue; }
    const hex = /^#([0-9a-f]{6})$/.exec(right);
    const num = /^(-?\d+(?:\.\d+)?)\s*%?$/.exec(right);
    if (right === 'home' || right === 'pass') cmd.value = { kind: right };
    else if (right === 'full') cmd.value = { kind: 'level', v: 100 };
    else if (right === 'out' || right === 'off') cmd.value = { kind: 'level', v: 0 };
    else if (hex && cmd.param === 'colour') cmd.value = { kind: 'colour', rgb: [0, 2, 4].map((k) => Math.round(parseInt(hex[1].slice(k, k + 2), 16) / 2.55 * 10) / 10) };
    else if (hex) cmd.error = 'a colour (#rrggbb) is set on “.colour”';
    else if (num && cmd.param === 'colour') cmd.error = '“.colour” takes a colour (#rrggbb); a single level goes on .red, .green or .blue';
    else if (num) cmd.value = { kind: 'level', v: Math.max(0, Math.min(100, Number(num[1]))) };
    else if (/^cue\b/.test(right)) cmd.error = 'a level pulled from another cue (“= cue …”) is not read here: type the level';
    else cmd.error = `“${src.slice(eq + 1).trim()}” is not a level (0 to 100, full, out, home, pass)`;
  }
  return out;
}

/**
 * What a block of commands sets, against a patch: { levels: Map('instrument.parameter' → 0–100),
 * errors: [{ line, text, why }] }. A line that cannot be understood is left out and reported; the
 * rest still run (a cue with one bad line must not leave the stage dark).
 */
function evaluate(text: unknown, patch: CompiledPatch): { levels: Levels; errors: { line: number; text: string; why: string }[] } {
  const levels: Levels = new Map();
  const errors: { line: number; text: string; why: string }[] = [];
  for (const cmd of Array.isArray(text) ? (text as LightCommand[]) : parse(text)) {
    const fail = (why: string) => errors.push({ line: cmd.line, text: cmd.text, why });
    if (cmd.error) { fail(cmd.error); continue; }
    const insts: string[] = [];
    let bad = false;
    for (const t of cmd.targets) {
      if (typeof t === 'object') {
        const [a, b] = t.from <= t.to ? [t.from, t.to] : [t.to, t.from];
        if (b - a > 2048) { fail('that range is too long'); bad = true; break; }
        let any = false;
        for (let n = a; n <= b; n++) if (patch.instruments.has(String(n))) { insts.push(String(n)); any = true; }
        if (!any) { fail(`no instrument is numbered ${a} to ${b}`); bad = true; break; }
      } else {
        const r = patch.resolve(t);
        if (!r) { fail(`there is no instrument or group “${t}”`); bad = true; break; }
        insts.push(...r);
      }
    }
    if (bad) continue;
    let hit = 0;
    for (const key of new Set(insts)) {
      const def = patch.instruments.get(key)!.def;
      const value = cmd.value as LightValue;    // every line without an error has one
      const params = cmd.param === 'colour' ? (['red', 'green', 'blue'].every((c) => def.byKey.has(c)) ? ['red', 'green', 'blue'] : [])
        : cmd.param ? (def.byKey.has(cmd.param) ? [cmd.param] : []) : [def.default];
      // "front = pass" lets go of everything this cue said about it; "front.red = pass" of that one parameter
      if (value.kind === 'pass' && !cmd.param) { for (const p of def.params) levels.delete(`${key}.${p.key}`); hit++; continue; }
      params.forEach((p, i) => {
        const k = `${key}.${p}`;
        const info = def.byKey.get(p)!;
        if (value.kind === 'pass') levels.delete(k);
        else levels.set(k, value.kind === 'home' ? info.home : value.kind === 'colour' ? value.rgb[i] : round(value.v, info.bits));
        hit++;
      });
    }
    if (!hit) fail(cmd.param === 'colour' ? 'nothing named there has red, green and blue' : `nothing named there has a parameter “${cmd.param}”`);
  }
  return { levels, errors };
}

/** One level as a command line: "front = 80", "cyc.red = 100". */
function line(patch: CompiledPatch, key: string, value: unknown): string {
  const at = key.lastIndexOf('.');
  const inst = patch.instruments.get(key.slice(0, at));
  const param = key.slice(at + 1);
  const name = inst ? inst.name : key.slice(0, at);
  const v = Math.round(Number(value) * 100) / 100;
  return `${name}${inst && inst.def.default === param ? '' : `.${param}`} = ${v}`;
}

/** Levels as text a person can read: one line each, in patch order, an instrument's intensity before its other parameters. */
function format(levels: Levels, patch: CompiledPatch): string {
  const out: string[] = [];
  for (const inst of patch.instruments.values()) {
    for (const p of [inst.def.byKey.get(inst.def.default)!, ...inst.def.params.filter((x) => x.key !== inst.def.default)]) {
      const k = `${inst.key}.${p.key}`;
      if (levels.has(k)) out.push(line(patch, k, levels.get(k)));
    }
  }
  return out.join('\n');
}

/**
 * A cue's text with some levels changed (the dashboard's Update): a line that set exactly that one
 * level is rewritten where it stands; anything else is added at the end, where it wins.
 */
function merge(text: unknown, levels: Levels, patch: CompiledPatch): string {
  const left = new Map(levels);
  const lines = String(text || '').split(/\r?\n/);
  const out = lines.map((raw) => {
    const [cmd] = parse(raw);
    if (!cmd || cmd.error || cmd.targets.length !== 1 || typeof cmd.targets[0] !== 'string' || cmd.param === 'colour') return raw;
    const inst = patch.instruments.get(keyOf(cmd.targets[0]));
    if (!inst) return raw;
    const k = `${inst.key}.${cmd.param || inst.def.default}`;
    if (!left.has(k)) return raw;
    const v = left.get(k); left.delete(k);
    return line(patch, k, v);
  });
  const more = format(left, patch);
  return [...out.filter((l, i) => l.trim() || i < out.length - 1), ...(more ? [more] : [])].join('\n').trim();
}

export { parse, evaluate, format, merge, line };
