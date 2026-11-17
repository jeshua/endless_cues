/**
 * The built-in helper: the assistant with no model.
 *
 * Many people open the assistant before they have set up a model, and some never will. This is what answers
 * then (the provider called `demo`, shown as "Built-in helper"): no network, nothing sent anywhere, and a short
 * list of jobs it really does, each a scripted turn through the same tools a model uses (tools.js). So every
 * job here ends, like a model's, in a proposal a person reviews, and each is also a test of the tools.
 *
 *   cues from the sounds in the folder · add a device from a model · look for props · a cue that sends a
 *   device's command · is everything ready? · why is X not answering? · firmware for a prop · the hand-over ·
 *   renumber a list in tens · check the show · make a patch a device · five one-line edits · and where a thing is
 *   in the window, or its key (from app-guide.js, with the place pointed at)
 *
 * It matches phrasings loosely and understands nothing: asked anything else it says what it does, in the
 * words to use, and that a model does the rest. It must never pretend to more than its list.
 *
 * A provider is { name, create({ messages, ctx }) → an assistant message }. `ctx` is the turn (the open show,
 * its folder, the draft); the helper reads it to work out what to ask the tools for, and changes nothing itself.
 */
import * as starters from './starters';
import { quickListing } from './tools';
import * as show from '../show/show';
import * as rigDevices from '../rig/devices';
import * as models from '../net/devices';
import * as appGuide from './app-guide';
import type { Block, Provider, Reply } from './assistant';
import type { ToolContext, ToolInput } from './tools';
import type { Op } from '../show/ops';
import type { Cue, ShowDoc } from '../show/types';

/** What to do with the next tool result: its text, and whether it failed. */
type Then = (text: string, failed: boolean) => Reply;

