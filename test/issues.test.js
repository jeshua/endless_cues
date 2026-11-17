/**
 * Something went wrong (core/report/issues.js): which log lines the status bar offers to report, that a repeat is
 * counted and not announced again, and that a report opened from it carries the line (core/report/report.js).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { isIssue, createIssues } = require('../core/report/issues');
const { makeContext } = require('../core/report/report');

test('an error, a sound that could not play, an output gone or a window that died is an issue; the day-to-day log is not', () => {
  for (const line of [
    '10:01:02.003 [audio] could not decode rain.wav: bad header',
    '10:01:02.003 [audio] the audio window died (crashed); making a new one',
    '10:01:02.003 [audio] Scarlett 2i2 is gone: on the system default output until it returns',
    '10:01:02.003 [midi] DROPPED note 60: no port',
    '10:01:02.003 [main] uncaught: TypeError: x is undefined',
    '10:01:02.003 [page] ReferenceError: y is not defined',
  ]) assert.equal(isIssue(line), true, line);
  for (const line of [
    '10:01:02.003 [cues] GO 1 Preshow',
    '10:01:02.003 [cues] STOP ALL (fade 1 s)',
    '10:01:02.003 [show] opened /tmp/x.ecshow',
    '10:01:02.003 [agent] claude: edit_show (refused)',
    '10:01:02.003 [report] no picture: capture failed',
    '',
  ]) assert.equal(isIssue(line), false, line);
});

test('an issue is announced once; the same again soon is counted, not announced; dismissing puts it away', () => {
  let t = 1000;
  const iss = createIssues({ now: () => t, quiet: 30000 });
  assert.equal(iss.latest(), null);
  assert.equal(iss.seen('10:00:00.000 [cues] GO 1'), false);
  assert.equal(iss.seen('10:00:00.000 [audio] could not decode a.wav: bad'), true);
  assert.deepEqual(iss.latest(), { line: '[audio] could not decode a.wav: bad', at: 1000, count: 1 });
  t += 5000;
  assert.equal(iss.seen('10:00:05.000 [audio] could not decode a.wav: bad'), false, 'a repeat within the quiet time');
  assert.equal(iss.latest().count, 2);
  assert.equal(iss.seen('10:00:05.000 [midi] DROPPED note 60: no port'), true, 'a different one is news');
  iss.dismiss();
  assert.equal(iss.latest(), null);
  t += 40000;
  assert.equal(iss.seen('10:00:45.000 [audio] could not decode a.wav: bad'), true, 'after the quiet time it is news again');
});

test('a report opened from the status bar carries the issue, scrubbed and cut, beside the recent error lines', () => {
  const scrub = (s) => s.replace('/Users/someone', '~');
  const ctx = makeContext({ issue: '[audio] could not decode /Users/someone/a.wav: ' + 'x'.repeat(900), log: ['10:00 [audio] could not decode /Users/someone/a.wav'] }, scrub);
  assert.ok(ctx.issue.startsWith('[audio] could not decode ~/a.wav'));
  assert.ok(ctx.issue.length <= 500);
  assert.equal(ctx.errors.length, 1);
  assert.equal(makeContext({ log: [] }).issue, undefined);
});
