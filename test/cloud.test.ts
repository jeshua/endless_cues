// The Endless Cues assistant from the app's side (docs/specs/17-service-protocol.md, sections 4.3 and 7): the
// device flow, the month's use, signing out, and a turn through the `cloud` provider, all against a stand-in for
// the service on 127.0.0.1. Nothing here reaches the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';
import * as cloud from '../core/assistant/cloud';
import { createAssistant, cloudProvider, providerFor, missingFor } from '../core/assistant/assistant';
import { ShowDocument } from '../core/show/document';
import { build } from './helpers';

/** A stand-in service: answers by route from `routes`, keeps every request. */
async function fakeService(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const r = { method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
      seen.push(r);
      const h = routes[`${req.method} ${req.url}`];
      const out = typeof h === 'function' ? h(r, seen) : h || { status: 404, body: { error: 'not_found', message: 'No such endpoint.' } };
      res.writeHead(out.status || 200, { 'content-type': 'application/json', ...(out.headers || {}) });
      res.end(JSON.stringify(out.body || {}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, seen, close: () => { server.closeAllConnections(); server.close(); } };
}

const START = { device_code: 'ecc_x', user_code: 'QXRM-7KPD', verification_uri: 'https://account.example/connect', verification_uri_complete: 'https://account.example/connect?code=QXRM-7KPD', expires_in: 900, interval: 5 };
const noSleep = () => Promise.resolve();

test('the device flow: a code, the browser, polling through pending and slow_down, then the token once', async () => {
  let polls = 0;
  const svc = await fakeService({
    'POST /v1/auth/device/start': { body: START },
    'POST /v1/auth/device/poll': () => {
      polls++;
      if (polls === 1) return { status: 400, body: { error: 'authorization_pending', message: 'Waiting.' } };
      if (polls === 2) return { status: 400, body: { error: 'slow_down', message: 'Slower.', interval: 10 } };
      return { body: { token: 'ecd_token', token_type: 'Bearer', device: { id: 3, name: 'Mac' }, account: { email: 'x@example.org', role: 'user' } } };
    },
  });
  const opened = [], states = [], waits = [];
  const c = cloud.client({ endpoint: svc.url, version: '0.2.0-alpha.1' });
  const r = await cloud.signIn({ client: c, name: 'Stage Mac', open: (u) => opened.push(u), onState: (s) => states.push(s), sleep: (ms) => { waits.push(ms); return Promise.resolve(); } }).done;
  svc.close();
  assert.deepEqual(r, { token: 'ecd_token', email: 'x@example.org', device: { id: 3, name: 'Mac' } });
  assert.deepEqual(opened, [START.verification_uri_complete]);
  assert.deepEqual(states, [{ step: 'code', code: 'QXRM-7KPD', url: START.verification_uri_complete }]);
  assert.deepEqual(waits, [5000, 5000, 10000], 'waits the interval, and longer after slow_down');
  assert.deepEqual(svc.seen[0].body, { name: 'Stage Mac' });
  assert.deepEqual(svc.seen.slice(1).map((x) => x.body), [{ device_code: 'ecc_x' }, { device_code: 'ecc_x' }, { device_code: 'ecc_x' }]);
  assert.match(svc.seen[0].headers['user-agent'], /^EndlessCues\/0\.2\.0-alpha\.1 \(/);
});

test('the device flow ends in one line: refused, run out, cancelled, or no network', async () => {
  for (const [code, line] of [['access_denied', 'Refused in the browser.'], ['expired_token', 'The code ran out. Sign in again.'], ['invalid_grant', 'That sign-in didn’t finish. Try again.']]) {
    const svc = await fakeService({ 'POST /v1/auth/device/start': { body: START }, 'POST /v1/auth/device/poll': { status: 400, body: { error: code, message: 'x' } } });
    await assert.rejects(cloud.signIn({ client: cloud.client({ endpoint: svc.url }), sleep: noSleep }).done, (err) => cloud.said(err) === line);
    svc.close();
  }
  // cancelled while waiting
  const svc = await fakeService({ 'POST /v1/auth/device/start': { body: START }, 'POST /v1/auth/device/poll': { status: 400, body: { error: 'authorization_pending' } } });
  let flow;
  flow = cloud.signIn({ client: cloud.client({ endpoint: svc.url }), sleep: () => { flow.cancel(); return Promise.resolve(); } });
  await assert.rejects(flow.done, (err) => err.code === 'cancelled' && cloud.said(err) === '');
  svc.close();
  // nothing listening: the first request fails, in words
  await assert.rejects(cloud.signIn({ client: cloud.client({ endpoint: 'http://127.0.0.1:9' }), sleep: noSleep }).done,
    (err) => cloud.said(err) === 'Can’t reach Endless Cues. Check the internet.');
  assert.equal(cloud.dayWords('2026-12-01T00:00:00.000Z'), '1 December');
});

test('usage and signing out carry the token', async () => {
  const svc = await fakeService({
    'GET /v1/usage': { body: { period_start: '2026-11-01T00:00:00.000Z', period_end: '2026-12-01T00:00:00.000Z', used_percent: 23, tier: 'allowance', asks_used: 23, asks_allowance: 100 } },
    'DELETE /v1/devices/self': { body: { ok: true, revoked: 3 } },
  });
  const c = cloud.client({ endpoint: svc.url });
  assert.equal((await c.usage('ecd_t')).asks_used, 23);
  assert.equal((await c.signOut('ecd_t')).revoked, 3);
  assert.deepEqual(svc.seen.map((x) => x.headers.authorization), ['Bearer ecd_t', 'Bearer ecd_t']);
  svc.close();
});

const doc = () => new ShowDocument({ doc: build([{ op: 'cue.add', cue: { type: 'audio', number: '1', name: 'Rain', file: 'media/rain.wav' } }]).doc });

test('a turn through the cloud provider: the token, the three headers, one turn id, ec_state sent back, the month read from the headers', async () => {
  const replies = [
    { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, ec_state: 'OPAQUE-1', tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_show', arguments: '{}' } }] } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Rain is cue 1.' } }] },
  ];
  const svc = await fakeService({ 'POST /v1/chat/completions': () => ({ body: replies.shift(), headers: { 'x-ec-tier': 'after', 'x-ec-used': '100', 'x-ec-resets': '2026-12-01T00:00:00.000Z' } }) });
  const a = createAssistant({ config: { provider: 'cloud' }, provider: cloudProvider({ endpoint: svc.url, token: 'ecd_t', version: '0.2.0-alpha.1' }) });
  const r = await a.ask('which cue is the rain?', { document: doc() });
  svc.close();
  assert.equal(r.ok, true);
  const [one, two] = svc.seen;
  assert.equal(one.url, '/v1/chat/completions');
  assert.equal(one.headers.authorization, 'Bearer ecd_t');
  assert.equal(one.headers['x-ec-version'], '0.2.0-alpha.1');
  assert.deepEqual([one.headers['x-ec-step'], two.headers['x-ec-step']], ['0', '1']);
  assert.ok(one.headers['x-ec-turn'].length >= 8 && one.headers['x-ec-turn'] === two.headers['x-ec-turn'], 'one id for the whole turn');
  assert.equal(two.body.messages.find((m) => m.role === 'assistant').ec_state, 'OPAQUE-1', 'the reasoning goes back as it came');
  assert.deepEqual(a.status().cloud.usage, { tier: 'after', used: 100, resets: '2026-12-01T00:00:00.000Z' });
});

