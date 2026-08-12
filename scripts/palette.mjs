/**
 * What colours a duelist is actually painted in, and which of them is skin.
 *
 * The imported bodies carry their look in a 256×256 texture rather than in
 * named materials, so the booth cannot recolour them the way it recoloured the
 * vendored roster — there is no `Jacket` material to repaint. What there *is*
 * is a small number of near-flat colour regions: these are 3DS textures, drawn
 * in blocks with a little baked shading, so "the jacket" is a cluster of pixels
 * within a few percent of one hue.
 *
 * This finds those clusters and prints them, so a catalog entry can name them.
 * It does not guess labels — it cannot know that the navy block is a blazer and
 * not trousers — but it does answer the one question that must not be guessed:
 *
 * **Which cluster is skin?** Whatever the *face* texture is mostly made of.
 * A face is a face; the largest cluster in it is the character's skin, and any
 * body cluster near that colour is a hand, an arm or a neck. Those are never
 * offered, so no palette choice can ever turn somebody's arms blue.
 *
 *   node scripts/palette.mjs "/tmp/rips2/Misc NPCs/Students/Males/01"
 *   node scripts/palette.mjs /tmp/rips2/Protagonist --json
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { readSmd } from './lib/smd.mjs';

/* ------------------------------------------------------------------ */
/* Just enough PNG                                                     */
/* ------------------------------------------------------------------ */

/**
 * Decodes a non-interlaced 8-bit PNG to RGBA.
 *
 * Hand-rolled rather than pulled in, because the whole job is "read a handful
 * of small textures at build time" and the alternative is a dependency or a
 * headless browser for something `zlib` already does most of.
 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  let interlace = 0;
  const idat = [];
  let palette = null;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colour = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colour];
  if (!channels) throw new Error(`unsupported colour type ${colour}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const line = Buffer.alloc(stride);
  const prev = Buffer.alloc(stride);

  let r = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[r++];
    raw.copy(line, 0, r, r + stride);
    r += stride;
    /* The five PNG filters, undone in place against the previous scanline. */
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    line.copy(prev);
    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      if (colour === 3) {
        const p = line[s] * 3;
        out[d] = palette[p];
        out[d + 1] = palette[p + 1];
        out[d + 2] = palette[p + 2];
        out[d + 3] = 255;
      } else if (colour === 0 || colour === 4) {
        out[d] = out[d + 1] = out[d + 2] = line[s];
        out[d + 3] = channels === 2 ? line[s + 1] : 255;
      } else {
        out[d] = line[s];
        out[d + 1] = line[s + 1];
        out[d + 2] = line[s + 2];
        out[d + 3] = channels === 4 ? line[s + 3] : 255;
      }
    }
  }
  return { width, height, data: out };
}

/* ------------------------------------------------------------------ */
/* Clustering                                                          */
/* ------------------------------------------------------------------ */

const hex = (r, g, b) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (mx === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h, s, l];
}

/** Below this, a colour has no meaningful hue — it is a grey, a black, a white. */
const NEUTRAL = 0.16;

/**
 * The garments in an image, largest first.
 *
 * **A garment is a hue family, not a colour.** The first pass at this bucketed
 * by RGB and a single blue blazer came back as five clusters — `#011893`,
 * `#071fa6`, `#1028ac`, `#162ebe`, `#0b24ad` — which are one jacket painted
 * with its own shading. Grouping by hue and reporting the lightness *range*
 * instead keeps the garment whole, and keeps the shading, which is the thing
 * that has to survive a recolour: swap the hue, scale the lightness, and the
 * folds are still there.
 *
 * Near-greys have no reliable hue, so they group by lightness instead — which
 * is right anyway, because black shoes and a white shirt are two things.
 *
 * Fully transparent pixels are ignored: these textures carry big empty
 * margins, and black nothing would otherwise win every time.
 */
function cluster(img, { minShare = 0.02 } = {}) {
  const buckets = new Map();
  let counted = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3] < 128) continue;
    const r = img.data[i];
    const g = img.data[i + 1];
    const b = img.data[i + 2];
    const [h, s, l] = rgbToHsl(r, g, b);
    /* 20° of hue for anything coloured; four bands of lightness for the greys. */
    const key = s < NEUTRAL ? `n${Math.round(l * 3)}` : `h${Math.round(h * 18)}`;
    const hit = buckets.get(key) ?? { key, n: 0, r: 0, g: 0, b: 0, lo: 1, hi: 0, neutral: s < NEUTRAL };
    hit.n++;
    hit.r += r;
    hit.g += g;
    hit.b += b;
    hit.lo = Math.min(hit.lo, l);
    hit.hi = Math.max(hit.hi, l);
    buckets.set(key, hit);
    counted++;
  }
  return [...buckets.values()]
    .filter((c) => c.n / counted >= minShare)
    .sort((a, b) => b.n - a.n)
    .map((c) => {
      const r = Math.round(c.r / c.n);
      const g = Math.round(c.g / c.n);
      const b = Math.round(c.b / c.n);
      const [h, s, l] = rgbToHsl(r, g, b);
      return {
        key: c.key,
        hex: hex(r, g, b),
        rgb: [r, g, b],
        share: c.n / counted,
        h,
        s,
        l,
        lo: c.lo,
        hi: c.hi,
        neutral: c.neutral,
      };
    });
}

/**
 * Is this body cluster the character's skin?
 *
 * Same hue family as the face's dominant colour, *and* about as light. The hue
 * test alone is not enough: brown hair and skin are both oranges and land in
 * the same 20° bin, so hair would be withheld as though it were an arm. What
 * separates them is that skin is pale and hair is not.
 */
