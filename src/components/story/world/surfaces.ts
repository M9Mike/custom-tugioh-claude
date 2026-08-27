/**
 * Every surface in the world, drawn into a canvas at load.
 *
 * The project ships no image assets and this is why it can afford not to: a
 * floor is a few hundred lines of canvas work, which costs a millisecond and
 * nothing on the wire. It is also the only way to get *variation* — a tiling
 * photograph repeats visibly across a shop floor, where a drawn one can give
 * every plank its own grain and every paving slab its own stain.
 *
 * ## What makes these read as real rather than as programmer art
 *
 * Three things, and all three matter more than the base colour:
 *
 * - **Value variation inside the material.** Real wood is not one brown. Each
 *   plank here is drawn at its own lightness before any grain goes on, which is
 *   what stops a floor looking like a sheet of laminate.
 * - **Edges that are not straight.** Grout lines, plank joins and kerb edges are
 *   drawn with a wobble of a pixel or two. Perfectly straight dark lines are the
 *   single loudest tell of generated geometry.
 * - **Dirt where dirt collects.** Corners, joins and the bottom of walls get a
 *   darker wash. It is the cheapest realism there is.
 *
 * Every function returns a `CanvasTexture` with `colorSpace` set and repeat
 * configured by the caller, or `null` when the browser refuses a 2D context —
 * which happens on a device that has run out of them, and which must degrade to
 * a flat colour rather than taking the world down.
 */

import * as THREE from 'three';

type Ctx = CanvasRenderingContext2D;

function surfaceRect(
  w: number,
  h: number,
  draw: (ctx: Ctx, w: number, h: number) => void
): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function surface(size: number, draw: (ctx: Ctx, s: number) => void): THREE.CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Takes the hardest edges off a drawn surface, without breaking its tiling.
 *
 * ## Why a texture needs softening at all
 *
 * Canvas draws a rectangle with a perfectly hard edge — one texel light, the
 * next dark, nothing between. On a brick wall that is a grid of hard lines about
 * a pixel wide once the wall is a few metres away, and a hard line at that size
 * is the one thing filtering cannot settle: whether a given screen pixel lands on
 * the joint or the brick changes as you walk, and the wall reads as very slightly
 * crawling. Softening the joints by a fraction of a texel gives the mipmap
 * something continuous to average, and the crawl goes away.
 *
 * It is invisible up close, which is the other half of why it works. At three
 * metres of wall across a 512 canvas one texel is six millimetres, so a
 * three-quarter-texel blur is four millimetres of softening on a mortar joint —
 * which is what a mortar joint looks like anyway.
 *
 * ## Why it is padded rather than tiled
 *
 * A blur samples outside the pixels it is given, and at the edge of a canvas
 * there is nothing there — so a naive pass darkens all four borders, and a
 * texture that repeats then shows a grid of dark seams across the whole wall,
 * which is worse than the problem. The fix is to give every edge the neighbour
 * it will actually have.
 *
 * The obvious way is to tile the source three by three, blur that, and cut the
 * middle out. It is also three times the width and three times the height —
 * 1536 square for a 512 texture, twice over, five times per area — and it wedged
 * the browser hard enough that page loads timed out. Only a few pixels of
 * neighbour are ever read for a blur this small, so it pads by a few pixels of
 * wrapped content instead. Same result, a fortieth of the pixels.
 */
function soften(ctx: Ctx, w: number, h: number, px: number): void {
  const pad = Math.ceil(px * 3) + 2;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const from = src.getContext('2d');
  if (!from) return;
  from.drawImage(ctx.canvas, 0, 0);

  const padded = document.createElement('canvas');
  padded.width = w + pad * 2;
  padded.height = h + pad * 2;
  const onto = padded.getContext('2d');
  if (!onto) return;
  /* Nine placements, but into a canvas barely bigger than the original — eight
     of them are clipped away to the strip of neighbour the blur will read. */
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) onto.drawImage(src, pad + i * w, pad + j * h);
  }

  const blurred = document.createElement('canvas');
  blurred.width = padded.width;
  blurred.height = padded.height;
  const out = blurred.getContext('2d');
  if (!out) return;
  out.filter = `blur(${px}px)`;
  out.drawImage(padded, 0, 0);
  out.filter = 'none';

  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(blurred, pad, pad, w, h, 0, 0, w, h);
}

