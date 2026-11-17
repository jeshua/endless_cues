/**
 * Module: Lighting desk.
 *
 * A Light cue fired in the list fires that cue on the lighting desk over OSC.
 * Firing a cue by number is idempotent: if the board operator presses GO too,
 * the same cue runs again, it never skips ahead. The operator still calls
 * every light cue, so the show survives the link going down.
 *
 * Desks are described by a small table (`KINDS`): the fire message, and (where
 * the desk can answer) a ping and what it sends back, so the app can say
 * "desk answering" instead of hoping.
 *
 *   us ─▶ desk   <fire>            e.g. /eos/cue/<list>/<n>/fire
 *                <ping>            every 2 s
 *   desk ─▶ us   on listenPort     /eos/out/ping, /eos/out/active/cue/<list>/<n>, …
 */
import * as dgram from 'dgram';
import * as osc from '../../../core/net/osc';
import type { EngineCue } from '../../../core/engine/cue-engine';
import type { ModuleContext, ModuleField } from '../host';

/** A kind of desk: how a cue is fired on it, and (where it answers) how it is asked and what it says. */
interface DeskKind {
  label: string;
  fire: (list: number | string, n: string) => string;
  ping?: string;
  heard?: (address: string, list: unknown) => Record<string, string> | null;
  number: (s: string) => string | null;
  setup?: string;
}
interface Config { kind?: string; host?: string; port?: number | string; listenPort?: number | string; list?: number | string; fromPatch?: string }

const KINDS: Record<string, DeskKind> = {
  'etc-eos': {
    label: 'ETC Eos family (Eos, Ion, Element, Nomad)',
    fire: (list, n) => `/eos/cue/${list}/${n}/fire`,
    ping: '/eos/ping',
    heard: (address, list) => {
      if (!address.startsWith('/eos/out/')) return null;
      const m = /^\/eos\/out\/(active|pending)\/cue\/(\d+)\/([\d.]+)$/.exec(address);
      return m && Number(m[2]) === Number(list) ? { [m[1]]: m[3] } : {};
    },
    number: (s) => (/^\d+(\.\d+)?$/.test(s) ? s : null),
    setup: 'On the desk: Setup ▸ System ▸ Show Control ▸ OSC. OSC RX on (UDP RX port 8000), OSC TX on (UDP TX port 8001, to this computer’s address). If nothing arrives, see that the desk’s network interface allows OSC (its shell’s network settings).',
  },
  'grandma3': {
    label: 'grandMA3',
    // Goto, not Go+: the manual's keyword for "jump in a list using the original cue timing" (its examples put the
    // cue first: "Goto Cue 105 Executor 104"). It names the cue, so firing it twice runs the same cue twice.
    fire: (list, n) => `/gma3/cmd "Goto Cue ${n} Sequence ${list}"`,
    number: (s) => (/^\d+(\.\d+)?$/.test(s) ? s : null),
    setup: 'On the desk: Menu ▸ In & Out ▸ OSC. Enable Input on; on a line for this computer: the Port this app sends to, Prefix “gma3”, Receive Yes and Receive Command Yes (commands are refused without it).',
  },
  'generic': {
    label: 'Generic OSC ( /cue/<n>/go )',
    fire: (_list, n) => `/cue/${n}/go`,
    number: (s) => s || null,
  },
};

const PING_MS = 2000;
const ANSWERING_MS = 5000;

export const id = 'lighting-desk';
export const name = 'Lighting desk';
export const summary = 'Light cues fire the lighting desk over OSC.';
export const fields: ModuleField[] = [
    { key: 'kind', label: 'Desk', kind: 'enum', options: Object.keys(KINDS), labels: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label])) },
    { key: 'host', label: 'Desk address', kind: 'text', placeholder: '10.0.0.20', help: 'Left empty, the desk’s patch under Settings ▸ Network is used (its address, port and kind of desk).' },
    { key: 'port', label: 'Desk OSC port', kind: 'number' },
    { key: 'listenPort', label: 'Listen for the desk on', kind: 'number' },
    { key: 'list', label: 'Cue list', kind: 'number' },
  ];
