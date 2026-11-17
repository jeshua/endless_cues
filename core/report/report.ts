/**
 * Report a problem: what one report is, and how it is sent to the service.
 *
 * docs/specs/17-service-protocol.md section 3 is the contract (POST /v1/reports, multipart, no account). This file
 * is that section in code, with no Electron in it: the window makes the picture (a WebP, because the service only
 * checks images and never re-encodes them), app/main/report.js gathers what the app knows, and everything here is
 * plain data and `fetch`, so it is tested against a fake server.
 *
 * What may go out is narrow on purpose (the protocol's "never send" list): the words the person wrote, the picture
 * they saw, the app's version and the system, and a small context in which anything that could carry a path with a
 * user's name, an address or a key has been through `scrubber` first.
 */
const ENDPOINT = 'https://api.endlesscues.com/v1/reports';

const LIMITS = {
  comment: 5000, appVersion: 40, os: 80, email: 254,
  context: 64 * 1024,
  screenshot: 8 * 1024 * 1024, screenshotSide: 2400,
  thumbnail: 256 * 1024, thumbnailSide: 480,
  total: 8.75 * 1024 * 1024,
  errors: 20, errorLength: 500,
};
const CATEGORIES = ['bug', 'idea', 'other'];
const ID = /^[A-Za-z0-9_.:-]{8,80}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A picture as it may arrive: bytes, a Buffer that went through JSON, or base64. */
export type Bytes = Uint8Array | ArrayBuffer | string | { type?: string; data?: number[] };
/** What the app gathers for one report (app/main/report.js): buildReport's input. */
export interface ReportInput {
  clientId?: string; submissionId?: string; category?: string; comment?: string; appVersion?: string; os?: string; email?: string;
  capturedAt?: string | number | Date; context?: Context | null; screenshot?: Bytes | null; thumbnail?: Bytes | null;
}
/** The protocol's form fields, by their names there (client_id, submission_id, category, comment, app_version, os, email, captured_at, context). */
export type ReportFields = Record<string, string>;
/** One report checked and in the protocol's words, ready for `formOf`. */
export interface Built { fields: ReportFields; files: Record<string, Uint8Array>; size?: number }
/** What the app knew at the moment of the picture (makeContext's input). */
export interface About {
  view?: string; mode?: string; selected?: { number?: string; type?: string } | null; cueCount?: number;
  audio?: { device?: string; sampleRate?: number; ok?: boolean } | null; locale?: string; log?: unknown[];
  issue?: string | null; includeShowName?: boolean; showName?: string;
}
/** The `context` field, before it is written as JSON. */
export interface Context {
  view?: string; mode?: string; selected_cue?: { number: string; type: string }; cue_count?: number;
  audio?: { device?: string; sample_rate?: number; ok?: boolean }; locale?: string; errors?: string[]; issue?: string; show_name?: string;
}
/** What an answer means for the app (outcomeOf). `kept`: the outbox has it on disk for later. */
export interface Outcome {
  sent?: boolean; id?: number; created?: boolean; status?: string;
  held?: string; retryAfter?: number; refused?: string; message?: string; detail?: string; kept?: boolean;
}
export interface SendOptions { url?: string; fetch?: typeof globalThis.fetch; userAgent?: string; token?: string; timeoutMs?: number }
/** The service's answer, as JSON (any of it may be missing). */
interface Answer { id?: unknown; created?: boolean; status?: string; retry_after?: unknown; error?: string; message?: string }
export type Scrub = (text: unknown) => string;

