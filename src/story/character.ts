/**
 * The duelist you play as in Story Mode.
 *
 * Deliberately a small, flat, *validatable* record rather than a bag of
 * three.js objects: it is written once, stored on the server for good, and read
 * back by two entirely different renderers (the creation booth and the open
 * world). Every field is either a number in 0..1 or an index/id into one of the
 * palettes below, so the server can sanitise a whole character without knowing
 * anything about how it is drawn — see `normaliseCharacter`.
 *
 * Everything a slider can move is a 0..1 knob. The renderer decides what that
 * means in centimetres; the stored character never has to change if the model
 * gains a limb.
 */

export interface StoryCharacter {
  /** Shown in the open-world menu. Defaults to the player's username. */
  name: string;
  /** Skeleton proportions: shoulder-to-hip ratio, waist, chest. */
  frame: FrameId;
  /** 0 slight · 1 heavy-set. */
  build: number;
  /** 0 short · 1 tall. */
  height: number;
  skin: number;
  /** 0 narrow, tapered jaw · 1 square, heavy jaw. */
  jaw: number;
  /** 0 wide and round · 1 narrow and sharp. */
  eyeShape: number;
  eyeColor: number;
  /** 0 barely there · 1 heavy. */
  brow: number;
  /** 0 small and straight · 1 large and hooked. */
  nose: number;
  /** 0 small · 1 wide. */
  mouth: number;
  /** 0 clean · 1 weathered — creases, shadow under the cheekbones. */
  age: number;
  hair: HairId;
  hairColor: number;
  facialHair: FacialHairId;
  outfit: OutfitId;
  /** The garment's main colour. */
  primary: number;
  /** Sleeves, panels, the inside of a coat. */
  secondary: number;
  /** Buckles, studs, the collar's edge. Metals only. */
  trim: number;
  trouser: number;
  boots: number;
  cape: boolean;
  capeColor: number;
  gauntlet: GauntletId;
}

/* ------------------------------------------------------------------ */
/* Palettes                                                            */
/*                                                                     */
/* Stored as indices, not hex. A character written today keeps meaning  */
/* the same thing if a swatch is ever re-tuned, and a corrupt or        */
/* hostile value can only ever be out of range — never arbitrary CSS.   */
/* ------------------------------------------------------------------ */

export const SKIN_TONES = [
  '#f6d5bd', '#f0c4a4', '#e2ab86', '#cf9068', '#b87950', '#9a6039',
  '#7d4a2b', '#5f3720', '#472819', '#f7ded0', '#d9a882', '#8b5a37',
] as const;

export const HAIR_COLORS = [
  '#1a1512', '#2e2119', '#4a3226', '#6d4a2f', '#8a6134', '#b08344',
  '#d3b06a', '#e8d9a8', '#8c2f22', '#c1502e', '#7a7a80', '#cfcfd4',
  '#2b3f6b', '#5b3070', '#1f5c4a', '#8f1f45',
] as const;

export const EYE_COLORS = [
  '#3d2b1d', '#5a3a20', '#7c5a2a', '#3f6b45', '#2f7d7a',
  '#2f5f9e', '#5a4b8f', '#8a2f3a', '#6e6e78', '#b08a2a',
] as const;

/** Cloth. Muted and slightly desaturated, to sit beside the arena's palette. */
export const CLOTH_COLORS = [
  '#1b2029', '#232b38', '#2f3a4a', '#3d4a5e', '#14181f', '#2a2320',
  '#3d2e26', '#5a3f2e', '#6d5320', '#8a6134', '#93313a', '#6b1f28',
  '#2f7d7a', '#1f5c4a', '#6a4b8f', '#43304f', '#4a5a2e', '#7a7060',
  '#cfc6b0', '#e8dfc9', '#8c8f96', '#5c6068', '#d2673a', '#a83b6b',
] as const;

/** Metals only — buckles, studs, the edge of a collar. */
export const TRIM_COLORS = [
  '#c2a15a', '#e6c980', '#8a723d', '#b8b3a8', '#d8d4c8', '#6f7378',
  '#8c5a3a', '#c87f4a', '#3f9c8f', '#93313a',
] as const;