export function create({ log, changed, failed = null, now = Date.now }: Pick<ModuleContext, 'log' | 'changed'> & { failed?: ModuleContext['failed'] | null; now?: () => number }) {
    let cfg: Config | null = null, sock: dgram.Socket | null = null, replies: dgram.Socket | null = null, pinger: ReturnType<typeof setInterval> | undefined | null = null;
    const st: { heardAt: number; active: string; pending: string; fired: { number: string; at: number } | null; error: string } = { heardAt: 0, active: '', pending: '', fired: null, error: '' };
    const kind = () => KINDS[(cfg && cfg.kind)!] || KINDS['etc-eos'];

    /** Returns why it could not be sent (null: on its way). A send that fails later is told to `failed`, for the cue. */
    function out(text: string, cueId: string | null = null) {
      if (!cfg || !cfg.host) { st.error = 'no desk address set'; return st.error; }
      const m = osc.parseText(text);
      sock!.send(osc.encode(m.address, m.args), Number(cfg.port) || 8000, cfg.host, (err) => {
        if (err) { st.error = `${m.address}: ${err.message}`; log(`DROPPED ${text}: ${err.message}`); if (cueId && failed) failed(cueId, err.message); changed(); }
      });
      return null;
    }

    return {
      start(config: Config) {
        cfg = { ...config };
        st.error = cfg.host ? '' : 'no desk address set';
        sock = dgram.createSocket('udp4');
        sock.on('error', (e) => { st.error = e.message; log(e.message); changed(); });
        sock.unref();
        if (kind().heard && Number(cfg.listenPort) > 0) {
          replies = dgram.createSocket({ type: 'udp4', reuseAddr: true });
          replies.on('message', (buf) => {
            // (anyone on the network can send to this port: what is not OSC is dropped, never thrown in the main process)
            let got: Record<string, string> | null = null;
            try { const m = osc.decode(buf); got = m && kind().heard!(m.address, cfg!.list); } catch { return; }
            if (!got) return;
            const was = [st.active, st.pending, now() - st.heardAt < ANSWERING_MS].join('|');
            st.heardAt = now(); Object.assign(st, got);
            if (was !== [st.active, st.pending, true].join('|')) changed();
          });
          replies.on('error', (e) => { st.error = `cannot listen for the desk on :${cfg!.listenPort}: ${e.message}`; log(st.error); try { replies!.close(); } catch { /* closed */ } replies = null; changed(); });
          replies.bind(Number(cfg.listenPort));
          replies.unref();
        }
        if (kind().ping && cfg.host) {
          out(kind().ping!);
          pinger = setInterval(() => { out(kind().ping!); changed(); }, PING_MS);
          pinger.unref();
        }
      },
      stop() {
        clearInterval(pinger ?? undefined); pinger = null;
        for (const s of [sock, replies]) try { s && s.close(); } catch { /* closed */ }
        sock = replies = null; cfg = null;
      },
      /** The engine fired a Light cue. */
      onLight(cue: EngineCue) {
        const n = kind().number(String(cue.lightCue || '').trim());
        if (!n) { log(`${cue.number || cue.id}: “${cue.lightCue}” is not a cue number this desk takes`); return `“${cue.lightCue}” is not a cue number this desk takes`; }
        const text = kind().fire(cfg!.list || 1, n);
        const why = out(text, cue.id);
        if (why) return why;
        st.fired = { number: n, at: now() };
        log(`-> desk: ${text}`);
        changed();
        return null;
      },
      status() {
        const canHear = !!(kind().heard && replies);
        const answering = canHear && now() - st.heardAt < ANSWERING_MS;
        return {
          ok: !st.error && (!canHear || answering),
          // "not answering" is all UDP can say: the cues are still sent, and whether they arrive is for the desk to show
          text: st.error || `${canHear ? (answering ? `desk answering${st.active ? ` · on cue ${st.active}` : ''}` : 'desk not answering') + ' · ' : ''}sending to ${cfg!.host}:${cfg!.port}${cfg!.fromPatch ? ` (the patch “${cfg!.fromPatch}”)` : ''}`,
          active: st.active, pending: st.pending, fired: st.fired, setup: kind().setup || '',
        };
      },
    };
  }
export { KINDS };
