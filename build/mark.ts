#!/usr/bin/env node
/**
 * The mark: the one source of every logo and icon file in the repo.
 *
 *   node build/mark.js        writes the SVGs, then (through Electron, offscreen) the PNGs, the .icns and the .ico
 *   node build/mark.js --svg  writes the SVGs only (needs nothing but Node)
 *
 * What it draws: a shadow puppet from Endless Forms, the show the app was built to run. A figure holding an
 * antlered buck-skull mask over their face, as it looks in the show: a dark shadow on the lit shadow screen.
 * The figure is not drawn here. It is the laser-cut outline in build/mark/buck-source.svg (kept by hand, read
 * here, never written), cropped to the mask, the antlers and the two hands holding it. This file crops it, fills
 * it, and for the small sizes makes it heavier and opens the holes it already has. docs/brand.md says when to
 * use which file.
 *
 * The site's copies (site/… below) are written into the website, which lives in the service repository
 * (bin/site-dir.ts: ../endless_cues_service/site beside this repo, or EC_SITE_DIR). Without it they are skipped,
 * and it says so.
 */
import * as fs from 'fs';
import * as path from 'path';
const ROOT = path.join(__dirname, '..');
import { findSite } from '../bin/site-dir';
const SITE = findSite();
/** Where a file in the lists below is written: site/… into the website's folder, everything else in this repo. */
const out = (file: string): string | null => (file.startsWith('site/') ? (SITE ? path.join(SITE, file.slice(5)) : null) : path.join(ROOT, file));

// ── colours ──────────────────────────────────────────────────────────────
const INK = '#1a120c';                                  // the shadow
const SCREEN = ['#fff1d6', '#f0b86a', '#d9742f'];       // the lit screen: the lamp, the cloth, the edge. The icon's
                                                        // alone: never an interface colour (docs/brand.md)
const BONE = '#eadfce';                                 // the figure where there is no screen (dark grounds)
const GROUND = '#17120f';                               // the page of a show's document icon

// ── the figure (in the source's own millimetres: 92.46 wide, the mask and antlers its top 95) ──
const SUBPATHS = fs.readFileSync(path.join(__dirname, 'mark', 'buck-source.svg'), 'utf8').match(/ d="([^"]+)"/)![1]
  .split(/(?=M )/).map((s) => s.trim()).filter((s) => s.length > 40);   // (the filter drops a stray single point)
const [OUTLINE, EYE_R, EYE_L, CHEEK_R, CHEEK_L, ARM_R, ARM_L, NOSE] = SUBPATHS;
if (SUBPATHS.length !== 8) throw new Error('build/mark/buck-source.svg: expected the silhouette and seven holes');

const round = (n: number) => String(Math.round(n * 100) / 100);
/** A hole made larger about its own middle (the small drawings: enlarging a hole the figure has, never a new one). */
function grow(sub: string, k: number) {
  if (k === 1) return sub;
  const n = sub.match(/-?\d+\.?\d*/g)!.map(Number);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n.length; i += 2) { x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]); y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return sub.replace(/(-?\d+\.?\d*) (-?\d+\.?\d*)/g, (m, x: string, y: string) => `${round(cx + (Number(x) - cx) * k)} ${round(cy + (Number(y) - cy) * k)}`);
}

/**
 * Three drawings of the one figure, chosen by eye at true size (docs/brand.md says what can be made out at each).
 * `box` is the square of the source a tile shows [x, y, side]: the antlers are the widest thing in it, so it can
 * never be much tighter than their span (a crop that lets them leave the tile reads as a bar, not antlers).
 * `eyes`, `cheeks` and `nose` enlarge those holes (0 leaves the cheek holes out: they are specks when small).
 * `bold` is a line of the figure's own colour round the silhouette above `boldTo` (the antlers and the crown;
 * never round the holes, which it would close): what keeps the antlers from turning to fuzz. `cut` is where the
 * figure ends when it stands with no tile to run off.
 *   plain  128 px and up: the approved sketch, untouched. Mask, antlers, both hands, shoulders; the body runs off.
 *   small  20 to 64 px: antlers 3 units heavier, the eyes twice their size, the nose half again.
 *   tiny   16 px: heavier again. The eyes are opened too, but do not survive.
 */
