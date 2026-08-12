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
import { readSmd } from './lib/smd.mjs';
import { NEUTRAL, decodePng, hex, rgbToHsl } from './lib/png.mjs';

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
 * **A hue family is not always one garment**, and that is the second pass.
 * These textures are inked: every region is drawn with near-black lines around
 * it, and that ink is faintly coloured, so it lands in whatever hue bucket it
 * happens to be nearest. On Mai it landed in the same bucket as her pale top,
 * and the cluster came back as `#697692` spanning lightness 0.08 to 0.87 — a
 * colour that is nowhere on the model, being the average of a light garment and
 * the black lines around it. A rule authored from a number like that paints
 * something nobody intended.
 *
 * So each bucket's lightness histogram is cut at its valleys, and each peak is
 * reported separately. A garment with shading is one peak and stays whole; a
 * garment plus its linework is two, and separates.
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
    let hit = buckets.get(key);
    if (!hit) {
      hit = { key, n: 0, neutral: s < NEUTRAL, bins: [] };
      for (let j = 0; j <= 100; j++) hit.bins.push({ n: 0, r: 0, g: 0, b: 0 });
      buckets.set(key, hit);
    }
    const bin = hit.bins[Math.round(l * 100)];
    hit.n++;
    bin.n++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    counted++;
  }

  const out = [];
  for (const c of buckets.values()) {
    for (const [i, [from, to]] of segments(c.bins).entries()) {
      let n = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = from; j <= to; j++) {
        n += c.bins[j].n;
        r += c.bins[j].r;
        g += c.bins[j].g;
        b += c.bins[j].b;
      }
      if (n / counted < minShare) continue;
      r = Math.round(r / n);
      g = Math.round(g / n);
      b = Math.round(b / n);
      const [h, s, l] = rgbToHsl(r, g, b);
      /* The 2nd and 98th percentile rather than the extremes: a lone stray
         texel in an otherwise tight region would otherwise report a span from
         black to white, which tells an author nothing. */
      const at = (q) => {
        let seen = 0;
        for (let j = from; j <= to; j++) {
          seen += c.bins[j].n;
          if (seen >= n * q) return j / 100;
        }
        return to / 100;
      };
      out.push({
        key: `${c.key}/${i}`,
        bucket: c.key,
        hex: hex(r, g, b),
        rgb: [r, g, b],
        share: n / counted,
        h,
        s,
        l,
        lo: at(0.02),
        hi: at(0.98),
        neutral: c.neutral,
        band: [from / 100, to / 100],
      });
    }
  }
  return out.sort((a, b) => b.share - a.share);
}

/**
 * Where one hue family's lightness histogram should be cut, as `[from, to]`
 * bin pairs.
 *
 * A peak is a garment; the dip between two peaks is the gap between a garment
 * and the ink around it. Smoothed first because these are 256×256 textures and
 * a raw histogram of a few thousand texels is spiky enough to invent peaks.
 *
 * A dip only counts if it is deep — under half the smaller of the two peaks it
 * separates. Shading makes a broad, lumpy hump, and cutting a garment in half
 * at a shallow dimple is exactly the failure this whole file exists to avoid.
 */
function segments(bins) {
  const smooth = bins.map((_, i) => {
    let sum = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(bins.length - 1, i + 2); j++) sum += bins[j].n;
    return sum;
  });
  const top = Math.max(...smooth);
  if (!top) return [[0, bins.length - 1]];

  const peaks = [];
  for (let i = 0; i < smooth.length; i++) {
    if (smooth[i] < top * 0.12) continue;
    let best = true;
    for (let j = Math.max(0, i - 3); j <= Math.min(smooth.length - 1, i + 3); j++) {
      if (smooth[j] > smooth[i]) best = false;
    }
    /* A flat top is several equal bins; keep the first and skip the rest. */
    if (best && (!peaks.length || i - peaks[peaks.length - 1] > 3)) peaks.push(i);
  }
  if (peaks.length < 2) return [[0, bins.length - 1]];

  const cuts = [];
  for (let p = 1; p < peaks.length; p++) {
    let at = peaks[p - 1];
    for (let i = peaks[p - 1]; i <= peaks[p]; i++) if (smooth[i] < smooth[at]) at = i;
    const shallower = Math.min(smooth[peaks[p - 1]], smooth[peaks[p]]);
    if (smooth[at] <= shallower * 0.5) cuts.push(at);
  }
  if (!cuts.length) return [[0, bins.length - 1]];

  const spans = [];
  let from = 0;
  for (const at of cuts) {
    spans.push([from, at]);
    from = at + 1;
  }
  spans.push([from, bins.length - 1]);
  return spans;
}

