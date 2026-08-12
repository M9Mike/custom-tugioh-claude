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
 * A hue family. These are game textures drawn in blocks with a little baked
 * shading, so a jacket is not one colour, it is a spread of one hue across a
 * range of lightness. Matching on hue and rewriting hue keeps the shading —
 * which is the whole point, because a flat repaint looks like a sticker.
 *
 * Lightness is carried across as a *ratio*, not a value: a pixel that was 20%
 * darker than the middle of its region stays 20% darker. Folds, seams and the
 * dark side of a sleeve all survive.
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
import type { TextureTint } from '@/story/premade';

/** Below this, a colour has no usable hue. Matches `scripts/palette.mjs`. */
const NEUTRAL = 0.16;
/** How far round the wheel a pixel can be and still belong to a region. */
const HUE_REACH = 0.055;
/** How far in lightness a *neutral* region reaches, having no hue to go on. */
const GREY_REACH = 0.2;
/** Anything this close to the face's own colour is skin, and is never touched. */
const SKIN_REACH = 0.13;

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function toHsl(r: number, g: number, b: number): Hsl {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return { h: 0, s: 0, l };
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h: number;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h, s, l };
}

function hslToRgb({ h, s, l }: Hsl): [number, number, number] {
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

function hexToHsl(hex: string): Hsl {
  const c = new THREE.Color(hex);
  return toHsl(c.r * 255, c.g * 255, c.b * 255);
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
  neutral: boolean;
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
  skin: string | undefined
): THREE.Texture | null {
  if (!map || !tints?.length) return null;

  const rules: Repaint[] = [];
  tints.forEach((tint, i) => {
    const picked = choices[i];
    if (!picked) return;
    const from = hexToHsl(tint.from);
    rules.push({ from, to: hexToHsl(picked), neutral: from.s < NEUTRAL });
  });
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
      c.s >= NEUTRAL &&
      hueGap(c.h, skinHsl.h) < HUE_REACH &&
      Math.abs(c.l - skinHsl.l) < SKIN_REACH
    ) {
      continue;
    }

    for (const rule of rules) {
      const hit = rule.neutral
        ? c.s < NEUTRAL && Math.abs(c.l - rule.from.l) < GREY_REACH
        : c.s >= NEUTRAL && hueGap(c.h, rule.from.h) < HUE_REACH;
      if (!hit) continue;
      /* Keep this pixel's place in its region's shading. */
      const ratio = rule.from.l > 0.02 ? c.l / rule.from.l : 1;
      const l = Math.max(0, Math.min(1, rule.to.l * ratio));
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