/** The words a person uses for a model. The first that is in the request wins, so the longer come first. */
const WORDS: [string, string][] = [
  ['prop switch', 'ec-prop-switch'], ['prop light', 'ec-prop-light'],
  ['etc', 'etc-eos'], ['eos', 'etc-eos'], ['ion', 'etc-eos'], ['element', 'etc-eos'], ['gio', 'etc-eos'], ['nomad', 'etc-eos'],
  ['grandma', 'grandma3'], ['ma3', 'grandma3'], ['x32', 'x32'], ['m32', 'x32'], ['x air', 'xair'], ['xair', 'xair'], ['xr18', 'xair'], ['xr16', 'xair'], ['xr12', 'xair'], ['mr18', 'xair'],
  ['qlab', 'qlab'], ['reaper', 'reaper'], ['resolume', 'resolume'],
  ['lantern', 'ec-prop-light'], ['lamp', 'ec-prop-light'], ['led strip', 'ec-prop-light'], ['strip', 'ec-prop-light'], ['light', 'ec-prop-light'],
  ['relay', 'ec-prop-switch'], ['servo', 'ec-prop-switch'], ['switch', 'ec-prop-switch'],
];
// (a "lighting desk" is not a "light": a desk is named by its maker or not at all)
const modelIn = (text: string) => { const t = ` ${text.toLowerCase().replace(/lighting (desk|board|console)/g, 'desk')} `; for (const id of Object.keys(models.DEVICES)) if (t.includes(` ${id} `)) return id; const w = WORDS.find(([word]) => new RegExp(`\\b${word}\\b`).test(t)); return w ? w[1] : null; };
const ADDRESS = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::(\d{1,5}))?\b/;
const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const unquote = (s: unknown) => String(s || '').trim().replace(/^["“'‘]+|["”'’.?!]+$/g, '').trim();

const LIST = [
  'The built-in helper has no model. It knows only these:',
  '• “make cues from the sounds in this folder”',
  '• “add a lantern at 10.0.0.42”',
  '• “look for props”',
  '• “add a cue that sends identify to Lantern”',
  '• “is everything ready?”',
  '• “why is Lantern not answering?”',
  '• “write firmware for Lantern”',
  '• “hand the show over”',
  '• “renumber Main in tens”',
  '• “set cue 2 level to -8”, “rename cue 3 to Thunder”, “fade out cue 1 over 6”',
  '• “where is Panic?”, “what is the key for Save?”, “how do I change a cue’s colour?”',
  'For anything else, choose a model in Settings ▸ Assistant.',
].join('\n');

/** A question about the app itself: where something is, how to do something in the window, what a key is. */
const ASKS_WHERE = /^\s*(where|how (do|can) i|how to|what('?s| is) the (key|shortcut)|which (key|button)|what (key|button)|is there a (key|shortcut)|show me)\b|\b(key|shortcut) (for|to)\b/i;
/** Keys as this computer writes them: ⌘S on a Mac, Ctrl+S elsewhere (as the window's keys() does). */
const local = (text: string, platform: string = process.platform) => (platform === 'darwin' ? text : text.replace(/⇧⌘/g, 'Ctrl+Shift+').replace(/⌥⌘/g, 'Ctrl+Alt+').replace(/⌘/g, 'Ctrl+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+'));

function helperProvider(): Provider {
  let n = 0;
  let then: Then | null = null;          // what to do with the next tool result: (text, failed) → a message
  const msg = (content: Block[], stop_reason: string): Reply => ({ role: 'assistant', content, stop_reason });
  const say = (text: string) => { then = null; return msg([{ type: 'text', text }], 'end_turn'); };
  const call = (name: string, input: ToolInput, next: Then) => { then = next; return msg([{ type: 'tool_use', id: `helper_${++n}`, name, input }], 'tool_use'); };
  /** Hand a change over, and say `reply` once it is staged (or why it was not). */
  const propose = (summary: string, ops: Op[] | null, reply = 'Ready to review.') => call('propose_changes', { summary, ...(ops ? { ops } : {}) }, (text, failed) => say(failed ? `I could not stage that: ${text}` : reply));

  function respond(text: string, ctx: Partial<ToolContext>) {
    // (with no show open, a job that needs one fails, and says so)
    const document = ctx && ctx.document, doc = (document ? (ctx.draft || document.doc) : null)!;
    const devs = doc ? rigDevices.list(doc) : [];
    const device = (words: string) => { const w = unquote(words).toLowerCase().replace(/^(the|my)\s+/, ''); return devs.find((d) => d.id === w || d.name.toLowerCase() === w) || devs.find((d) => d.name.toLowerCase().startsWith(w) || w.startsWith(d.name.toLowerCase())) || null; };
    const noDevice = (words: string) => say(devs.length ? `The show has no device called “${unquote(words)}”. It has: ${devs.map((d) => d.name).join(', ')}.` : 'No devices yet. Say “add a lantern at 10.0.0.42”, or “look for props”.');
    let m: RegExpExecArray | null;

    // ── the folder ──
    if (/how do i start from a folder/i.test(text)) return say('Choose File ▸ Start from a Folder… and pick your sounds’ folder. Nothing is moved or copied.');

    // ── where things are, and their keys: the app's own guide (app-guide.js), and the place pointed at ──
    if (ASKS_WHERE.test(text)) {
      const hit = appGuide.find(text);
      if (hit) {
        const keyed = /\b(key|keys|shortcut|hotkey)\b/i.test(text) && hit.keys.length;
        const keyList = hit.keys.map((k) => `${k.what}: ${k.keys}`).join('; ');
        const words = local(keyed ? `${hit.keys.length === 1 ? `The key is ${hit.keys[0].keys}` : keyList}. ${hit.text}` : `${hit.text}${hit.keys.length ? ` (${keyList})` : ''}`);
        if (!hit.place.ok || hit.place.place.sel === null) return say(words);
        return call('show_in_app', { target: hit.at, say: local(keyed && hit.keys.length === 1 ? `${hit.place.place.label}: ${hit.keys[0].keys}` : hit.place.place.label) }, (said, failed) => say(failed ? words : `${words}\nIt is ringed on the screen now.`));
      }
    }
    if (/\bcues?\b.*\b(from|for|out of)\b.*\b(sounds?|folder|files?|tracks?|music)\b/i.test(text) && !/\bsends?\b/i.test(text)) {
      if (!document || !document.showDir) return say('This show is not in a folder yet. Choose File ▸ Start from a Folder… first.');
      return call('list_folder', {}, (_listing, failed) => {
        if (failed) return say(`I could not look at the folder: ${_listing}`);
        const plan = starters.folderPlan(quickListing(document.showDir!, doc), { from: starters.nextNumber(doc) });
        if (!plan.count) return say(starters.said(plan));
        return propose(`Cues for the ${plan.count} sound${plan.count === 1 ? '' : 's'} in the folder`, plan.ops, `${starters.said(plan)} Accept to add them.`);
      });
    }

    // ── a cue that sends a device's command ──
    if ((m = /\bcue\b.*?\b(?:sends?|fires?|does)\s+(.+?)\s+(?:to|on)\s+(.+?)[.?!]?$/i.exec(text))) {
      const d = device(m[2]);
      if (!d) return noDevice(m[2]);
      const words = unquote(m[1]).replace(/^(the|a|an)\s+/i, '').split(/\s+/);
      const cmd = (d.commands || []).find((c) => c.id === words[0].toLowerCase() || c.label.toLowerCase() === unquote(m![1]).toLowerCase()) || (d.commands || []).find((c) => c.label.toLowerCase().startsWith(words[0].toLowerCase()));
      if (!cmd) return say(`${d.name} has no command “${unquote(m[1])}”. It has: ${(d.commands || []).map((c) => c.label).join(', ') || 'none yet'}.`);
      // words after the command's name are its values, in the order of its parameters ("effect breathe")
      const args: Record<string, string | number> = {};
      (cmd.params || []).forEach((p, i) => { const v = words[i + 1]; if (v !== undefined) args[p.key] = p.kind === 'number' && Number.isFinite(Number(v)) ? Number(v) : v; });
      const engine = ctx.engine, at = engine && engine.playhead && show.index(doc).byId.get(engine.playhead);
      return call('read_show', { device: d.id }, () => {
        const made = rigDevices.compose(d, cmd.id, args);
        if (!made.ok) return say(`That would not send: ${made.why}.`);
        const number = numberAfter(doc, at || null);
        return propose(`A cue that sends ${cmd.label} to ${d.name}`, [{ op: 'cue.add', cue: { type: 'device', device: d.id, command: cmd.id, ...(number ? { number } : {}), ...(Object.keys(args).length ? { args } : {}) }, ...(at ? { after: at.id } : {}) }],
          `A Device cue, “${rigDevices.cueName(d, { device: d.id, command: cmd.id, args })}”, ${at ? `after ${at.number ? `cue ${at.number}` : 'the cue the playhead is on'}` : 'at the end of the list'}. GO on it sends ${made.message}. I cannot send it myself: accept, then GO it or press Try on the Rig page.`);
      });
    }

    // ── the rig ──
    if (/look for props|find (?:the |my |any )?(?:props|devices)|scan for props/i.test(text)) {
      return call('find_devices', {}, (heard, failed) => {
        if (failed) return say(heard);
        const found = (ctx.found || []);
        const fresh = found.filter((f) => !f.known), moved = found.filter((f) => f.known && f.moved);
        if (!fresh.length && !moved.length) return say(found.length ? `${heard}\nThere is nothing to add.` : `${heard} Then ask again. A prop without the kit’s firmware cannot answer: “write firmware for …” makes it.`);
        const taken = new Set([...devs.map((d) => d.id), ...(doc.settings.network.patches || []).map((p) => p && p.id)]);
        const ops = [
          ...fresh.map((f): Op => { const id = rigDevices.ID.test(String(f.name)) && !taken.has(f.name) ? f.name : rigDevices.idFrom(f.name, taken); taken.add(id); return { op: 'device.add', device: { id, name: capital(String(f.name).replace(/_/g, ' ')), model: f.kind === 'switch' ? 'ec-prop-switch' : 'ec-prop-light', host: f.host, port: Number(f.port) || 53100 } }; }),
          ...moved.map((f): Op => ({ op: 'device.set', id: f.known!, props: { host: f.host } })),
        ];
        const what = [fresh.length && `${fresh.length === 1 ? 'One prop' : `${fresh.length} props`} answered that the show does not have yet: ${fresh.map((f) => `${f.name} at ${f.host} (a ${f.kind === 'switch' ? 'switch' : 'light'}${f.fw ? `, firmware ${f.fw}` : ''})`).join(', ')}.`, moved.length && `${moved.map((f) => f.name).join(', ')} answered from a new address: I have corrected it.`].filter(Boolean).join(' ');
        return propose(fresh.length ? `Add ${fresh.length === 1 ? `the prop ${fresh[0].name}` : `${fresh.length} props`} found on the network` : 'Props at their new addresses', ops, `${what} Accept, and each gets a row on the Rig page; Try ▸ Identify there shows which is which.`);
      });
    }
    if ((m = /why (?:is|isn't|isn’t) (.+?) (?:not )?(?:answering|working|there|responding|ready)/i.exec(text))) {
      const d = device(m[1]);
      if (!d) return noDevice(m[1]);
      const where = rigDevices.isNetwork(d) ? (d.host && d.port ? `${d.host}:${d.port}` : 'no address yet') : 'MIDI';
      return call('ask_device', { device: d.id }, (heard, failed) => {
        if (failed) return say(heard);
        if (/answered in/.test(heard)) return say(`${heard}\nIt is there now. If its Rig row still shows a problem, press Check again.`);
        if (/^Held back/.test(heard)) return say(`${heard} Hold Back is on, so nothing reaches it: let it go, and ask again.`);
        return say(`I asked ${d.name} at ${where} just now and it did not answer. Most likely: it has no power; it is not on this computer’s network, and an ESP32 joins only 2.4 GHz; its address has changed, and “look for props” finds a kit prop; or the address in the show is wrong.`);
      });
    }
    if (/\b(is|are) (everything|we|it all|the show|the rig)\b.*\bready\b|\bwhat is not ready\b|\bcheck the rig\b/i.test(text)) {
      return call('rig_status', {}, (status, failed) => {
        if (failed) return say(status);
        const lines = status.split('\n');
        const not = lines.filter((l) => /^ {2}(problem|to look at|cannot be told): /.test(l)).map((l) => `• ${l.trim()}`);
        const head = lines[0].replace(/^The rig: /, '');
        if (/nothing to report/.test(lines[0])) return say('The Rig page has nothing to report yet.');
        return say(not.length ? `${capital(head)}\n${not.join('\n')}` : `${capital(head)}. Nothing needs you.`);
      });
    }
    if ((m = /(?:write|make|generate|build)\s+(?:the\s+|some\s+)?firmware\s+for\s+(.+?)[.?!]?$/i.exec(text))) {
      const d = device(m[1]);
      if (!d) return noDevice(m[1]);
      return call('make_prop_files', { device: d.id, sketch: d.model === 'ec-prop-switch' ? 'switch' : 'light' }, (staged, failed) => {
        if (failed) return say(staged);
        const first = staged.split('\n')[0].replace(/^Staged \d+ files for /, '').replace(/:$/, '');
        return propose(`Firmware for ${d.name}`, null, `Firmware for ${first}, with the kit’s usual settings; for others, use the Rig page’s “Write firmware…”. Accept, and the files are in props/${d.id}/: put your Wi-Fi name and password in secrets.h, open ${d.id}.ino in the Arduino IDE, and upload. It compiles, but has not yet been run on a board.`);
      });
    }
    if (/hand\s*(?:the show|it|this)?\s*(?:over|off)|coding agent/i.test(text)) {
      return call('hand_off', { why: 'The person asked for the show to be handed over to a coding agent.' }, (staged, failed) => {
        if (failed) return say(staged);
        return propose('The guide for coding agents', null, `Accept, and AGENTS.md and CLAUDE.md, a guide for coding agents, are written into the show folder. Then, in a terminal:\n  cd ${JSON.stringify(document!.showDir)}\n  claude\nand say what you want. Codex reads the same file.`);
      });
    }
    if ((m = /turn (?:the )?patch\s+(.+?)\s+into a device/i.exec(text))) {
      const patches = (doc.settings.network.patches || []), want = unquote(m[1]).toLowerCase();
      const p = patches.find((x) => x && (String(x.name).toLowerCase() === want || x.id === want));
      if (!p) return say(`The show has no network patch called “${unquote(m[1])}”. It has: ${patches.map((x) => x.name).join(', ') || 'none'}.`);
      const model = p.device && p.device !== 'generic' && models.DEVICES[p.device] ? p.device : null;
      return propose(`The patch ${p.name}, made a device`, [
        { op: 'device.add', device: { id: p.id, name: p.name, ...(model ? { model } : {}), host: p.host, port: p.port, protocol: p.protocol || 'udp' } },
        { op: 'show.set', path: 'settings.network.patches', value: patches.filter((x) => x !== p) },
      ], `${p.name} becomes a device, and its cues still send to it. ${model ? `It takes the commands of ${models.DEVICES[model].label} and` : 'It has no commands yet; its cues keep their messages. It'} gets a row on the Rig page.`);
    }
    // a device, from a model named in words: "add a lantern at 10.0.0.42", "my lighting desk is an ETC Ion at 10.0.0.20"
    const addr = ADDRESS.exec(text);
    if ((addr || /\badd\b.*\bdevice\b/i.test(text)) && !/\bcue\b/i.test(text)) {
      const model = modelIn(text.replace(ADDRESS, ' '));
      const called = /\b(?:called|named)\s+(.+?)(?:\s+(?:at|on)\s+\d|\s*[.?!]?$)/i.exec(text);
      const noun = /\b(?:add|connect)\s+(?:a|an|the|my)?\s*(.+?)\s+(?:at|on)\s+\d/i.exec(text) || /\b(?:my|the)\s+(.+?)\s+is\b/i.exec(text);
      const name = capital(unquote(called ? called[1] : noun ? noun[1].replace(/^(device|prop)\s+/i, '') : model ? models.DEVICES[model].label.replace(/\s*\(.*$/, '') : 'Device'));
      if (!name || name.toLowerCase() === 'device') return say('What is it called? Say “add a device called Fog at 10.0.0.60:9000”.');
      const same = devs.find((d) => d.name.toLowerCase() === name.toLowerCase());
      if (same) return say(`The show already has a device called ${same.name}${same.host ? ` (at ${same.host})` : ''}. Name this one differently, or change ${same.name}’s address on the Rig page.`);
      const port = addr && addr[2] ? Number(addr[2]) : null;
      const dev = { name, ...(model ? { model } : { kind: 'other' }), ...(addr ? { host: addr[1] } : {}), ...(port ? { port } : {}) };
      const md = model && models.DEVICES[model];
      const reply = md
        ? `${name}, from the app’s model “${md.label}”: I took that from your words, so reject this if it is something else. ${md.commands.length} commands${md.test && md.answers ? ', asked “are you there?” every 2 seconds' : ''}${addr ? '' : '; no address yet: give it one on the Rig page'}. Accept, and it has a row on the Rig page.${model.startsWith('ec-prop') ? ` Not built yet? Ask me to “write firmware for ${name}”.` : ''}`
        : `${name}, a plain device${addr ? ` at ${addr[1]}${port ? `:${port}` : ', no port yet'}` : ''}. I do not know what it is, so it has no commands yet: add them on the Rig page, or name a kind I know: ETC Eos, grandMA3, X32, X Air, QLab, REAPER, Resolume, or a kit prop light or switch.`;
      return propose(`Add the device ${name}`, [{ op: 'device.add', device: dev }], reply);
    }

    // ── a list, and the show ──
    if ((m = /renumber\s+(.+?)\s+in tens/i.exec(text))) {
      const want = unquote(m[1]).toLowerCase().replace(/^the\s+/, '').replace(/\s+list$/, '');
      const l = doc.lists.find((x) => x.name.toLowerCase() === want) || (doc.lists.length === 1 || /^(it|this|everything|all|the show)$/.test(want) ? doc.lists[0] : null);
      if (!l) return say(`Which list? The show has: ${doc.lists.map((x) => x.name).join(', ')}.`);
      if (!l.cues.length) return say(`${l.name} has no cues to number.`);
      return propose(`Renumber ${l.name} in tens`, [{ op: 'cue.renumber', ids: l.cues.map((c) => c.id), start: 10, step: 10 }], `The ${l.cues.length} top-level cues of ${l.name} become 10, 20, 30…; cues inside groups keep theirs.`);
    }
    if (/check (the show|it|everything) for problems|what is (wrong|broken)/i.test(text)) return call('check_show', {}, (found) => say(found));

    // ── the five one-line edits ──
    if ((m = /(?:set|change|put)\s+(?:cue\s+)?#?(\S+?)(?:'s)?\s+(?:level|gain|volume)\s+(?:to|at)\s+(-?\d+(?:\.\d+)?)/i.exec(text))) return propose(`Set ${m[1]} to ${m[2]} dB`, [{ op: 'cue.set', id: `#${m[1]}`, props: { gainDb: Number(m[2]) } }]);
    if ((m = /rename\s+(?:cue\s+)?#?(\S+)\s+(?:to|as)\s+["“]?(.+?)["”]?$/i.exec(text))) return propose(`Rename ${m[1]} to “${m[2]}”`, [{ op: 'cue.set', id: `#${m[1]}`, props: { name: m[2] } }]);
    if ((m = /fade\s+out\s+(?:cue\s+)?#?(\S+?)(?:\s+over\s+(\d+(?:\.\d+)?))?(?:\s*s(?:ec(?:ond)?s?)?)?$/i.exec(text))) return propose(`Add a ${m[2] || 5} s fade-out after ${m[1]}`, [{ op: 'cue.add', after: `#${m[1]}`, cue: { type: 'fade', target: `#${m[1]}`, db: -60, duration: Number(m[2] || 5), stopTarget: true } }]);
    if ((m = /add\s+(?:a\s+|an\s+)?(memo|wait|group)\s*(?:(?:called|named)\s+["“]?(.+?)["”]?)?$/i.exec(text))) return propose(`Add a ${m[1]}${m[2] ? ` “${m[2]}”` : ''}`, [{ op: 'cue.add', cue: { type: m[1].toLowerCase(), ...(m[2] ? { name: m[2] } : {}) } }]);
    if ((m = /(?:delete|remove)\s+(?:cue\s+)?#?(\S+)$/i.exec(text))) return propose(`Remove ${m[1]}`, [{ op: 'cue.remove', id: `#${m[1]}` }]);
    return say(LIST);
  }

  return {
    name: 'demo',
    label: 'Built-in helper',
    async create({ messages, ctx = null }) {
      const last = messages[messages.length - 1];
      const blocks: Block[] = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content) }];
      const result = blocks.find((b) => b.type === 'tool_result');
      if (result) {
        const text = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
        const next = then; then = null;
        return next ? next(text, !!result.is_error) : say(result.is_error ? `I could not do that: ${text}` : 'Done.');
      }
      const text = (blocks.filter((b) => b.type === 'text').map((b) => b.text).pop() || '').replace(/<show_outline>[\s\S]*<\/show_outline>/, '').trim();
      try { return respond(text, ctx || {}); } catch (err) { return say(`I could not do that: ${(err as Error).message}`); }
    },
    explain: (err) => err.message,
  };
}

/** The number a cue added after `at` takes, as one added from the toolbar would (the window's `nextNumber`): the next
 *  whole number, else half or a tenth of the way to the cue after it; none when numbering is off or there is no
 *  number to count from. At the end of the list (no `at`): one more than the highest. */
function numberAfter(doc: ShowDoc, at: Cue | null | undefined) {
  if (((doc.settings || {}).editing || {}).autoNumber === false) return null;
  const step = Number(((doc.settings || {}).editing || {}).numberStep) > 0 ? Number(doc.settings.editing.numberStep) : 1;
  const used = new Set<string>(); show.walk(doc, (c) => { if (c.number) used.add(String(c.number)); });
  const round = (n: number) => Math.round(n * 1000) / 1000;
  if (!at) return String(starters.nextNumber(doc));
  const list = doc.lists.find((l) => l.cues.some((c) => c.id === at.id));
  if (!list) return null;
  const i = list.cues.findIndex((c) => c.id === at.id), prev = Number(at.number), next = list.cues[i + 1] ? Number(list.cues[i + 1].number) : NaN;
  if (!at.number || !Number.isFinite(prev)) return null;
  for (const n of [round((Math.floor(prev / step) + 1) * step), round(prev + step / 2), round(prev + step / 10)]) if (!used.has(String(n)) && !(n >= next)) return String(n);
  return null;
}

export { helperProvider, LIST, modelIn };
