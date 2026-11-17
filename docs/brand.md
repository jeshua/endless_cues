# The brand

## The mark

A shadow puppet. A figure holding an antlered buck-skull mask over their face with both hands, shown the way it
looks on stage: a dark shadow on the lit shadow screen. It is a theatre mask, but stranger.

It comes from *Endless Forms*, the puppet show by Monica Lerch and Jeshua Bratman that the app was built to run.
The figure is not a drawing made for a logo: it is the outline the laser cut the puppet from
(`build/mark/buck-source.svg`, figure r1-01-2, in millimetres), used as this app's mark by the owner's choice. The
mark shows its top: the mask, the antlers, the two hands and the shoulders. The body runs off the bottom. The
puppet was designed by Esme Roszel.

The app's textures (the tabletops and the algae) are by Callie Nicole Richards.

The name beside it is "Endless Cues" in Bricolage Grotesque, weight 700, in bone.

## Colours

| | Hex | Used for |
|---|---|---|
| Ink | `#1a120c` | the shadow; the figure on paper and light pages |
| Screen, the lamp | `#fff1d6` | the middle of the lit screen (a little above centre) |
| Screen, the cloth | `#f0b86a` | most of the screen (68% of the way out) |
| Screen, the edge | `#d9742f` | the screen's corners |
| Bone | `#eadfce` | the figure where there is no screen: dark grounds |
| Ground | `#17120f` | the page of a show's document icon |

The screen is a radial gradient through its three stops, centred at 50% across and 42% down. At 128 px and up
the app icon adds a faint weave and a vignette, so it reads as cloth lit from behind.

**The screen's gold belongs to the icon.** It is used in the app icon, the document icon, the favicons, the badge
and the link card, and nowhere else. It is never an interface colour: on an operator surface colour carries
meaning, and the cloth's `#f0b86a` is close to `--standby` (`#ecd25e`, standing by, unsaved). So inside the app,
and in the site's header and footer, the mark is the bone figure with no screen. Do not add a token for the gold,
tint a button with it, or put the badge in a toolbar.

Copper (`#d39a6a`, `--accent` in `app/renderer/styles.css` and `site/styles.css`) is not a colour of the mark any
more. It stays the app's "selected" and the site's accent. The name beside the mark is one colour, the text's
(bone in the Lab theme): never `--go` green, which on an operator surface means running.

## Three drawings of one figure

Nothing is redrawn. The small drawings make the antlers heavier (a line of the figure's own colour round the
silhouette, above the brow only) and enlarge holes the figure already has:

- **plain**: 128 px and up. The cut figure untouched.
- **small**: 20 to 64 px. Antlers heavier, the eye sockets twice their size, the nose half again, the two cheek
  holes left out.
- **tiny**: 16 px. Heavier again.

What a person can make out (looked at, at true size, Nov 2026):

- **128 px and up**: all of it. A skull mask with eye sockets and a nose, antlers, two hands holding it, shoulders.
- **64 px**: an antlered skull held up by two arms; the eyes are two small points of light.
- **32 px**: an antlered figure with its arms raised. That it is a mask being held is a guess. The eyes are a
  flicker, not eyes.
- **16 px**: a dark figure under a pair of antlers on a gold square. No face. It is recognisable as this icon by
  its colour and its antlers, not readable as a mask.

The antlers are the widest thing in the figure, so the crop cannot be much tighter at small sizes: a crop that
lets the antlers leave the tile was tried and reads as a bar across a blob.

## The files

Masters, in `build/mark/`:

| File | What | Use it for |
|---|---|---|
| `buck-source.svg` | the cut figure itself, whole. Kept by hand; everything else is made from it | nothing directly |
| `icon.svg`, `icon-small.svg`, `icon-tiny.svg` | the app icon: the screen as a rounded square of 824 in a 1024 canvas, the shadow on it | anywhere the operating system does not round the icon itself |
| `tile.svg` | the screen filling a square, the shadow on it | where the platform rounds it (iOS), large favicons |
| `tile-small.svg`, `tile-tiny.svg` | the same with rounded corners | favicons |
| `badge.svg`, `badge-small.svg` | the screen as a disc, the shadow on it (the figure sits smaller than in a tile: a disc cuts the corners where the antlers' tips are) | where a spot of the colour is wanted on a dark ground: the document icon, the link card, a poster, a sticker. 40 px and up |
| `mark.svg`, `mark-small.svg` | the figure alone in bone, no screen, cut level below the elbows | dark surfaces: the app's start screen and About, the site's header and footer, a slide |
| `mark-light.svg`, `mark-light-small.svg` | the figure alone in ink | paper and light pages |
| `mark-mono.svg`, `mark-mono-small.svg` | the figure alone in black (recolour it) | a menu bar, a stamp, one-colour print, `mask-icon` |
| `document.svg`, `document-small.svg`, `document-tiny.svg` | a page of the ground with a turned corner, the badge on it | a show's document icon |

Made from them: `build/icon.png` (1024) and `build/icon.icns`, which `electron-builder` uses (16 px is the tiny
drawing, 32 and 64 the small, 128 and up the plain); `build/document.icns` and `build/document.ico` (the icon of
an `.ecshow` show: `build.fileAssociations` in `package.json`); `app/renderer/images/mark.svg` (the start screen
and Settings ▸ About: the bone figure on the app's own ground); and on the site (`site/` in the service repository, `../endless_cues_service`, found by `bin/site-dir.js`; skipped if it is not there) `images/mark.svg`,
`images/mark-small.svg` (header and footer), `images/mark-mono.svg`, `images/favicon.svg`,
`images/favicon-32.png`, `images/favicon-192.png`, `images/apple-touch-icon.png`, `favicon.ico`. The site's `og.png` is
a photograph of a small page with the badge on it (see the site's `README.md`).

Which to use: the tile or the app icon wherever an icon is expected; the bone figure beside the name and on any
interface; the badge only on brand surfaces that are not the interface.

## Clear space and smallest size

- Leave a quarter of the mark's height clear on every side. Beside the name, the gap is a quarter of the mark's
  height too.
- Do not show the tile below 16 px, the figure alone below 20 px high, or the badge below 40 px. Below 128 px
  use the small drawing.

## What not to do

- Do not redraw it, trace it, tidy its curves or straighten the antlers. Crop, fill and scale only.
- Do not outline it. A stroke round the holes closes the eyes; the figure is always a solid fill
  (`fill-rule: evenodd`).
- Do not put it on green: green is `--go`. Do not put the shadow on anything but the screen, or the bone figure
  on a light ground (use ink there).
- Do not flip it, tilt it, crop the antlers off, or cut the figure anywhere but level across the bottom.
- Do not use the screen's gold as an interface colour (see Colours).
- Do not add eyes, a mouth or any shape the cut figure does not have. Enlarging its own holes for a small size is
  the limit.

## Making the files again

```bash
node build/mark.js        # every SVG, PNG, the .icns and the .ico (needs Electron from node_modules; the .icns needs a Mac, the .ico ImageMagick)
node build/mark.js --svg  # the SVGs only
node site/stamp.js        # in ../endless_cues_service, after it, so the site's pages point at the new files
```

`build/mark.js` is the one source: it reads the cut figure from `build/mark/buck-source.svg` and holds the three
drawings (the crop, how much heavier, how far the holes are opened), the colours, the screen and the list of
files. Never edit a generated file, and never edit the figure. After changing a drawing, look at the result at
its true size before keeping it.
