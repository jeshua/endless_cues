// DMX on the wire: Art-Net, sACN and the Enttec USB frame checked byte by byte against the published
// specifications, and the sender checked on loopback sockets. Nothing here reaches a real network.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as dgram from 'dgram';
import * as artnet from '../core/light/artnet';
import * as sacn from '../core/light/sacn';
import * as usb from '../core/light/usb';
import { createLightOutput, broadcastAddresses, cidFor } from '../core/light/output';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface Listener { sock: dgram.Socket; got: { b: Buffer; from: dgram.RemoteInfo }[]; port: number; close: () => void }
const listener = () => new Promise<Listener>((res) => { const s = dgram.createSocket('udp4'); const got: Listener['got'] = []; s.on('message', (b, from) => got.push({ b, from })); s.bind(0, '127.0.0.1', () => res({ sock: s, got, port: s.address().port, close: () => s.close() })); });
const until = async (fn: () => unknown, ms = 1500) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await sleep(10); } return false; };

test('ArtDmx: the header, sequence, port address and length, to the byte (Art-Net 4, ArtDmx)', () => {
  const p = artnet.artDmx({ universe: 0x1234, sequence: 7, physical: 2, data: [255, 128, 1, 0] });
  assert.deepEqual([...p], [
    0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00,      // "Art-Net\0"
    0x00, 0x50,                                          // OpOutput 0x5000, low byte first
    0x00, 0x0e,                                          // protocol 14, high byte first
    0x07,                                                // sequence
    0x02,                                                // physical
    0x34,                                                // SubUni: the low 8 bits of the port address
    0x12,                                                // Net: the high 7
    0x00, 0x04,                                          // length, high byte first
    0xff, 0x80, 0x01, 0x00,
  ]);
  // an odd number of levels is padded to an even length
  const odd = artnet.artDmx({ universe: 0, data: [9, 8, 7] });
  assert.equal(odd.length, 18 + 4);
  assert.deepEqual([...odd.subarray(16)], [0x00, 0x04, 9, 8, 7, 0]);
  // a full universe
  const full = artnet.artDmx({ universe: 1, sequence: 255, data: Buffer.alloc(512, 0xaa) });
  assert.equal(full.length, 530);
  assert.deepEqual([...full.subarray(12, 18)], [0xff, 0x00, 0x01, 0x00, 0x02, 0x00]);
  assert.deepEqual(artnet.parseDmx(full), { universe: 1, sequence: 255, physical: 0, data: Buffer.alloc(512, 0xaa) });
  assert.throws(() => artnet.artDmx({ universe: 32768, data: [0] }), /universe/);
  assert.throws(() => artnet.artDmx({ universe: 0, data: Buffer.alloc(513) }), /512/);
  assert.throws(() => artnet.artDmx({ universe: 0, data: [] }), /1 to 512/);
});

test('ArtPoll and ArtPollReply: the fields a node or another controller reads, at their offsets', () => {
  assert.deepEqual([...artnet.artPoll()], [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00, 0x00, 0x20, 0x00, 0x0e, 0x00, 0x00]);
  const r = artnet.artPollReply({ ip: '10.0.0.5', mac: '02:aa:bb:cc:dd:ee', shortName: 'Endless Cues', longName: 'Endless Cues (show control)', universes: [0x0123, 0x0125, 0x0200] });
  assert.equal(r.length, 239);
  assert.deepEqual([...r.subarray(0, 10)], [0x41, 0x72, 0x74, 0x2d, 0x4e, 0x65, 0x74, 0x00, 0x00, 0x21]);       // OpPollReply 0x2100
  assert.deepEqual([...r.subarray(10, 14)], [10, 0, 0, 5]);                                                     // the IP address
  assert.deepEqual([...r.subarray(14, 16)], [0x36, 0x19]);                                                      // port 0x1936, low byte first
  assert.equal(r[18], 0x01);                                                                                    // NetSwitch
  assert.equal(r[19], 0x02);                                                                                    // SubSwitch
  assert.equal(r.subarray(26, 44).toString('latin1').replace(/\0+$/, ''), 'Endless Cues');                      // short name: 18 bytes
  assert.equal(r[43], 0);
  assert.equal(r.subarray(44, 108).toString('latin1').replace(/\0+$/, ''), 'Endless Cues (show control)');      // long name: 64 bytes
  assert.deepEqual([...r.subarray(172, 174)], [0, 2]);                                                          // two ports in this Net and Sub-Net (0x0200 is another Net)
  assert.deepEqual([...r.subarray(174, 178)], [0x40, 0x40, 0, 0]);                                              // each can input onto the network
  assert.deepEqual([...r.subarray(186, 190)], [0x03, 0x05, 0, 0]);                                              // SwIn: the universe nibbles
  assert.equal(r[200], 0x01);                                                                                   // Style: a controller
  assert.deepEqual([...r.subarray(201, 207)], [0x02, 0xaa, 0xbb, 0xcc, 0xdd, 0xee]);                            // MAC
  assert.deepEqual([...r.subarray(207, 211)], [10, 0, 0, 5]);                                                   // BindIp
  assert.equal(r[212] & 0x08, 0x08);                                                                            // 15-bit port addresses
  // a name too long for its field is cut, and still ends in a null
  const long = artnet.artPollReply({ shortName: 'A name much longer than eighteen bytes' });
  assert.equal(long[43], 0);
  assert.equal(long.subarray(26, 43).toString('latin1'), 'A name much longe');
});