/** Deterministic noise, so a reload gives the same floor rather than a new one. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A scatter of soft dark blotches — grime, damp, wear. */
function grime(ctx: Ctx, s: number, rnd: () => number, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    const x = rnd() * s;
    const y = rnd() * s;
    const r = s * (0.02 + rnd() * 0.09);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${alpha * (0.5 + rnd() * 0.5)})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Fine speckle, which is what stops a large flat area looking like a swatch. */
function speckle(ctx: Ctx, s: number, rnd: () => number, count: number, alpha: number): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rnd() > 0.5 ? `rgba(255,255,255,${alpha})` : `rgba(0,0,0,${alpha})`;
    ctx.fillRect(rnd() * s, rnd() * s, 1, 1);
  }
}

/**
 * A line with a wobble, for every join and edge in the world.
 *
 * Straight one-pixel lines are the loudest possible signal that a surface was
 * generated. Two pixels of drift over a plank's length is invisible as drift and
 * completely changes how the floor reads.
 */
function wobbleLine(
  ctx: Ctx,
  x0: number, y0: number, x1: number, y1: number,
  rnd: () => number, drift: number
): void {
  const steps = 12;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    ctx.lineTo(
      x0 + (x1 - x0) * t + (rnd() - 0.5) * drift,
      y0 + (y1 - y0) * t + (rnd() - 0.5) * drift
    );
  }
  ctx.stroke();
}

/* ------------------------------------------------------------------ */
/* Wood                                                                */
/* ------------------------------------------------------------------ */

/**
 * Floorboards. Warm, worn, and laid in staggered courses.
 *
 * The stagger is the detail that sells it: real boards do not line up end to
 * end across a room, and a floor whose joins form a continuous line across the
 * texture reads as tiles rather than as timber.
 */
