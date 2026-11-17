/**
 * Who has been sending to this computer that the show does not know: the monitor's incoming messages from
 * addresses that are no device's and no patch's, grouped by who sent them, for "is this your prop?"
 * (docs/specs/15-assistant-and-rig.md, 3.3 and 5.2 "Heard on the network").
 *
 *   senders(entries, { devices, patches })
 *     → [{ address, port, count, messages: [{ address, count, every }], lastAt }]      the most recent sender first
 *
 * `entries` are the hub's monitor entries. `every` is the usual number of seconds between two of that message
 * (null with fewer than two). Pure: it reads what was heard and sends nothing.
 */
function senders(entries = [], { devices = [], patches = [] } = {}) {
  const ours = new Set([...devices, ...patches].map((x) => x && x.host).filter(Boolean));
  const by = new Map();
  for (const e of entries) {
    if (!e || e.dir !== 'in' || !e.from || e.patch || e.via === 'midi' || ours.has(e.from.address)) continue;
    const key = `${e.from.address}:${e.from.port}`;
    if (!by.has(key)) by.set(key, { address: e.from.address, port: e.from.port, count: 0, lastAt: 0, seen: new Map() });
    const s = by.get(key);
    s.count++; s.lastAt = Math.max(s.lastAt, e.at || 0);
    const address = String(e.text || '').split(/\s+/)[0];
    if (!s.seen.has(address)) s.seen.set(address, []);
    s.seen.get(address).push(e.at || 0);
  }
  return [...by.values()].sort((a, b) => b.lastAt - a.lastAt).map((s) => ({
    address: s.address, port: s.port, count: s.count, lastAt: s.lastAt,
    messages: [...s.seen].map(([address, times]) => {
      const gaps = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
      return { address, count: times.length, every: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)] / 100) / 10 : null };
    }).sort((a, b) => b.count - a.count),
  }));
}

export { senders };
