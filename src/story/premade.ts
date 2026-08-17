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

/**
 * A recolourable region of a model's *texture*, for models that have one.
 *
 * The vendored roster paints each garment as its own flat-colour material, so
 * a `TintSlot` can just name materials. The imported bodies carry their whole
 * look in one 256×256 image, so there is no `Jacket` to repaint — what there is
 * is a block of pixels around one hue. This names that block by the colour it
 * currently is, and the rig repaints everything within reach of it.
 *
 * A hue family is often a whole outfit rather than one garment: these
 * characters wear blue uniforms where the jacket and the trousers are the same
 * blue. So the labels are honest about that — `Outfit`, `Hair`, `Trim` —
 * rather than claiming a precision the data does not have.
 *
 * Where the same hue *is* two different things at two different lightnesses —
 * dark hair over a pale top — the `lightness` window separates them, and the
 * booth offers both. Where it cannot, the booth offers one swatch rather than
 * two that repaint each other's garment. Every number here is transcribed from
 * `npm run palette`, which picks the regions and reports their windows.
 */
export interface TextureTint {
  label: string;
  palette: TintPalette;
  /** What that region is painted now. Everything near this hue moves with it. */
  from: string;
  /**
   * The band of lightness the region lives in, 0 black to 1 white.
   *
   * Only needed when a body wears the same hue twice. Mai's model is painted
   * with three blue-ish things a few degrees apart — dark hair, a pale top,
   * light trousers — and a rule that names only the hue takes all three, so the
   * hair cannot be recoloured without the trousers going with it. Naming the
   * band the hair sits in separates them. Omit it whenever the hue is
   * unambiguous, which is most of the time.
   */
  lightness?: readonly [number, number];
}

/**
 * A colour-to-colour instruction for an authored character.
 *
 * The bare string is the common case — "everything this colour becomes that
 * colour". The long form adds the same lightness window a tint slot can carry,
 * for a body that wears one hue in two places.
 */
export type RepaintRule = string | { to: string; lightness: readonly [number, number] };

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
   *
   * Absent on a `sculpt`, and absent rather than zero on purpose: there is no
   * Walk clip to rate, so any number written here would be a fact about
   * nothing. The rig never reads them for those models.
   */
  walkSpeed?: number;
  runSpeed?: number;
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
  /**
   * A single static mesh with no skeleton, no skin and no clips.
   *
   * The rigged models are the assumption everywhere else in Story Mode; this
   * flag is how a reader finds out that assumption does not hold here without
   * having to open the `.glb`. A sculpt stands exactly as it was modelled — it
   * can be placed, scaled, turned to face the player and talked to, and it
   * cannot walk, run or breathe.
   *
   * It is a fact about the file rather than a switch: `premadeRig` decides
   * what to do by looking for an `Idle` clip, so nothing breaks if this is
   * wrong. It is here so that `walkSpeed` being missing reads as deliberate,
   * and so the day somebody rigs these there is one word per entry to delete.
   */
  sculpt?: boolean;
  /**
   * What this character's skin is painted, taken from what their *face* texture
   * is mostly made of.
   *
   * Recorded so it can be protected. Recolouring works by hue, and a hue window
   * wide enough to catch a brown jacket is wide enough to catch a hand — so
   * anything this close to the skin colour is left alone, whatever the player
   * picked. The old roster got this for free by forbidding slots from naming
   * `Skin`; a texture has no material names to forbid, so it is a value here
   * instead.
   */
  skin?: string;
  /** Recolourable regions of the texture, for models that carry one. */
  textureTints?: TextureTint[];
}

/**
 * Every duelist the booth offers: six men and six women from the Ultimate
 * Modular packs. Order is the booth's display order. The slot material lists
 * were authored by reading each file's material inventory (`npm run premade`
 * prints it) against the pack's preview renders; the handling run photographs
 * every one of them in the booth, which is where a wrong name shows.
 */
