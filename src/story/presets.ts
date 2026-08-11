/**
 * The booth's whole vocabulary: every duelist a player can make, as choices
 * from short lists rather than positions on sliders.
 *
 * The rich `StoryCharacter` spec still exists underneath — it is what these
 * tables are written in, what the server stores, and what NPCs are authored
 * in. What changed is who gets to hold the pen. A slider per nostril produced
 * ten thousand mediocre faces and no good ones; a face authored once, looked
 * at from six angles and kept only if it survives, produces three good ones.
 * The player picks between finished things.
 *
 * Everything here is data, so "make outfit four's coat darker" is a one-line
 * change that every duelist wearing it inherits.
 */

import {
  MAX_CHARACTER_NAME,
  type FacialHairId,
  type HairId,
  type SexId,
  type StoryCharacter,
} from './character';

/** What the booth edits: one choice per row, nothing free but the name. */
export interface CharacterPick {
  sex: SexId;
  /** Index into `FACE_PRESETS[sex]`. */
  face: number;
  /** Index into `HAIR_PRESETS[sex]`. */
  hair: number;
  /** Index into `HAIR_COLOR_CHOICES`. */
  hairColor: number;
  /** Index into `BODY_PRESETS`. */
  body: number;
  /** Index into `OUTFIT_PRESETS`. */
  outfit: number;
  /** 0 young · 1 old. The one slider left, because age is a continuum. */
  age: number;
}

/* ------------------------------------------------------------------ */
/* Faces                                                               */
/* ------------------------------------------------------------------ */

export interface FacePreset {
  label: string;
  note: string;
  skin: number;
  jaw: number;
  eyeShape: number;
  eyeColor: number;
  brow: number;
  nose: number;
  mouth: number;
  facialHair: FacialHairId;
}

/**
 * Three faces per body plan, spanning the skin palette between them.
 *
 * Skin rides with the face on purpose: a face is authored *on* its skin — the
 * brow weight that reads right on a fair face is too light on a deep one, and
 * a separate skin picker would put every face on tones it was never tuned
 * against. Three faces per sex, each kept only after being photographed on its
 * own tone from six angles.
 */
export const FACE_PRESETS: Record<SexId, FacePreset[]> = {
  male: [
    {
      label: 'Face I',
      note: 'Fair, open-eyed, stubbled',
      skin: 1,
      jaw: 0.55,
      eyeShape: 0.35,
      eyeColor: 5,
      brow: 0.68,
      nose: 0.5,
      mouth: 0.55,
      facialHair: 'stubble',
    },
    {
      label: 'Face II',
      note: 'Bronzed, sharp-eyed, clean',
      skin: 4,
      jaw: 0.45,
      eyeShape: 0.75,
      eyeColor: 0,
      brow: 0.85,
      nose: 0.45,
      mouth: 0.42,
      facialHair: 'none',
    },
    {
      label: 'Face III',
      note: 'Deep-toned, steady, bearded',
      skin: 7,
      jaw: 0.7,
      eyeShape: 0.55,
      eyeColor: 1,
      brow: 0.6,
      nose: 0.55,
      mouth: 0.5,
      facialHair: 'full',
    },
  ],
  female: [
    {
      label: 'Face I',
      note: 'Fair, wide-eyed, green',
      skin: 0,
      jaw: 0.22,
      eyeShape: 0.12,
      eyeColor: 3,
      brow: 0.25,
      nose: 0.3,
      mouth: 0.6,
      facialHair: 'none',
    },
    {
      label: 'Face II',
      note: 'Warm-toned, calm-eyed',
      skin: 3,
      jaw: 0.3,
      eyeShape: 0.4,
      eyeColor: 0,
      brow: 0.4,
      nose: 0.34,
      mouth: 0.55,
      facialHair: 'none',
    },
    {
      label: 'Face III',
      note: 'Deep-toned, sharp-eyed',
      skin: 6,
      jaw: 0.28,
      eyeShape: 0.6,
      eyeColor: 9,
      brow: 0.55,
      nose: 0.38,
      mouth: 0.52,
      facialHair: 'none',
    },
  ],
};

/* ------------------------------------------------------------------ */
/* Hair                                                                */
/* ------------------------------------------------------------------ */

export interface HairPreset {
  label: string;
  style: HairId;
}

/** Three cuts per body plan, chosen for spread: short, mid, tied. */
export const HAIR_PRESETS: Record<SexId, HairPreset[]> = {
  male: [
    { label: 'Crop', style: 'crop' },
    { label: 'Swept back', style: 'swept' },
    { label: 'Spiked', style: 'spiked' },
  ],
  female: [
    { label: 'Long', style: 'long' },
    { label: 'Ponytail', style: 'ponytail' },
    { label: 'Bun', style: 'bun' },
  ],
};

/**
 * Five colours out of the full palette: black, dark brown, chestnut, blond,
 * red. Indices into `HAIR_COLORS`, so re-tuning a swatch re-tunes everyone.
 */
export const HAIR_COLOR_CHOICES = [0, 2, 4, 6, 9] as const;

/* ------------------------------------------------------------------ */
/* Bodies                                                              */
/* ------------------------------------------------------------------ */

export interface BodyPreset {
  label: string;
  frame: StoryCharacter['frame'];
  build: number;
}

/** Slim · Balanced · Heavy. Frame and girth together, one choice. */
export const BODY_PRESETS: BodyPreset[] = [
  { label: 'Slim', frame: 'lean', build: 0.18 },
  { label: 'Balanced', frame: 'balanced', build: 0.5 },
  { label: 'Heavy', frame: 'sturdy', build: 0.92 },
];