/** "macOS 15.1 arm64", "Windows 10.0.22631 x64", "Linux 6.8.0 x64": the `os` field. */
function osName(platform: string, version?: string, arch?: string) {
  const name = ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' } as Record<string, string>)[platform] || String(platform || 'unknown');
  return `${name} ${version || ''} ${arch || ''}`.replace(/\s+/g, ' ').trim().slice(0, LIMITS.os);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A function that takes the personal out of a line of text: this computer's home folder (and any other user's
 * folder) becomes `~`, the user's own name `<user>`, a network address `<address>`, an email `<email>`, and anything
 * that looks like a key or token `<key>`. Used on everything in `context` the app wrote (error lines, the audio
 * output's name), never on what the person typed themselves.
 */
function scrubber({ home = '', user = '' } = {}): Scrub {
  const homes: string[] = [];
  if (home && home.length > 1) { homes.push(home); if (home.includes('\\')) homes.push(home.replace(/\\/g, '/')); }
  const homeRe = homes.length ? new RegExp(homes.map(escapeRe).join('|'), 'gi') : null;
  // (a name of one or two letters would eat ordinary words: such a name is left to the folder rules above)
  const userRe = user && user.length >= 3 ? new RegExp(`(?<![A-Za-z0-9])${escapeRe(user)}(?![A-Za-z0-9])`, 'gi') : null;
  return (text) => {
    let t = String(text == null ? '' : text);
    if (homeRe) t = t.replace(homeRe, '~');
    t = t.replace(/(?:[A-Za-z]:)?[\\/](?:Users|home|Documents and Settings)[\\/][^\\/\s"'`:]+/gi, '~')
      .replace(/file:\/\/~/g, '~')
      // (what is left of a path under a home folder is only its file's name: the folders could name a show)
      .replace(/~[\\/][^\s"'`]*/g, (p) => { const parts = p.split(/[\\/]/); return parts.length > 2 ? `~/…/${parts[parts.length - 1]}` : p; });
    if (userRe) t = t.replace(userRe, '<user>');
    return t
      .replace(/\bBearer\s+\S+/gi, 'Bearer <key>')
      .replace(/\b(?:ec[lscd]_|sk-|sk_|xox[abprs]-|ghp_|gho_|AKIA)[A-Za-z0-9_-]{6,}/g, '<key>')
      .replace(/\b[A-Za-z0-9+_-]{32,}={0,2}/g, '<key>')
      .replace(/[^\s@<>"']+@[^\s@<>"']+\.[A-Za-z]{2,}/g, '<email>')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g, '<address>')
      // (IPv6: with a "::" or at least four colons, so a time like 20:15:03 is left alone)
      .replace(/(?<![\w:])(?=[0-9a-f:]*::|(?:[0-9a-f]{1,4}:){4})[0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7}(?![\w:])/gi, '<address>');
  };
}

/** Of the app's own log, the lines that say something went wrong: the last `LIMITS.errors`, each cut, each scrubbed. */
function errorLines(lines: unknown[] | null | undefined, scrub: Scrub) {
  const bad = (lines || []).filter((l) => /\b(error|uncaught|could not|cannot|failed|exception|refused)\b|\[page\]/i.test(String(l)));
  return bad.slice(-LIMITS.errors).map((l) => scrub(String(l)).slice(0, LIMITS.errorLength));
}

/**
 * The `context` object: what the app knew at the moment of the picture, small and with nothing personal in it.
 * `selected` is the one selected cue ({ number, type }) or nothing; `showName` goes in only with `includeShowName`.
 */
function makeContext(about: About = {}, scrub = scrubber()) {
  const out: Context = {};
  if (about.view) out.view = String(about.view).slice(0, 60);
  if (about.mode === 'edit' || about.mode === 'show') out.mode = about.mode;
  const sel = about.selected;
  if (sel && typeof sel === 'object' && sel.type) out.selected_cue = { number: String(sel.number || '').slice(0, 24), type: String(sel.type).slice(0, 24) };
  if (Number.isFinite(about.cueCount)) out.cue_count = Math.max(0, Math.round(about.cueCount!));
  if (about.audio && typeof about.audio === 'object') {
    const a: NonNullable<Context['audio']> = {};
    if (about.audio.device) a.device = scrub(about.audio.device).slice(0, 80);
    if (Number.isFinite(about.audio.sampleRate)) a.sample_rate = about.audio.sampleRate;
    if (about.audio.ok === false) a.ok = false;
    if (Object.keys(a).length) out.audio = a;
  }
  if (about.locale) out.locale = String(about.locale).slice(0, 20);
  const errors = errorLines(about.log, scrub);
  if (errors.length) out.errors = errors;
  // (the line the status bar offered to report, when the form was opened from there: core/report/issues.js)
  if (about.issue) out.issue = scrub(String(about.issue)).slice(0, LIMITS.errorLength);
  if (about.includeShowName && about.showName) out.show_name = String(about.showName).slice(0, 200);
  // (within 64 KB as text: the oldest errors go first)
  while (out.errors && JSON.stringify(out).length > LIMITS.context) { out.errors.shift(); if (!out.errors.length) delete out.errors; }
  return out;
}

/** A WebP file's own header: { width, height, animated }, or null when the bytes are not a WebP. */
function webpInfo(bytes: unknown) {
  const b = bytes instanceof Uint8Array ? bytes : null;
  if (!b || b.length < 30) return null;
  const str = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  if (str(0, 4) !== 'RIFF' || str(8, 4) !== 'WEBP') return null;
  const kind = str(12, 4);
  const u24 = (at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
  if (kind === 'VP8 ') {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff, animated: false };
  }
  if (kind === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, animated: false };
  }
  if (kind === 'VP8X') return { width: u24(24) + 1, height: u24(27) + 1, animated: !!(b[20] & 0x02) };
  return null;
}

/** A picture checked against its limits: null when it is fine, or the reason it is not. */
function pictureProblem(bytes: Uint8Array, side: number, max: number) {
  const info = webpInfo(bytes);
  if (!info) return 'not a WebP still';
  if (info.animated) return 'an animated WebP';
  if (Math.max(info.width, info.height) > side) return `larger than ${side} px`;
  if (bytes.length > max) return `over ${Math.round(max / 1024)} KB`;
  return null;
}

/**
 * One report, checked and in the protocol's words: { fields, files } ready for `formOf`, or { error } saying why
 * it cannot be sent as it is. A comment over the limit is cut (the service would cut it too); everything else that
 * is wrong is an error, because sending it would only be refused.
 */
function buildReport(r: ReportInput = {}): Built | { error: string; why?: string } {
  const fields: ReportFields = {};
  if (!ID.test(String(r.clientId || ''))) return { error: 'bad_client_id' };
  fields.client_id = r.clientId!;
  if (r.submissionId) { if (!ID.test(String(r.submissionId))) return { error: 'bad_submission_id' }; fields.submission_id = r.submissionId; }
  const category = r.category || 'bug';
  if (!CATEGORIES.includes(category)) return { error: 'bad_category' };
  fields.category = category;
  const comment = String(r.comment || '').trim().slice(0, LIMITS.comment);
  if (comment) fields.comment = comment;
  if (!r.appVersion) return { error: 'bad_app_version' };
  fields.app_version = String(r.appVersion).slice(0, LIMITS.appVersion);
  if (!r.os) return { error: 'bad_os' };
  fields.os = String(r.os).slice(0, LIMITS.os);
  const email = String(r.email || '').trim();
  if (email) { if (email.length > LIMITS.email || !EMAIL.test(email)) return { error: 'bad_email' }; fields.email = email; }
  if (r.capturedAt) fields.captured_at = new Date(r.capturedAt).toISOString();
  if (r.context && typeof r.context === 'object' && Object.keys(r.context).length) {
    const text = JSON.stringify(r.context);
    if (text.length > LIMITS.context) return { error: 'bad_context' };
    fields.context = text;
  }
  const files: Record<string, Uint8Array> = {};
  if (r.screenshot) {
    const shot = toBytes(r.screenshot);
    const why = pictureProblem(shot, LIMITS.screenshotSide, LIMITS.screenshot);
    if (why) return { error: 'bad_image', why: `the picture is ${why}` };
    files.screenshot = shot;
    if (r.thumbnail) {
      const thumb = toBytes(r.thumbnail);
      const whyThumb = pictureProblem(thumb, LIMITS.thumbnailSide, LIMITS.thumbnail);
      if (whyThumb) return { error: 'bad_image', why: `the thumbnail is ${whyThumb}` };
      files.thumbnail = thumb;
    }
  }
  if (!fields.comment && !files.screenshot) return { error: 'empty_report' };
  // (the whole request has a ceiling; the fields are small, the pictures are what could pass it)
  const size = Object.values(fields).reduce((n, v) => n + Buffer.byteLength(String(v)) + 120, 0) + Object.values(files).reduce((n, f) => n + f.length + 200, 0);
  if (size > LIMITS.total) return { error: 'too_large' };
  return { fields, files, size };
}

function toBytes(x: Bytes) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (x && typeof x === 'object' && x.type === 'Buffer' && Array.isArray(x.data)) return Uint8Array.from(x.data);
  if (typeof x === 'string') return new Uint8Array(Buffer.from(x, 'base64'));
  return new Uint8Array(0);
}

/** The multipart body. */
function formOf({ fields, files }: Built) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  for (const [k, bytes] of Object.entries(files || {})) form.append(k, new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' }), `${k}.webp`);
  return form;
}

/**
 * What an answer means for the app: `sent` (with the report's id), `held` (try again later: no connection, too many
 * reports, the service's own trouble; `retryAfter` in seconds when it said), or `refused` (sending the same again will
 * not help). The app decides from `error`, never from `message`; `message` is shown as it is.
 */
function outcomeOf(status: number, body: unknown): Outcome {
  const b: Answer = body && typeof body === 'object' ? body : {};
  if ((status === 200 || status === 201) && Number.isFinite(Number(b.id))) return { sent: true, id: Number(b.id), created: b.created !== false, status: b.status || 'open' };
  if (status === 429) return { held: 'rate_limited', retryAfter: Number(b.retry_after) > 0 ? Number(b.retry_after) : 3600, message: b.message || '' };
  if (status >= 500 || status === 0) return { held: b.error || 'server_error', retryAfter: Number(b.retry_after) > 0 ? Number(b.retry_after) : 0, message: b.message || '' };
  return { refused: b.error || `http_${status}`, message: b.message || '' };
}

/**
 * Send one built report. Never throws: a network failure (or no answer within `timeoutMs`) is `held: 'offline'`.
 * `url` is required: a test run has none unless it is given a fake one (main.js), so it can never reach the service.
 */
async function send(built: Built, { url, fetch: fetchImpl = globalThis.fetch, userAgent = '', token = '', timeoutMs = 30000 }: SendOptions = {}): Promise<Outcome> {
  if (!url) return { refused: 'no_endpoint', message: 'Reports are not sent from a test run.' };
  const headers: Record<string, string> = {};
  if (userAgent) headers['User-Agent'] = userAgent;
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers, body: formOf(built), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as { cause?: { code?: string }; name?: string } | null;
    return { held: 'offline', retryAfter: 0, message: '', detail: String((err && (err.cause && err.cause.code)) || (err && err.name) || err) };
  }
  let body: Answer | null = null;
  try { body = await res.json(); } catch { /* not JSON: judged by the status alone */ }
  const out = outcomeOf(res.status, body);
  // (the header is the protocol's too; it wins when the body did not say)
  if (out.held === 'rate_limited' && !(body && body.retry_after)) { const h = Number(res.headers.get('retry-after')); if (h > 0) out.retryAfter = h; }
  return out;
}

/** How long to wait before trying a held report again (section 2): at least 30 s, then 2 and 10 minutes, and never
 *  sooner than the service asked. null after the third: no more tries until the app is opened again or Send is pressed. */
const DELAYS = [30, 120, 600];
function retryDelay(tries: number, retryAfter: number | null = 0) {
  if (tries >= DELAYS.length) return null;
  return Math.max(DELAYS[tries], Number(retryAfter) || 0) * 1000;
}

export { ENDPOINT, LIMITS, CATEGORIES, osName, scrubber, errorLines, makeContext, webpInfo, buildReport, formOf, outcomeOf, send, retryDelay, DELAYS };
