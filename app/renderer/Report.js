// Report a problem (Help ▸ Report a Problem…, or Settings ▸ About): a bug, an idea or anything else, sent to the
// service with a picture of the window if the person wants one. Nothing is sent until Send is pressed; what goes
// with it is said under the form, and can be looked at in full.
//
// The picture is taken by the app (app/main/report.js) before the form is drawn, so the form is never in it; it is
// made into a WebP here, because the window has a canvas and the service never re-encodes what it is sent.
import { html, useState, useEffect, useRef, ec, cx, keys } from './lib.js';

const SHOT = { side: 2400, quality: 0.84, max: 8 * 1024 * 1024 };
const THUMB = { side: 480, quality: 0.72, max: 256 * 1024 };

// What was written is kept here until it is sent: closing the form, or a failure, never loses it.
let draft = { category: 'bug', comment: '', email: '', picture: true, showName: false, showLog: false, submissionId: null };

/** A PNG made into a WebP that fits `side` and `max`, a little less fine each time it is too big. */
async function webpOf(png, { side, quality, max }) {
  const bmp = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = new OffscreenCanvas(w, h);
  const g = canvas.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  for (let q = quality; q >= 0.3; q -= 0.12) {
    const blob = await canvas.convertToBlob({ type: 'image/webp', quality: q });
    if (blob.type !== 'image/webp') return null;           // (a Chromium without a WebP encoder: no picture rather than the wrong kind)
    if (blob.size <= max) return { blob, bytes: new Uint8Array(await blob.arrayBuffer()), width: w, height: h };
  }
  return null;
}
const dataUrlOf = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => resolve(null); r.readAsDataURL(blob); });

/**
 * The form's opening: `open()` takes the picture first (from Settings, once Settings has closed), then shows the
 * form with it. `about()` says what is on screen: { view, selected, closeSettings }.
 */
export function useReport(about) {
  const [taken, setTaken] = useState(null);
  const latest = useRef(about); latest.current = about;
  const busy = useRef(false);
  // `issue`: the line the status bar offered ("Something went wrong. Report it?"), attached to this report
  const open = async ({ fromSettings = false, issue = null } = {}) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const a = latest.current() || {};
      if (fromSettings && a.closeSettings) {
        a.closeSettings();
        // (two frames and a little: the window is drawn without Settings before its picture is taken)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise((r) => setTimeout(r, 80));
      }
      const b = latest.current() || {};
      const r = await ec.app({ op: 'report-capture', view: b.view, selected: b.selected, issue: issue || undefined });
      if (r && !r.error) setTaken(issue ? { ...r, fromIssue: true } : r);
    } finally { busy.current = false; }
  };
  useEffect(() => {
    ec.onMenu((action) => { if (action === 'report') open(); });
    const fromAbout = () => open({ fromSettings: true });
    window.addEventListener('ec-report', fromAbout);
    return () => window.removeEventListener('ec-report', fromAbout);
  }, []);
  return { taken, open, close: () => setTaken(null) };
}

/** Settings ▸ About's link asks for the form this way (it has no say over Settings being open). */
export const askForReport = () => window.dispatchEvent(new Event('ec-report'));

const PLACEHOLDER = { bug: 'What happened, and what did you expect?', idea: 'What would help?', other: 'Your message' };