test('the cloud provider’s errors are one line each, and a 401 signs this computer out', async () => {
  const answers = [
    { status: 429, body: { error: 'allowance_used', message: "This month's asks are used up. Back on 1 December.", resets_at: '2026-12-01T00:00:00.000Z' } },
    { status: 400, body: { error: 'build_not_allowed', message: "This build can't use the hosted assistant. Use your own key." } },
    { status: 502, body: { error: 'upstream_error', message: 'x' } },
    { status: 401, body: { error: 'unauthorized', message: 'Sign in again.' } },
  ];
  const svc = await fakeService({ 'POST /v1/chat/completions': () => answers.shift() });
  let out = 0;
  const p = cloudProvider({ endpoint: svc.url, token: 'ecd_t', signedOut: () => { out++; } });
  const a = createAssistant({ config: { provider: 'cloud' }, provider: p });
  const lines = [];
  for (let i = 0; i < 4; i++) lines.push((await a.ask('x', { document: doc() })).error);
  svc.close();
  assert.deepEqual(lines, ['This month’s asks are used up: the built-in helper can still help.', 'This build can’t use the hosted assistant. Use your own key.',
    'The Endless Cues assistant isn’t answering. Your show isn’t affected.', 'Signed out. Sign in again in Settings ▸ Assistant.']);
  assert.equal(out, 1);
  assert.equal(a.status().cloud.usage.tier, 'used_up');
  // no network at all
  const off = createAssistant({ config: { provider: 'cloud' }, provider: cloudProvider({ endpoint: 'http://127.0.0.1:9', token: 'ecd_t' }) });
  assert.equal((await off.ask('x', { document: doc() })).error, 'The Endless Cues assistant isn’t answering. Your show isn’t affected.');
});

test('chosen and not signed in: no provider, a line, and the sign-in’s own line while it runs', () => {
  assert.equal(providerFor({ provider: 'cloud' }, {}), null);
  assert.equal(missingFor({ provider: 'cloud' }, {}), 'Sign in first.');
  assert.equal(providerFor({ provider: 'cloud', token: 'ecd_t' }, {}).name, 'cloud');
  const a = createAssistant({ config: { provider: 'cloud' } });
  assert.equal(a.status().missing, 'Sign in first.');
  a.setAccount({ step: 'code', code: 'QXRM-7KPD' });
  assert.equal(a.status().missing, 'Your code: QXRM-7KPD. Confirm it in the browser.');
  a.setAccount({ step: 'error', code: '', error: 'Can’t reach Endless Cues. Check the internet.' });
  assert.equal(a.status().missing, 'Can’t reach Endless Cues. Check the internet.');
  a.configure({ provider: 'demo' });
  assert.equal(a.status().cloud, undefined, 'another provider: nothing of the account');
});