test('ArtPollReply from a node is read: its name, address and the universes it outputs', () => {
  const b = Buffer.alloc(239);
  Buffer.from('Art-Net\0').copy(b); b.writeUInt16LE(0x2100, 8);
  b.set([192, 168, 1, 50], 10);
  b[18] = 0x00; b[19] = 0x01;                    // Net 0, Sub-Net 1
  b.write('Node 4', 26, 'latin1'); b.write('A four-port node', 44, 'latin1');
  b.writeUInt16BE(2, 172);
  b[174] = 0x80; b[175] = 0x80;                  // two ports that output DMX from the network
  b[190] = 0x00; b[191] = 0x03;                  // SwOut
  assert.deepEqual(artnet.parsePollReply(b), { ip: '192.168.1.50', shortName: 'Node 4', longName: 'A four-port node', report: '', style: 0, ports: 2, outputs: [0x10, 0x13] });
  assert.equal(artnet.parsePollReply(artnet.artPoll()), null);
  assert.equal(artnet.kindOf(Buffer.from('not art-net at all')), null);
  assert.equal(artnet.kindOf(artnet.artPoll()), 'poll');
});

test('sACN: an E1.31 data packet, layer by layer, to the byte (ANSI E1.31-2018)', () => {
  const cid = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const p = sacn.dataPacket({ universe: 0x0102, cid, sequence: 9, data: Buffer.alloc(512, 0x7f), name: 'Endless Cues', priority: 100 });
  assert.equal(p.length, 638);
  // root layer
  assert.deepEqual([...p.subarray(0, 4)], [0x00, 0x10, 0x00, 0x00]);                                       // preamble 16, postamble 0
  assert.deepEqual([...p.subarray(4, 16)], [0x41, 0x53, 0x43, 0x2d, 0x45, 0x31, 0x2e, 0x31, 0x37, 0x00, 0x00, 0x00]);   // "ASC-E1.17\0\0\0"
  assert.deepEqual([...p.subarray(16, 18)], [0x72, 0x6e]);                                                 // flags 0x7, length 638 − 16 = 622 = 0x26e
  assert.deepEqual([...p.subarray(18, 22)], [0x00, 0x00, 0x00, 0x04]);                                     // VECTOR_ROOT_E131_DATA
  assert.deepEqual(p.subarray(22, 38), cid);
  // framing layer
  assert.deepEqual([...p.subarray(38, 40)], [0x72, 0x58]);                                                 // 638 − 38 = 600 = 0x258
  assert.deepEqual([...p.subarray(40, 44)], [0x00, 0x00, 0x00, 0x02]);                                     // VECTOR_E131_DATA_PACKET
  assert.equal(p.subarray(44, 108).toString('utf8').replace(/\0+$/, ''), 'Endless Cues');                  // source name, 64 bytes
  assert.equal(p[108], 100);                                                                               // priority
  assert.deepEqual([...p.subarray(109, 111)], [0, 0]);                                                     // no synchronisation
  assert.equal(p[111], 9);                                                                                 // sequence
  assert.equal(p[112], 0);                                                                                 // options
  assert.deepEqual([...p.subarray(113, 115)], [0x01, 0x02]);                                               // universe
  // DMP layer
  assert.deepEqual([...p.subarray(115, 117)], [0x72, 0x0b]);                                               // 638 − 115 = 523 = 0x20b
  assert.equal(p[117], 0x02);                                                                              // VECTOR_DMP_SET_PROPERTY
  assert.equal(p[118], 0xa1);
  assert.deepEqual([...p.subarray(119, 123)], [0x00, 0x00, 0x00, 0x01]);                                   // first address 0, increment 1
  assert.deepEqual([...p.subarray(123, 125)], [0x02, 0x01]);                                               // 513 values: the start code and 512 levels
  assert.equal(p[125], 0x00);                                                                              // DMX start code
  assert.deepEqual(p.subarray(126), Buffer.alloc(512, 0x7f));
  assert.deepEqual(sacn.parse(p), { universe: 258, sequence: 9, priority: 100, name: 'Endless Cues', terminated: false, cid, data: Buffer.alloc(512, 0x7f) });

  const end = sacn.dataPacket({ universe: 1, cid, sequence: 255, data: [], terminated: true });
  assert.equal(end.length, 126);
  assert.equal(end[112], 0x40);                                                                            // Stream_Terminated
  assert.deepEqual([...end.subarray(16, 18)], [0x70, 0x6e]);                                               // 126 − 16 = 110
  assert.throws(() => sacn.dataPacket({ universe: 0, cid, data: [] }), /universe/);
  assert.throws(() => sacn.dataPacket({ universe: 64000, cid, data: [] }), /universe/);
  assert.throws(() => sacn.dataPacket({ universe: 1, cid: Buffer.alloc(4), data: [] }), /CID/);
});