export type FrameId = 'lean' | 'balanced' | 'sturdy';
export type HairId =
  | 'shaved' | 'crop' | 'swept' | 'spiked' | 'curtain' | 'wild'
  | 'long' | 'ponytail' | 'topknot' | 'braids' | 'mohawk' | 'bun';
export type FacialHairId = 'none' | 'stubble' | 'moustache' | 'goatee' | 'full' | 'sideburns';
export type OutfitId = 'duelist' | 'traveller' | 'scholar' | 'warden' | 'street';
export type GauntletId = 'none' | 'left' | 'right' | 'both';

export const FRAMES: { id: FrameId; label: string; note: string }[] = [
  { id: 'lean', label: 'Lean', note: 'Narrow shoulders, light through the chest' },
  { id: 'balanced', label: 'Balanced', note: 'Even shoulders and hips' },
  { id: 'sturdy', label: 'Sturdy', note: 'Broad shoulders, deep chest' },
];

export const HAIR_STYLES: { id: HairId; label: string }[] = [
  { id: 'shaved', label: 'Shaved' },
  { id: 'crop', label: 'Crop' },
  { id: 'swept', label: 'Swept back' },
  { id: 'spiked', label: 'Spiked' },
  { id: 'curtain', label: 'Curtains' },
  { id: 'wild', label: 'Wild' },
  { id: 'long', label: 'Long' },
  { id: 'ponytail', label: 'Ponytail' },
  { id: 'topknot', label: 'Topknot' },
  { id: 'braids', label: 'Braids' },
  { id: 'mohawk', label: 'Mohawk' },
  { id: 'bun', label: 'Bun' },
];

export const FACIAL_HAIR: { id: FacialHairId; label: string }[] = [
  { id: 'none', label: 'Clean' },
  { id: 'stubble', label: 'Stubble' },
  { id: 'moustache', label: 'Moustache' },
  { id: 'goatee', label: 'Goatee' },
  { id: 'full', label: 'Full beard' },
  { id: 'sideburns', label: 'Sideburns' },
];

export const OUTFITS: { id: OutfitId; label: string; note: string }[] = [
  { id: 'duelist', label: 'Duelist', note: 'Fitted jacket, high collar, buckled belt' },
  { id: 'traveller', label: 'Traveller', note: 'Long coat, split tails, road-worn' },
  { id: 'scholar', label: 'Scholar', note: 'Full robe to the ankle, wide sash' },
  { id: 'warden', label: 'Warden', note: 'Plated chest and pauldrons over mail' },
  { id: 'street', label: 'Street', note: 'Short jacket, open front, loose shirt' },
];

export const GAUNTLETS: { id: GauntletId; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'left', label: 'Left arm' },
  { id: 'right', label: 'Right arm' },
  { id: 'both', label: 'Both arms' },
];

/* ------------------------------------------------------------------ */
/* Defaults, randomisation, validation                                 */
/* ------------------------------------------------------------------ */

export const MAX_CHARACTER_NAME = 18;

export function defaultCharacter(name: string): StoryCharacter {
  return {
    name: name.slice(0, MAX_CHARACTER_NAME),
    frame: 'balanced',
    build: 0.5,
    height: 0.5,
    skin: 2,
    jaw: 0.5,
    eyeShape: 0.5,
    eyeColor: 1,
    brow: 0.5,
    nose: 0.45,
    mouth: 0.5,
    age: 0.2,
    hair: 'swept',
    hairColor: 1,
    facialHair: 'none',
    outfit: 'duelist',
    /* Not the first swatch of each list. The palette runs dark by design — it
       is the arena's — and a default built from the top of every column came
       out as a black coat over black trousers on a black background, which
       looks like the model failed to load rather than a choice nobody has made
       yet. The default duelist is deliberately legible. */
    primary: 10,
    secondary: 0,
    trim: 0,
    trouser: 4,
    boots: 5,
    cape: false,
    capeColor: 10,
    gauntlet: 'right',
  };
}

const pick = <T,>(xs: readonly T[], rnd: () => number): T => xs[Math.floor(rnd() * xs.length)];

