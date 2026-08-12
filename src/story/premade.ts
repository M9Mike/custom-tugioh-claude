/**
 * The duelists you can be, and the record that says which one you are.
 *
 * Story Mode's characters are no longer assembled from parts — they are
 * finished, rigged, animated models, made by Quaternius and vendored under CC0
 * into `public/models/duelists/` (see the LICENSE.md beside them for exactly
 * where they came from and what was trimmed). The player picks one, tints
 * what the model's own catalog entry says can be tinted, sets a stature,
 * names the result — and that is the whole of what is stored.
 *
 * This file is the catalog and the validation and nothing else. It knows no
 * three.js: the same module is imported by the server to sanitise what a
 * route was posted, and by the client to know what to offer and how to paint
 * it. The geometry lives in the `.glb` files; the code that turns one of
 * these records into a walking rig is `src/components/story/premadeRig.ts`.
 *
 * Tinting works on materials, not meshes and not textures. These models carry
 * no texture at all — every part is a named flat-colour material (`Suit`,
 * `Tie`, `Hair`, `Skin`, `Eye`…) — so a tint slot simply names the materials
 * it owns and the rig recolours exactly those. Skin and faces are safe *by
 * construction*: `Skin`, `Eye` and `Eyebrows` are materials no slot is
 * allowed to name, so the failure mode the old atlas windows guarded against
 * cannot be expressed. The slot lists are data about the vendored file,
 * exactly like its height: swap the file, re-check the names (`npm run
 * premade` asserts every named material exists).
 */

import { CLOTH_COLORS, HAIR_COLORS, TRIM_COLORS } from './character';

/** Shown in the world menu; same budget the old booth had. */
export const MAX_PREMADE_NAME = 18;

/**
 * A tint choice that means "leave the material exactly as Quaternius coloured
 * it". Every slot offers it first and defaults to it: the vendored look is a
 * finished thing, and the only way to keep a finished thing reachable is for
 * "untouched" to be a value, not a swatch that happens to be close.
 */
export const AS_AUTHORED = -1;

/** Materials no slot may ever name. The face is not a garment. */
export const UNTINTABLE = ['Skin', 'Eye', 'Eyebrows'] as const;

/* ------------------------------------------------------------------ */
/* The catalog                                                         */
/* ------------------------------------------------------------------ */

export type TintPalette = 'cloth' | 'trim' | 'hair';

export interface TintSlot {
  /** What the booth calls it: the garment, not the colour. */
  label: string;
  /** Which palette the choices index into. */
  palette: TintPalette;
  /** The material names this slot recolours, exactly as the file spells them. */
  materials: string[];
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
   * Ground the Walk / Run clips cover per second at playback rate 1, in
   * metres, once the model is scaled to `height`. The rig divides real ground
   * speed by this to get the playback rate — one speed, both derived from it,
   * which is what keeps the feet from sliding. Tuned by watching the handling
   * frames, not measured — retune if a model is ever swapped.
   */
  walkSpeed: number;
  runSpeed: number;
  tintSlots: TintSlot[];
  /**
   * A named character rather than an option: in the catalog so the world can
   * build one, out of the booth so nobody can pick it.
   *
   * These are the imported models — real characters, with faces and textures
   * instead of flat tintable materials, converted by `npm run import-rip`.
   * They carry no tint slots because there is nothing about them a player
   * should be recolouring; they already look like who they are.
   */
  npcOnly?: boolean;
}

/**
 * Every duelist the booth offers: six men and six women from the Ultimate
 * Modular packs. Order is the booth's display order. The slot material lists
 * were authored by reading each file's material inventory (`npm run premade`
 * prints it) against the pack's preview renders; the handling run photographs
 * every one of them in the booth, which is where a wrong name shows.
 */