test('sACN: a universe’s multicast group is 239.255.<high>.<low>', () => {
  assert.equal(sacn.multicastAddress(1), '239.255.0.1');
  assert.equal(sacn.multicastAddress(256), '239.255.1.0');
  assert.equal(sacn.multicastAddress(63999), '239.255.249.255');
});

test('USB (not wired in): an Enttec DMX USB Pro “send DMX” frame', () => {
  const f = usb.enttecProFrame(Buffer.alloc(512, 1));
  assert.equal(f.length, 518);
  assert.deepEqual([...f.subarray(0, 5)], [0x7e, 0x06, 0x01, 0x02, 0x00]);       // start, label 6, length 513 low byte first, DMX start code
  assert.equal(f[517], 0xe7);
  // fewer than 24 levels are padded up to 24: the widget's minimum
  const small = usb.enttecProFrame([255, 128]);
  assert.deepEqual([...small.subarray(0, 7)], [0x7e, 0x06, 25, 0, 0x00, 255, 128]);
  assert.equal(small.length, 5 + 1 + 24);
  assert.equal(small.at(-1), 0xe7);
});

test('broadcast addresses come from each network’s address and mask; loopback and IPv6 are left out', () => {
  const list = broadcastAddresses({
    lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', internal: true }],
    en0: [{ address: '192.168.1.20', netmask: '255.255.255.0', family: 'IPv4', internal: false, mac: 'aa:bb:cc:dd:ee:ff' }, { address: 'fe80::1', netmask: 'ffff::', family: 'IPv6', internal: false }],
    en5: [{ address: '2.0.0.9', netmask: '255.0.0.0', family: 'IPv4', internal: false }],
  } as unknown as Parameters<typeof broadcastAddresses>[0]);
  assert.deepEqual(list.map((i) => i.broadcast), ['192.168.1.255', '2.255.255.255']);
  assert.equal(cidFor('a').length, 16);
  assert.deepEqual(cidFor('a'), cidFor('a'));
  assert.notDeepEqual(cidFor('a'), cidFor('b'));
});

test('a dry run builds every packet and opens no socket', () => {
  let opened = 0;
  const fake = { createSocket() { opened++; throw new Error('a test run opened a socket'); } };
  const out = createLightOutput({ dgram: fake, dryRun: true });
  out.configure([{ id: 1, protocol: 'artnet', address: 0, host: '' }, { id: 2, protocol: 'sacn', address: 7, host: '' }], { on: true });
  const frames = new Map([[1, Buffer.alloc(512, 3)], [2, Buffer.alloc(512, 4)]]);
  assert.equal(out.send(frames), 2);
  assert.equal(out.send(frames), 2);
  assert.equal(opened, 0);
  assert.equal(artnet.parseDmx(out.last(1)!)!.data[0], 3);
  assert.equal(artnet.parseDmx(out.last(1)!)!.sequence, 2);
  assert.equal(sacn.parse(out.last(2)!)!.universe, 7);
  assert.equal(sacn.parse(out.last(2)!)!.sequence, 1);
  assert.equal(out.status().packets, 4);
  assert.equal(out.status().dryRun, true);
  out.close();
  assert.equal(sacn.parse(out.last(2)!)!.terminated, true);
  assert.equal(opened, 0);
});

test('nothing is made while the output is off, or with no universe set up', () => {
  const out = createLightOutput({ dryRun: true });
  out.configure([{ id: 1, protocol: 'artnet', address: 0 }], { on: false });
  assert.equal(out.send(new Map([[1, Buffer.alloc(512)]])), 0);
  out.configure([], { on: true });
  assert.equal(out.send(new Map([[1, Buffer.alloc(512)]])), 0);
  assert.equal(out.last(1), null);
});

test('the Art-Net sequence runs 1 to 255 and never 0', () => {
  const out = createLightOutput({ dryRun: true });
  out.configure([{ id: 1, protocol: 'artnet', address: 0 }], { on: true });
  const seen: number[] = [];
  for (let i = 0; i < 257; i++) { out.send(new Map([[1, Buffer.alloc(2)]])); seen.push(artnet.parseDmx(out.last(1)!)!.sequence); }
  assert.deepEqual(seen.slice(0, 3), [1, 2, 3]);
  assert.deepEqual(seen.slice(253), [254, 255, 1, 2]);
  assert.ok(!seen.includes(0));
});

