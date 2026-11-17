/**
 * Writes core/show/cue-fields.ts, the TypeScript shape of a cue, from the one table of cue types
 * (core/show/cue-types.ts: TYPES and COMMON), so the table stays the only place a field is added:
 *
 *   npm run cue-fields        after adding or changing a field in the table (test/cue-fields.test.ts says when)
 *
 * A field's `kind` says its type (KINDS below); an enum is the union of its options. A key that two cue types use
 * with different kinds has either type.
 */
import * as fs from 'fs';
import * as path from 'path';
import { TYPES, COMMON, COLORS } from '../core/show/cue-types';

type Field = { key: string; kind: string; label?: string; help?: string; options?: readonly unknown[] };

/** The type of a value of each kind of field (the complex ones are named in core/show/types.ts). */
const KINDS: Record<string, string> = {
  text: 'string', longtext: 'string', file: 'string', patch: 'string', bus: 'string', cue: 'string', input: 'string',
  camera: 'string', device: 'string', command: 'string', cell: 'string', color: 'string',
  number: 'number', seconds: 'number', db: 'number', bool: 'boolean', numbers: 'number[]',
  args: 'DeviceArgs', levels: 'BusLevels', markers: 'Marker[]', regions: 'Region[]', tempo: 'Tempo', matrix: 'Matrix',
  eq: 'Eq', chain: 'Chain', sweep: 'Sweep', shape: 'Shape', envelope: 'Envelope', automation: 'Automation', desk: 'Desk',
};

function typeOf(f: Field): string {
  if (f.kind === 'enum') return f.options === COLORS || !f.options ? 'string' : f.options.map((o) => JSON.stringify(o)).join(' | ');
  const t = KINDS[f.kind];
  if (!t) throw new Error(`cue-fields: no type for a field of kind “${f.kind}” (${f.key}): add one to KINDS`);
  return t;
}

/** The text of core/show/cue-fields.ts as the table now makes it. */
export function source(): string {
  const byKey = new Map<string, { types: Set<string>; label?: string; help?: string; of: string[] }>();
  const add = (f: Field, of: string) => {
    const at = byKey.get(f.key) || { types: new Set<string>(), label: f.label, help: f.help, of: [] };
    for (const t of typeOf(f).split(' | ')) at.types.add(t);
    if (!at.of.includes(of)) at.of.push(of);
    byKey.set(f.key, at);
  };
  for (const f of COMMON as Field[]) add(f, 'every cue');
  for (const [type, d] of Object.entries(TYPES)) for (const f of (d.fields || []) as Field[]) add(f, type);
  const used = new Set([...byKey.values()].flatMap((x) => [...x.types]).flatMap((t) => t.match(/^[A-Z]\w+/g) || []));
  const lines = [
    '// Written by build/cue-fields.ts from the cue types table (core/show/cue-types.ts): never edited by hand.',
    '// `npm run cue-fields` writes it again; test/cue-fields.test.ts fails while it is behind the table.',
    `import type { ${[...used].sort().join(', ')} } from './types';`,
    '',
    '/** The cue types, in the table\'s order. */',
    `export type CueType = ${Object.keys(TYPES).map((t) => JSON.stringify(t)).join(' | ')};`,
    '',
    '/** Every field the table gives a cue (each type has some of them: TYPES[type].fields, and COMMON on every cue). */',
    'export interface CueFields {',
  ];
  for (const [key, x] of byKey) {
    const words = [x.label, x.help].filter(Boolean).join(': ').replace(/\*\//g, '* /');
    lines.push(`  /** ${words}${words ? ' ' : ''}(${x.of.length > 4 ? `${x.of.length} types` : x.of.join(', ')}) */`);
    lines.push(`  ${/^[a-zA-Z_]\w*$/.test(key) ? key : JSON.stringify(key)}?: ${[...x.types].join(' | ')};`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

export const FILE = path.join(__dirname, '../core/show/cue-fields.ts');

if (require.main === module) {
  fs.writeFileSync(FILE, source());
  console.log(`wrote ${path.relative(process.cwd(), FILE)}`);
}
