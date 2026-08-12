/**
 * Recolouring a duelist who is painted rather than built out of materials.
 *
 * The vendored roster wears its garments as named flat-colour materials, so
 * tinting one is assigning a colour and nothing more. The imported bodies carry
 * their whole look in a single 256×256 texture: no `Jacket`, no `Hair`, just
 * pixels. Recolouring one means rewriting that image.
 *
 * ## What a region is
 *
 * A hue family, optionally confined to a band of lightness. These are game
 * textures drawn in blocks with a little baked shading, so a jacket is not one
 * colour, it is a spread of one hue across a range of lightness. Matching on
 * hue and rewriting hue keeps the shading — which is the whole point, because
 * a flat repaint looks like a sticker.
 *
 * Lightness is carried across as a *difference*, not a ratio: a pixel drawn a
 * tenth darker than the middle of its region stays a tenth darker. Folds,
 * seams and the dark side of a sleeve all survive.
 *
 * It was a ratio first, and that is wrong whenever a region moves a long way in
 * lightness. Grandpa's hair goes brown (0.24) to grey (0.54), which is a lift
 * of 2.2×, and multiplying by 2.2 turns a head drawn across 0.15–0.35 into one
 * drawn across 0.33–0.78 — silver on top and black at the sides, a skunk rather
 * than an old man. A difference moves the whole region together, which is what
 * "the same garment in another colour" means.
 *
 * The difference is only scaled back when there is no room for it — going to
 * near-white or near-black leaves less space above or below than the region
 * needs, and the shading is compressed into what is left rather than clipped
 * flat against the end.
 *
 * Hue alone is not always enough to name a region. Mai's body is painted with
 * three blue-ish things — dark hair, a pale top, light trousers — that sit
 * within a few degrees of each other, so a hue rule claims all three and she
 * ends up with matching hair and trousers. What separates them is how light
 * they are, so a rule may carry a lightness window and only paint inside it.
 *
 * ## Hue is trusted in proportion to chroma, not to saturation
 *
 * HSL saturation is chroma divided by how much room the lightness leaves for
 * it, so the same paint reads as `s 0.15` in shadow and `s 0.58` in a
 * highlight. Thresholding on it splits a region down the middle: Mai's hair is
 * `#444c5c` (s 0.150) and `#3f4758` (s 0.166) — hue 0.611 and 0.613, the same
 * blue-grey — and a cut at 0.16 sent one half to the grey rule and the other
 * half to whichever hue rule was nearest. That is what a stripe is.
 *
 * Chroma is just how far the channels spread, which barely moves under
 * shading: those two are 0.094 and 0.098. So chroma decides whether a colour
 * has a hue worth matching, and true greys — which have none — are matched on
 * lightness instead.
 *
 * ## Skin is protected by value, not by rule
 *
 * The old system could not paint skin because slots were forbidden from naming
 * the `Skin` material. There are no material names here, so the guard is
 * arithmetic: every model records what its face is mostly made of, and any
 * pixel within reach of that is left exactly as it was. A brown jacket and a
 * pair of hands are the same hue, and the hands win.
 *
 * ## Cost
 *
 * One pass over 65,536 pixels per recoloured duelist, once, at build time —
 * about a millisecond. The result is a new texture; the original belongs to the
 * shared template and is never touched, or every duelist on screen would change
 * colour together.
 */

import * as THREE from 'three';
import type { RepaintRule, TextureTint } from '@/story/premade';

/**
 * Below this spread between the channels, a colour has no hue worth matching:
 * it is a grey, a black or a white, and its hue is rounding noise.
 *
 * Set under the muted blue-grey the hair on these models is painted in
 * (chroma 0.094 at its lightest, 0.067 in the linework) and well above a true
 * neutral, which is the gap it exists to sit in.
 */
const CHROMA_FLOOR = 0.055;
/** How far round the wheel a pixel can be and still belong to a region. */
const HUE_REACH = 0.055;
/** How far in lightness a *grey* region reaches, having no hue to go on. */
const GREY_REACH = 0.2;
/** Anything this close to the face's own colour is skin, and is never touched. */
const SKIN_REACH = 0.13;

interface Hsl {
  h: number;
  s: number;
  l: number;
  /** max − min over the channels, 0..1. How much colour is actually there. */
  c: number;
}

function toHsl(r: number, g: number, b: number): Hsl {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l, c: 0 };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l, c: d };
}

/* Takes the three it writes with, not a whole `Hsl`: chroma is a measurement
   made on the way in and means nothing on the way out. */
function hslToRgb({ h, s, l }: Omit<Hsl, 'c'>): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const chan = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [
    Math.round(chan(h + 1 / 3) * 255),
    Math.round(chan(h) * 255),
    Math.round(chan(h - 1 / 3) * 255),
  ];
}

