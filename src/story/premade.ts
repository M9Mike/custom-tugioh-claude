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
  /**
   * How many bytes the file is, so a loading bar can be weighted before a
   * single one of them has arrived.
   *
   * Written down because nothing will tell us at runtime. Vercel serves these
   * Brotli-encoded, and a browser hides `content-length` from script whenever
   * `content-encoding` is set — the header is the encoded length and the body
   * handed to JS is not. What comes back from a range request is the encoded
   * length too, and the ratio is nothing like constant: Sarah compresses to 77%
   * and Joey to 33%, so weighting by it puts the bar wrong by different amounts
   * per file. Progress events count decoded bytes, which is this number.
   *
   * `npm run models` fails if any of these has drifted from the file on disk.
   */
  bytes: number;
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
   * Rigged, and carrying no animation on purpose.
   *
   * Between `sculpt` and the rest: a sculpt has no skeleton and can never be
   * animated, the others ship Idle, Walk and Run, and this is a model with the
   * bones and none of the clips. `premadeRig` already does the right thing
   * without being told — it looks for an `Idle`, finds none, and gives the
   * root the same breath and step-rise the sculpts get — so this word exists
   * for `npm run premade`, which otherwise reports three missing clips as
   * three faults rather than as one decision somebody made.
   *
   * Declaring it is not excusing it. The audit still requires the skeleton,
   * and the day clips are put in the file this word comes out and the three
   * rows go back to being required.
   */
  still?: boolean;
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
   * them — the booth's roster. Three, added one at a time, each        *
   * checked a frame at a time before it landed.                        *
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
     * Sandra, resculpted — the same duelist, a far better model.
     *
     * The dress has real drape instead of a painted suggestion of one, the face
     * carries detail at conversation distance, and she stands on heels that are
     * modelled rather than implied. Her id, her label and her height are
     * untouched, because she is the same person and every save that names her
     * has to keep pointing at her.
     *
     * What she arrived without is clips. She is a UniRig export like Sky and
     * Isha — her own skeleton fitted to her own body, thirty-five bones called
     * `Bone_000` upward, no animation of any kind — so her Idle, Walk and Run
     * are her predecessor's, moved onto her by `scripts/blender/retarget.py`.
     * The outgoing model is the only honest donor for her: it is literally the
     * same character's gait, and nobody else's cadence is hers.
     *
     * Her legs are longer than the old model's — hip to ankle is 53% of her
     * height against 48% — so the same rotations carry her 20% further per
     * stride, which is the whole of why these two numbers went up.
     */
    id: 'sandra-afrika',
    label: 'Sandra Afrika',
    note: 'Red dress, street duelist',
    file: '/models/players/sandra-afrika.glb',
    bytes: 5326428,
    height: 1.72,
    /* Her own, measured by `scripts/blender/gait.py` on the shipped file and
       scaled from the 1.70 m it is modelled at to the 1.72 she is rendered at.
       Never copied from another character: the bundles are authored at whatever
       cadence they were authored at, and an inherited number is exactly how
       feet start sliding. (The old pair were the raw 1.70 figures, unscaled —
       1.2% of slide that nobody was ever going to see, but the arithmetic is
       written down here twice and it may as well be right in both places.) */
    walkSpeed: 2.63,
    runSpeed: 4.79,
    tintSlots: [],
  },
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
    bytes: 6626628,
    height: 1.9,
    walkSpeed: 2.34,
    runSpeed: 5.4,
    tintSlots: [],
  },
  {
    /*
     * Sky, and the first duelist here who could not walk when she arrived.
     *
     * She is a UniRig export: sixty-eight bones fitted to her own body, weights
     * that work, and not one frame of animation. That is the same shape of file
     * Isha came in as, and Isha could stay that way — she is a spirit who stands
     * on old ground, and `premadeRig`'s `staticMotion` breath is the right
     * motion for her rather than a mitigation. It is not a thing a *player* can
     * be. A duelist is the one model in the game you look at continuously, from
     * 4.6 m behind, while she crosses a hundred metres of Domino City, and the
     * legs of a clipless model do not move at all.
     *
     * So her Idle, Walk and Run are the outgoing Sandra's, transferred onto her
     * own skeleton by `scripts/blender/retarget.py` — rotations only, nothing
     * touched about the mesh, the weights or the bind (her rest pose out is her
     * rest pose in to half a micron). Her Walk is a shade slower than the clip's
     * donor and her Run a good deal quicker, both for the same reason: her shin
     * is longer and her foot shorter, so the same rotations swing her further at
     * speed and no further at a stroll.
     *
     * 1.75 m — taller than Sandra, nowhere near Robert. She is drawn long-limbed
     * and lean and reads as the tallest woman in the city at anything under six
     * feet, which is the useful thing for a character you pick out at a distance.
     */
    id: 'sky',
    label: 'Sky',
    note: 'Leather and fur, the wilds',
    file: '/models/players/sky.glb',
    bytes: 8402016,
    height: 1.75,
    /* Measured on the shipped file by `scripts/blender/gait.py` — 2.11 and 4.83
       at the 1.70 m she is modelled at — and scaled to the 1.75 she is rendered
       at, which is the height the catalog's speeds are defined against. */
    walkSpeed: 2.17,
    runSpeed: 4.97,
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
    bytes: 598408,
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
    bytes: 660016,
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
    bytes: 617336,
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
    bytes: 564040,
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
    bytes: 4756836,
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
    bytes: 5607352,
    height: 1.72,
    /* Measured off her own clips, scaled to the height she is rendered at. */
    walkSpeed: 1.88,
    runSpeed: 4.16,
    tintSlots: [],
    npcOnly: true,
  },
  {
    /*
     * Sarah, the first duelist you meet who is not behind a counter.
     *
     * 1.70 m, which is what she is modelled at, so her clips need no rescaling:
     * 1.87 and 4.23 m/s measured off her own Walk and Run by `gait.py`.
     *
     * Her idle is the `scout` style — alert, light, arms held a little off the
     * plate, on a 4.1 second period. The period matters as much as the shape:
     * she stands in the same street as Tony, and two people breathing on the
     * same clock read as a pair of mannequins.
     */
    id: 'sarah',
    label: 'Sarah',
    note: 'Clockwork Vanguard, purple plate',
    file: '/models/cast/sarah.glb',
    bytes: 8995712,
    height: 1.7,
    walkSpeed: 1.87,
    runSpeed: 4.23,
    tintSlots: [],
    npcOnly: true,
  },
  {
    /*
     * Tony, across the road from her.
     *
     * 1.86 m — he is the biggest person in the game so far and reads as it, so
     * his measured 2.03 and 4.12 are scaled by 1.86/1.70 to the height he is
     * actually rendered at. A speed left at the modelled figure is a character
     * whose feet slide the moment they are scaled up.
     *
     * `heavy` idle, 4.7 second period: the chest does the work, the head barely
     * moves. Nothing else placed uses it, and it is 0.6 s off Sarah's.
     */
    id: 'tony',
    label: 'Tony',
    note: 'Forest Ambush, tactical vest',
    file: '/models/cast/tony.glb',
    bytes: 7538316,
    height: 1.86,
    walkSpeed: 2.22,
    runSpeed: 4.51,
    tintSlots: [],
    npcOnly: true,
  },
  {
    /*
     * Isha, who is not alive, and is the first model here that is neither
     * rigged nor a sculpt.
     *
     * She arrives from Meshy skinned to her own body — one mesh, seventy-three
     * joints, weights that work — and carrying no clips at all. That is a
     * combination nothing in this file had yet: a `sculpt` has no skeleton and
     * can never move, the rest ship Idle, Walk and Run, and she has the bones
     * and none of the animation. `premadeRig` decides by looking for an `Idle`
     * and finds none, so she takes the same root-level breath and step-rise
     * that the unrigged cast takes — which on a character who *is* a drifting
     * spirit is not a mitigation, it is the right motion.
     *
     * So `walkSpeed` and `runSpeed` are absent for the sculpts' reason: there
     * is no clip to rate, and a number here would be a fact about nothing.
     * `sculpt` is *not* set, because it would be false — she has a skin, and
     * the day somebody animates her the only change is three new clips in the
     * file and two speeds here.
     *
     * 1.74 m, a shade over Sarah and well under Tony: she should read as a
     * tall, thin presence rather than as a large one.
     */
    id: 'isha',
    label: 'Isha',
    note: 'The Unquiet, old ground',
    file: '/models/cast/isha.glb',
    bytes: 11806536,
    height: 1.74,
    still: true,
    tintSlots: [],
    npcOnly: true,
  },
  {
    /*
     * Tina, who stands in Market Row, and the first of these to arrive clipless
     * and *not* keep it that way.
     *
     * She is the same UniRig export Sky and Isha were — thirty-one bones fitted
     * to her own body, weights that work, no animation of any kind — and the
     * difference is what she is for. Isha is a spirit drifting over old ground,
     * and the root-level breath a clipless model falls back to is the right
     * motion for her rather than a shortfall. Tina is a courier standing in a
     * covered market waiting for somebody to duel, at three metres, with the
     * conversation camera on her face. A living person who stands in her bind
     * pose with her arms held out at forty degrees is a mannequin, and no amount
     * of root bob fixes the arms.
     *
     * So her Idle, Walk and Run are Sarah's, moved onto her own skeleton by
     * `scripts/blender/retarget.py` — rotations only, her bind untouched (her
     * rest pose out is her rest pose in to under a micron). Sarah is the donor
     * because she is the nearest thing to Tina in the cast: an athletic woman in
     * boots and hard kit, whose idle is alert and light rather than poised. They
     * stand in different areas and can never be seen together, so sharing a
     * period costs nothing.
     *
     * `still` is therefore absent, and absent rather than false: she has clips
     * — six of them. Idle, Walk and Run are Sarah's; Stretch, LookAround and
     * Settle are her own, authored by `scripts/blender/make-gesture.py` and
     * played additively over whatever she is already doing while she is
     * waiting about in the arcade. She is the first character here with any.
     *
     * 1.70 m, which is what she is modelled at, so nothing is rescaled and the
     * two speeds below are the measurement itself.
     */
    id: 'tina',
    label: 'Tina',
    note: 'Long Odds, Market Row',
    file: '/models/cast/tina.glb',
    bytes: 9764996,
    height: 1.7,
    /* Measured on the shipped file by `scripts/blender/gait.py`. Her walk is the
       slowest in the cast and her run is not: the clips are Sarah's, and Tina's
       shin is shorter and her foot longer, which shortens a stroll and costs a
       sprint nothing. */
    walkSpeed: 1.96,
    runSpeed: 4.57,
    tintSlots: [],
    npcOnly: true,
  },
  {
    /*
     * Ash Ketchum, who is not from this cartoon and is met by luck.
     *
     * Mike's own sculpt, and it arrived the way Tina did: a UniRig export,
     * sixty-nine bones fitted to his own body, weights that work, no clips.
     * His Idle, Walk and Run are Sarah's, moved onto his skeleton by
     * `scripts/blender/retarget.py` — rotations only, his bind untouched. A
     * ten-year-old walking like a scout is nearer the truth than any other
     * gait in the cast, which is the whole of why Sarah is the donor again.
     * Stretch, LookAround and Settle are his own, from `make-gesture.py`, for
     * the looking about a boy does in a shop full of cards that are not his.
     *
     * 1.45 m, because he is ten. The file is modelled at 1.70 like everything
     * from that pipeline, so the two speeds below are the measured 1.65 and
     * 3.56 (`gait.py`) scaled by 1.45/1.70 — a small body covers less ground
     * with the same rotations, and the feet stay honest.
     */
    id: 'ash',
    label: 'Ash Ketchum',
    note: 'Pallet Town, red cap',
    file: '/models/cast/ash.glb',
    bytes: 6143376,
    height: 1.45,
    walkSpeed: 1.41,
    runSpeed: 3.04,
    tintSlots: [],
    npcOnly: true,
  },
  {
    /*
     * The three Amazons, who walk the shrine precinct.
     *
     * Mike's own sculpts and the same shape as everybody since Tina: a UniRig
     * export apiece — sixty-seven to sixty-nine bones fitted to their own
     * bodies, weights that work, no animation of any kind — and each one a
     * hundred and twelve to a hundred and eighteen megabytes of baked texture
     * on the way in.
     *
     * Their Idle, Walk and Run are Sarah's, moved onto their own skeletons by
     * `scripts/blender/retarget.py`, and their Stretch, LookAround and Settle
     * are their own out of `scripts/blender/make-gesture.py`. Sarah is the
     * donor for the same reason she was Tina's and Ash's: she is the nearest
     * thing in the cast to a fit woman in hard boots, and a donor who stands
     * like the target is a retarget with nothing left to correct.
     *
     * All three are modelled at exactly 1.70 m, so nothing is rescaled and the
     * two speeds under each are the measurement itself — `gait.py` on the
     * shipped file, not on the import. The walks come out within a tenth of a
     * metre a second of each other and of Tina's, which is what you would
     * expect of one donor clip on three bodies of the same height: the spread
     * is shin and foot length and nothing else.
     */
    id: 'antiope',
    label: 'Antiope',
    note: 'The Shieldwall, Domino Shrine',
    file: '/models/cast/antiope.glb',
    bytes: 10367364,
    height: 1.7,
    walkSpeed: 1.94,
    runSpeed: 4.56,
    tintSlots: [],
    npcOnly: true,
  },
  {
    id: 'panthesilea',
    label: 'Panthesilea',
    note: 'The Long Hunt, Domino Shrine',
    file: '/models/cast/panthesilea.glb',
    bytes: 10356120,
    height: 1.7,
    /* The longest stride of the three, which is why her route is the quickest
       of them: the clip is the same clip, so a longer leg covers more ground
       per cycle and wants a faster route to play at its own rate. */
    walkSpeed: 2.07,
    runSpeed: 4.88,
    tintSlots: [],
    npcOnly: true,
  },
  {
    id: 'hippolyta',
    label: 'Hippolyta',
    note: "The Queen's Own, Domino Shrine",
    file: '/models/cast/hippolyta.glb',
    bytes: 10661092,
    height: 1.7,
    walkSpeed: 1.92,
    runSpeed: 4.56,
    tintSlots: [],
    npcOnly: true,
  },
];

/** What the booth may offer: everything that is not somebody in particular. */
/**
 * What the booth offers, in the order it offers them.
 *
 * The order is this array's order, which makes it a decision rather than an
 * accident of who was added last — and `BOOTH_MODELS[0]` is load-bearing twice
 * over: it is the duelist a new player starts on, and the fallback for a save
 * naming a model that no longer exists.
 *
 * Sandra Afrika is first because she was the first playable character and is the
 * one every save so far was built on. Robert came in after her and sits after
 * her here, and Sky after him.
 */
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
