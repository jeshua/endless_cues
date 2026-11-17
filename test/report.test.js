// Report a problem (core/report): the request built as docs/specs/17-service-protocol.md section 3 says, nothing
// personal in it, and the reports kept on disk when the service cannot take them. Sent to a fake local server, never
// to the real one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const R = require('../core/report/report');
const { createOutbox } = require('../core/report/outbox');

/** The header of a WebP still (VP8L) of the given size, padded to `bytes`: all the service and `webpInfo` read. */
function webp(w, h, bytes = 64, { animated = false } = {}) {
  const b = Buffer.alloc(Math.max(bytes, 40));
  b.write('RIFF', 0); b.writeUInt32LE(b.length - 8, 4); b.write('WEBP', 8);
  if (animated) {
    b.write('VP8X', 12); b.writeUInt32LE(10, 16); b[20] = 0x02;
    b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  } else {
    b.write('VP8L', 12); b.writeUInt32LE(b.length - 20, 16); b[20] = 0x2f;
    b.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 21);
  }
  return new Uint8Array(b);
}

const base = () => ({ clientId: '6f1c2a9e-3b4d-4e5f-8a7b-1c2d3e4f5a6b', submissionId: 's-0001-abcdef', category: 'bug', comment: 'The fade did not finish.', appVersion: '0.2.0-alpha.1', os: 'macOS 15.1 arm64' });

