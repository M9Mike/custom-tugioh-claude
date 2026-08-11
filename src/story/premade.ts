/**
 * The duelists you can be, and the record that says which one you are.
 *
 * Story Mode's characters are no longer assembled from parts — they are
 * finished, rigged, animated models, made by Quaternius and vendored under CC0
 * into `public/models/duelists/` (see the LICENSE.md beside them for exactly
 * where they came from). The player picks one, tints what the model's own
 * catalog entry says can be tinted, sets a stature, names the result — and
 * that is the whole of what is stored.
 *
 * This file is the catalog and the validation and nothing else. It knows no
 * three.js: the same module is imported by the server to sanitise what a
 * route was posted, and by the client to know what to offer and how to paint
 * it. The geometry lives in the `.glb` files; the code that turns one of
 * these records into a walking rig is `src/components/story/premadeRig.ts`.
 *
 * Tinting works on the texture, not the mesh. Each model's atlas is a painted
 * thing — brush strokes, baked shadow, a face — so a tint cannot just multiply
 * the whole image (lesson 7 on the old system's list: the skin goes with it).
 * Instead each slot declares a *window* in hue/saturation/lightness that
 * catches its garment's pixels and nothing else's, authored by looking at the
 * atlas, and repainting keeps every caught pixel's lightness so the painting
 * survives the recolour. The windows live here because they are *data about
 * the vendored file*, exactly like its height: change the file, re-check the
 * windows (`npm run premade` photographs them).
 */

import { CLOTH_COLORS, TRIM_COLORS } from './character';

/** Shown in the world menu; same budget the old booth had. */
export const MAX_PREMADE_NAME = 18;

/**
 * A tint choice that means "leave the texture exactly as Quaternius painted
 * it". Every slot offers it first and defaults to it: the vendored look is a
 * finished thing, and the only way to keep a finished thing reachable is for
 * "untouched" to be a value, not a swatch that happens to be close.
 */
export const AS_AUTHORED = -1;

/* ------------------------------------------------------------------ */
/* Windows                                                             */
/* ------------------------------------------------------------------ */

/**
 * The pixels a tint slot owns, as a box in HSL.
 *
 * `hue` is in degrees and may wrap — `[335, 15]` is the reds astride zero.
 * `sat` and `lum` are 0..1. A window is deliberately a blunt instrument: it
 * was authored by looking at the model's atlas, then checked by photographing
 * the repaint (`npm run premade`), and a window that needs to be cleverer
 * than a box is a window that is catching something it should not.
 */
export interface TintWindow {
  hue: [number, number];
  sat: [number, number];
  lum: [number, number];
}

/** HSL of an sRGB pixel, hue in degrees. The one conversion, used by the
    client repaint and the audit script alike, so they cannot disagree. */