/** One of the three drawings: which square of the source a tile shows, how much each hole is enlarged, how heavy the antlers. */
interface Form { box: number[]; eyes: number; cheeks: number; nose: number; bold: number; boldTo?: number; cut: number }
type FormName = 'plain' | 'small' | 'tiny';
const FORMS: Record<FormName, Form> = {
  plain: { box: [-6, -9, 104], eyes: 1, cheeks: 1, nose: 1, bold: 0, cut: 96 },
  small: { box: [-4, -7, 100], eyes: 2, cheeks: 0, nose: 1.5, bold: 3, boldTo: 30, cut: 90 },
  tiny: { box: [-5, -6, 102], eyes: 2.6, cheeks: 0, nose: 1.8, bold: 5.5, boldTo: 31, cut: 84 },
};
const formOf = (form: FormName | Form) => (typeof form === 'string' ? FORMS[form] : form);

/** The figure's elements, in the source's units. */
function figure(form: FormName | Form, colour: string) {
  const f = formOf(form);
  const holes = [grow(EYE_R, f.eyes), grow(EYE_L, f.eyes), ...(f.cheeks ? [grow(CHEEK_R, f.cheeks), grow(CHEEK_L, f.cheeks)] : []), ARM_R, ARM_L, grow(NOSE, f.nose)];
  const fill = `<path fill="${colour}" fill-rule="evenodd" d="${[OUTLINE, ...holes].join(' ')}"/>`;
  if (!f.bold) return fill;
  // the heavier line, on the antlers and the crown only (above `boldTo`): lower down it would close the gaps
  // between the hands and the skull
  return `<clipPath id="a"><rect x="-20" y="-20" width="140" height="${f.boldTo! + 20}"/></clipPath>`
    + `<path clip-path="url(#a)" d="${OUTLINE}Z" fill="none" stroke="${colour}" stroke-width="${f.bold}" stroke-linejoin="round"/>` + fill;
}
/** The figure placed so that its form's box fills the square at (x, y) of side `side`. */
function placed(form: FormName | Form, colour: string, x: number, y: number, side: number) {
  const [bx, by, bs] = formOf(form).box, k = side / bs;
  return `<g transform="translate(${round(x - bx * k)} ${round(y - by * k)}) scale(${Number(round(k * 1000)) / 1000})">${figure(form, colour)}</g>`;
}

const svg = (box: string, body: string, title?: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${title ? `<title>${title}</title>` : ''}${body}</svg>\n`;

/**
 * The lit screen filling the square at (x, y) of side `side`: the lamp a little above the middle, the cloth, the
 * darker edge. With `cloth`, a faint weave and a vignette as well (drawn for 128 px and up only: smaller, they
 * are noise). Returns { defs, fill }: `fill` is a rect to be clipped to the tile's shape.
 */
function screen(id: string, x: number, y: number, side: number, cloth: boolean) {
  const cx = round(x + side * 0.5), cy = round(y + side * 0.42);
  let defs = `<radialGradient id="${id}g" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${round(side * 0.766)}">`
    + `<stop offset="0" stop-color="${SCREEN[0]}"/><stop offset=".68" stop-color="${SCREEN[1]}"/><stop offset="1" stop-color="${SCREEN[2]}"/></radialGradient>`;
  const rect = (more: string) => `<rect x="${x}" y="${y}" width="${side}" height="${side}" ${more}/>`;
  let fill = rect(`fill="url(#${id}g)"`);
  if (cloth) {
    const f = 1024 / side;   // (the weave is sized for a 1024 canvas)
    const thread = (n: string, fx: number, fy: number, seed: number) => `<filter id="${id}${n}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">`
      + `<feTurbulence type="fractalNoise" baseFrequency="${Number(round(fx * f * 1000)) / 1000} ${Number(round(fy * f * 1000)) / 1000}" numOctaves="2" seed="${seed}"/>`
      + `<feColorMatrix values="0 0 0 0 .42  0 0 0 0 .2  0 0 0 0 .05  0 0 0 ${CLOTH.weave} ${-CLOTH.weave * 0.42}"/></filter>`;
    defs += thread('w', 0.02, 0.5, 4) + thread('v', 0.5, 0.02, 9)
      + `<radialGradient id="${id}e" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${round(side * 0.766)}">`
      + `<stop offset=".55" stop-color="#5a2206" stop-opacity="0"/><stop offset="1" stop-color="#5a2206" stop-opacity="${CLOTH.vignette}"/></radialGradient>`;
    fill += rect(`filter="url(#${id}w)"`) + rect(`filter="url(#${id}v)"`) + rect(`fill="url(#${id}e)"`);
  }
  return { defs, fill };
}
const CLOTH = { weave: 0.2, vignette: 0.3 };