/**
 * A rule's colour, measured the same way a pixel is.
 *
 * Parsed by hand rather than through `THREE.Color`, which colour-manages an
 * sRGB hex into linear space on the way in. The pixels being compared against
 * come off a canvas as raw sRGB bytes, so going through three puts the two
 * sides of every comparison in different spaces — `#444c5c` is chroma 0.094 as
 * bytes and 0.049 linearised, which is the difference between "a blue-grey"
 * and "a grey", and so between Mai having blonde hair and not.
 */
function hexToHsl(hex: string): Hsl {
  const n = parseInt(hex.replace('#', ''), 16);
  return toHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** Shortest distance between two hues on the wheel, 0..0.5. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 1;
  return d > 0.5 ? 1 - d : d;
}

/** One region's rule: what it currently is, and what it is becoming. */
interface Repaint {
  from: Hsl;
  to: Hsl;
  grey: boolean;
  /** The lightness window the rule paints inside, 0..1 when unconstrained. */
  lo: number;
  hi: number;
}

/**
 * Where a pixel lands, keeping its place in its region's shading.
 *
 * The region moves as a body: a pixel drawn a tenth below its region's middle
 * comes out a tenth below the new middle. The only time that is not possible is
 * when the new colour is close to an end — a region drawn across a quarter of
 * the range, recoloured to lightness 0.9, has only a tenth of room above it —
 * and then the shading on that side is squeezed into the room available. It is
 * never scaled *up*, because that is what turned Grandpa piebald, and it is
 * never allowed to clip, because clipping flattens shading into a solid block.
 */
function shade(l: number, rule: Repaint): number {
  const d = l - rule.from.l;
  const room = d > 0 ? (1 - rule.to.l) / Math.max(1e-6, 1 - rule.from.l) : rule.to.l / Math.max(1e-6, rule.from.l);
  return Math.max(0, Math.min(1, rule.to.l + d * Math.min(1, room)));
}

function ruleFor(from: string, to: string, window?: readonly [number, number]): Repaint {
  const f = hexToHsl(from);
  return {
    from: f,
    to: hexToHsl(to),
    grey: f.c < CHROMA_FLOOR,
    lo: window?.[0] ?? 0,
    hi: window?.[1] ?? 1,
  };
}

/**
 * Rewrites a texture so the named regions take new colours.
 *
 * Returns `null` when there is nothing to do — no choices made, no texture, or
 * an image the browser has not decoded — and the caller keeps the original,
 * which is both correct and the cheap path.
 */
export function repaintTexture(
  map: THREE.Texture | null,
  tints: TextureTint[] | undefined,
  choices: (string | null)[],
  skin: string | undefined,
  /**
   * Extra colour-to-colour rules, for a character somebody wrote down.
   *
   * The booth can only offer what the catalog lists as a slot, which is the
   * two or three biggest regions. An authored character is not limited that
   * way — Grandpa's hair is 2.5% of his texture and is the whole point of him
   * — so this names any colour in the image directly. It is the texture's
   * answer to `overrides`, which does the same for named materials.
   */
  extra?: Record<string, RepaintRule>
): THREE.Texture | null {
  if (!map) return null;

  const rules: Repaint[] = [];
  (tints ?? []).forEach((tint, i) => {
    const picked = choices[i];
    if (!picked) return;
    rules.push(ruleFor(tint.from, picked, tint.lightness));
  });
  for (const [from, rule] of Object.entries(extra ?? {})) {
    if (typeof rule === 'string') rules.push(ruleFor(from, rule));
    else rules.push(ruleFor(from, rule.to, rule.lightness));
  }
  if (!rules.length) return null;

  const source = map.image as CanvasImageSource & { width?: number; height?: number };
  const w = source?.width ?? 0;
  const h = source?.height ?? 0;
  if (!w || !h) return null;

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;

  const skinHsl = skin ? hexToHsl(skin) : null;

  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    const c = toHsl(px[i], px[i + 1], px[i + 2]);

    /* Hands, arms, necks and faces, whatever anybody picked. */
    if (
      skinHsl &&
      c.c >= CHROMA_FLOOR &&
      hueGap(c.h, skinHsl.h) < HUE_REACH &&
      Math.abs(c.l - skinHsl.l) < SKIN_REACH
    ) {
      continue;
    }

    for (const rule of rules) {
      if (c.l < rule.lo || c.l > rule.hi) continue;
      const hit = rule.grey
        ? c.c < CHROMA_FLOOR && Math.abs(c.l - rule.from.l) < GREY_REACH
        : c.c >= CHROMA_FLOOR && hueGap(c.h, rule.from.h) < HUE_REACH;
      if (!hit) continue;
      const l = shade(c.l, rule);
      const [r, g, b] = hslToRgb({ h: rule.to.h, s: rule.to.s, l });
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      break;
    }
  }

  ctx.putImageData(img, 0, 0);
  const out = new THREE.CanvasTexture(canvas);
  out.colorSpace = map.colorSpace;
  out.wrapS = map.wrapS;
  out.wrapT = map.wrapT;
  out.flipY = map.flipY;
  out.needsUpdate = true;
  return out;
}