export function woodFloor(): THREE.CanvasTexture | null {
  return surface(1024, (ctx, s) => {
    const rnd = seeded(0x5eed01);
    const planks = 8;
    const h = s / planks;
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(0, 0, s, s);

    for (let row = 0; row < planks; row++) {
      const y = row * h;
      /* Each board its own value — the single biggest difference between wood
         and laminate. */
      const tone = 0.82 + rnd() * 0.36;
      const r = Math.round(122 * tone);
      const g = Math.round(84 * tone);
      const b = Math.round(52 * tone);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, y, s, h - 1);

      /* Grain: long strokes along the board, a few darker knots' worth. */
      for (let i = 0; i < 90; i++) {
        const gy = y + rnd() * h;
        const len = s * (0.15 + rnd() * 0.6);
        const gx = rnd() * s;
        ctx.strokeStyle = `rgba(${rnd() > 0.5 ? '60,38,20' : '150,110,72'},${0.05 + rnd() * 0.13})`;
        ctx.lineWidth = 0.6 + rnd() * 1.5;
        ctx.beginPath();
        ctx.moveTo(gx, gy);
        ctx.bezierCurveTo(gx + len * 0.3, gy + (rnd() - 0.5) * 3,
                          gx + len * 0.7, gy + (rnd() - 0.5) * 3, gx + len, gy);
        ctx.stroke();
      }
      /* A knot or two per board. */
      if (rnd() > 0.55) {
        const kx = rnd() * s;
        const ky = y + h * (0.3 + rnd() * 0.4);
        for (let k = 5; k > 0; k--) {
          ctx.strokeStyle = `rgba(52,32,16,${0.1 + k * 0.05})`;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.ellipse(kx, ky, k * 2.2, k * 1.3, rnd(), 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      /* The join below this board, and the staggered end-joins along it. */
      ctx.strokeStyle = 'rgba(38,22,10,0.75)';
      ctx.lineWidth = 1.6;
      wobbleLine(ctx, 0, y + h - 1, s, y + h - 1, rnd, 1.6);
      const ends = 1 + Math.floor(rnd() * 2);
      for (let e = 0; e < ends; e++) {
        const ex = ((row * 137 + e * 421) % s) + rnd() * 60;
        ctx.strokeStyle = 'rgba(38,22,10,0.6)';
        ctx.lineWidth = 1.3;
        wobbleLine(ctx, ex, y + 1, ex, y + h - 2, rnd, 1.2);
      }
    }
    grime(ctx, s, rnd, 22, 0.16);
    speckle(ctx, s, rnd, 2600, 0.05);
  });
}

/** Darker, tighter timber — counters, shelves, window frames. */
export function darkWood(): THREE.CanvasTexture | null {
  return surface(512, (ctx, s) => {
    const rnd = seeded(0x5eed02);
    ctx.fillStyle = '#4a3120';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 420; i++) {
      const y = rnd() * s;
      ctx.strokeStyle = `rgba(${rnd() > 0.5 ? '30,18,8' : '108,76,46'},${0.06 + rnd() * 0.16})`;
      ctx.lineWidth = 0.5 + rnd() * 1.6;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + (rnd() - 0.5) * 7, s * 0.7, y + (rnd() - 0.5) * 7, s, y);
      ctx.stroke();
    }
    grime(ctx, s, rnd, 10, 0.2);
    speckle(ctx, s, rnd, 900, 0.04);
  });
}

/* ------------------------------------------------------------------ */
/* Walls                                                               */
/* ------------------------------------------------------------------ */

