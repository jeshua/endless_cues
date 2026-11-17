// A provider that was chosen and cannot be made always says why, in one short line: the drawer shows it in place of
// sitting unchanged (the owner chose Claude Code in a test window and nothing happened).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssistant, providerFor, missingFor, CLI, COMPATIBLE } from '../core/assistant/assistant';

test('a chosen provider is either made or says why not, for every provider there is', () => {
  for (const provider of ['cloud', 'anthropic', 'demo', ...Object.keys(CLI), ...Object.keys(COMPATIBLE)]) {
    const config = { provider };
    const made = providerFor(config, {}), why = missingFor(config, {});
    assert.ok(made || why, `${provider}: neither made nor a reason`);
    if (!made) assert.ok(why.length < 80 && !/[()]/.test(why), `${provider}: “${why}” is one short line`);
  }
});

test('an agent with no door to the app says so, and status carries what was chosen beside what answers', () => {
  // (whether the program is installed is this computer's business: either reason is a reason)
  const why = missingFor({ provider: 'claude-code', noDoor: 'in a test window' }, process.env);
  assert.match(why, /^Claude Code (can’t be used in a test window|wasn’t found on this computer)\.$/);
  const a = createAssistant({ config: { provider: 'off' } });
  a.configure({ provider: 'claude-code', noDoor: 'in a test window' });
  const st = a.status();
  assert.deepEqual([st.available, st.provider, st.chosen], [false, 'off', 'claude-code']);
  assert.equal(st.missing, why);
  a.configure({ provider: 'demo' });
  assert.deepEqual([a.status().available, a.status().chosen, a.status().missing], [true, 'demo', '']);
});