/** A complete, plausible character. Used by the Surprise me button. */
export function randomCharacter(name: string, rnd: () => number = Math.random): StoryCharacter {
  const hairColor = Math.floor(rnd() * HAIR_COLORS.length);
  return {
    name: name.slice(0, MAX_CHARACTER_NAME),
    frame: pick(FRAMES, rnd).id,
    build: rnd(),
    height: rnd(),
    skin: Math.floor(rnd() * SKIN_TONES.length),
    jaw: rnd(),
    eyeShape: rnd(),
    eyeColor: Math.floor(rnd() * EYE_COLORS.length),
    brow: rnd(),
    nose: rnd(),
    mouth: rnd(),
    age: rnd() * 0.8,
    hair: pick(HAIR_STYLES, rnd).id,
    hairColor,
    facialHair: pick(FACIAL_HAIR, rnd).id,
    outfit: pick(OUTFITS, rnd).id,
    primary: Math.floor(rnd() * CLOTH_COLORS.length),
    secondary: Math.floor(rnd() * CLOTH_COLORS.length),
    trim: Math.floor(rnd() * TRIM_COLORS.length),
    trouser: Math.floor(rnd() * CLOTH_COLORS.length),
    boots: Math.floor(rnd() * CLOTH_COLORS.length),
    cape: rnd() < 0.3,
    capeColor: Math.floor(rnd() * CLOTH_COLORS.length),
    gauntlet: pick(GAUNTLETS, rnd).id,
  };
}

const clamp01 = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return n < 0 ? 0 : n > 1 ? 1 : n;
};

/**
 * A palette index, or the default.
 *
 * `Number.isInteger` rather than `Math.floor`: rounding 1.9 down to 1 turns a
 * value that is not an index at all into a *different, valid* swatch, and the
 * player is then wearing a colour nothing chose. A field that arrives wrong
 * should fall back to the default, not quietly land somewhere plausible.
 */
const index = (v: unknown, len: number, fallback: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v)) return fallback;
  return v < 0 || v >= len ? fallback : v;
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(v as string) ? (v as T) : fallback;

/**
 * Coerces anything at all into a character we are willing to store and draw.
 *
 * The creation booth is the only screen that *should* produce one of these, but
 * it posts JSON, so the route has to assume the body was hand-written. Rather
 * than reject a character over one bad field — which locks the player out of
 * Story Mode for good, since the character can only be created once — every
 * field falls back to the default independently. A malformed knob costs you the
 * knob, not the run.
 */
export function normaliseCharacter(raw: unknown, username: string): StoryCharacter {
  const d = defaultCharacter(username);
  const c = (raw ?? {}) as Partial<StoryCharacter>;
  const name = typeof c.name === 'string' ? c.name.trim().slice(0, MAX_CHARACTER_NAME) : '';
  return {
    name: name || d.name,
    frame: oneOf(c.frame, FRAMES.map((f) => f.id), d.frame),
    build: clamp01(c.build, d.build),
    height: clamp01(c.height, d.height),
    skin: index(c.skin, SKIN_TONES.length, d.skin),
    jaw: clamp01(c.jaw, d.jaw),
    eyeShape: clamp01(c.eyeShape, d.eyeShape),
    eyeColor: index(c.eyeColor, EYE_COLORS.length, d.eyeColor),
    brow: clamp01(c.brow, d.brow),
    nose: clamp01(c.nose, d.nose),
    mouth: clamp01(c.mouth, d.mouth),
    age: clamp01(c.age, d.age),
    hair: oneOf(c.hair, HAIR_STYLES.map((h) => h.id), d.hair),
    hairColor: index(c.hairColor, HAIR_COLORS.length, d.hairColor),
    facialHair: oneOf(c.facialHair, FACIAL_HAIR.map((f) => f.id), d.facialHair),
    outfit: oneOf(c.outfit, OUTFITS.map((o) => o.id), d.outfit),
    primary: index(c.primary, CLOTH_COLORS.length, d.primary),
    secondary: index(c.secondary, CLOTH_COLORS.length, d.secondary),
    trim: index(c.trim, TRIM_COLORS.length, d.trim),
    trouser: index(c.trouser, CLOTH_COLORS.length, d.trouser),
    boots: index(c.boots, CLOTH_COLORS.length, d.boots),
    cape: c.cape === true,
    capeColor: index(c.capeColor, CLOTH_COLORS.length, d.capeColor),
    gauntlet: oneOf(c.gauntlet, GAUNTLETS.map((g) => g.id), d.gauntlet),
  };
}