/** A superellipse (the rounded square of a macOS icon), as a path. */
function squircle(c: number, r: number, n = 5) {
  let d = '';
  for (let i = 0; i < 96; i++) {
    const t = Math.PI * 2 * i / 96, x = Math.cos(t), y = Math.sin(t);
    d += `${i ? 'L' : 'M'}${round(c + r * Math.sign(x) * Math.abs(x) ** (2 / n))} ${round(c + r * Math.sign(y) * Math.abs(y) ** (2 / n))}`;
  }
  return d + 'Z';
}
/** The app icon in a 1024 canvas: the screen as an 824 rounded square on a transparent ground, as macOS icons sit,
 *  the shadow on it. */
function appIcon(form: FormName, cloth = form === 'plain') {
  const s = screen('s', 100, 100, 824, cloth);
  return svg('0 0 1024 1024', `<defs>${s.defs}<clipPath id="t"><path d="${squircle(512, 412)}"/></clipPath></defs>`
    + `<g clip-path="url(#t)">${s.fill}${placed(form, INK, 100, 100, 824)}</g>`
    + `<path d="${squircle(512, 410.5)}" fill="none" stroke="#5a2206" stroke-opacity=".28" stroke-width="3"/>`, 'Endless Cues');
}
/** The screen with the shadow on it, the screen filling the square: `radius` 0 where the platform rounds it itself. */
function tile(form: FormName, radius: number) {
  const s = screen('s', 0, 0, 120, false);
  return svg('0 0 120 120', `<defs>${s.defs}<clipPath id="t"><rect width="120" height="120" rx="${radius}"/></clipPath></defs>`
    + `<g clip-path="url(#t)">${s.fill}${placed(form, INK, 0, 0, 120)}</g>`, 'Endless Cues');
}
/** The badge's parts: the screen as a disc of radius `r` about (cx, cy), the shadow on it. A disc cuts the corners
 *  where the antlers' tips are, so the figure sits smaller in it than in a tile (`fit`: the part of the disc's
 *  width the form's box takes) and a little low. */
function badgeParts(form: FormName, cx: number, cy: number, r: number, id = 'b') {
  const { fit, drop } = BADGE[form], side = r * 2 * fit, s = screen(id, cx - r, cy - r, r * 2, false);
  return { defs: `${s.defs}<clipPath id="${id}c"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>`,
    body: `<g clip-path="url(#${id}c)">${s.fill}${placed(form, INK, cx - side / 2, cy - side / 2 + r * 2 * drop, side)}</g>` };
}
const BADGE: Record<FormName, { fit: number; drop: number }> = { plain: { fit: 0.86, drop: 0.09 }, small: { fit: 0.84, drop: 0.1 }, tiny: { fit: 0.84, drop: 0.1 } };
function badge(form: FormName) {
  const b = badgeParts(form, 60, 60, 60);
  return svg('0 0 120 120', `<defs>${b.defs}</defs>${b.body}`, 'Endless Cues');
}
/** The figure alone, in one colour, on nothing: cut level where the form says, with `pad` units of air round it. */
function alone(form: FormName, colour: string, pad = 3) {
  const f = formOf(form), w = 92.46, b = f.bold / 2;
  return svg(`${round(-pad - b)} ${round(-pad - b)} ${round(w + (pad + b) * 2)} ${round(f.cut + pad * 2 + b)}`,
    `<defs><clipPath id="c"><rect x="-20" y="-20" width="140" height="${f.cut + 20}"/></clipPath></defs><g clip-path="url(#c)">${figure(form, colour)}</g>`, 'Endless Cues');
}
/** A show's document icon: a page of the ground with its corner turned down, the badge on it. In a 1024 canvas, the
 *  page 640 by 896 as macOS document icons sit. */