export const DUELIST_MODELS: DuelistModel[] = [
  {
    id: 'punk',
    label: 'Punk',
    note: 'Torn vest, mohawk, earrings',
    file: '/models/duelists/m_punk.glb',
    height: 1.85,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Vest', palette: 'cloth', materials: ['Black'] },
      { label: 'Jeans', palette: 'cloth', materials: ['LightBlue'] },
      { label: 'Hair', palette: 'hair', materials: ['Red', 'Red_Dark'] },
    ],
  },
  {
    id: 'suit',
    label: 'Suit',
    note: 'Two-piece suit and tie',
    file: '/models/duelists/m_suit.glb',
    height: 1.8,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Suit', palette: 'cloth', materials: ['Suit'] },
      { label: 'Tie', palette: 'cloth', materials: ['Tie'] },
      { label: 'Hair', palette: 'hair', materials: ['Hair'] },
    ],
  },
  {
    id: 'hoodie',
    label: 'Hoodie',
    note: 'Hoodie over a tee',
    file: '/models/duelists/m_hoodie.glb',
    height: 1.8,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Hoodie', palette: 'cloth', materials: ['Purple'] },
      { label: 'Shirt', palette: 'cloth', materials: ['White'] },
      { label: 'Hair', palette: 'hair', materials: ['Hair'] },
    ],
  },
  {
    id: 'adventurer',
    label: 'Adventurer',
    note: 'Field jacket and bedroll pack',
    file: '/models/duelists/m_adventurer.glb',
    height: 1.8,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Jacket', palette: 'cloth', materials: ['Green', 'LightGreen'] },
      { label: 'Pack', palette: 'cloth', materials: ['Brown', 'Brown2'] },
      { label: 'Hair', palette: 'hair', materials: ['Hair'] },
    ],
  },
  {
    id: 'king',
    label: 'King',
    note: 'Crown, pauldrons and a robe',
    file: '/models/duelists/m_king.glb',
    height: 1.84,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Robe', palette: 'cloth', materials: ['Blue'] },
      { label: 'Armour', palette: 'trim', materials: ['Metal', 'Metal_Dark'] },
      { label: 'Crown', palette: 'trim', materials: ['Gold'] },
    ],
  },
  {
    id: 'astronaut',
    label: 'Astronaut',
    note: 'Sealed suit, tinted visor',
    file: '/models/duelists/m_spacesuit.glb',
    height: 1.82,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Suit', palette: 'cloth', materials: ['SciFi_Main', 'SciFi_MainDark'] },
      { label: 'Panels', palette: 'cloth', materials: ['SciFi_Light', 'SciFi_Light_Accent'] },
      { label: 'Visor', palette: 'trim', materials: ['Grey'] },
    ],
  },
  {
    id: 'wanderer',
    label: 'Wanderer',
    note: 'Hood, blade and road gear',
    file: '/models/duelists/w_medieval.glb',
    height: 1.8,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Hood', palette: 'cloth', materials: ['DarkBrown'] },
      { label: 'Tunic', palette: 'cloth', materials: ['LightBrown', 'Brown'] },
      { label: 'Armour', palette: 'trim', materials: ['Metal', 'Metal_Dark'] },
    ],
  },
  {
    id: 'witch',
    label: 'Witch',
    note: 'Wide hat, gold-trimmed robe',
    file: '/models/duelists/w_witch.glb',
    height: 1.95,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Robe', palette: 'cloth', materials: ['Purple'] },
      { label: 'Trim', palette: 'trim', materials: ['Gold'] },
      { label: 'Hair', palette: 'hair', materials: ['Hair_Black'] },
    ],
  },
  {
    id: 'rebel',
    label: 'Rebel',
    note: 'Crop top, torn trousers, mohawk',
    file: '/models/duelists/w_punk.glb',
    height: 1.84,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Outfit', palette: 'cloth', materials: ['Black'] },
      { label: 'Boots', palette: 'cloth', materials: ['Brown'] },
      { label: 'Hair', palette: 'hair', materials: ['Pink'] },
    ],
  },
  {
    id: 'executive',
    label: 'Executive',
    note: 'Sharp jacket over a blouse',
    file: '/models/duelists/w_formal.glb',
    height: 1.78,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Jacket', palette: 'cloth', materials: ['Red'] },
      { label: 'Blouse', palette: 'cloth', materials: ['LimeGreen'] },
      { label: 'Trim', palette: 'trim', materials: ['Gold'] },
    ],
  },
  {
    id: 'pilot',
    label: 'Pilot',
    note: 'Flight suit with hard plating',
    file: '/models/duelists/w_scifi.glb',
    height: 1.79,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Suit', palette: 'cloth', materials: ['Blue', 'LightBlue'] },
      { label: 'Under-layer', palette: 'cloth', materials: ['Black'] },
      { label: 'Hair', palette: 'hair', materials: ['Hair_Black'] },
    ],
  },
  {
    id: 'casual',
    label: 'Casual',
    note: 'Tee and everyday trousers',
    file: '/models/duelists/w_casual.glb',
    height: 1.78,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [
      { label: 'Top', palette: 'cloth', materials: ['White'] },
      { label: 'Trousers', palette: 'cloth', materials: ['Orange'] },
      { label: 'Hair', palette: 'hair', materials: ['Hair_Blond', 'Hair_Brown'] },
    ],
  },
  /* ---------------------------------------------------------------- *
   * The cast.                                                         *
   *                                                                   *
   * Not options — people. These are converted from the character rips *
   * of Yu-Gi-Oh! Duel Monsters: Saikyo Card Battle (3DS) by           *
   * `npm run import-rip`, which turns the SMD set into one `.glb`     *
   * carrying Idle, Walk and Run. They are textured rather than        *
   * flat-shaded, so they have no tint slots and nothing about them is *
   * for the player to change.                                         *
   *                                                                   *
   * Only Yami was playable in the source game, so only Yami has a     *
   * walk and a run of his own; the other three borrow his, rotation   *
   * only, which keeps each of them their own build. Heights are the   *
   * characters' own — Yugi is famously the shortest person in the     *
   * room and Kaiba the tallest, and at a shared height they lose most *
   * of what makes them recognisable at a distance.                    *
   * ---------------------------------------------------------------- */
  {
    id: 'yugi',
    label: 'Yugi Muto',
    note: 'Domino High uniform',
    file: '/models/duelists/yugi.glb',
    height: 1.53,
    walkSpeed: 1.35,
    runSpeed: 3.1,
    tintSlots: [],
    npcOnly: true,
  },
  {
    id: 'yami',
    label: 'Yami Yugi',
    note: 'The Pharaoh',
    file: '/models/duelists/yami.glb',
    height: 1.75,
    walkSpeed: 1.5,
    runSpeed: 3.4,
    tintSlots: [],
    npcOnly: true,
  },
  {
    id: 'kaiba',
    label: 'Seto Kaiba',
    note: 'White coat, Kaiba Corp',
    file: '/models/duelists/kaiba.glb',
    height: 1.86,
    walkSpeed: 1.6,
    runSpeed: 3.6,
    tintSlots: [],
    npcOnly: true,
  },
  {
    id: 'joey',
    label: 'Joey Wheeler',
    note: 'Green jacket, blond',
    file: '/models/duelists/joey.glb',
    height: 1.78,
    walkSpeed: 1.55,
    runSpeed: 3.5,
    tintSlots: [],
    npcOnly: true,
  },
];

/** What the booth may offer: everything that is not somebody in particular. */
export const BOOTH_MODELS: DuelistModel[] = DUELIST_MODELS.filter((m) => !m.npcOnly);

export function modelById(id: unknown): DuelistModel {
  return DUELIST_MODELS.find((m) => m.id === id) ?? DUELIST_MODELS[0];
}

/** The swatches a slot's choices index into. */
export function paletteFor(slot: TintSlot): readonly string[] {
  if (slot.palette === 'trim') return TRIM_COLORS;
  if (slot.palette === 'hair') return HAIR_COLORS;
  return CLOTH_COLORS;
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
 * What a profile written before the model swap looked like, as much of it as
 * the mapping below needs. The old records are procedural-spec characters;
 * they cannot be drawn any more, but the people they belong to still exist,
 * so a loaded one is seated on the nearest model rather than erased. The
 * mapping is arbitrary — an outfit is not a person — but it is *stable*,
 * which is the only property it needs: the same old save maps to the same
 * duelist every time it is read.
 */
const LEGACY_OUTFIT_TO_MODEL: Record<string, string> = {
  duelist: 'suit',
  traveller: 'adventurer',
  scholar: 'witch',
  warden: 'wanderer',
  street: 'hoodie',
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
