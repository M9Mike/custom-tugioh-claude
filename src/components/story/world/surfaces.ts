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

/** Brick, for the buildings outside. */
export function brick(base: string): THREE.CanvasTexture | null {
  return surface(512, (ctx, s) => {
    const rnd = seeded(0x5eed04);
    /* Mortar first; the bricks are laid on top with a gap left round each. */
    ctx.fillStyle = '#8d8378';
    ctx.fillRect(0, 0, s, s);
    const rows = 16;
    const h = s / rows;
    const w = h * 2.3;
    const col = new THREE.Color(base);
    for (let row = 0; row < rows; row++) {
      const y = row * h;
      const offset = (row % 2) * (w / 2);
      for (let x = -w; x < s + w; x += w) {
        const tone = 0.78 + rnd() * 0.44;
        ctx.fillStyle = `rgb(${Math.round(col.r * 255 * tone)},${Math.round(col.g * 255 * tone)},${Math.round(col.b * 255 * tone)})`;
        ctx.fillRect(x + offset + 1.4, y + 1.4, w - 2.8, h - 2.8);
      }
    }
    grime(ctx, s, rnd, 16, 0.22);
    speckle(ctx, s, rnd, 2400, 0.05);
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
  sub?: string
): THREE.CanvasTexture | null {
  return surface(512, (ctx, s) => {
    const rnd = seeded(0x516e);
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, s, s);
    /* Grain and wear on the board before anything is painted on it. */
    for (let i = 0; i < 2400; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.02 + rnd() * 0.05})`;
      ctx.fillRect(rnd() * s, rnd() * s, 1.6, 1.6);
    }
    grime(ctx, s, rnd, 9, 0.14);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.font = `bold ${sub ? 96 : 118}px Georgia, "Times New Roman", serif`;
    /* Painted by hand: every letter sits a pixel or two off the line. */
    const mid = sub ? s * 0.38 : s * 0.5;
    const chars = [...text];
    const width = ctx.measureText(text).width;
    let x = s / 2 - width / 2;
    for (const ch of chars) {
      const w = ctx.measureText(ch).width;
      ctx.save();
      ctx.translate(x + w / 2, mid + (rnd() - 0.5) * 5);
      ctx.rotate((rnd() - 0.5) * 0.035);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      x += w;
    }
    if (sub) {
      ctx.fillStyle = ink;
      ctx.globalAlpha = 0.8;
      ctx.font = '52px Georgia, "Times New Roman", serif';
      ctx.fillText(sub, s / 2, s * 0.66);
      ctx.globalAlpha = 1;
    }
    /* A border, and a little flaking. */
    ctx.strokeStyle = ink;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 7;
    ctx.strokeRect(22, 22, s - 44, s - 44);
    ctx.globalAlpha = 1;
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(${parseInt(ground.slice(1, 3), 16)},${parseInt(ground.slice(3, 5), 16)},${parseInt(ground.slice(5, 7), 16)},${0.3 + rnd() * 0.5})`;
      ctx.fillRect(rnd() * s, rnd() * s, 2 + rnd() * 7, 2 + rnd() * 5);
    }
  });
}