export function hslOfRgb(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/** Is this pixel the slot's to repaint? */
export function windowCatches(w: TintWindow, h: number, s: number, l: number): boolean {
  if (s < w.sat[0] || s > w.sat[1] || l < w.lum[0] || l > w.lum[1]) return false;
  const [a, b] = w.hue;
  /* A fully desaturated window does not care what the hue claims to be —
     greys carry no hue worth trusting. */
  if (s < 0.02) return true;
  return a <= b ? h >= a && h <= b : h >= a || h <= b;
}

/* ------------------------------------------------------------------ */
/* The catalog                                                         */
/* ------------------------------------------------------------------ */

export type TintPalette = 'cloth' | 'trim';

export interface TintSlot {
  /** What the booth calls it: the garment, not the colour. */
  label: string;
  /** Which palette the choices index into — cloth for garments, trim for metal. */
  palette: TintPalette;
  window: TintWindow;
}

export interface DuelistModel {
  id: string;
  label: string;
  /** One line under the label — what you are looking at. */
  note: string;
  /** Under `public/`, so also the URL it is fetched from. */
  file: string;
  /** Standing height to scale the model to, in metres, at stature 0.5. */
  height: number;
  /**
   * Ground the Walk / Run clips cover per second at timeScale 1, in metres,
   * once the model is scaled to `height`. The rig divides real ground speed
   * by this to get the playback rate, which is the same arithmetic that kept
   * the old system's feet from sliding: one speed, both derived from it.
   * Tuned by watching the handling frames, not measured — retune if a model
   * is ever swapped.
   */
  walkSpeed: number;
  runSpeed: number;
  tintSlots: TintSlot[];
}

/**
 * Every duelist the booth offers. Six for now — the whole of the vendored
 * pack. Order is the booth's display order.
 *
 * The windows were authored against the atlases as shipped and checked by
 * `npm run premade`, which repaints every slot in every swatch and writes the
 * sheets out to be looked at. If a repaint ever catches a face, the window is
 * wrong, not the face.
 */
export const DUELIST_MODELS: DuelistModel[] = [
  {
    id: 'warrior',
    label: 'Warrior',
    note: 'Plate and tabard, longsword in hand',
    file: '/models/duelists/warrior.glb',
    height: 1.86,
    walkSpeed: 1.5,
    runSpeed: 3.4,
    tintSlots: [
      { label: 'Tabard', palette: 'cloth', window: { hue: [330, 8], sat: [0.25, 0.85], lum: [0.08, 0.65] } },
      { label: 'Plate', palette: 'trim', window: { hue: [0, 360], sat: [0, 0.13], lum: [0.18, 0.8] } },
    ],
  },
  {
    id: 'rogue',
    label: 'Rogue',
    note: 'Crimson leathers, hood and daggers',
    file: '/models/duelists/rogue.glb',
    height: 1.74,
    walkSpeed: 1.5,
    runSpeed: 3.4,
    tintSlots: [
      { label: 'Leathers', palette: 'cloth', window: { hue: [335, 9], sat: [0.15, 0.9], lum: [0.06, 0.55] } },
      { label: 'Hood', palette: 'cloth', window: { hue: [12, 45], sat: [0.1, 0.28], lum: [0.1, 0.32] } },
    ],
  },
  {
    id: 'ranger',
    label: 'Ranger',
    note: 'Hooded cloak, tunic and a bow',
    file: '/models/duelists/ranger.glb',
    height: 1.8,
    walkSpeed: 1.5,
    runSpeed: 3.4,
    tintSlots: [
      { label: 'Tunic', palette: 'cloth', window: { hue: [130, 185], sat: [0.05, 0.3], lum: [0.1, 0.35] } },
      { label: 'Cloak', palette: 'cloth', window: { hue: [75, 128], sat: [0.05, 0.35], lum: [0.08, 0.35] } },
    ],
  },
  {
    id: 'wizard',
    label: 'Wizard',
    note: 'Long robe, longer beard, pointed hat',
    file: '/models/duelists/wizard.glb',
    height: 1.82,
    walkSpeed: 1.5,
    runSpeed: 3.4,
    tintSlots: [
      { label: 'Robe', palette: 'cloth', window: { hue: [198, 252], sat: [0.2, 0.8], lum: [0.1, 0.7] } },
      { label: 'Trim', palette: 'trim', window: { hue: [36, 58], sat: [0.35, 0.9], lum: [0.25, 0.75] } },
    ],
  },
  {
    id: 'monk',
    label: 'Monk',
    note: 'Travelling robe and sash, bare fists',
    file: '/models/duelists/monk.glb',
    height: 1.78,
    walkSpeed: 1.5,
    runSpeed: 3.4,
    tintSlots: [
      { label: 'Robe', palette: 'cloth', window: { hue: [22, 46], sat: [0.22, 0.6], lum: [0.14, 0.38] } },
      { label: 'Sash', palette: 'cloth', window: { hue: [32, 48], sat: [0.2, 0.45], lum: [0.38, 0.55] } },
    ],
  },
  {
    id: 'cleric',
    label: 'Cleric',
    note: 'Vestments, white beard and a staff',
    file: '/models/duelists/cleric.glb',
    height: 1.76,
    walkSpeed: 1.5,
    runSpeed: 3.4,
    tintSlots: [
      { label: 'Vestment', palette: 'cloth', window: { hue: [40, 80], sat: [0.03, 0.14], lum: [0.28, 0.62] } },
      { label: 'Cloak', palette: 'cloth', window: { hue: [20, 42], sat: [0.1, 0.35], lum: [0.12, 0.34] } },
    ],
  },
];

export function modelById(id: unknown): DuelistModel {
  return DUELIST_MODELS.find((m) => m.id === id) ?? DUELIST_MODELS[0];
}

/** The swatches a slot's choices index into. */
export function paletteFor(slot: TintSlot): readonly string[] {
  return slot.palette === 'trim' ? TRIM_COLORS : CLOTH_COLORS;
}

/* ------------------------------------------------------------------ */
/* The record                                                          */
/* ------------------------------------------------------------------ */

/**
 * A bound duelist, whole. Written once by the booth, stored for good, read by
 * every renderer — so, like the record it replaces, it is flat, small and
 * validatable: an id into the catalog, palette indices (or `AS_AUTHORED`) per
 * tint slot, one 0..1 knob, a name.
 */
export interface PremadeCharacter {
  name: string;
  /** Which catalog entry. An unknown id falls back to the first model. */
  model: string;
  /**
   * One choice per tint slot of the model, in the model's slot order:
   * `AS_AUTHORED`, or an index into that slot's palette.
   */
  tints: number[];
  /** 0 short · 1 tall, around the model's own height. */
  stature: number;
}

/** How far the stature knob takes the model's height, as a multiplier. */
export const STATURE_RANGE: [number, number] = [0.93, 1.07];

export function statureScale(stature: number): number {
  const t = Math.max(0, Math.min(1, stature));
  return STATURE_RANGE[0] + (STATURE_RANGE[1] - STATURE_RANGE[0]) * t;
}

export function defaultPremade(name: string): PremadeCharacter {
  const model = DUELIST_MODELS[0];
  return {
    name: name.slice(0, MAX_PREMADE_NAME),
    model: model.id,
    tints: model.tintSlots.map(() => AS_AUTHORED),
    stature: 0.5,
  };
}

/** A roll across everything the booth offers — used by Surprise me. */
export function randomPremade(name: string, rnd: () => number = Math.random): PremadeCharacter {
  const model = DUELIST_MODELS[Math.floor(rnd() * DUELIST_MODELS.length)];
  return {
    name: name.slice(0, MAX_PREMADE_NAME),
    model: model.id,
    /* A third of rolls keep a slot as authored: the vendored looks are part
       of the space, and a roll that can never land on them says they are not. */
    tints: model.tintSlots.map((slot) =>
      rnd() < 0.34 ? AS_AUTHORED : Math.floor(rnd() * paletteFor(slot).length)
    ),
    stature: 0.2 + rnd() * 0.6,
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const clamp01 = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return n < 0 ? 0 : n > 1 ? 1 : n;
};

/**
 * What a profile written before the swap looked like, as much of it as the
 * mapping below needs. The old records are procedural-spec characters; they
 * cannot be drawn any more, but the people they belong to still exist, so a
 * loaded one is seated on the nearest model rather than erased. The mapping
 * is arbitrary — an outfit is not a class — but it is *stable*, which is the
 * only property it needs: the same old save maps to the same duelist every
 * time it is read.
 */
const LEGACY_OUTFIT_TO_MODEL: Record<string, string> = {
  duelist: 'rogue',
  traveller: 'ranger',
  scholar: 'wizard',
  warden: 'warrior',
  street: 'monk',
};

/**
 * Coerces anything at all into a duelist we are willing to store and draw.
 *
 * Same contract as the old `normaliseCharacter`, for the same reason: the
 * booth is the only screen that should produce one of these, but it posts
 * JSON, and a character can only be created once — so a malformed field costs
 * the field, never the run. Also the seam where a pre-swap save is seated on
 * a model: `loadProfile` runs every stored character through here, so nothing
 * downstream ever meets the old shape.
 */
export function normalisePremade(raw: unknown, username: string): PremadeCharacter {
  const d = defaultPremade(username);
  const c = (raw ?? {}) as Record<string, unknown>;
  const name = typeof c.name === 'string' ? c.name.trim().slice(0, MAX_PREMADE_NAME) : '';

  /* A pre-swap record: no model id, but the old spec's fields. Seat it. */
  if (typeof c.model !== 'string' && (typeof c.outfit === 'string' || typeof c.sex === 'string')) {
    const model = modelById(LEGACY_OUTFIT_TO_MODEL[c.outfit as string]);
    return {
      name: name || d.name,
      model: model.id,
      tints: model.tintSlots.map(() => AS_AUTHORED),
      /* The one old knob with a direct heir. */
      stature: clamp01(c.height, 0.5),
    };
  }

  const model = modelById(c.model);
  const rawTints = Array.isArray(c.tints) ? c.tints : [];
  return {
    name: name || d.name,
    model: model.id,
    tints: model.tintSlots.map((slot, i) => {
      const v = rawTints[i];
      /* `Number.isInteger`, not rounding: a value that is not an index at all
         must fall back to "as authored", never quietly land on a swatch
         nobody chose. */
      if (typeof v !== 'number' || !Number.isInteger(v)) return AS_AUTHORED;
      return v >= 0 && v < paletteFor(slot).length ? v : AS_AUTHORED;
    }),
    stature: clamp01(c.stature, d.stature),
  };
}