function documentIcon(form: FormName) {
  const L = 192, R = 832, T = 64, B = 960, r = 52, f = 190;
  const page = `M${L + r} ${T}H${R - f}L${R} ${T + f}V${B - r}Q${R} ${B} ${R - r} ${B}H${L + r}Q${L} ${B} ${L} ${B - r}V${T + r}Q${L} ${T} ${L + r} ${T}Z`;
  const b = badgeParts(form, 512, 590, { plain: 230, small: 250, tiny: 270 }[form]);
  return svg('0 0 1024 1024', `<defs>${b.defs}</defs><path d="${page}" fill="${GROUND}"/>`
    + `<path d="${page}" fill="none" stroke="${BONE}" stroke-opacity=".28" stroke-width="${form === 'plain' ? 6 : 14}"/>`
    + `<path d="M${R - f} ${T}V${T + f - 36}Q${R - f} ${T + f} ${R - f + 36} ${T + f}H${R}Z" fill="${BONE}" fill-opacity=".3"/>`
    + b.body, 'An Endless Cues show');
}

const FILES = {
  // the masters (build/mark/buck-source.svg, the figure itself, is beside them and is not written here)
  'build/mark/mark.svg': alone('plain', BONE),
  'build/mark/mark-small.svg': alone('small', BONE),
  'build/mark/mark-light.svg': alone('plain', INK),
  'build/mark/mark-light-small.svg': alone('small', INK),
  'build/mark/mark-mono.svg': alone('plain', '#000'),
  'build/mark/mark-mono-small.svg': alone('small', '#000'),
  'build/mark/badge.svg': badge('plain'),
  'build/mark/badge-small.svg': badge('small'),
  'build/mark/icon.svg': appIcon('plain'),
  'build/mark/icon-small.svg': appIcon('small'),
  'build/mark/icon-tiny.svg': appIcon('tiny'),
  'build/mark/document.svg': documentIcon('plain'),
  'build/mark/document-small.svg': documentIcon('small'),
  'build/mark/document-tiny.svg': documentIcon('tiny'),
  'build/mark/tile.svg': tile('plain', 0),
  'build/mark/tile-small.svg': tile('small', 26),
  'build/mark/tile-tiny.svg': tile('tiny', 26),
  // inside the app: the start screen and Settings ▸ About
  'app/renderer/images/mark.svg': alone('plain', BONE),
  // the site's copies
  'site/images/mark.svg': alone('plain', BONE),
  'site/images/mark-small.svg': alone('small', BONE),
  'site/images/mark-mono.svg': alone('small', '#000'),
  'site/images/favicon.svg': tile('small', 26),
};

/** The PNGs: [file, the SVG it is a picture of, its size in pixels]. */
const PNGS: [string, string, number][] = [
  ['build/icon.png', 'build/mark/icon.svg', 1024],
  ['site/images/favicon-32.png', 'build/mark/tile-small.svg', 32],
  ['site/images/favicon-192.png', 'build/mark/tile.svg', 192],
  ['site/images/apple-touch-icon.png', 'build/mark/tile.svg', 180],    // iOS rounds it itself
];
/** The .icns: the tiny drawing at 16 px, the small one at 32 and 64, the plain one from there up. */
const ICNS: [number, FormName][] = [[16, 'tiny'], [32, 'small'], [64, 'small'], [128, 'plain'], [256, 'plain'], [512, 'plain'], [1024, 'plain']];

export { figure, placed, screen, appIcon, tile, badge, alone, documentIcon, FORMS, CLOTH, BADGE, FILES, INK, SCREEN, BONE, GROUND };

