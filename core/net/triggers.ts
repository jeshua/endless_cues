/**
 * OSC triggers: which cues an incoming message fires.
 *
 * A cue's `oscTrigger` is an address ("/sm/thunder", patterns allowed: "/sm/*"), optionally followed by the
 * arguments the message must carry ("/sensor/door 1", so that the door's 0 does not fire it). The host reads
 * the show's triggers once per edit and asks, for each message that arrives, which cues it starts.
 */
import * as osc from './osc';
import * as show from '../show/show';
import type { ShowDoc } from '../show/types';

/** A cue's OSC trigger: the address, and the arguments it must carry ('' for any). */
export interface OscTrigger { id: string; address: string; args: string }

/** Every OSC trigger in a show: [{ id, address, args }] (`args`: the text they must match, '' for any). */
function oscTriggers(doc: Pick<ShowDoc, 'lists'>): OscTrigger[] {
  const out: OscTrigger[] = [];
  show.walk(doc, (c) => {
    const t = String(c.oscTrigger || '').trim();
    if (!t.startsWith('/')) return;
    const [address, ...rest] = t.split(/\s+/);
    out.push({ id: c.id, address, args: rest.join(' ') });
  });
  return out;
}

/** The cues a message ({ address, args }) fires, in show order. */
function firedBy(triggers: OscTrigger[], msg: { address: string; args?: unknown[] }): string[] {
  const args = (msg.args || []).map(String).join(' ');
  return triggers.filter((t) => osc.matches(t.address, msg.address) && (!t.args || t.args === args)).map((t) => t.id);
}

export { oscTriggers, firedBy };
