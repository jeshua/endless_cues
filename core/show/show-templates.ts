/**
 * Show templates, and a show's settings as a file of their own.
 *
 * A template is a whole show kept to start others from: its lists and cues, its
 * buses, patches and modules (a venue's rig, a company's usual pre-show). A new
 * show made from one is a new show: its own id, no folder, nothing saved. Its
 * sounds are named by where they are on this computer, so the new show can play
 * them at once and Save brings them into its own folder.
 *
 * A settings file is only the settings and modules, to carry one show's rig into
 * another that already has cues: importing it is a list of show.set operations,
 * so it is one undoable edit, checked as every edit is.
 *
 * Neither ever holds a passcode or a key: those stay with the show they were set
 * in. Plain data in and out; the folder templates are kept in is the caller's.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as show from './show';
import { atomicWrite } from './versions';
import type { ShowDoc, Modules } from './types';
import type { Op } from './ops';

/** A show kept to start others from (a .ectemplate file). */
export interface Template { format: string; version: number; name: string; show: ShowDoc }
/** A show's settings as a file of their own (format SETTINGS). */
export interface SettingsFile { format: string; version: number; from: string; settings: ShowDoc['settings']; modules: Modules }

const TEMPLATE = 'endless-cues-template';
const SETTINGS = 'endless-cues-settings';
const secret = (k: string) => /pass|key|token|secret/i.test(k);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** A show's modules with every passcode and key emptied. */
function withoutSecrets(modules: Modules): Modules {
  const out = clone(modules || {}) as Modules;
  for (const m of Object.values(out) as Record<string, unknown>[]) if (m && typeof m === 'object') for (const k of Object.keys(m)) if (secret(k)) m[k] = '';
  return out;
}

/** A show as a template. `showDir`: where its sounds are, so they can be named from anywhere. */
function templateOf(doc: ShowDoc, { name = '', showDir = null }: { name?: string; showDir?: string | null } = {}): Template {
  const copy = clone(doc);
  copy.modules = withoutSecrets(copy.modules);
  show.walk(copy, (c) => { if (c.file && showDir && !path.isAbsolute(c.file)) c.file = path.join(showDir, c.file); });
  return { format: TEMPLATE, version: 1, name: String(name || doc.title || 'Template').trim(), show: copy };
}

/** A new show from a template: the same cues and settings under a new id, untitled. */
function showFrom(template: any, title = 'Untitled show'): ShowDoc {
  if (!template || template.format !== TEMPLATE || !template.show) throw new Error('not an Endless Cues template');
  const doc = show.normalise(template.show).doc;
  return { ...doc, id: show.newId('show'), title, modules: withoutSecrets(doc.modules) };
}

const safeName = (name: unknown) => String(name || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Template';

/** The templates in a folder, by name: [{ name, file }]. */
function list(dir: string) {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => /\.ectemplate$/i.test(n)).sort((a, b) => a.localeCompare(b)).map((n) => ({ name: n.replace(/\.ectemplate$/i, ''), file: path.join(dir, n) }));
}
function save(dir: string, template: Template) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${safeName(template.name)}.ectemplate`);
  atomicWrite(file, JSON.stringify(template, null, 2) + '\n');
  return { name: safeName(template.name), file };
}
function read(file: string): Template {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new Error('that template cannot be read'); }
  if (!raw || raw.format !== TEMPLATE) throw new Error('not an Endless Cues template');
  return raw;
}

/** A show's settings, as a file: { format, version, from, settings, modules }. */
function settingsOf(doc: ShowDoc): SettingsFile {
  return { format: SETTINGS, version: 1, from: doc.title, settings: clone(doc.settings), modules: withoutSecrets(doc.modules) };
}

/**
 * The operations that bring a settings file into `doc`: each group of settings and each module replaced by the
 * file's, and nothing else touched. The show's own passcodes and keys stay as they are. Throws when the file is
 * not one; ops.js refuses the batch if anything in it is not a setting this app can hold.
 */
function settingsOps(file: any, doc: ShowDoc): Op[] {
  if (!file || file.format !== SETTINGS || !file.settings || typeof file.settings !== 'object') throw new Error('not an Endless Cues settings file');
  if (Number(file.version) > 1) throw new Error('this settings file was written by a newer Endless Cues');
  const ops: Op[] = [];
  for (const k of Object.keys(show.defaultSettings())) if (file.settings[k] && typeof file.settings[k] === 'object') ops.push({ op: 'show.set', path: `settings.${k}`, value: file.settings[k] });
  for (const [id, m] of Object.entries(file.modules || {})) {
    if (!m || typeof m !== 'object' || !(id in show.defaultModules())) continue;
    const mine: Record<string, unknown> = (doc.modules || {})[id as keyof Modules] || {};
    ops.push({ op: 'show.set', path: `modules.${id}`, value: { ...m, ...Object.fromEntries(Object.keys(m).filter(secret).map((k) => [k, mine[k] || ''])) } });
  }
  return ops;
}

export { TEMPLATE, SETTINGS, templateOf, showFrom, list, save, read, settingsOf, settingsOps, withoutSecrets };
