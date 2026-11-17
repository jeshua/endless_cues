/**
 * The Endless Cues account, from the app's side: the device flow that signs this computer in, this month's use,
 * and signing out (docs/specs/17-service-protocol.md, sections 4.3, 4.4 and 7). The model calls themselves go
 * through the `cloud` provider in assistant.ts, which is the OpenAI-compatible one pointed at the service.
 *
 *   client({ endpoint, fetchImpl, version })      → { start, poll, usage, signOut }
 *   signIn({ client, name, open, onState, sleep }) → a sign-in under way: { done (a promise of { token, email }), cancel() }
 *   said(err)                                     → what went wrong, in one short line
 *
 * Nothing here runs until a person chooses the Endless Cues assistant: no request at start-up, none in the
 * background. The token is kept by the app (main.ts, sealed with the OS keychain), never in a show.
 */
const ENDPOINT = 'https://api.endlesscues.com';

/** What the service answered a device flow's start (section 4.3). */
export interface DeviceStart { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; expires_in?: number; interval?: number }
/** What it answers a poll once the person has confirmed. */
export interface DeviceToken { token: string; token_type?: string; device?: { id: number; name: string } | null; account?: { email?: string; role?: string } }
/** This month's use (section 7.2). */
export interface Usage { period_start?: string; period_end?: string; used_percent?: number; tier?: string; asks_used?: number; asks_allowance?: number }
export type CloudClient = ReturnType<typeof client>;

class CloudError extends Error {
  status: number;
  code: string;
  /** a slow_down's new interval, and anything else the answer said */
  interval?: unknown;
  constructor(status: number, code: string, message?: string, extra: object = {}) { super(message || code); this.status = status; this.code = code; Object.assign(this, extra); }
}

function client({ endpoint = ENDPOINT, fetchImpl = fetch, version = '' }: { endpoint?: string; fetchImpl?: typeof fetch; version?: string } = {}) {
  const base = String(endpoint || ENDPOINT).replace(/\/+$/, '');
  const agent = `EndlessCues/${version || 'dev'} (${process.platform})`;
  async function request<T = Record<string, unknown>>(method: string, path: string, { token, body }: { token?: string; body?: object } = {}): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: { 'user-agent': agent, ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) { throw new CloudError(0, 'offline', (err as Error).message); }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new CloudError(res.status, (data && typeof data.error === 'string' && data.error) || `http_${res.status}`, data && data.message, data || {});
    return data || {};
  }
  return {
    endpoint: base,
    start: (name: string) => request<DeviceStart>('POST', '/v1/auth/device/start', { body: { name } }),
    poll: (deviceCode: string) => request<DeviceToken>('POST', '/v1/auth/device/poll', { body: { device_code: deviceCode } }),
    usage: (token: string) => request<Usage>('GET', '/v1/usage', { token }),
    signOut: (token: string) => request('DELETE', '/v1/devices/self', { token }),
  };
}

/** One short line for a person. */
function said(err: { code?: string; status?: number } | null | undefined) {
  if (!err) return '';
  switch (err.code) {
    case 'offline': return 'Can’t reach Endless Cues. Check the internet.';
    case 'access_denied': return 'Refused in the browser.';
    case 'expired_token': return 'The code ran out. Sign in again.';
    case 'invalid_grant': return 'That sign-in didn’t finish. Try again.';
    case 'unauthorized': return 'Signed out. Sign in again.';
    case 'rate_limited': return 'Too many tries. Wait a while.';
    case 'cancelled': return '';
    default: return (err.status ?? 0) >= 500 ? 'Endless Cues isn’t answering. Try again later.' : 'Sign-in didn’t work. Try again.';
  }
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The device flow: ask for a code, show it and open the browser, poll until it is confirmed there.
 * `onState` hears { step: 'code', code, url } once the code is known. The promise ends with { token, email, device }
 * or a CloudError (code `cancelled` when cancel() was called).
 */
function signIn({ client: c, name = 'A computer', open = () => {}, onState = () => {}, sleep = wait }: {
  client: Pick<CloudClient, 'start' | 'poll'>; name?: string; open?: (url: string) => void;
  onState?: (state: { step: string; code: string; url: string }) => void; sleep?: (ms: number) => Promise<unknown>;
}) {
  let cancelled = false;
  const done = (async () => {
    const start = await c.start(name);
    if (cancelled) throw new CloudError(0, 'cancelled');
    onState({ step: 'code', code: start.user_code, url: start.verification_uri_complete || start.verification_uri });
    open(start.verification_uri_complete || start.verification_uri);
    let interval = Math.max(1, Number(start.interval) || 5);
    const until = Date.now() + (Number(start.expires_in) || 900) * 1000;
    for (;;) {
      await sleep(interval * 1000);
      if (cancelled) throw new CloudError(0, 'cancelled');
      if (Date.now() > until) throw new CloudError(400, 'expired_token');
      try {
        const r = await c.poll(start.device_code);
        return { token: r.token, email: (r.account && r.account.email) || '', device: r.device || null };
      } catch (e) {
        const err = e as CloudError;
        if (err.code === 'authorization_pending') continue;
        if (err.code === 'slow_down') { interval = Math.max(interval + 5, Number(err.interval) || 0); continue; }
        if (err.code === 'offline') continue;        // a moment without the network: keep asking until the code runs out
        throw err;
      }
    }
  })();
  return { done, cancel() { cancelled = true; } };
}

/** "1 December", from the ISO time a period ends. */
function dayWords(iso: string | number | Date) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getUTCDate()} ${d.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`;
}

export { client, signIn, said, dayWords, CloudError, ENDPOINT };
