/**
 * The open show: the working document, its undo stack, its saved versions and
 * any change waiting for review.
 *
 * Every edit is an `edit(ops)`: applied whole or not at all (ops.js), heard and
 * seen at once, and undoable — but NOT kept. Nothing reaches show.json until
 * `save()`, which writes the file and records a version (versions.js). Until
 * then `unsaved()` says exactly what is pending, change by change, so the app
 * can mark each changed control, put one back, and warn before quitting. (It
 * used to save every move the moment it was made, which is how an accidental
 * nudge of a level became the show.)
 *
 * Pending edits are not lost to a crash: they are journalled beside the show
 * (show.unsaved.json) and offered back, still unsaved, the next time it opens.
 *
 * A proposal is a batch of ops shown as a diff before anyone accepts it — the
 * assistant never edits a show directly, it proposes; accepting is one
 * undoable, unsaved edit like any other.
 * A proposal may also carry a few text files for the show folder (prop firmware,
 * the guide for coding agents: files.js says which are allowed), written when
 * it is accepted; a proposal may be files alone. Undo takes back the change to
 * the show and leaves the files.
 *
 * Emits 'change' ({ doc, reason }) after anything that alters the document.
 * Plain node: the disk is the only side effect, and `showDir: null` keeps
 * even that away (tests, an untitled show).
 */
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import * as show from './show';
import { applyOps } from './ops';
import { diffShows, describe, summary } from './diff';
import * as versions from './versions';
import * as showFiles from './files';
import type { ShowDoc } from './types';
import type { Op } from './ops';
import type { Change } from './diff';
import type { VersionEntry } from './versions';
import type { ShowFile, CheckedFile } from './files';

/** A step of undo or redo: the document as it was (its text), and what the step was called. */
interface UndoStep { doc: string; label: string }

/** A change waiting for review: its ops (null: a whole draft), the document it would make, and the show it was made against (`base`, a hash). */
export interface Proposal {
  id: string;
  summary: string;
  author: string;
  ops: Op[] | null;
  doc: ShowDoc;
  base: string;
  changes: Change[];
  counts: ReturnType<typeof summary> & { files: number };
  made: string[];
  files: CheckedFile[];
}

/** What an edit (or an accepted proposal) did: the cues it made, their refs, whether anything changed, and the files it wrote. */
export interface Edited { made: string[]; refs?: Record<string, string>; changed: boolean; files?: string[] }

/** What 'change' is emitted with. */
export interface DocChange { doc: ShowDoc; reason: string }

const UNDO_MAX = 200;

class ShowDocument extends EventEmitter {
  showDir: string | null;
  warnings: string[];
  undoStack: UndoStep[];
  redoStack: UndoStep[];
  proposal: Proposal | null;
  displaced: Proposal | null;
  proposalSeq: number;
  doc: ShowDoc;
  saved: ShowDoc;
  assisted: boolean;
  recovered: boolean;
  made: boolean;
  localOnly: boolean;
  pendingCache: { doc: ShowDoc; saved: ShowDoc; changes: Change[] } | null;

  constructor({ showDir = null, doc = null }: { showDir?: string | null; doc?: unknown } = {}) {
    super();
    this.showDir = showDir;
    this.warnings = [];
    this.undoStack = [];      // { doc (text), label }
    this.redoStack = [];
    this.proposal = null;     // { id, summary, ops, doc, changes, author }
    this.displaced = null;    // the proposal the waiting one took the place of (withdraw brings it back)
    this.proposalSeq = 0;
    this.doc = doc ? show.normalise(doc).doc : show.newShow();
    this.saved = this.doc;    // the document as it is on disk (a new, untitled show: as it was made)
    this.assisted = false;    // an accepted proposal is among the unsaved changes (the version says so)
    this.recovered = false;   // opened with unsaved changes from last time
    this.made = false;        // open() made this show (its folder had none): it was made on this computer
    this.localOnly = false;   // a show from another computer, not turned on yet: a file on another computer's share is not opened (trust.js)
    this.pendingCache = null;
  }

