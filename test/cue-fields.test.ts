// The TypeScript shape of a cue (core/show/cue-fields.ts) is written from the cue types table, never by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import { source, FILE } from '../build/cue-fields';

test('core/show/cue-fields.ts is what the cue types table makes (npm run cue-fields writes it again)', () => {
  assert.equal(fs.readFileSync(FILE, 'utf8'), source(), 'the table has changed since cue-fields.ts was written: npm run cue-fields');
});