function isSkin(cluster, skin) {
  return cluster.key === skin.key && Math.abs(cluster.l - skin.l) < 0.2;
}

/** The bucket key a single pixel falls in — the same rule `cluster` uses. */
function keyOf(r, g, b) {
  const [h, s, l] = rgbToHsl(r, g, b);
  return s < NEUTRAL ? `n${Math.round(l * 3)}` : `h${Math.round(h * 18)}`;
}

/**
 * Where on the body each colour actually sits.
 *
 * A cluster is a set of texels, and a texel means nothing on its own — "the
 * navy region" could be a blazer or trousers, and the booth has to say which.
 * The mesh knows: every triangle carries both a UV and a position, so reading
 * the texture at each triangle's UV centre says which colour covers it, and its
 * vertices say how high up the body it is.
 *
 * Centroids rather than a full rasterisation because this only needs to be
 * right on average — two thousand triangles is plenty of samples to separate a
 * hat from a pair of shoes, and rasterising each one properly is an hour of
 * code for an answer that does not change.
 */
function placeOnBody(smd, img, bodyMaterial) {
  const sums = new Map();
  let lo = Infinity;
  let hi = -Infinity;
  for (const g of smd.groups) {
    for (const v of g.verts) {
      lo = Math.min(lo, v.pos[1]);
      hi = Math.max(hi, v.pos[1]);
    }
  }
  const span = Math.max(1e-6, hi - lo);

  for (const g of smd.groups) {
    if (!g.material.includes(bodyMaterial)) continue;
    if (g.verts.length < 3) continue;
    const u = (g.verts[0].uv[0] + g.verts[1].uv[0] + g.verts[2].uv[0]) / 3;
    const w = (g.verts[0].uv[1] + g.verts[1].uv[1] + g.verts[2].uv[1]) / 3;
    /* UVs on these rips run outside 0..1 and wrap. */
    const px = Math.min(img.width - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * img.width)));
    const py = Math.min(img.height - 1, Math.max(0, Math.floor((1 - (((w % 1) + 1) % 1)) * img.height)));
    const i = (py * img.width + px) * 4;
    if (img.data[i + 3] < 128) continue;
    const key = keyOf(img.data[i], img.data[i + 1], img.data[i + 2]);
    const y = (g.verts[0].pos[1] + g.verts[1].pos[1] + g.verts[2].pos[1]) / 3;
    const hit = sums.get(key) ?? { n: 0, y: 0 };
    hit.n++;
    hit.y += (y - lo) / span;
    sums.set(key, hit);
  }
  const out = new Map();
  for (const [key, v] of sums) out.set(key, v.y / v.n);
  return out;
}

/** What to call a region that sits this far up the body, 0 feet, 1 crown. */
function partAt(height) {
  if (height === undefined) return 'Outfit';
  if (height > 0.86) return 'Hair';
  if (height > 0.56) return 'Top';
  if (height > 0.22) return 'Legs';
  return 'Shoes';
}

/* ------------------------------------------------------------------ */

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const dirs = argv.filter((a) => !a.startsWith('--'));
if (!dirs.length) {
  console.error('palette: pass one or more rip folders');
  process.exit(2);
}

const report = [];
for (const dir of dirs) {
  const files = await fs.readdir(dir);
  const bodyFile = files.find((f) => /body_tex\.png$/i.test(f));
  const faceFile = files.find((f) => /face_tex\.png$/i.test(f));
  if (!bodyFile || !faceFile) {
    console.error(`${dir}: expected a body_tex and a face_tex PNG`);
    process.exit(1);
  }
  const bodyImg = decodePng(await fs.readFile(path.join(dir, bodyFile)));
  const body = cluster(bodyImg);
  const face = cluster(decodePng(await fs.readFile(path.join(dir, faceFile))));
  const smd = readSmd(await fs.readFile(path.join(dir, 'Model.smd'), 'utf8'));
  const heights = placeOnBody(smd, bodyImg, path.parse(bodyFile).name);

  /* Skin is the biggest thing a face is made of. Anything on the body within
     reach of it is a hand, an arm or a neck, and is never offered. */
  const skin = face[0];
  const wearable = body.filter((c) => !isSkin(c, skin));

  /* Two of the same part is "Top" twice in the booth, which is useless — the
     second becomes its trim. */
  const seen = new Map();
  const slots = wearable.map((c) => {
    const part = partAt(heights.get(c.key));
    const n = (seen.get(part) ?? 0) + 1;
    seen.set(part, n);
    return {
      label: n === 1 ? part : `${part} trim`,
      from: c.hex,
      share: +c.share.toFixed(3),
      height: heights.has(c.key) ? +heights.get(c.key).toFixed(2) : null,
    };
  });
  report.push({ dir, skin: skin.hex, slots });
  if (!asJson) {
    console.log(`${dir}`);
    console.log(`  skin (from the face): ${skin.hex}`);
    for (const s2 of slots) {
      console.log(
        `  ${s2.from}  ${(s2.share * 100).toFixed(1).padStart(5)}%  ` +
          `y ${s2.height ?? '  ? '}  ${s2.label.padEnd(10)}${'█'.repeat(Math.ceil(s2.share * 30))}`
      );
    }
    const hidden = body.length - wearable.length;
    if (hidden) console.log(`  (${hidden} cluster${hidden > 1 ? 's' : ''} withheld as skin)`);
  }
}
if (asJson) console.log(JSON.stringify(report, null, 2));
