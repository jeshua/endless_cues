/**
 * What a question carries about the show, given what the conversation has already been told.
 *
 * The conversation sent to a model is append-only: a message, once sent, is never changed. Two reasons. Every
 * provider caches a request by its prefix, so a changed earlier message makes the whole conversation after it full
 * price again, on every call of every turn. And on Anthropic's current models a thinking block is tied to exactly
 * what came before it: a request whose earlier messages were edited can be refused with a 400 ("bound to a
 * different conversation"; enforced for accounts made from 31 August 2026), which would break every follow-up
 * question for anyone with a new key.
 *
 * So the show's outline is sent in full once, and after that each question carries only what changed since the
 * outline the model last had: nothing but a line when nothing did, a short diff of the outline's lines when a
 * little did, and the whole outline again when so much changed that a diff would not be shorter (or when the
 * diffs since the last whole outline add up to most of one, so the model never has to add up a long chain).
 *
 *   note(last, now) → { text, state }
 *     last  what the conversation has been told so far (the `state` a previous note returned), or null
 *     now   the outline as it is at this moment
 *     text  what goes in the question's message
 *     state what to pass as `last` next time (kept only if the message is kept: a failed turn forgets it)
 */

/** A diff larger than this share of the whole outline is not worth it: the outline is sent instead. */
const DIFF_SHARE = 0.4;
/** Nor once the diffs since the last whole outline add up to more than this share of one. */
const CHAIN_SHARE = 0.6;
/** Past this many cells, the middle of a diff is not searched for lines in common: it is all changed. */
const MAX_CELLS = 4e6;

const whole = (now) => `<show_outline>\n${now}\n</show_outline>`;

/**
 * The lines of `b` against `a`, as unified-diff hunks (with as little context as places them), or '' when they are
 * the same. The common start and end are taken off first (an edit is nearly always in one place), and what is left
 * is matched line by line (longest common subsequence).
 */
function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a1 = A.slice(s, A.length - e), b1 = B.slice(s, B.length - e);
  if (!a1.length && !b1.length) return '';
  // ops over the middle: ' ' kept, '-' gone, '+' new
  let ops = [];
  if (!a1.length || !b1.length || a1.length * b1.length > MAX_CELLS) {
    ops = [...a1.map((l) => ['-', l]), ...b1.map((l) => ['+', l])];
  } else {
    const n = a1.length, m = b1.length;
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a1[i] === b1[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a1[i] === b1[j]) { ops.push([' ', a1[i]]); i++; j++; } else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { ops.push(['-', a1[i]]); i++; } else { ops.push(['+', b1[j]]); j++; }
    }
  }
  // with the line before the middle, so a change at its start can say where it is
  const all = [...(s ? [[' ', A[s - 1]]] : []), ...ops];
  // hunks: changes no more than two kept lines apart are one hunk. A hunk that starts by taking a line away is found
  // by that line (each outline line names its cue, so it is unique); one that starts with a new line, or whose first
  // line is not unique, has the kept line before it to say where it goes. Nothing after: a diff is what a request
  // carries, so it says no more than it must.
  const count = new Map(); for (const l of A) count.set(l, (count.get(l) || 0) + 1);
  const changed = all.map((x, i) => (x[0] === ' ' ? -1 : i)).filter((i) => i >= 0);
  const groups = [];
  for (const i of changed) { const g = groups.at(-1); if (g && i - g[1] <= 3) g[1] = i; else groups.push([i, i]); }
  const out = [];
  for (const [first, last] of groups) {
    const before = first > 0 && (all[first][0] === '+' || count.get(all[first][1]) > 1);
    out.push('@@', ...all.slice(before ? first - 1 : first, last + 1).map(([o, l]) => `${o}${l}`));
  }
  return out.join('\n');
}

function note(last, now) {
  now = String(now);
  if (!last) return { text: whole(now), state: { outline: now, chain: 0 } };
  if (last.outline === now) return { text: '<show_unchanged>The show is as last sent.</show_unchanged>', state: last };
  const diff = diffLines(last.outline, now);
  const chain = last.chain + diff.length;
  if (diff.length > now.length * DIFF_SHARE || chain > now.length * CHAIN_SHARE) return { text: whole(now), state: { outline: now, chain: 0 } };
  return {
    text: `<show_changes>The outline as last sent, with this diff ("-" gone, "+" new, " " context):\n${diff}\n</show_changes>`,
    state: { outline: now, chain },
  };
}

/** Applies diffLines' output to `a`: what the model is expected to do in its head. For the tests. */
function applyDiff(a, diff) {
  if (!diff) return a;
  const A = a.split('\n'), out = [];
  let at = 0;
  const hunks = diff.split(/^@@$/m).map((h) => h.split('\n').filter((l) => l !== '')).filter((h) => h.length);
  for (const h of hunks) {
    const old = h.filter((l) => l[0] !== '+').map((l) => l.slice(1));
    // the hunk's old lines, found from where the last one ended
    let p = at; while (p <= A.length - old.length && old.some((l, i) => A[p + i] !== l)) p++;
    if (p > A.length - old.length) throw new Error('hunk does not apply');
    out.push(...A.slice(at, p));
    for (const l of h) if (l[0] !== '-') out.push(l.slice(1));
    at = p + old.length;
  }
  out.push(...A.slice(at));
  return out.join('\n');
}

module.exports = { note, diffLines, applyDiff, DIFF_SHARE, CHAIN_SHARE };