function writeSvgs() {
  let n = 0;
  for (const [file, text] of Object.entries(FILES)) {
    const to = out(file);
    if (!to) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, text);
    n++;
  }
  console.log(`wrote ${n} SVG files${SITE ? ` (the site's into ${SITE})` : '; the site is not beside this repo, so its copies were not written (bin/site-dir.js)'}`);
}

if (require.main === module && !process.versions.electron) {
  writeSvgs();
  if (!process.argv.includes('--svg')) {
    const r = require('child_process').spawnSync(require('electron'), [__filename], { stdio: 'inherit' });
    process.exit(r.status || 0);
  }
} else if (process.versions.electron) {
  // ── the pictures: each SVG drawn on a canvas in a window nobody sees ──
  const { app, BrowserWindow } = require('electron');
  if (app.setActivationPolicy) app.setActivationPolicy('accessory');
  app.whenReady().then(async () => {
    const w = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true } });
    await w.loadURL('about:blank');
    const png = async (svgFile: string, size: number) => {
      const uri = 'data:image/svg+xml;base64,' + fs.readFileSync(path.join(ROOT, svgFile)).toString('base64');
      const data = await w.webContents.executeJavaScript(`new Promise((ok, no) => { const i = new Image(); i.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = ${size}; const g = c.getContext('2d');
        g.imageSmoothingQuality = 'high'; g.drawImage(i, 0, 0, ${size}, ${size}); ok(c.toDataURL('image/png')); }; i.onerror = () => no(new Error('svg')); i.src = ${JSON.stringify(uri)}; })`);
      return Buffer.from(data.split(',')[1], 'base64');
    };
    const pngs = PNGS.filter(([file]) => out(file));
    for (const [file, from, size] of pngs) fs.writeFileSync(out(file)!, await png(from, size));
    console.log(`wrote ${pngs.length} PNG files`);

    // the icon files, and site/favicon.ico (16, 32, 48)
    const os = require('os'), { spawnSync } = require('child_process');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-mark-'));
    // build/icon.icns and build/document.icns (16 and 32 px are the tiny and small drawings)
    for (const name of ['icon', 'document']) {
      const sized: Record<number, string> = {};
      for (const [size, form] of ICNS) { sized[size] = path.join(tmp, `${name}-${size}.png`); fs.writeFileSync(sized[size], await png(`build/mark/${name}${form === 'plain' ? '' : '-' + form}.svg`, size)); }
      if (process.platform === 'darwin') {
        const set = path.join(tmp, `${name}.iconset`); fs.mkdirSync(set);
        for (const n of [16, 32, 128, 256, 512]) { fs.copyFileSync(sized[n], path.join(set, `icon_${n}x${n}.png`)); fs.copyFileSync(sized[n === 16 ? 32 : n === 32 ? 64 : n * 2], path.join(set, `icon_${n}x${n}@2x.png`)); }
        const r = spawnSync('iconutil', ['-c', 'icns', '-o', path.join(ROOT, `build/${name}.icns`), set], { stdio: 'inherit' });
        console.log(r.status === 0 ? `wrote build/${name}.icns` : `iconutil failed: build/${name}.icns not written`);
      } else console.log(`build/${name}.icns is made on a Mac only (iconutil): not written`);
      // (Windows shows a document's icon from an .ico beside it: electron-builder swaps the extension)
      if (name === 'document') {
        const d = spawnSync('magick', [sized[16], sized[32], sized[64], sized[256], path.join(ROOT, 'build/document.ico')], { stdio: 'inherit' });
        console.log(d.status === 0 ? 'wrote build/document.ico' : 'ImageMagick (magick) not found: build/document.ico not written');
      }
    }
    const ico = [16, 32, 48].map((n) => path.join(tmp, `f${n}.png`));
    for (const [i, n] of [16, 32, 48].entries()) fs.writeFileSync(ico[i], await png(`build/mark/tile-${n === 16 ? 'tiny' : 'small'}.svg`, n));
    if (out('site/favicon.ico')) {
      const m = spawnSync('magick', [...ico, out('site/favicon.ico')], { stdio: 'inherit' });
      console.log(m.status === 0 ? 'wrote the site\'s favicon.ico' : 'ImageMagick (magick) not found: the site\'s favicon.ico not written');
    }
    fs.rmSync(tmp, { recursive: true, force: true });
    app.exit(0);
  });
}