export const DUELIST_MODELS: DuelistModel[] = [
  /* ---------------------------------------------------------------- *
   * The whole cast, and it is six people.                             *
   *                                                                   *
   * This file used to hold thirty-nine entries: twelve Quaternius      *
   * bodies, fifteen townspeople converted from a 3DS rip, eight        *
   * sculpts and four named duelists. They are gone, and what is left   *
   * is the six characters that are actually finished.                  *
   *                                                                   *
   * The test each one passed is the same: it is rigged, it carries     *
   * Idle, Walk and Run, and it has been looked at a frame at a time at *
   * full resolution. Nothing here is a costume built out of a generic  *
   * body, and nothing here is a static sculpt sliding across the       *
   * ground in a fixed pose. Both of those were tried and both were     *
   * worse than having fewer characters.                                *
   *                                                                   *
   * Everybody else comes back one at a time, rigged at source, through *
   * `npm run rigged`. That is the door now — see the header of         *
   * `scripts/import-rigged.mjs` for why fitting one skeleton to many   *
   * characters cannot work on models that are each posed individually. *
   * ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- *
   * The duelists you can be.                                          *
   *                                                                   *
   * The entries without `npcOnly`, which is what makes them — and only *
   * them — the booth's roster. Two, added one at a time, each checked  *
   * a frame at a time before it landed.                                *
   *                                                                   *
   * They are why the booth has no knobs on it. The nine townspeople she  *
   * replaced each carried their look in one 256x256 atlas, so the      *
   * booth offered hue-windowed repaints of "Outfit", "Hair" and "Trim" *
   * and a stature slider, and a player assembled somebody out of them. *
   * These are finished characters. There is nothing to recolour that   *
   * would not be vandalism, so the booth asks for a name and stops.     *
   * ---------------------------------------------------------------- */
  {
    /*
     * A second duelist, and the reason the booth is a list rather than a label.
     *
     * 1.90 m, the tallest of the roster, because he is drawn as a slab of a man
     * and a big character at everybody else's height stops being one. His clips
     * were measured at his modelled 1.70 and scaled to it, which is why his walk
     * is the fastest here — a long stride at a long leg.
     */
    id: 'robert',
    label: 'Robert Barathion',
    note: 'Black leather, longsword',
    file: '/models/players/robert.glb',
    height: 1.9,
    walkSpeed: 2.34,
    runSpeed: 5.4,
    tintSlots: [],
  },
  {
    id: 'sandra-afrika',
    label: 'Sandra Afrika',
    note: 'Red dress, street duelist',
    file: '/models/players/sandra-afrika.glb',
    height: 1.72,
    /* Her own, measured by `scripts/blender/gait.py` at the height she is
       rendered at. Never copied from another character: the bundles are
       authored at whatever cadence they were authored at, and an inherited
       number is exactly how feet start sliding. */
    walkSpeed: 2.16,
    runSpeed: 4.33,
    tintSlots: [],
  },

  /* ---------------------------------------------------------------- *
   * The cast.                                                         *
   *                                                                   *
   * Not options - people. Four of them are converted from the          *
   * character rips of Yu-Gi-Oh! Duel Monsters: Saikyo Card Battle      *
   * (3DS) by `npm run import-rip`, and carry that game's own Idle,     *
   * Walk and Run. Only Yami was playable there, so only Yami has a     *
   * gait of his own; the other three borrow his, rotation only, which  *
   * keeps each of them their own build.                                *
   *                                                                   *
   * Mai is the first character rigged at source, and the template for  *
   * every one that follows.                                            *
   *                                                                   *
   * Heights are the characters' own. Yugi is famously the shortest     *
   * person in the room and Kaiba the tallest, and at a shared height   *
   * they lose most of what makes them recognisable at a distance.      *
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
  {
    /*
     * Grandpa Muto, and the reason the booth's costume machinery is gone.
     *
     * He used to be an ordinary adult off the generic roster, repainted grey,
     * with a bandana and a beard generated in `accessories.ts` and a
     * barrel-chested `build` to make a slim young man read as a stout old one.
     * All of that came off when he arrived modelled: it was a set of
     * instructions for a texture and a skeleton he no longer has.
     *
     * 1.60 m, the shortest of the seven, because he should not tower over the
     * person he is welcoming. His clips were measured at his modelled 1.70 and
     * scaled down to it.
     */
    id: 'solomon',
    label: 'Solomon Muto',
    note: 'Kame Game Shop, orange bandana',
    file: '/models/cast/solomon.glb',
    height: 1.6,
    walkSpeed: 1.55,
    runSpeed: 3.63,
    tintSlots: [],
    npcOnly: true,
  },
  {
    id: 'mai',
    label: 'Mai Valentine',
    note: 'Purple jacket, blonde',
    file: '/models/cast/mai.glb',
    height: 1.72,
    /* Measured off her own clips, scaled to the height she is rendered at. */
    walkSpeed: 1.88,
    runSpeed: 4.16,
    tintSlots: [],
    npcOnly: true,
  },
];