/** Painted plaster: the shop's walls. Faintly uneven, dirtier low down. */
export function plaster(tint: string): THREE.CanvasTexture | null {
  return surface(512, (ctx, s) => {
    const rnd = seeded(0x5eed03);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    /* Broad tonal drift, so a big wall is never one value. */
    for (let i = 0; i < 26; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = s * (0.15 + rnd() * 0.35);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() > 0.5;
      g.addColorStop(0, `rgba(${dark ? '0,0,0' : '255,255,255'},${0.03 + rnd() * 0.05})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    /* A few hairline cracks, because a perfect wall is a new wall. */
    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.06 + rnd() * 0.08})`;
      ctx.lineWidth = 0.8;
      let x = rnd() * s;
      let y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 9; k++) {
        x += (rnd() - 0.5) * 40;
        y += rnd() * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    speckle(ctx, s, rnd, 3000, 0.035);
  });
}

/**
 * Brick, for the buildings outside.
 *
 * ## Why the bricks barely differ from each other
 *
 * Because they used to, and it shimmered.
 *
 * Every brick was drawn at its own value across a range of ±22%, on a light grey
 * mortar quite unlike either — so a wall was a dense grid of high-contrast
 * rectangles about a centimetre and a half of screen apart at normal walking
 * distance. That is almost exactly the size a pixel is at that distance, which is
 * the one frequency no amount of filtering can settle: too fine to render
 * cleanly, too coarse for the mipmap to have averaged away. Move a millimetre and
 * a different set of bricks wins. It reads as the wall crawling.
 *
 * It is not z-fighting and no geometry change touches it — the filtering was
 * already as good as it gets, sixteen-times anisotropic on trilinear mipmaps.
 * The fix is to stop drawing detail at that frequency: the spread is ±10% now,
 * and the mortar is mixed from the brick colour rather than being its own grey,
 * so what is left to alias is small enough not to matter. Close up it still reads
 * as brick, because brick is mostly a *pattern* and only a little a contrast.
 *
 * `npm run shimmer` measures this directly — it renders each area twice 1.2 mm
 * apart and counts how much of the frame changes.
 */
export function brick(base: string): THREE.CanvasTexture | null {
  return surface(512, (ctx, s) => {
    const rnd = seeded(0x5eed04);
    const col = new THREE.Color(base);
    /* Mortar mixed from the brick rather than picked independently: a joint is
       the same sand as the wall, and a grey that owes it nothing is a second
       high-contrast edge round every brick. */
    const mortar = col.clone().lerp(new THREE.Color('#cfc7ba'), 0.55);
    ctx.fillStyle = `rgb(${Math.round(mortar.r * 255)},${Math.round(mortar.g * 255)},${Math.round(mortar.b * 255)})`;
    ctx.fillRect(0, 0, s, s);
    const rows = 16;
    const h = s / rows;
    const w = h * 2.3;
    for (let row = 0; row < rows; row++) {
      const y = row * h;
      const offset = (row % 2) * (w / 2);
      for (let x = -w; x < s + w; x += w) {
        const tone = 0.90 + rnd() * 0.20;
        ctx.fillStyle = `rgb(${Math.round(col.r * 255 * tone)},${Math.round(col.g * 255 * tone)},${Math.round(col.b * 255 * tone)})`;
        ctx.fillRect(x + offset + 1.6, y + 1.6, w - 3.2, h - 3.2);
      }
    }
    grime(ctx, s, rnd, 16, 0.16);
    /* Per-texel noise is the same problem one step finer down, so there is less
       of it and it is fainter. */
    speckle(ctx, s, rnd, 1600, 0.03);
    /* And the joints stop being knife edges, which is the last of the crawl. */
    soften(ctx, s, s, 0.85);
  });
}

/** Painted render, for the shopfronts that are not brick. */
export function render(tint: string): THREE.CanvasTexture | null {
  return surface(512, (ctx, s) => {
    const rnd = seeded(0x5eed05);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 18; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = s * (0.1 + rnd() * 0.3);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${0.03 + rnd() * 0.06})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    /* Streaking below where sills would be — weathering runs downwards. */
    for (let i = 0; i < 40; i++) {
      const x = rnd() * s;
      ctx.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.04})`;
      ctx.fillRect(x, rnd() * s * 0.5, 1 + rnd() * 3, s * (0.1 + rnd() * 0.4));
    }
    speckle(ctx, s, rnd, 2200, 0.04);
  });
}

/* ------------------------------------------------------------------ */
/* Ground, outside                                                     */
/* ------------------------------------------------------------------ */

/** Asphalt: the road surface. Coarse, patched, faintly oily. */
export function asphalt(): THREE.CanvasTexture | null {
  return surface(1024, (ctx, s) => {
    const rnd = seeded(0x5eed06);
    ctx.fillStyle = '#33353a';
    ctx.fillRect(0, 0, s, s);
    /* Aggregate — thousands of chips of slightly different greys. */
    for (let i = 0; i < 26000; i++) {
      const v = 28 + rnd() * 52;
      ctx.fillStyle = `rgba(${v},${v + 2},${v + 6},${0.25 + rnd() * 0.5})`;
      const r = 0.6 + rnd() * 1.9;
      ctx.fillRect(rnd() * s, rnd() * s, r, r);
    }
    /* Patches, where the road has been dug up and made good. */
    for (let i = 0; i < 5; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const w = s * (0.1 + rnd() * 0.22);
      const h = s * (0.08 + rnd() * 0.2);
      ctx.fillStyle = `rgba(0,0,0,${0.1 + rnd() * 0.12})`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }
    /* Cracks. */
    for (let i = 0; i < 12; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.2 + rnd() * 0.25})`;
      ctx.lineWidth = 0.8 + rnd();
      let x = rnd() * s;
      let y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 12; k++) {
        x += (rnd() - 0.5) * 70;
        y += (rnd() - 0.5) * 70;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    grime(ctx, s, rnd, 18, 0.18);
  });
}