test('on loopback: Art-Net and sACN universes arrive as sent, and an sACN stream says when it ends', async () => {
  const a = await listener(), s = await listener();
  const out = createLightOutput({ ports: { artnet: a.port, sacn: s.port }, listen: false, bindAddress: '127.0.0.1', name: 'Test' });
  out.configure([{ id: 1, protocol: 'artnet', address: 5, host: '127.0.0.1' }, { id: 2, protocol: 'sacn', address: 300, host: '127.0.0.1' }], { on: true });
  await sleep(50);
  const one = Buffer.alloc(512); one[0] = 255; one[511] = 17;
  const two = Buffer.alloc(512); two[9] = 99;
  out.send(new Map([[1, one], [2, two]]));
  assert.ok(await until(() => a.got.length >= 1 && s.got.length >= 1), 'both arrived');
  assert.deepEqual(artnet.parseDmx(a.got[0].b), { universe: 5, sequence: 1, physical: 0, data: one });
  const got = sacn.parse(s.got[0].b)!;
  assert.equal(got.universe, 300); assert.equal(got.name, 'Test'); assert.deepEqual(got.data, two);
  assert.equal(out.status().universes.find((u) => u.id === 1)!.packets, 1);
  // the output is switched off: three terminated packets, then silence
  out.configure([{ id: 1, protocol: 'artnet', address: 5, host: '127.0.0.1' }, { id: 2, protocol: 'sacn', address: 300, host: '127.0.0.1' }], { on: false });
  assert.ok(await until(() => s.got.length >= 4), 'the stream was terminated');
  assert.deepEqual(s.got.slice(1).map((g) => sacn.parse(g.b)!.terminated), [true, true, true]);
  const before = a.got.length;
  assert.equal(out.send(new Map([[1, one]])), 0);
  await sleep(60);
  assert.equal(a.got.length, before);
  out.close(); a.close(); s.close();
});

test('on loopback: DMX held back for a rehearsal makes its packets and sends none, until it is let go', async () => {
  const a = await listener();
  const out = createLightOutput({ ports: { artnet: a.port, sacn: a.port }, listen: false, bindAddress: '127.0.0.1', name: 'Test' });
  out.configure([{ id: 1, protocol: 'artnet', address: 5, host: '127.0.0.1' }], { on: true });
  await sleep(50);
  out.hold(true);
  const one = Buffer.alloc(512, 9);
  assert.equal(out.send(new Map([[1, one]])), 1);
  await sleep(120);
  assert.equal(a.got.length, 0, 'nothing left the computer');
  assert.equal(out.status().held, true);
  assert.equal(artnet.parseDmx(out.last(1)!)!.data[0], 9, 'the packet was still made');
  out.hold(false);
  out.send(new Map([[1, one]]));
  assert.ok(await until(() => a.got.length >= 1), 'sent again');
  out.close(); a.close();
});

test('on loopback: another controller’s ArtPoll is answered, and a node’s reply lists it', async () => {
  const other = await listener();                     // stands for everything else on the network
  const free = await listener(); const mine = free.port; free.close(); await sleep(20);
  const out = createLightOutput({ ports: { artnet: other.port }, listenPort: mine, bindAddress: '127.0.0.1', interfaces: () => ({}) });
  out.configure([{ id: 1, protocol: 'artnet', address: 3, host: '127.0.0.1' }], { on: true });
  assert.ok(await until(() => out.status().listing), 'listening');
  other.sock.send(artnet.artPoll(), mine, '127.0.0.1');
  assert.ok(await until(() => other.got.some((g) => artnet.kindOf(g.b) === 'pollReply')), 'answered the poll');
  const reply = other.got.find((g) => artnet.kindOf(g.b) === 'pollReply')!.b;
  assert.equal(reply.length, 239);
  assert.equal(reply[200], 0x01);
  assert.equal(reply[186], 0x03);
  // a node answers our poll
  const node = Buffer.alloc(239);
  Buffer.from('Art-Net\0').copy(node); node.writeUInt16LE(0x2100, 8); node.set([127, 0, 0, 1], 10); node.write('Dimmer rack', 26, 'latin1');
  node.writeUInt16BE(1, 172); node[174] = 0x80; node[190] = 0x03;
  other.sock.send(node, mine, '127.0.0.1');
  assert.ok(await until(() => out.status().nodes.length === 1), 'the node is listed');
  assert.deepEqual(out.status().nodes[0], { ip: '127.0.0.1', name: 'Dimmer rack', outputs: [3] });
  out.close(); other.close();
});