  static filePath(showDir: string) { return path.join(showDir, 'show.json'); }
  static journalPath(showDir: string) { return path.join(showDir, 'show.unsaved.json'); }

  /** Open a show folder (made if it is not there). */
  static open(showDir: string, { title }: { title?: string } = {}) {
    const d = new ShowDocument({ showDir });
    const file = ShowDocument.filePath(showDir);
    if (fs.existsSync(file)) {
      const r = show.normalise(JSON.parse(fs.readFileSync(file, 'utf8')));
      d.doc = d.saved = r.doc; d.warnings = r.warnings;
      // unsaved changes from a session that ended without saving or discarding them
      try {
        const j = show.normalise(JSON.parse(fs.readFileSync(ShowDocument.journalPath(showDir), 'utf8'))).doc;
        if (show.stringify(j) !== show.stringify(d.saved)) { d.doc = j; d.recovered = true; }
      } catch { /* none, or unreadable: the saved show is the show */ }
    } else {
      // a new show's folder gets a media/ for what is brought into it; a folder that already holds a person's files
      // (Start from a Folder) is left as it is: their sounds stay where they are, and media/ is made if one is ever needed
      let theirs = false; try { theirs = fs.readdirSync(showDir).some((n) => !n.startsWith('.')); } catch { /* no folder yet */ }
      fs.mkdirSync(theirs ? showDir : path.join(showDir, 'media'), { recursive: true });
      d.doc = d.saved = show.newShow(title || path.basename(showDir).replace(/\.ecshow$/i, ''));
      d.made = true;
      d.write();
    }
    return d;
  }

  /** The show file itself: only save() and a brand-new show call this. */
  write() {
    if (!this.showDir) return;
    fs.mkdirSync(this.showDir, { recursive: true });
    versions.atomicWrite(ShowDocument.filePath(this.showDir), show.stringify(this.doc));
    this.saved = this.doc;
    this.journal();
  }