/** Stature is part of the body plan, not a slider. */
const HEIGHT: Record<SexId, number> = { male: 0.58, female: 0.36 };

/* ------------------------------------------------------------------ */
/* Outfits                                                             */
/* ------------------------------------------------------------------ */

export interface OutfitPreset {
  label: string;
  note: string;
  outfit: StoryCharacter['outfit'];
  primary: number;
  secondary: number;
  trim: number;
  trouser: number;
  boots: number;
  cape: boolean;
  capeColor: number;
  gauntlet: StoryCharacter['gauntlet'];
}

/**
 * Five finished outfits. Nothing on them is customisable — each is one
 * authored combination of garment, colours, fittings and cape, photographed
 * all the way round before it earned its slot.
 */
export const OUTFIT_PRESETS: OutfitPreset[] = [
  {
    label: 'Crimson Duelist',
    note: 'Academy jacket, brass cuffs',
    outfit: 'duelist',
    primary: 24,
    secondary: 29,
    trim: 0,
    trouser: 4,
    boots: 5,
    cape: false,
    capeColor: 24,
    gauntlet: 'both',
  },
  {
    label: 'Road Warden',
    note: 'Silver chestplate, crimson cape',
    outfit: 'warden',
    primary: 25,
    secondary: 20,
    trim: 4,
    trouser: 5,
    boots: 6,
    cape: true,
    capeColor: 24,
    gauntlet: 'both',
  },
  {
    label: 'Emerald Traveller',
    note: 'Long coat, split tails',
    outfit: 'traveller',
    primary: 26,
    secondary: 29,
    trim: 0,
    trouser: 1,
    boots: 6,
    cape: false,
    capeColor: 26,
    gauntlet: 'none',
  },
  {
    label: 'Midnight Scholar',
    note: 'Violet robe, gold sash',
    outfit: 'scholar',
    primary: 27,
    secondary: 29,
    trim: 1,
    trouser: 4,
    boots: 5,
    cape: false,
    capeColor: 27,
    gauntlet: 'none',
  },
  {
    label: 'Street Ace',
    note: 'Short jacket, cream tee',
    outfit: 'street',
    primary: 22,
    secondary: 28,
    trim: 5,
    trouser: 2,
    boots: 4,
    cape: false,
    capeColor: 22,
    gauntlet: 'none',
  },
];

/* ------------------------------------------------------------------ */
/* Resolution                                                          */
/* ------------------------------------------------------------------ */

const at = <T,>(xs: readonly T[], i: number): T => xs[Math.max(0, Math.min(xs.length - 1, Math.floor(i)))];

/** The booth's starting point. */
export function defaultPick(): CharacterPick {
  return { sex: 'male', face: 0, hair: 1, hairColor: 1, body: 1, outfit: 0, age: 0.25 };
}

/**
 * A pick, spelled out as the full spec the renderer and the server speak.
 *
 * This is the single seam between "what the player chooses" and "what the
 * model understands", and it only ever widens: a new preset is a new row in a
 * table above, never a new code path.
 */
export function resolvePick(pick: CharacterPick, name: string): StoryCharacter {
  const face = at(FACE_PRESETS[pick.sex] ?? FACE_PRESETS.male, pick.face);
  const hair = at(HAIR_PRESETS[pick.sex] ?? HAIR_PRESETS.male, pick.hair);
  const body = at(BODY_PRESETS, pick.body);
  const outfit = at(OUTFIT_PRESETS, pick.outfit);
  return {
    name: name.slice(0, MAX_CHARACTER_NAME),
    sex: pick.sex === 'female' ? 'female' : 'male',
    frame: body.frame,
    build: body.build,
    height: HEIGHT[pick.sex] ?? HEIGHT.male,
    skin: face.skin,
    jaw: face.jaw,
    eyeShape: face.eyeShape,
    eyeColor: face.eyeColor,
    brow: face.brow,
    nose: face.nose,
    mouth: face.mouth,
    age: Math.max(0, Math.min(1, pick.age)),
    hair: hair.style,
    hairColor: at(HAIR_COLOR_CHOICES, pick.hairColor),
    facialHair: face.facialHair,
    outfit: outfit.outfit,
    primary: outfit.primary,
    secondary: outfit.secondary,
    trim: outfit.trim,
    trouser: outfit.trouser,
    boots: outfit.boots,
    cape: outfit.cape,
    capeColor: outfit.capeColor,
    gauntlet: outfit.gauntlet,
  };
}

/** A roll across everything the booth can offer — used by Surprise me. */
export function randomPick(rnd: () => number = Math.random): CharacterPick {
  const sex: SexId = rnd() < 0.5 ? 'male' : 'female';
  return {
    sex,
    face: Math.floor(rnd() * FACE_PRESETS[sex].length),
    hair: Math.floor(rnd() * HAIR_PRESETS[sex].length),
    hairColor: Math.floor(rnd() * HAIR_COLOR_CHOICES.length),
    body: Math.floor(rnd() * BODY_PRESETS.length),
    outfit: Math.floor(rnd() * OUTFIT_PRESETS.length),
    age: rnd() * 0.7,
  };
}

/**
 * A rolled duelist, resolved. The lab's seeds photograph these, so a seed
 * covers exactly the space a player (or a rolled NPC) can land in.
 */
export function randomCharacter(name: string, rnd: () => number = Math.random): StoryCharacter {
  return resolvePick(randomPick(rnd), name);
}
