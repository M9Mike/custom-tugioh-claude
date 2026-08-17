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
   * The duelists you can be.                                          *
   *                                                                   *
   * The only entries in this file without `npcOnly`, which is what     *
   * makes them — and only them — the booth's roster. Sculpted, like    *
   * the cast at the bottom of this file, and in through the same door  *
   * (`npm run sculpt`).                                               *
   *                                                                   *
   * They replaced nine generic townspeople converted from the 3DS      *
   * rip, and the replacement is the whole reason the booth no longer   *
   * has any knobs on it. Those bodies needed dressing: each carried    *
   * its look in one 256×256 atlas, so the booth offered hue-windowed   *
   * repaints of "Outfit", "Hair" and "Trim" and a stature slider, and  *
   * a player built somebody out of them. These are finished            *
   * characters. There is nothing here to recolour that would not be    *
   * vandalism, so the booth asks for a pick and a name and stops.      *
   *                                                                   *
   * **They do not move**, in exactly the way the sculpted cast does    *
   * not, and on the player that is far more visible than it is on an   *
   * NPC standing in a field: the duelist you drive crosses the ground  *
   * in a fixed pose. `premadeRig` gives them a breath and a lean so    *
   * they are not wholly inert (see `staticMotion` there), but that is  *
   * a mitigation and not a walk cycle. Rigging these eight is the      *
   * single biggest thing outstanding in Story Mode.                    *
   *                                                                   *
   * Heights are authored here for the same reason as the cast's: every *
   * sculpt arrives normalised into the same ~1.9-unit box, so the file *
   * says nothing about how tall anybody is.                            *
   * ---------------------------------------------------------------- */
  {
    id: 'amazoni',
    label: 'Amazoni',
    note: 'Amazon warrior',
    file: '/models/players/amazoni.glb',
    height: 1.78,
    tintSlots: [],
    sculpt: true,
  },
  {
    id: 'savage-valkyrie',
    label: 'Savage Valkyrie',
    note: 'Winged, armoured',
    file: '/models/players/savage-valkyrie.glb',
    height: 1.8,
    tintSlots: [],
    sculpt: true,
  },
  {
    id: 'valkyrie-sentinel',
    label: 'Valkyrie Sentinel',
    note: 'Heavy plate',
    file: '/models/players/valkyrie-sentinel.glb',
    height: 1.82,
    tintSlots: [],
    sculpt: true,
  },
  {
    id: 'wave',
    label: 'Wave',
    note: 'Blue and current',
    file: '/models/players/wave.glb',
    height: 1.74,
    tintSlots: [],
    sculpt: true,
  },
  {
    id: 'christy',
    label: 'Christy',
    note: 'Street duelist',
    file: '/models/players/christy.glb',
    height: 1.7,
    tintSlots: [],
    sculpt: true,
  },
  {
    id: 'meg',
    label: 'Meg',
    note: 'Street duelist',
    file: '/models/players/meg.glb',
    height: 1.68,
    tintSlots: [],
    sculpt: true,
  },
  {
    id: 'shea',
    label: 'Shea',
    note: 'Street duelist',
    file: '/models/players/shea.glb',
    height: 1.7,
    tintSlots: [],
    sculpt: true,
  },
  {
    id: 'sandra-afrika',
    label: 'Sandra Afrika',
    note: 'Street duelist',
    file: '/models/players/sandra-afrika.glb',
    height: 1.72,
    tintSlots: [],
    sculpt: true,
  },

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
    npcOnly: true,
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
    npcOnly: true,
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
    npcOnly: true,
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
    npcOnly: true,
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
    npcOnly: true,
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
    npcOnly: true,
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
    npcOnly: true,
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
    npcOnly: true,
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
    npcOnly: true,
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
    npcOnly: true,
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
    npcOnly: true,
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
    npcOnly: true,
  },
  /* ---------------------------------------------------------------- *
   * The people a player *used* to be able to be.                      *
   *                                                                   *
   * Nine generic townspeople converted from the same 3DS rip as the   *
   * named cast. They were the booth's whole roster, and everything    *
   * the booth used to do was built on them: they carry their look in  *
   * one 256×256 atlas, so `textureTints` offered hue-windowed         *
   * repaints of the outfit, hair and trim, and the stature slider     *
   * covered the rest of the distance to "somebody".                   *
   *                                                                   *
   * `npcOnly` on every one of them now, which takes them out of the   *
   * booth. **They are kept rather than deleted, and only for stored   *
   * saves.** A character bound before this change names one of these  *
   * ids, and `modelById` searches this whole list — so keeping the    *
   * entries means an existing duelist still resolves to the model     *
   * they were bound as. Delete them and that player silently becomes  *
   * somebody else on their next login, which is the one thing Story   *
   * Mode promises cannot happen.                                      *
   *                                                                   *
   * They may go for good once no stored profile names one. That also  *
   * takes `repaint.ts`, `accessories.ts` and the tint machinery with  *
   * it: nothing else in the game uses any of it any more.             *
   * ---------------------------------------------------------------- */
  {
    id: 'rookie',
    label: 'Rookie',
    note: 'Red jacket, ready to duel',
    file: '/models/duelists/rookie.glb',
    height: 1.7,
    walkSpeed: 1.5,
    runSpeed: 3.4,
    tintSlots: [],
    skin: '#e69763',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#f60929', lightness: [0.43, 0.55] },
      { label: 'Trim', palette: 'cloth', from: '#1a1a1b', lightness: [0.09, 0.16] },
      { label: 'Detail', palette: 'trim', from: '#d1d1ec', lightness: [0.73, 0.99] },
    ],
    npcOnly: true,
  },
  {
    id: 'student1',
    label: 'Student',
    note: 'Blazer and slacks',
    file: '/models/duelists/student1.glb',
    height: 1.68,
    walkSpeed: 1.45,
    runSpeed: 3.3,
    tintSlots: [],
    skin: '#fdd5a3',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#091f9f', lightness: [0.25, 0.45] },
      { label: 'Hair', palette: 'hair', from: '#5d477d', lightness: [0.29, 0.48] },
      { label: 'Detail', palette: 'trim', from: '#39294b', lightness: [0.19, 0.26] },
    ],
    npcOnly: true,
  },
  {
    id: 'student2',
    label: 'Student',
    note: 'Uniform, tie',
    file: '/models/duelists/student2.glb',
    height: 1.7,
    walkSpeed: 1.45,
    runSpeed: 3.3,
    tintSlots: [],
    skin: '#fdae7d',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#091f9f', lightness: [0.23, 0.46] },
      { label: 'Trim', palette: 'cloth', from: '#bc832a', lightness: [0.27, 0.82] },
      { label: 'Detail', palette: 'trim', from: '#b9c4d8', lightness: [0.71, 0.91] },
    ],
    npcOnly: true,
  },
  {
    id: 'student3',
    label: 'Student',
    note: 'Skirt and blazer',
    file: '/models/duelists/student3.glb',
    height: 1.63,
    walkSpeed: 1.4,
    runSpeed: 3.2,
    tintSlots: [],
    skin: '#ffd1b8',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#3f6abd', lightness: [0.39, 0.75] },
      { label: 'Trim', palette: 'cloth', from: '#eb3767', lightness: [0.52, 0.61] },
      { label: 'Detail', palette: 'trim', from: '#1a2262', lightness: [0.18, 0.36] },
    ],
    npcOnly: true,
  },
  {
    id: 'student4',
    label: 'Student',
    note: 'Uniform, ribbon',
    file: '/models/duelists/student4.glb',
    height: 1.62,
    walkSpeed: 1.4,
    runSpeed: 3.2,
    tintSlots: [],
    skin: '#ffd1b8',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#732601', lightness: [0.16, 0.31] },
      { label: 'Trim', palette: 'cloth', from: '#e02e5e', lightness: [0.48, 0.57] },
      { label: 'Detail', palette: 'trim', from: '#f34b7c', lightness: [0.58, 0.66] },
    ],
    npcOnly: true,
  },
  {
    id: 'man1',
    label: 'Adult',
    note: 'Casual jacket',
    file: '/models/duelists/man1.glb',
    height: 1.76,
    walkSpeed: 1.55,
    runSpeed: 3.5,
    tintSlots: [],
    skin: '#fbd4a2',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#41220f', lightness: [0.07, 0.25] },
      { label: 'Trim', palette: 'cloth', from: '#6b903d', lightness: [0.28, 0.44] },
      { label: 'Detail', palette: 'trim', from: '#874c38', lightness: [0.31, 0.75] },
    ],
    npcOnly: true,
  },
  {
    id: 'man2',
    label: 'Adult',
    note: 'Shirt and slacks',
    file: '/models/duelists/man2.glb',
    height: 1.75,
    walkSpeed: 1.55,
    runSpeed: 3.5,
    tintSlots: [],
    skin: '#fca970',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#423d43', lightness: [0.18, 0.33] },
      { label: 'Trim', palette: 'cloth', from: '#655666', lightness: [0.34, 0.41] },
      { label: 'Detail', palette: 'trim', from: '#181718', lightness: [0.02, 0.16] },
    ],
    npcOnly: true,
  },
  {
    id: 'woman1',
    label: 'Adult',
    note: 'Blouse and skirt',
    file: '/models/duelists/woman1.glb',
    height: 1.66,
    walkSpeed: 1.45,
    runSpeed: 3.3,
    tintSlots: [],
    skin: '#f5c3aa',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#f35e5e', lightness: [0.58, 0.71] },
      { label: 'Trim', palette: 'cloth', from: '#5f4040', lightness: [0.14, 0.37] },
      { label: 'Detail', palette: 'trim', from: '#3a62a3', lightness: [0.37, 0.48] },
    ],
    npcOnly: true,
  },
  {
    id: 'woman2',
    label: 'Adult',
    note: 'Coat and trousers',
    file: '/models/duelists/woman2.glb',
    height: 1.67,
    walkSpeed: 1.45,
    runSpeed: 3.3,
    tintSlots: [],
    skin: '#f6a474',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#6555a5', lightness: [0.41, 0.53] },
      { label: 'Hair', palette: 'hair', from: '#464e5e', lightness: [0.23, 0.45] },
      { label: 'Detail', palette: 'trim', from: '#98aadf', lightness: [0.6, 0.82] },
    ],
    npcOnly: true,
  },
  {
    id: 'boy1',
    label: 'Child',
    note: 'Young, out playing',
    file: '/models/duelists/boy1.glb',
    height: 1.3,
    walkSpeed: 1.1,
    runSpeed: 2.6,
    tintSlots: [],
    skin: '#f5ba8a',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#e36a09', lightness: [0.38, 0.55] },
      { label: 'Trim', palette: 'cloth', from: '#0a203f', lightness: [0.1, 0.23] },
      { label: 'Detail', palette: 'trim', from: '#3a2313', lightness: [0.11, 0.21] },
    ],
    npcOnly: true,
  },
  {
    id: 'boy2',
    label: 'Child',
    note: 'Young, satchel',
    file: '/models/duelists/boy2.glb',
    height: 1.32,
    walkSpeed: 1.1,
    runSpeed: 2.6,
    tintSlots: [],
    skin: '#e5976f',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#b50832', lightness: [0.24, 0.58] },
      { label: 'Hair', palette: 'hair', from: '#464638', lightness: [0.18, 0.47] },
      { label: 'Detail', palette: 'trim', from: '#40467a', lightness: [0.26, 0.48] },
    ],
    npcOnly: true,
  },
  {
    id: 'girl1',
    label: 'Child',
    note: 'Young, out playing',
    file: '/models/duelists/girl1.glb',
    height: 1.28,
    walkSpeed: 1.1,
    runSpeed: 2.6,
    tintSlots: [],
    skin: '#f2d0b7',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#ea3737', lightness: [0.5, 0.61] },
      { label: 'Trim', palette: 'cloth', from: '#fc6666', lightness: [0.63, 0.87] },
      { label: 'Detail', palette: 'trim', from: '#613e33', lightness: [0.13, 0.49] },
    ],
    npcOnly: true,
  },
  {
    id: 'girl2',
    label: 'Child',
    note: 'Young, satchel',
    file: '/models/duelists/girl2.glb',
    height: 1.3,
    walkSpeed: 1.1,
    runSpeed: 2.6,
    tintSlots: [],
    skin: '#ffcebc',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#621ccb', lightness: [0.35, 0.53] },
      { label: 'Trim', palette: 'cloth', from: '#0d0d19', lightness: [0.04, 0.44] },
      { label: 'Detail', palette: 'trim', from: '#8f3af6', lightness: [0.55, 0.76] },
    ],
    npcOnly: true,
  },
  {
    id: 'guide',
    label: 'Guide',
    note: 'Uniform and cap',
    file: '/models/duelists/guide.glb',
    height: 1.72,
    walkSpeed: 1.5,
    runSpeed: 3.4,
    tintSlots: [],
    skin: '#f0a07f',
    textureTints: [
      { label: 'Outfit', palette: 'cloth', from: '#badcf1', lightness: [0.53, 0.89] },
      { label: 'Trim', palette: 'cloth', from: '#b30f09', lightness: [0.3, 0.65] },
      { label: 'Detail', palette: 'trim', from: '#9caee2', lightness: [0.71, 0.8] },
    ],
    npcOnly: true,
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
  /* ---------------------------------------------------------------- *
   * The sculpted cast.                                                *
   *                                                                   *
   * Modelled rather than ripped or assembled, and brought in by       *
   * `npm run sculpt` (`scripts/import-sculpt.mjs`), which is where    *
   * the whole story of how they got this small is written down.       *
   *                                                                   *
   * **These do not move.** Each is one static mesh — no skeleton, no  *
   * skin, no clips — so they stand exactly as modelled. That is the   *
   * trade they were accepted on: the rips animate and look like       *
   * nobody in particular at close range, these look like the          *
   * characters and do not breathe. Rigging is the next piece of work  *
   * on them, and until it happens `sculpt: true` says so on every     *
   * entry.                                                            *
   *                                                                   *
   * No tint slots and no `skin`, for the same reason the rips have    *
   * none: they already look like who they are, and there is nothing   *
   * here for a player to recolour.                                    *
   *                                                                   *
   * Heights are the characters' own rather than the file's. Every     *
   * sculpt arrives normalised into the same ~1.9-unit box, so the     *
   * file says nothing whatsoever about how tall anybody is — without  *
   * a number here Weevil would stand eye to eye with Odion. At        *
   * stature 0.5 the rig scales to exactly these figures.              *
   * ---------------------------------------------------------------- */
  {
    /*
     * Replaces the built Mai — `woman2` with a mane cut into it by
     * `scripts/blender/mai.py`, dressed by a runtime repaint. That one was a
     * body wearing her colours; this one is her. The repaint rules and the
     * ribcage `build` that went with it are gone from `npcs.ts` with it: they
     * were instructions for a texture and a skeleton that are no longer there.
     */
    id: 'mai',
    label: 'Mai Valentine',
    note: 'Purple jacket, blonde',
    file: '/models/cast/mai.glb',
    height: 1.72,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    /*
     * Replaces Grandpa-as-`man1`: an ordinary adult repainted grey, with a
     * bandana and a beard generated in `accessories.ts` because no repaint can
     * add a shape. He is modelled now, so the accessories and the barrel-chest
     * `build` come off with the costume.
     *
     * Short, and deliberately the shortest adult here: he is the first person
     * a new duelist meets and should not be looming over them.
     */
    id: 'solomon',
    label: 'Solomon Muto',
    note: 'The Kame Game Shop',
    file: '/models/cast/solomon.glb',
    height: 1.55,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    id: 'pegasus',
    label: 'Maximillion Pegasus',
    note: 'Red suit, silver hair',
    file: '/models/cast/pegasus.glb',
    height: 1.88,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    id: 'keith',
    label: 'Bandit Keith',
    note: 'Stars and stripes bandana',
    file: '/models/cast/keith.glb',
    height: 1.9,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    id: 'bakura',
    label: 'Bakura Ryou',
    note: 'Domino High, white hair',
    file: '/models/cast/bakura.glb',
    height: 1.76,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    id: 'mako',
    label: 'Mako Tsunami',
    note: 'The fisherman',
    file: '/models/cast/mako.glb',
    height: 1.8,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    /* The two shortest in the cast, and it is most of how the pair read
       standing next to anybody else. */
    id: 'weevil',
    label: 'Weevil Underwood',
    note: 'Insect duelist',
    file: '/models/cast/weevil.glb',
    height: 1.5,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    id: 'rex',
    label: 'Rex Raptor',
    note: 'Dinosaur duelist',
    file: '/models/cast/rex.glb',
    height: 1.64,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    id: 'marik',
    label: 'Yami Marik',
    note: 'The Rare Hunter',
    file: '/models/cast/marik.glb',
    height: 1.8,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    /* The largest human here by a clear margin, which is the point of him. */
    id: 'odion',
    label: 'Odion Ishtar',
    note: 'Marik’s guardian',
    file: '/models/cast/odion.glb',
    height: 1.98,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    id: 'ishizu',
    label: 'Ishizu Ishtar',
    note: 'Keeper of the tombs',
    file: '/models/cast/ishizu.glb',
    height: 1.75,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    id: 'priest-seto',
    label: 'Priest Seto',
    note: 'Ancient Egypt',
    file: '/models/cast/priest-seto.glb',
    height: 1.86,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    /* Not from this story at all, and in on purpose. */
    id: 'ash',
    label: 'Ash Ketchum',
    note: 'Visiting from another franchise',
    file: '/models/cast/ash.glb',
    height: 1.5,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
  },
  {
    /*
     * Not a person, and the one entry where `height` is not a stature.
     *
     * The sculpt is longest along Z — a body and a wingspan — and only 1.65 of
     * its 1.9-unit box tall, so the number below scales the *shoulder*, and
     * the length follows it to about six and a half metres. Three times the
     * tallest man in the field is roughly the proportion the card art keeps.
     */
    id: 'blue-eyes',
    label: 'Blue-Eyes White Dragon',
    note: 'Kaiba’s dragon',
    file: '/models/cast/blue-eyes.glb',
    height: 5.5,
    tintSlots: [],
    npcOnly: true,
    sculpt: true,
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