  /** The crash journal: the working document while it differs from the saved one, nothing otherwise. */
  journal() {
    this.pendingCache = null;
    if (!this.showDir) return;
    const file = ShowDocument.journalPath(this.showDir);
    try {
      if (this.dirty) versions.atomicWrite(file, show.stringify(this.doc));
      else if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch { /* a journal that cannot be written must not stop an edit */ }
  }

  /** Whether anything is pending. */
  get dirty() { return this.doc !== this.saved && show.stringify(this.doc) !== show.stringify(this.saved); }

  /** What is pending, change by change (diff.js), from the saved show to the working one. */
  unsaved() {
    if (!this.pendingCache || this.pendingCache.doc !== this.doc || this.pendingCache.saved !== this.saved) {
      this.pendingCache = { doc: this.doc, saved: this.saved, changes: this.dirty ? diffShows(this.saved, this.doc) : [] };
    }
    return this.pendingCache.changes;
  }

  /** Keep what is pending: write the show and record a version of it. Returns the version (or null: nothing to save, no folder). */
  save({ note = '' }: { note?: string } = {}): (VersionEntry & { same?: boolean }) | null {
    if (!this.showDir) throw new Error('save the show to a folder first');
    const first = !versions.list(this.showDir).length;
    if (!this.dirty && !first) return null;
    const text = note || (first && !this.dirty ? 'first version' : describe(this.unsaved()));
    const author = this.assisted ? 'assistant' : 'you';
    this.write();
    this.assisted = false; this.recovered = false;
    const entry = versions.save(this.showDir, this.doc, { note: text || 'first version', author });
    this.emit('change', { doc: this.doc, reason: 'save' });
    return entry;
  }

  /** Throw away everything pending: the show as it was last saved. Undoable, like any edit. */
  revert() {
    if (!this.dirty) return false;
    this.undoStack.push({ doc: show.stringify(this.doc), label: 'revert to saved' });
    this.redoStack = [];
    this.doc = this.saved;
    this.assisted = false; this.recovered = false;
    this.journal();
    this.emit('change', { doc: this.doc, reason: 'revert' });
    return true;
  }

  /** Apply ops as one undoable edit. Throws (OpError) and changes nothing if they do not fit. */
  edit(ops: readonly Op[], { label = '', reason = 'edit' }: { label?: string; reason?: string } = {}): Edited {
    const r = applyOps(this.doc, ops);
    const before = show.stringify(this.doc);
    if (show.stringify(r.doc) === before) return { made: r.made, changed: false };
    this.undoStack.push({ doc: before, label });
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.doc = r.doc;
    this.journal();
    this.emit('change', { doc: this.doc, reason });
    return { made: r.made, refs: r.refs, changed: true };
  }

  undo() { return this.step(this.undoStack, this.redoStack, 'undo'); }
  redo() { return this.step(this.redoStack, this.undoStack, 'redo'); }
  step(from: UndoStep[], to: UndoStep[], reason: string): string | boolean {
    const s = from.pop();
    if (!s) return false;
    to.push({ doc: show.stringify(this.doc), label: s.label });
    this.doc = show.normalise(JSON.parse(s.doc)).doc;
    this.journal();
    this.emit('change', { doc: this.doc, reason });
    return s.label || true;
  }

  // ── versions ──────────────────────────────────────────────────────────

  listVersions() { return this.showDir ? versions.list(this.showDir) : []; }

  /** (The older name: a version is what a save records.) */
  saveVersion(opts: { note?: string } = {}) {
    const all = this.showDir ? versions.list(this.showDir) : [];
    return this.save(opts) || { ...all[all.length - 1], same: true };
  }

  /** What a version differs by from the show as it is now (or from another version). */
  compareVersion(id: string, otherId: string | null = null) {
    const a = versions.read(this.showDir!, id);
    const b = otherId ? versions.read(this.showDir!, otherId).doc : this.doc;
    const changes = diffShows(a.doc, b);
    return { entry: a.entry, changes, summary: summary(changes) };
  }

  /** Go back to a version: an edit like any other (undo brings back what was there; it is not kept until saved). */
  restoreVersion(id: string) {
    const { entry, doc } = versions.read(this.showDir!, id);
    const before = show.stringify(this.doc);
    if (show.stringify(doc) === before) return entry;
    this.undoStack.push({ doc: before, label: `restore ${entry.id}` });
    this.redoStack = [];
    this.doc = doc;
    this.journal();
    this.emit('change', { doc: this.doc, reason: 'restore' });
    return entry;
  }

  /** The working document becomes `doc` (a backup, a settings-only copy): an edit like any other, undoable and not kept until saved. */
  replace(doc: unknown, { label = 'restore', reason = 'restore' }: { label?: string; reason?: string } = {}) {
    const next = show.normalise(doc).doc;
    const before = show.stringify(this.doc);
    if (show.stringify(next) === before) return false;
    this.undoStack.push({ doc: before, label });
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.doc = next;
    this.journal();
    this.emit('change', { doc: this.doc, reason });
    return true;
  }

  // ── proposals (the assistant's edits, reviewed before they land) ─────────

  /** The files a proposal carries, checked (files.js): [] for none. Throws, with the sentence to show, when one may not be written. */
  filesFor(files: ShowFile[] | null | undefined): CheckedFile[] {
    if (!files || !files.length) return [];
    const r = showFiles.check(this.showDir, files);
    if (!r.ok) throw new Error(r.why);
    return r.files;
  }
  /** What a proposal is called when nobody named it. */
  static proposalText(changes: Change[], files: CheckedFile[]) {
    const f = files.length ? `${files.length} file${files.length === 1 ? '' : 's'} for the show folder` : '';
    return changes.length ? `${describe(changes)}${f ? ` · ${f}` : ''}` : f || describe(changes);
  }

  /** Stage ops for review. Throws if they do not apply; nothing changes until accept(). `files`: [{ path, text }] written on accept. */
  propose(ops: Op[], { summary: text = '', author = 'assistant', files = null }: { summary?: string; author?: string; files?: ShowFile[] | null } = {}): Proposal {
    const r = applyOps(this.doc, ops);
    const changes = diffShows(this.doc, r.doc);
    const carried = this.filesFor(files);
    this.displaced = this.proposal;
    this.proposal = { id: `p${++this.proposalSeq}`, summary: text || ShowDocument.proposalText(changes, carried), author, ops, doc: r.doc, base: show.hash(this.doc), changes, counts: { ...summary(changes), files: carried.length }, made: r.made, files: carried };
    this.emit('proposal', this.proposal);
    return this.proposal;
  }

  /** Stage a whole draft for review (the assistant's working copy, itself built only by edit operations). `files` as for propose:
   *  a draft that is the show as it stands, with files, is a proposal of files alone. */
  proposeDocument(draft: unknown, { summary: text = '', author = 'assistant', files = null }: { summary?: string; author?: string; files?: ShowFile[] | null } = {}): Proposal {
    const doc = show.normalise(draft).doc;
    const changes = diffShows(this.doc, doc);
    const carried = this.filesFor(files);
    this.displaced = this.proposal;
    this.proposal = { id: `p${++this.proposalSeq}`, summary: text || ShowDocument.proposalText(changes, carried), author, ops: null, doc, base: show.hash(this.doc), changes, counts: { ...summary(changes), files: carried.length }, made: [], files: carried };
    this.emit('proposal', this.proposal);
    return this.proposal;
  }

  /** The proposal lands: one undoable edit, pending like any other until the show is saved. */
  accept(id?: string | null): Edited {
    const p = this.proposal;
    if (!p || (id && p.id !== id)) throw new Error('no such proposal');
    if (p.base !== show.hash(this.doc)) throw new Error('the show changed since this was proposed; ask again');
    // its files first, checked again against the folder as it is now: if one cannot be written, nothing has changed
    // and the proposal is still waiting
    const written = p.files && p.files.length ? showFiles.write(this.showDir!, p.files) : [];
    this.proposal = null; this.displaced = null;
    let r: Edited;
    if (p.ops) r = this.edit(p.ops, { label: p.summary, reason: 'proposal' });
    else {
      // a draft: the working document becomes it, as one undoable step
      const before = show.stringify(this.doc);
      r = { made: [], changed: show.stringify(p.doc) !== before };
      if (r.changed) {
        this.undoStack.push({ doc: before, label: p.summary });
        if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
        this.redoStack = [];
        this.doc = p.doc;
        this.journal();
        this.emit('change', { doc: this.doc, reason: 'proposal' });
      }
    }
    if (r.changed) this.assisted = true;
    if (written.length) r = { ...r, files: written };
    this.emit('proposal', null);
    return r;
  }

  reject(id?: string | null) {
    if (!this.proposal || (id && this.proposal.id !== id)) return false;
    this.proposal = null; this.displaced = null;
    this.emit('proposal', null);
    return true;
  }

  /**
   * Take back a proposal that should never have been waiting (the turn that staged it failed before it ended).
   * Unlike reject, which is the person's answer, this puts back the proposal it had taken the place of, when
   * that one still fits the show: a turn that goes wrong leaves the review as it found it.
   */
  withdraw(id?: string | null) {
    if (!this.proposal || (id && this.proposal.id !== id)) return false;
    const was = this.displaced;
    this.proposal = was && was.base === show.hash(this.doc) ? was : null;
    this.displaced = null;
    this.emit('proposal', this.proposal);
    return true;
  }

  /** Where a cue's file is on disk: relative to the show folder unless absolute. */
  resolveFile(file: string | null | undefined) {
    if (!file) return null;
    // (\\host\share and //host/share: not touched for a show from another computer until it is turned on)
    if (this.localOnly && /^[\\/]{2}/.test(String(file))) return null;
    if (path.isAbsolute(file)) return file;
    return this.showDir ? path.join(this.showDir, file) : null;
  }
}

export { ShowDocument };
