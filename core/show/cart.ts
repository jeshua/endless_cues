/**
 * A cue cart: a list drawn as a grid of buttons instead of a table.
 *
 * A cart is a list like any other in the show file, with `cart: { rows, columns }`
 * on it; each of its cues may say which button it is with `cell` ("row,column",
 * counted from 1). Nothing else about the cues differs: a button starts its cue as
 * a hotkey or a remote would, and the playhead of the list the operator is running
 * stays where it is.
 *
 * `layout` is the one place that decides which cue is on which button, so the
 * window, the web remote and an import all agree. A cue whose cell is missing,
 * outside the grid or already taken is not lost: it takes the first free button
 * in reading order, and when the grid is full it is reported in `extra`.
 */
import type { Cue } from './types';

/** The size of a cart's grid. */
export interface CartSize { rows: number; columns: number }
/** What `layout` needs of a list: its cart (if it is one) and its cues. */
type CartList = { cart?: unknown; cues?: Pick<Cue, 'id' | 'type' | 'cell'>[] } | null | undefined;

const MAX = 15;                  // QLab's largest cart is 15 × 15
const DEFAULT = { rows: 4, columns: 4 };

const whole = (v: unknown) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };

/** A cell as [row, column] (from "2,3", "2 3", [2, 3] or { row, column }), or null when it is not one. */
function parseCell(v: unknown): [number, number] | null {
  let pair: unknown[] | null = null;
  if (Array.isArray(v)) pair = v;
  else if (v && typeof v === 'object') pair = [(v as { row?: unknown }).row, (v as { column?: unknown }).column];
  else if (typeof v === 'string') { const m = /^\s*\{?\s*(\d+)\s*[,\sx×]\s*(\d+)\s*\}?\s*$/.exec(v); pair = m ? [m[1], m[2]] : null; }
  if (!pair || pair.length !== 2) return null;
  const row = whole(pair[0]), column = whole(pair[1]);
  return row >= 1 && column >= 1 && row <= MAX && column <= MAX ? [row, column] : null;
}
const cellText = (row: number, column: number) => `${row},${column}`;

/** A list's `cart` as the file keeps it: { rows, columns }, each 1–15. null: not a cart. */
function cleanCart(v: any): CartSize | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const size = (n: unknown, dflt: number) => (Number.isFinite(Number(n)) && Number(n) >= 1 ? Math.min(MAX, Math.round(Number(n))) : dflt);
  return { rows: size(v.rows, DEFAULT.rows), columns: size(v.columns, DEFAULT.columns) };
}

/** Which cue is on which button: { rows, columns, cells: [cue id | null] in reading order, extra: [cue ids with no button] }. */
function layout(list: CartList) {
  const cart = cleanCart(list && list.cart) || DEFAULT;
  const cells: (string | null)[] = new Array(cart.rows * cart.columns).fill(null);
  const at = (row: number, column: number) => (row - 1) * cart.columns + (column - 1);
  const loose: string[] = [];
  for (const c of (list && list.cues) || []) {
    if (c.type === 'section') continue;          // (a heading has no button)
    const p = parseCell(c.cell);
    if (p && p[0] <= cart.rows && p[1] <= cart.columns && cells[at(p[0], p[1])] === null) cells[at(p[0], p[1])] = c.id;
    else loose.push(c.id);
  }
  const extra: string[] = [];
  for (const id of loose) { const free = cells.indexOf(null); if (free < 0) extra.push(id); else cells[free] = id; }
  return { rows: cart.rows, columns: cart.columns, cells, extra };
}

/** The first button with nothing on it, as a cell ("2,3"), or null when the cart is full. */
function freeCell(list: CartList) {
  const l = layout(list), i = l.cells.indexOf(null);
  return i < 0 ? null : cellText(Math.floor(i / l.columns) + 1, (i % l.columns) + 1);
}

export { MAX, DEFAULT, parseCell, cellText, cleanCart, layout, freeCell };
