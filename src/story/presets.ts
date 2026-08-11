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
      note: 'Fair, square-jawed, stubbled',
      skin: 1,
      jaw: 0.72,
      eyeShape: 0.45,
      eyeColor: 5,
      brow: 0.62,
      nose: 0.5,
      mouth: 0.45,
      facialHair: 'stubble',
    },
    {
      label: 'Face II',
      note: 'Bronzed, even-featured, clean',
      skin: 4,
      jaw: 0.5,
      eyeShape: 0.58,
      eyeColor: 0,
      brow: 0.48,
      nose: 0.36,
      mouth: 0.5,
      facialHair: 'none',
    },
    {
      label: 'Face III',
      note: 'Deep-toned, heavy-browed, bearded',
      skin: 7,
      jaw: 0.62,
      eyeShape: 0.5,
      eyeColor: 1,
      brow: 0.78,
      nose: 0.58,
      mouth: 0.55,
      facialHair: 'full',
    },
  ],
  female: [
    {
      label: 'Face I',
      note: 'Fair, fine-boned, green-eyed',
      skin: 0,
      jaw: 0.2,
      eyeShape: 0.42,
      eyeColor: 3,
      brow: 0.28,
      nose: 0.28,
      mouth: 0.52,
      facialHair: 'none',
    },
    {
      label: 'Face II',
      note: 'Warm-toned, soft-jawed',
      skin: 3,
      jaw: 0.3,
      eyeShape: 0.55,
      eyeColor: 0,
      brow: 0.36,
      nose: 0.33,
      mouth: 0.56,
      facialHair: 'none',
    },
    {
      label: 'Face III',
      note: 'Deep-toned, high-browed',
      skin: 6,
      jaw: 0.34,
      eyeShape: 0.5,
      eyeColor: 1,
      brow: 0.44,
      nose: 0.4,
      mouth: 0.6,
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
    note: 'Fitted jacket, brass cuffs',
    outfit: 'duelist',
    primary: 10,
    secondary: 0,
    trim: 0,
    trouser: 4,
    boots: 5,
    cape: false,
    capeColor: 10,
    gauntlet: 'both',
  },
  {
    label: 'Road Warden',
    note: 'Plated chest, oxblood cape',
    outfit: 'warden',
    primary: 2,
    secondary: 4,
    trim: 3,
    trouser: 5,
    boots: 6,
    cape: true,
    capeColor: 11,
    gauntlet: 'both',
  },
  {
    label: 'Emerald Traveller',
    note: 'Long coat, split tails',
    outfit: 'traveller',
    primary: 13,
    secondary: 5,
    trim: 0,
    trouser: 1,
    boots: 6,
    cape: false,
    capeColor: 13,
    gauntlet: 'none',
  },
  {
    label: 'Midnight Scholar',
    note: 'Full robe, gold sash',
    outfit: 'scholar',
    primary: 15,
    secondary: 14,
    trim: 1,
    trouser: 4,
    boots: 5,
    cape: false,
    capeColor: 15,
    gauntlet: 'none',
  },
  {
    label: 'Street Ace',
    note: 'Short jacket, open front',
    outfit: 'street',
    primary: 22,
    secondary: 4,
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