/**
 * Is this body cluster the character's skin?
 *
 * Same hue family as the face's dominant colour, *and* about as light. The hue
 * test alone is not enough: brown hair and skin are both oranges and land in
 * the same bin, so hair would be withheld as though it were an arm. What
 * separates them is that skin is pale and hair is not.
 *
 * Compared by measurement rather than by bucket key, because the keys carry a
 * segment number now and the face and the body are cut in different places.
 * The hue window is the renderer's own, which is the right one: what this has
 * to predict is whether a recolour of that cluster would reach the skin.
 */
function isSkin(cluster, skin) {
  const d = Math.abs(cluster.h - skin.h) % 1;
  const sameHue = cluster.neutral === skin.neutral && (cluster.neutral || Math.min(d, 1 - d) < 0.055);
  return sameHue && Math.abs(cluster.l - skin.l) < 0.2;
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
function placeOnBody(smd, img, bodyMaterial, clusters) {
  /* Which cluster a texel belongs to: its hue bucket, then the lightness
     segment of that bucket it falls in. */
  const byBucket = new Map();
  for (const c of clusters) {
    const list = byBucket.get(c.bucket) ?? [];
    list.push(c);
    byBucket.set(c.bucket, list);
  }
  const keyOf = (r, g, b) => {
    const [h, s, l] = rgbToHsl(r, g, b);
    const bucket = s < NEUTRAL ? `n${Math.round(l * 3)}` : `h${Math.round(h * 18)}`;
    return byBucket.get(bucket)?.find((c) => l >= c.band[0] && l <= c.band[1])?.key;
  };

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
    if (!key) continue;
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
  const heights = placeOnBody(smd, bodyImg, path.parse(bodyFile).name, body);

  /* Skin is the biggest thing a face is made of. Anything on the body within
     reach of it is a hand, an arm or a neck, and is never offered. */
  const skin = face[0];
  const wearable = body.filter((c) => !isSkin(c, skin));

  /* Two of the same part is "Top" twice in the booth, which is useless — the
     second becomes its trim, the third its detail. Past that a region is too
     small to be worth a swatch, and splitting garments from their linework
     turned up more of them than a booth can sensibly offer. */
  const seen = new Map();
  const PARTS = ['', ' trim', ' detail'];
  const slots = [];
  for (const c of wearable) {
    const part = partAt(heights.get(c.key));
    const n = seen.get(part) ?? 0;
    if (n >= PARTS.length) continue;
    seen.set(part, n + 1);
    slots.push({
      label: `${part}${PARTS[n]}`,
      from: c.hex,
      share: +c.share.toFixed(3),
      height: heights.has(c.key) ? +heights.get(c.key).toFixed(2) : null,
      /* What a rule authored from `from` actually has to cover. A recolour
         matches on hue and rewrites it, so anything in the region outside the
         rule's reach keeps the old colour and reads as a stripe. */
      lightness: [+c.lo.toFixed(2), +c.hi.toFixed(2)],
      hue: +c.h.toFixed(3),
    });
  }

  /*
   * Two garments in the same hue family.
   *
   * A recolour rule names a hue, so when two regions sit within the renderer's
   * hue reach of each other, one rule takes both — pick a colour for Mai's hair
   * and her trousers change with it. The fix is a lightness window on the
   * catalog slot, and this is what says one is needed: it is not visible in the
   * hexes, which is why it went unnoticed until somebody's hair came out
   * striped.
   */
  const HUE_REACH = 0.055;
  const clashes = [];
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const d = Math.abs(slots[i].hue - slots[j].hue) % 1;
      if (Math.min(d, 1 - d) < HUE_REACH) clashes.push([slots[i], slots[j]]);
    }
  }

  report.push({ dir, skin: skin.hex, slots, clashes: clashes.map(([a, b]) => [a.label, b.label]) });
  if (!asJson) {
    console.log(`${dir}`);
    console.log(`  skin (from the face): ${skin.hex}`);
    for (const s2 of slots) {
      console.log(
        `  ${s2.from}  ${(s2.share * 100).toFixed(1).padStart(5)}%  ` +
          `y ${s2.height ?? '  ? '}  l ${s2.lightness[0].toFixed(2)}–${s2.lightness[1].toFixed(2)}  ` +
          `${s2.label.padEnd(10)}${'█'.repeat(Math.ceil(s2.share * 30))}`
      );
    }
    const hidden = body.length - wearable.length;
    if (hidden) console.log(`  (${hidden} cluster${hidden > 1 ? 's' : ''} withheld as skin)`);
    for (const [a, b] of clashes) {
      console.log(
        `  ! ${a.from} "${a.label}" and ${b.from} "${b.label}" are one hue family — ` +
          `a rule for either takes both. Window them: ` +
          `[${a.lightness[0]}, ${a.lightness[1]}] and [${b.lightness[0]}, ${b.lightness[1]}].`
      );
    }
  }
}
if (asJson) console.log(JSON.stringify(report, null, 2));