/** A fake reports service on 127.0.0.1: answers from `script` in turn (the last one again once it runs out), and keeps what it was sent. */
async function fakeService(script) {
  const got = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const form = await new Request('http://x/', { method: 'POST', headers: { 'content-type': req.headers['content-type'] }, body }).formData();
    const fields = {}, files = {};
    for (const [k, v] of form.entries()) { if (typeof v === 'string') fields[k] = v; else files[k] = { type: v.type, name: v.name, bytes: new Uint8Array(await v.arrayBuffer()) }; }
    got.push({ url: req.url, headers: req.headers, fields, files, size: body.length });
    const [status, json, headers] = script.length > 1 ? script.shift() : script[0];
    res.writeHead(status, { 'content-type': 'application/json', 'x-ec-api': '1', ...(headers || {}) });
    res.end(JSON.stringify(json));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/v1/reports`, got, close: () => { server.closeAllConnections(); return new Promise((r) => server.close(r)); } };
}

test('the os field and the WebP header are read as the protocol means them', () => {
  assert.equal(R.osName('darwin', '15.1', 'arm64'), 'macOS 15.1 arm64');
  assert.equal(R.osName('win32', '10.0.22631', 'x64'), 'Windows 10.0.22631 x64');
  assert.deepEqual(R.webpInfo(webp(2400, 1500)), { width: 2400, height: 1500, animated: false });
  assert.equal(R.webpInfo(webp(10, 10, 64, { animated: true })).animated, true);
  assert.equal(R.webpInfo(new Uint8Array(Buffer.from('\x89PNG\r\n\x1a\n' + 'x'.repeat(40), 'binary'))), null, 'a PNG is not a WebP');
});

test('a report is built in the protocol’s fields, with its limits', () => {
  const b = R.buildReport({ ...base(), email: 'me@example.com', capturedAt: '2026-11-16T20:00:00Z', context: { view: 'cue list' }, screenshot: webp(2400, 1500, 5000), thumbnail: webp(480, 300, 800) });
  assert.ok(!b.error, b.error);
  assert.deepEqual(Object.keys(b.fields).sort(), ['app_version', 'captured_at', 'category', 'client_id', 'comment', 'context', 'email', 'os', 'submission_id']);
  assert.equal(b.fields.captured_at, '2026-11-16T20:00:00.000Z');
  assert.deepEqual(JSON.parse(b.fields.context), { view: 'cue list' });
  assert.deepEqual(Object.keys(b.files), ['screenshot', 'thumbnail']);

  assert.equal(R.buildReport({ ...base(), comment: 'x'.repeat(6000) }).fields.comment.length, 5000, 'a long comment is cut, as the service would');
  assert.equal(R.buildReport({ ...base(), comment: '' }).error, 'empty_report', 'no words and no picture');
  assert.ok(!R.buildReport({ ...base(), comment: '', screenshot: webp(100, 100) }).error, 'a picture alone is a report');
  assert.equal(R.buildReport({ ...base(), clientId: 'short' }).error, 'bad_client_id');
  assert.equal(R.buildReport({ ...base(), submissionId: 'has space here' }).error, 'bad_submission_id');
  assert.equal(R.buildReport({ ...base(), category: 'rant' }).error, 'bad_category');
  assert.equal(R.buildReport({ ...base(), email: 'not an address' }).error, 'bad_email');
  assert.equal(R.buildReport({ ...base(), screenshot: webp(2401, 100) }).error, 'bad_image', 'over 2400 px on its long side');
  assert.equal(R.buildReport({ ...base(), screenshot: webp(100, 100, 64, { animated: true }) }).error, 'bad_image', 'animated');
  assert.equal(R.buildReport({ ...base(), screenshot: new Uint8Array(Buffer.from('<svg></svg>'.padEnd(60))) }).error, 'bad_image', 'not a WebP at all');
  assert.equal(R.buildReport({ ...base(), screenshot: webp(1000, 600, R.LIMITS.screenshot + 1) }).error, 'bad_image', 'over 8 MB');
  assert.equal(R.buildReport({ ...base(), screenshot: webp(1000, 600), thumbnail: webp(481, 100) }).error, 'bad_image', 'a thumbnail over 480 px');
  assert.equal(R.buildReport({ ...base(), screenshot: webp(1000, 600), thumbnail: webp(480, 300, R.LIMITS.thumbnail + 1) }).error, 'bad_image', 'a thumbnail over 256 KB');
  assert.deepEqual(Object.keys(R.buildReport({ ...base(), thumbnail: webp(480, 300) }).files), [], 'a thumbnail goes only with a screenshot');
  assert.equal(R.buildReport({ ...base(), context: { errors: ['x'.repeat(70 * 1024)] } }).error, 'bad_context');
});

test('nothing personal is in the context: home folders, the user’s name, addresses, keys and emails are taken out', () => {
  const scrub = R.scrubber({ home: '/Users/sam', user: 'sam' });
  const ctx = R.makeContext({
    view: 'cue list', mode: 'edit', selected: { number: '7', type: 'audio', name: 'never sent' }, cueCount: 64,
    audio: { device: 'Sam’s AirPods', sampleRate: 48000 }, locale: 'en-GB', showName: 'My Show',
    log: [
      '10:00:00.000 [show] opened',
      '10:00:01.000 [page] TypeError: x is undefined at /Users/sam/Shows/Secret.ecshow/show.json:3',
      '10:00:02.000 [audio] could not open C:\\Users\\sam\\Music\\a.wav',
      '10:00:03.000 [net] failed to reach 192.168.1.40:53000 and fe80::1c2b:3a4d',
      '10:00:04.000 [assistant] error: 401 with Bearer ecd_abcdefghijklmnop and sk-ant-api03-abcdefgh',
      '10:00:05.000 [mail] could not write to sam@example.com in /home/sam/x',
    ],
  }, scrub);
  assert.deepEqual(ctx.selected_cue, { number: '7', type: 'audio' }, 'the selected cue is its number and type, never its name');
  assert.equal(ctx.cue_count, 64);
  assert.equal(ctx.audio.device, '<user>’s AirPods');
  assert.equal(ctx.audio.sample_rate, 48000);
  assert.equal(ctx.show_name, undefined, 'the show’s name only when asked');
  assert.equal(ctx.errors.length, 5, 'only the lines that say something went wrong');
  const text = JSON.stringify(ctx);
  for (const bad of ['/Users/sam', 'Users\\\\sam', '/home/sam', 'sam@', '192.168', 'fe80', 'ecd_', 'sk-ant', 'Secret']) assert.ok(!text.includes(bad), `${bad} in ${text}`);
  assert.match(ctx.errors[0], /^10:00:01\.000 \[page\] TypeError: x is undefined at ~\/…\/show\.json:3$/, 'times are left alone; a path is only its file’s name');
  assert.equal(R.makeContext({ showName: 'My Show', includeShowName: true }).show_name, 'My Show');

  const many = R.makeContext({ log: Array.from({ length: 50 }, (_, i) => `error ${i} ${'y'.repeat(900)}`) });
  assert.equal(many.errors.length, 20, 'at most 20 error lines');
  assert.ok(many.errors.every((e) => e.length <= 500), 'each at most 500 characters');
  assert.match(many.errors[19], /^error 49 /, 'the latest ones');
});

test('a report reaches the service as multipart, with its pictures, its User-Agent and no token', async () => {
  const svc = await fakeService([[201, { id: 42, status: 'open', created_at: '2026-11-16T20:00:01.000Z', created: true }]]);
  try {
    const built = R.buildReport({ ...base(), context: { view: 'rig' }, screenshot: webp(1600, 1000, 3000), thumbnail: webp(480, 300, 500) });
    const r = await R.send(built, { url: svc.url, userAgent: 'EndlessCues/0.2.0-alpha.1 (macOS 15.1 arm64)' });
    assert.deepEqual(r, { sent: true, id: 42, created: true, status: 'open' });
    const g = svc.got[0];
    assert.equal(g.url, '/v1/reports');
    assert.match(g.headers['content-type'], /^multipart\/form-data; boundary=/);
    assert.equal(g.headers['user-agent'], 'EndlessCues/0.2.0-alpha.1 (macOS 15.1 arm64)');
    assert.equal(g.headers.authorization, undefined, 'no account needed: nothing is sent in its place');
    assert.equal(g.fields.client_id, base().clientId);
    assert.equal(g.fields.submission_id, base().submissionId);
    assert.deepEqual(JSON.parse(g.fields.context), { view: 'rig' });
    assert.equal(g.files.screenshot.type, 'image/webp');
    assert.equal(g.files.screenshot.bytes.length, 3000);
    assert.equal(g.files.thumbnail.bytes.length, 500);
    assert.ok(g.size < R.LIMITS.total);
  } finally { await svc.close(); }
});

test('what the service says is understood from its error code', async () => {
  assert.deepEqual(R.outcomeOf(200, { id: 42, created: false }), { sent: true, id: 42, created: false, status: 'open' });
  assert.equal(R.outcomeOf(429, { error: 'rate_limited', retry_after: 1834 }).retryAfter, 1834);
  assert.equal(R.outcomeOf(503, { error: 'try_again' }).held, 'try_again');
  assert.deepEqual(R.outcomeOf(400, { error: 'bad_image', message: 'Not a WebP.' }), { refused: 'bad_image', message: 'Not a WebP.' });
  assert.equal(R.outcomeOf(413, { error: 'too_large' }).refused, 'too_large');
  // the header, when the body has no retry_after
  const svc = await fakeService([[429, { error: 'rate_limited', message: 'Later.' }, { 'retry-after': '90' }]]);
  try { const r = await R.send(R.buildReport(base()), { url: svc.url }); assert.equal(r.held, 'rate_limited'); assert.equal(r.retryAfter, 90); assert.equal(r.message, 'Later.'); }
  finally { await svc.close(); }
  // no connection at all
  const off = await R.send(R.buildReport(base()), { url: 'http://127.0.0.1:9/v1/reports', timeoutMs: 3000 });
  assert.equal(off.held, 'offline');
  // and a test run that was given no endpoint sends nothing
  assert.equal((await R.send(R.buildReport(base()), { url: null })).refused, 'no_endpoint');
});

test('the waits between tries are section 2’s: 30 s, 2 and 10 minutes, never sooner than asked, three at most', () => {
  assert.deepEqual([0, 1, 2, 3].map((n) => R.retryDelay(n)), [30000, 120000, 600000, null]);
  assert.equal(R.retryDelay(0, 1834), 1834000);
});

test('a report the service cannot take is kept on disk, tried again on its schedule, and sent once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-reports-'));
  const svc = await fakeService([[0, null]]);
  svc.close();                        // (a port with nobody on it: offline)
  let timers = [], t = 1_000_000;
  const box = createOutbox({ dir, sendOptions: () => ({ url: svc.url, timeoutMs: 2000 }), now: () => t,
    setTimer: (fn, ms) => { const x = { fn, at: t + ms }; timers.push(x); return x; }, clearTimer: (x) => { timers = timers.filter((y) => y !== x); } });
  const built = R.buildReport({ ...base(), screenshot: webp(800, 500, 900), thumbnail: webp(480, 300, 200) });
  const r1 = await box.submit(built);
  assert.equal(r1.held, 'offline');
  assert.equal(r1.kept, true);
  assert.equal(box.waiting(), 1, 'kept on disk');
  const kept = box.list()[0];
  assert.equal(kept.built.fields.comment, 'The fade did not finish.', 'every word of it');
  assert.equal(kept.built.files.screenshot.length, 900, 'and its picture');
  assert.equal(timers.length, 1); assert.equal(timers[0].at - t, 30000, 'tried again in 30 s');

  // the service is back, and says 429 first: the next try waits as long as it asked
  const up = await fakeService([[429, { error: 'rate_limited', retry_after: 1834 }], [201, { id: 7, created: true }]]);
  const box2 = createOutbox({ dir, sendOptions: () => ({ url: up.url }), now: () => t,
    setTimer: (fn, ms) => { const x = { fn, at: t + ms }; timers.push(x); return x; }, clearTimer: (x) => { timers = timers.filter((y) => y !== x); } });
  timers = [];
  box2.start();                       // the app opened again
  assert.equal(timers.length, 1, 'a launch tries what was kept');
  t = timers[0].at; await timers.shift().fn();
  assert.equal(up.got.length, 1);
  assert.equal(box2.waiting(), 1, 'still kept after a 429');
  assert.ok(box2.list()[0].notBefore >= t + 1834000, 'with the time it may be tried again');
  assert.ok(timers.some((x) => x.at - t >= 1834000), 'and the next automatic try no sooner');

  // the person presses Send on a new report: the one waiting goes with it, whatever its retry_after
  const second = R.buildReport({ ...base(), submissionId: 's-0002-abcdef', comment: 'Second.' });
  const svc3 = await fakeService([[201, { id: 8, created: true }], [201, { id: 7, created: false }]]);
  const box3 = createOutbox({ dir, sendOptions: () => ({ url: svc3.url }), now: () => t, setTimer: () => null, clearTimer: () => {} });
  const r3 = await box3.submit(second);
  assert.equal(r3.sent, true);
  assert.deepEqual(svc3.got.map((g) => g.fields.submission_id), ['s-0002-abcdef', 's-0001-abcdef'], 'the same submission id again: a retry is safe');
  assert.equal(box3.waiting(), 0, 'nothing left waiting once it is sent');
  await up.close(); await svc3.close();
});

test('a report the service refuses is set aside, not tried again by itself, and not deleted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-reports-'));
  const svc = await fakeService([[503, { error: 'try_again' }], [400, { error: 'bad_category', message: 'No.' }]]);
  const box = createOutbox({ dir, sendOptions: () => ({ url: svc.url }), setTimer: () => null, clearTimer: () => {} });
  const built = R.buildReport(base());
  assert.equal((await box.submit(built)).held, 'try_again');
  assert.equal(box.waiting(), 1);
  const out = await box.flush();
  assert.equal(out.refused, 1);
  assert.equal(box.waiting(), 0);
  assert.ok(fs.existsSync(path.join(dir, 'refused', 's-0001-abcdef', 'report.json')), 'kept aside');
  await svc.close();
});