/** What the booth may offer: everything that is not somebody in particular. */
export const BOOTH_MODELS: DuelistModel[] = DUELIST_MODELS.filter((m) => !m.npcOnly);

/**
 * A model a *player* may be.
 *
 * Anything else — a named character, a child, a retired roster body — is seated
 * on the first booth model instead. Stored records outlive catalogs: a save
 * written before the import names `punk`, and `punk` is Grandpa's body now.
 * Nobody should open their character and find they are somebody else's
 * grandfather.
 */
export function playerModelById(id: unknown): DuelistModel {
  const found = BOOTH_MODELS.find((m) => m.id === id);
  return found ?? BOOTH_MODELS[0];
}

/**
 * The recolourable slots of a model, whichever kind it carries.
 *
 * Two mechanisms, one question. The vendored roster recolours named materials;
 * the imported bodies recolour regions of a texture. Everything above this line
 * — the booth's swatch rows, the randomiser, the validator, the stored `tints`
 * array — only ever needs "how many choices, and which palette each", which is
 * the same for both. Keeping that in one function is what stops the booth from
 * offering a slot the rig will not paint.
 */
export function slotsFor(model: DuelistModel): { label: string; palette: TintPalette }[] {
  return model.textureTints?.length ? model.textureTints : model.tintSlots;
}

export function modelById(id: unknown): DuelistModel {
  return DUELIST_MODELS.find((m) => m.id === id) ?? DUELIST_MODELS[0];
}

/** The swatches a slot's choices index into. */
export function paletteFor(slot: { palette: TintPalette }): readonly string[] {
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
  const model = BOOTH_MODELS[0];
  return {
    name: name.slice(0, MAX_PREMADE_NAME),
    model: model.id,
    tints: model.tintSlots.map(() => AS_AUTHORED),
    stature: 0.5,
  };
}

/** A roll across everything the booth offers — used by Surprise me. */
export function randomPremade(name: string, rnd: () => number = Math.random): PremadeCharacter {
  const model = BOOTH_MODELS[Math.floor(rnd() * BOOTH_MODELS.length)];
  return {
    name: name.slice(0, MAX_PREMADE_NAME),
    model: model.id,
    /* A third of rolls keep a slot as authored: the vendored looks are part
       of the space, and a roll that can never land on them says they are not. */
    tints: slotsFor(model).map((slot) =>
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
/**
 * Where a pre-import save lands.
 *
 * These used to name the vendored roster, which the booth no longer offers —
 * a player cannot be a punk any more, because the punk is Grandpa now. Each
 * old outfit is seated on the nearest thing a player *can* be, so an existing
 * save opens as somebody plausible rather than as somebody they could never
 * have made.
 */
const LEGACY_OUTFIT_TO_MODEL: Record<string, string> = {
  duelist: 'rookie',
  traveller: 'man1',
  scholar: 'woman1',
  warden: 'man2',
  street: 'student1',
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
    const model = playerModelById(LEGACY_OUTFIT_TO_MODEL[c.outfit as string]);
    return {
      name: name || d.name,
      model: model.id,
      tints: slotsFor(model).map(() => AS_AUTHORED),
      /* The one old knob with a direct heir. */
      stature: clamp01(c.height, 0.5),
    };
  }

  const model = playerModelById(c.model);
  const rawTints = Array.isArray(c.tints) ? c.tints : [];
  return {
    name: name || d.name,
    model: model.id,
    tints: slotsFor(model).map((slot, i) => {
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