/** Paving slabs, for the pavement. Big, grey, stained at the joints. */
export function paving(): THREE.CanvasTexture | null {
  return surface(1024, (ctx, s) => {
    const rnd = seeded(0x5eed07);
    ctx.fillStyle = '#6f7176';
    ctx.fillRect(0, 0, s, s);
    const n = 4;
    const c = s / n;
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        const tone = 0.86 + rnd() * 0.28;
        const v = Math.round(118 * tone);
        ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
        ctx.fillRect(ix * c + 2, iz * c + 2, c - 4, c - 4);
        /* Each slab lightly speckled in its own right. */
        for (let k = 0; k < 700; k++) {
          const g = 0.5 + rnd() * 0.5;
          ctx.fillStyle = rnd() > 0.5
            ? `rgba(255,255,255,${g * 0.05})`
            : `rgba(0,0,0,${g * 0.06})`;
          ctx.fillRect(ix * c + 2 + rnd() * (c - 4), iz * c + 2 + rnd() * (c - 4), 1.4, 1.4);
        }
        /* Chipped corners. */
        if (rnd() > 0.7) {
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          ctx.fillRect(ix * c + (rnd() > 0.5 ? c - 12 : 3), iz * c + (rnd() > 0.5 ? c - 12 : 3), 9, 9);
        }
      }
    }
    /* Joints, drawn last and dirty. */
    ctx.strokeStyle = 'rgba(38,38,40,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      wobbleLine(ctx, i * c, 0, i * c, s, rnd, 2);
      wobbleLine(ctx, 0, i * c, s, i * c, rnd, 2);
    }
    grime(ctx, s, rnd, 20, 0.14);
  });
}

/**
 * The arcade floor: small tiles, laid in courses, polished down the middle.
 *
 * Not `paving()` with a different colour. A covered shopping street is not a
 * pavement — it is an interior floor that happens to have shops on it, and the
 * three things that say so are all in here:
 *
 * - **Small units.** Half-metre tiles rather than metre slabs. Scale is most of
 *   what separates "indoors" from "out".
 * - **A worn lane down the centre.** Forty years of people walking the middle of
 *   an arcade and none of them walking the edges. The centre band is lighter and
 *   smoother; the tiles by the shopfronts keep their texture and their dirt.
 * - **No kerb, no camber, no drainage.** The street's ground is built to shed
 *   rain. This one never sees any, and looks it.
 */