export function ReportForm({ taken, close }) {
  // (opened from "Something went wrong": a bug, with the show log's tail ticked; both shown, both can be changed)
  const [d, setD] = useState(() => (taken.fromIssue ? (draft = { ...draft, showLog: !!(taken.logTail || []).length, ...(draft.comment ? {} : { category: 'bug' }) }) : draft));
  // what is attached (the error the status bar offered, the app's recent error lines), each can be left out
  const [leaveOut, setLeaveOut] = useState([]);
  const attached = [['issue', 'The error'], ['errors', 'Recent error messages']].filter(([k]) => taken.context && taken.context[k] && taken.context[k].length);
  const [seeAttached, setSeeAttached] = useState(false);
  const set = (change) => { draft = { ...draft, ...change }; setD(draft); };
  const [pic, setPic] = useState(null);            // { shot, thumb, url } once made; false: none could be made
  const [big, setBig] = useState(false);
  const [details, setDetails] = useState(false);
  const [state, setState] = useState(null);        // null | 'sending' | { sent } | { held, message } | { refused, message }
  const [waiting, setWaiting] = useState(taken.waiting || 0);
  const text = useRef();

  useEffect(() => {
    let gone = false;
    (async () => {
      if (!taken.png) { setPic(false); return; }
      try {
        const shot = await webpOf(taken.png, SHOT), thumb = shot && await webpOf(taken.png, THUMB);
        if (gone) return;
        setPic(shot && thumb ? { shot, thumb, url: await dataUrlOf(shot.blob) } : false);
      } catch { if (!gone) setPic(false); }
    })();
    setTimeout(() => text.current && text.current.focus(), 30);
    return () => { gone = true; };
  }, [taken]);

  const sending = state === 'sending';
  const withPicture = d.picture && !!pic;
  const canSend = !sending && !(state && state.sent) && (d.comment.trim() || withPicture);
  const send = async () => {
    if (!canSend) return;
    // (one id per report, kept until it is sent: pressing Send again after a failure is the same report, so the
    // service keeps it once)
    if (!draft.submissionId) set({ submissionId: crypto.randomUUID() });
    setState('sending');
    const r = await ec.app({ op: 'report-send', category: draft.category, comment: draft.comment, email: draft.email, showName: draft.showName, submissionId: draft.submissionId,
      leaveOut, showLog: draft.showLog && !!(taken.logTail || []).length, picture: withPicture, screenshot: withPicture ? pic.shot.bytes : null, thumbnail: withPicture ? pic.thumb.bytes : null });
    if (r && r.sent) {
      draft = { ...draft, comment: '', submissionId: null };
      setState({ sent: r.id });
      setWaiting(0);
      setTimeout(close, 1800);
    } else if (r && r.held) setState({ held: r.held, message: r.held === 'offline' ? 'Not sent: no connection.' : r.message || 'The service could not take it just now.' });
    else setState({ refused: (r && r.refused) || 'error', message: (r && r.message) || `Not sent (${(r && (r.refused || r.error)) || 'unknown'}).` });
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); send(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const logTail = taken.logTail || [];
  const context = { ...taken.context, ...(d.showName && taken.showName ? { show_name: taken.showName } : {}), ...(d.showLog && logTail.length ? { show_log: logTail } : {}) };
  for (const k of leaveOut) delete context[k];
  const sent = { app_version: taken.version, os: taken.os, category: d.category, ...(d.email.trim() ? { email: d.email.trim() } : {}), captured_at: taken.capturedAt, context };
  return html`<div class="scrim" onMouseDown=${(e) => { if (e.target === e.currentTarget) close(); }}><div class="sheet report" data-report role="dialog" aria-label="Report a problem">
    <h2>Report a problem</h2>
    <div class="seg report-kind">${[['bug', 'Bug'], ['idea', 'Idea'], ['other', 'Other']].map(([k, l]) => html`<button key=${k} data-report-kind=${k} class=${cx(d.category === k && 'on')} onClick=${() => set({ category: k })}>${l}</button>`)}</div>
    <textarea ref=${text} data-report-text rows="5" maxlength="5000" placeholder=${PLACEHOLDER[d.category]} value=${d.comment} onInput=${(e) => set({ comment: e.target.value })}></textarea>
    <div class="report-picture">
      <label class="check"><input type="checkbox" data-report-picture checked=${d.picture} disabled=${pic === false} onChange=${(e) => set({ picture: e.target.checked })} />Include a picture of the window</label>
      ${pic ? html`<button class=${cx('report-shot', big && 'big', !d.picture && 'off')} data-report-shot onClick=${() => setBig(!big)} title=${big ? 'Smaller' : 'Larger'}><img src=${pic.url} alt="The picture that is sent" /></button>`
        : pic === false ? html`<span class="dim">No picture could be made.</span>` : html`<span class="dim">Making the picture…</span>`}
    </div>
    ${attached.length ? html`<div class="report-attached" data-report-attached>
      <span class="dim">Attached:</span>
      ${attached.map(([k, label]) => html`<label class="check" key=${k}><input type="checkbox" data-report-attach=${k} checked=${!leaveOut.includes(k)}
        onChange=${(e) => setLeaveOut((l) => (e.target.checked ? l.filter((x) => x !== k) : [...l, k]))} />${label}${k === 'errors' ? ` (${taken.context.errors.length})` : ''}</label>`)}
      <button class="linkish" data-report-attached-see onClick=${() => setSeeAttached(!seeAttached)}>${seeAttached ? 'Hide' : 'Show'}</button>
      ${seeAttached ? html`<pre class="mono report-json">${attached.map(([k]) => [].concat(taken.context[k]).join('\n')).join('\n\n')}</pre>` : null}
    </div>` : null}
    <label class="report-line">Email, if you’d like a reply<input type="text" data-report-email inputmode="email" autocomplete="email" value=${d.email} onInput=${(e) => set({ email: e.target.value })} /></label>
    <label class="check"><input type="checkbox" data-report-showname checked=${d.showName} onChange=${(e) => set({ showName: e.target.checked })} />Include the show’s name${taken.showName ? ` (“${taken.showName}”)` : ''}</label>
    <label class="check"><input type="checkbox" data-report-log checked=${d.showLog} disabled=${!logTail.length} onChange=${(e) => set({ showLog: e.target.checked })} />Include the show log’s last${logTail.length ? ` ${logTail.length}` : ''} lines (times, cue numbers and what happened; no names)</label>
    <p class="report-what dim" data-report-what>Sent with it: the app’s version, your system, what was on screen, the selected cue’s number and type, the number of cues, the sound output, your language and recent error messages. Never: show files, sounds, paths with your name, keys.${' '}
      <button class="linkish" data-report-details onClick=${() => setDetails(!details)}>${details ? 'Hide' : 'Exactly what is sent'}</button></p>
    ${details ? html`<pre class="mono report-json" data-report-json>${JSON.stringify(sent, null, 2)}${withPicture ? `\n+ the picture above (${pic.shot.width} × ${pic.shot.height}, ${Math.round(pic.shot.bytes.length / 1024)} KB) and a small copy of it` : ''}${d.comment.trim() ? '\n+ what you wrote' : ''}</pre>` : null}
    ${waiting > 0 && !(state && state.sent) ? html`<p class="dim" data-report-waiting>${waiting === 1 ? 'An earlier report is' : `${waiting} earlier reports are`} waiting to be sent: they go with this one.</p>` : null}
    ${state && state.sent ? html`<p class="report-status" data-report-status="sent">Sent. Thank you.</p>`
      : state && state.held ? html`<p class="report-status standby" data-report-status="held">${state.message} It is kept on this computer and sent when the app next opens, or when you press Send again.</p>`
      : state && state.refused ? html`<p class="report-status danger" data-report-status="refused">${state.message}</p>` : null}
    ${!taken.sends ? html`<p class="dim">A test run: reports go nowhere.</p>` : null}
    <div class="acts">
      <span class="grow"></span>
      ${state && state.held ? html`<button class="btn" data-report-later onClick=${close}>Send later</button>` : html`<button class="btn" onClick=${close}>${state && state.sent ? 'Close' : 'Cancel'}</button>`}
      <button class="btn primary" data-report-send disabled=${!canSend} onClick=${send} title=${keys('Send (⌘Enter)')}>${sending ? 'Sending…' : state && state.held ? 'Send again' : 'Send'}</button>
    </div>
  </div></div>`;
}
