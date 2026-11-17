/**
 * Module: Show feedback.
 *
 * Tells something else what the show is doing, over OSC, so it can follow: a lighting desk's
 * macro, a second computer, Companion (button colours), a show-caller's display.
 *
 *   <prefix>/go <number> <name>                 a GO was pressed
 *   <prefix>/cue/<number>/start <name>          a cue started running
 *   <prefix>/cue/<number>/stop                  …and finished or was stopped
 *   <prefix>/playhead <number> <name>           what is standing by now ("" at the end of the list)
 *   <prefix>/running <count>                    how many top-level cues are running
 *
 * Sent to one network patch. Numbers are sent as text, because a cue number need not be a number.
 */
const q = (s) => `"${String(s ?? '').replace(/"/g, "'")}"`;

module.exports = {
  id: 'show-feedback',
  name: 'Show feedback',
  summary: 'Tell another system what the show is doing (GO, cues starting and stopping, the playhead) over OSC.',
  fields: [
    { key: 'patch', label: 'Send to', kind: 'patch' },
    { key: 'prefix', label: 'Address prefix', kind: 'text', placeholder: '/endlesscues' },
  ],

  create({ host, net }) {
    let cfg = null, sent = 0;
    let last = { go: null, head: undefined, live: new Set() };
    const send = (text) => { if (net && cfg.patch) { net.send(cfg.patch, text, { label: 'feedback' }); sent++; } };
    return {
      start(config) {
        cfg = { ...config, prefix: String(config.prefix || '/endlesscues').replace(/\/+$/, '') }; sent = 0;
        // what is already so when the module is switched on is not news: a GO from a minute ago is not sent as a GO
        let e = null; try { e = host.snapshot().engine; } catch { /* no show yet */ }
        last = { go: e ? e.lastGo : null, head: undefined, live: new Set() };
      },
      stop() {},
      onState() {
        const s = host.snapshot();
        const e = s.engine, row = (id) => s.rows.find((r) => r.id === id) || { number: '', name: '' };
        if (e.lastGo && (!last.go || last.go.at !== e.lastGo.at)) { const r = row(e.lastGo.id); send(`${cfg.prefix}/go ${q(r.number)} ${q(r.name)}`); }
        last.go = e.lastGo;
        const live = new Set(e.live);
        for (const id of live) if (!last.live.has(id)) { const r = row(id); send(`${cfg.prefix}/cue/${encodeURIComponent(r.number || r.name || id)}/start ${q(r.name)}`); }
        for (const id of last.live) if (!live.has(id)) send(`${cfg.prefix}/cue/${encodeURIComponent(row(id).number || row(id).name || id)}/stop`);
        if (live.size !== last.live.size) send(`${cfg.prefix}/running ${live.size}`);
        last.live = live;
        if (e.playhead !== last.head) { const r = e.playhead ? row(e.playhead) : { number: '', name: '' }; send(`${cfg.prefix}/playhead ${q(r.number)} ${q(r.name)}`); last.head = e.playhead; }
      },
      status() { return { ok: !!cfg.patch, text: cfg.patch ? `${sent} sent` : 'choose a patch to send to' }; },
    };
  },
};