export function arcadeFloor(): THREE.CanvasTexture | null {
  return surface(1024, (ctx, s) => {
    const rnd = seeded(0x5eed09);
    ctx.fillStyle = '#584f45';
    ctx.fillRect(0, 0, s, s);

    const n = 8;                 // eight tiles across the metre-and-a-bit
    const c = s / n;
    for (let ix = 0; ix < n; ix++) {
      for (let iz = 0; iz < n; iz++) {
        /*
         * Warm grey, and every tile its own value — the same rule the wood floor
         * follows, and for the same reason.
         *
         * Dark, and it has to be. The first pass was a genuinely plausible tile
         * colour, around 60% grey, and it turned the whole arcade into a lit
         * white corridor: the street gets away with lamps at 210 candela because
         * it is laid on asphalt that returns a fifth of what hits it, and a floor
         * three times as reflective under a roof reads as a shopping centre at
         * midday. Albedo is lighting. This is pitched to sit in the same world as
         * the road outside.
         */
        const tone = 0.86 + rnd() * 0.26;
        const r = Math.round(104 * tone);
        const g = Math.round(98 * tone);
        const b = Math.round(87 * tone);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(ix * c + 1.5, iz * c + 1.5, c - 3, c - 3);
        for (let k = 0; k < 160; k++) {
          const v = 0.5 + rnd() * 0.5;
          ctx.fillStyle = rnd() > 0.5
            ? `rgba(255,255,255,${v * 0.045})`
            : `rgba(0,0,0,${v * 0.055})`;
          ctx.fillRect(ix * c + 1.5 + rnd() * (c - 3), iz * c + 1.5 + rnd() * (c - 3), 1.3, 1.3);
        }
        /* A chipped edge here and there, and a cracked one now and then. */
        if (rnd() > 0.86) {
          ctx.fillStyle = 'rgba(0,0,0,0.14)';
          ctx.fillRect(ix * c + (rnd() > 0.5 ? c - 9 : 2.5), iz * c + (rnd() > 0.5 ? c - 9 : 2.5), 7, 7);
        }
      }
    }

    /* Joints — thinner and cleaner than paving's, because these are grouted
       rather than sand-filled. */
    ctx.strokeStyle = 'rgba(30,27,23,0.6)';
    ctx.lineWidth = 1.8;
    for (let i = 0; i <= n; i++) {
      wobbleLine(ctx, i * c, 0, i * c, s, rnd, 1.1);
      wobbleLine(ctx, 0, i * c, s, i * c, rnd, 1.1);
    }

    /*
     * The worn lane is **not** in here, and that is deliberate.
     *
     * It was: a pale band down the middle of the canvas. Which works exactly
     * once, because this texture has to repeat about a dozen times along a
     * forty-six metre arcade — so the one worn path came out as a dozen of them
     * laid side by side, a stripe every four metres across a floor nobody walks
     * that way. A feature that exists once in the world cannot live in a texture
     * that exists many times. `world/market.ts` lays it down as a single plane.
     */
    grime(ctx, s, rnd, 14, 0.1);
    speckle(ctx, s, rnd, 2000, 0.03);
  });
}

/**
 * A roller shutter, pulled down. Corrugated, dented, and dirty along the bottom.
 *
 * Half the units in a shopping arcade are shut at any hour, and a shut one is
 * the cheapest character an area has: it says the place has more life in it than
 * you are seeing, which a row of uniformly open shops never manages.
 *
 * The ribs run across the canvas because that is how a shutter is built — slats
 * stacked up the way it rolls — so the plane this goes on wants its height
 * mapped to the canvas height, unrepeated vertically.
 */
export function shutter(tint: string): THREE.CanvasTexture | null {
  return surface(512, (ctx, s) => {
    const rnd = seeded(0x5eed0a);
    const col = new THREE.Color(tint);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);

    const slats = 26;
    const h = s / slats;
    for (let i = 0; i < slats; i++) {
      const y = i * h;
      /* Each slat is a little cylinder: dark at the top where it turns away,
         bright across its belly, and a hard shadow in the join below. */
      /*
       * Softer than it was, for the reason brick is.
       *
       * Twenty-six slats across half a metre puts a hard dark band every couple
       * of centimetres, and at any distance that is a stack of high-contrast
       * lines about a pixel apart — the frequency that crawls whatever the
       * filtering does. It is the brown thing at the top-left of the bakery.
       *
       * The shading is the same shape; there is simply less of it, and the joins
       * ease in rather than starting black.
       */
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      const lit = 1.04 + rnd() * 0.06;
      g.addColorStop(0, 'rgba(0,0,0,0.17)');
      g.addColorStop(0.18, 'rgba(0,0,0,0.05)');
      g.addColorStop(0.4, `rgb(${Math.round(col.r * 255 * lit)},${Math.round(col.g * 255 * lit)},${Math.round(col.b * 255 * lit)})`);
      g.addColorStop(0.7, `rgb(${Math.round(col.r * 244)},${Math.round(col.g * 244)},${Math.round(col.b * 244)})`);
      g.addColorStop(0.88, 'rgba(0,0,0,0.08)');
      g.addColorStop(1, 'rgba(0,0,0,0.2)');
      ctx.fillStyle = g;
      ctx.fillRect(0, y, s, h);
    }

    /* Dents: a slat that has been kicked reads along its whole length. */
    for (let i = 0; i < 7; i++) {
      const y = Math.floor(rnd() * slats) * h;
      const x = rnd() * s;
      const w = s * (0.06 + rnd() * 0.16);
      const d = ctx.createLinearGradient(x, 0, x + w, 0);
      d.addColorStop(0, 'rgba(0,0,0,0)');
      d.addColorStop(0.5, `rgba(0,0,0,${0.1 + rnd() * 0.14})`);
      d.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = d;
      ctx.fillRect(x, y, w, h);
    }

    /* Rust creeping up from the bottom rail, and road dirt with it. */
    const rust = ctx.createLinearGradient(0, s, 0, s * 0.62);
    rust.addColorStop(0, 'rgba(96,52,26,0.34)');
    rust.addColorStop(1, 'rgba(96,52,26,0)');
    ctx.fillStyle = rust;
    ctx.fillRect(0, s * 0.62, s, s * 0.38);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * s;
      ctx.fillStyle = `rgba(74,42,20,${0.06 + rnd() * 0.12})`;
      ctx.fillRect(x, s * (0.66 + rnd() * 0.3), 1 + rnd() * 4, s * (0.02 + rnd() * 0.1));
    }

    grime(ctx, s, rnd, 12, 0.16);
    speckle(ctx, s, rnd, 1400, 0.035);
  });
}

/** Ceiling tiles for the shop — plain, but not perfectly plain. */
export function ceiling(): THREE.CanvasTexture | null {
  return surface(512, (ctx, s) => {
    const rnd = seeded(0x5eed08);
    ctx.fillStyle = '#d9d2c4';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 5000; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.05})`;
      ctx.fillRect(rnd() * s, rnd() * s, 1.6, 1.6);
    }
    grime(ctx, s, rnd, 8, 0.1);
  });
}

/**
 * Poured concrete: the steps, the retaining walls, the poles.
 *
 * Not paving — paving is slabs with joints, and a stair cast in place has none.
 * What it has instead is the record of how it was made and what has happened
 * since: the faint horizontal lines where the shuttering met, aggregate showing
 * through where the surface has worn, hairline cracks, and a darkening at the
 * bottom of anything vertical where the rain runs off.
 *
 * Low contrast throughout, and softened at the end, for the reason brick is —
 * a stair is seen at a grazing angle by definition, so anything sharp in here
 * would crawl as you climb.
 */
export function concrete(tint: string): THREE.CanvasTexture | null {
  return surface(512, (ctx, s) => {
    const rnd = seeded(0x5eed0c);
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, s, s);

    /* Broad tonal drift, so a large pour is never one value. */
    for (let i = 0; i < 22; i++) {
      const x = rnd() * s;
      const y = rnd() * s;
      const r = s * (0.12 + rnd() * 0.3);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${rnd() > 0.5 ? '0,0,0' : '255,255,255'},${0.025 + rnd() * 0.04})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }

    /* Shutter lines: where one board met the next. */
    for (let i = 0; i < 3; i++) {
      const y = (i + 0.5) * (s / 3) + (rnd() - 0.5) * 20;
      ctx.strokeStyle = `rgba(0,0,0,${0.05 + rnd() * 0.04})`;
      ctx.lineWidth = 1.6;
      wobbleLine(ctx, 0, y, s, y, rnd, 2.2);
    }

    /* Aggregate showing through, in patches rather than everywhere. */
    for (let patch = 0; patch < 6; patch++) {
      const px = rnd() * s;
      const py = rnd() * s;
      const pr = s * (0.05 + rnd() * 0.11);
      for (let i = 0; i < 420; i++) {
        const a = rnd() * Math.PI * 2;
        const d = rnd() * pr;
        const v = rnd() > 0.5 ? 0.05 : -0.05;
        ctx.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${0.04 + rnd() * 0.05})`;
        ctx.fillRect(px + Math.cos(a) * d, py + Math.sin(a) * d, 1.6, 1.6);
      }
    }

    /* Hairline cracks, and a wash at the foot. */
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.05 + rnd() * 0.05})`;
      ctx.lineWidth = 0.9;
      let x = rnd() * s;
      let y = rnd() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rnd() - 0.5) * 46;
        y += rnd() * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const foot = ctx.createLinearGradient(0, s * 0.78, 0, s);
    foot.addColorStop(0, 'rgba(0,0,0,0)');
    foot.addColorStop(1, 'rgba(0,0,0,0.1)');
    ctx.fillStyle = foot;
    ctx.fillRect(0, s * 0.78, s, s * 0.22);

    speckle(ctx, s, rnd, 1400, 0.025);
    soften(ctx, s, s, 0.8);
  });
}

/**
 * Sets a texture's tiling and sharpens it at grazing angles.
 *
 * Anisotropy matters most on the ground, which is always seen at a glancing
 * angle: without it a paved street turns to grey mush three metres ahead of
 * the player, which is exactly where they are looking.
 */
export function tile(
  tex: THREE.Texture | null,
  repeatX: number,
  repeatY: number,
  anisotropy: number
): THREE.Texture | null {
  if (!tex) return null;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A painted sign board, with lettering on it.
 *
 * The shop's fascia was a blank panel, and a blank panel over a door does not
 * read as a sign — it reads as a panel. Two words of text is the whole
 * difference between "a building" and "a shop that is called something", and
 * canvas gives it to us for nothing.
 *
 * The letterforms are deliberately loose: a hand-painted shop sign, slightly
 * uneven, on a board that has been up a long time.
 */
export function signBoard(
  text: string,
  ink: string,
  ground: string,
  sub?: string,
  /**
   * Width over height of the surface this will be shown on.
   *
   * A square canvas stretched across a 9:1 fascia squashes the type to a ninth
   * of its height, which is exactly what happened to the shop's sign — the
   * letters were drawn large and arrived thin. Drawing into a canvas of the
   * same proportions as the plane means the type is the size it looks.
   */
  aspect = 1
): THREE.CanvasTexture | null {
  return surfaceRect(1024, Math.max(64, Math.round(1024 / aspect)), (ctx, s, h) => {
    const rnd = seeded(0x516e);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, s, h);
    /* Grain and wear on the board before anything is painted on it. */
    for (let i = 0; i < 2400; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.05})`;
      ctx.fillRect(rnd() * s, rnd() * h, 1.6, 1.6);
    }
    grime(ctx, s, rnd, 9, 0.14);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    /* Sized off the *height* of the board, which is what the type has to fit. */
    ctx.font = `bold ${Math.round(h * (sub ? 0.42 : 0.62))}px Georgia, "Times New Roman", serif`;
    const mid = sub ? h * 0.36 : h * 0.5;
    const chars = [...text];
    const width = ctx.measureText(text).width;
    let x = s / 2 - width / 2;
    for (const ch of chars) {
      const w = ctx.measureText(ch).width;
      ctx.save();
      ctx.translate(x + w / 2, mid + (rnd() - 0.5) * (h * 0.02));
      ctx.rotate((rnd() - 0.5) * 0.035);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      x += w;
    }
    if (sub) {
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.8;
      ctx.font = `${Math.round(h * 0.26)}px Georgia, "Times New Roman", serif`;
      ctx.fillText(sub, s / 2, h * 0.74);
      ctx.globalAlpha = 1;
    }
    /* A border, and a little flaking. */
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 7;
    ctx.strokeRect(h * 0.06, h * 0.06, s - h * 0.12, h - h * 0.12);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(${parseInt(ground.slice(1, 3), 16)},${parseInt(ground.slice(3, 5), 16)},${parseInt(ground.slice(5, 7), 16)},${0.3 + rnd() * 0.5})`;
      ctx.fillRect(rnd() * s, rnd() * h, 2 + rnd() * 7, 2 + rnd() * 5);
    }
  });
}
