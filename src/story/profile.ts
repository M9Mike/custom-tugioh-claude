/**
 * A Story Mode save, as both the client and the server see it.
 *
 * One record per username, written the first time you finish the creation booth
 * and updated from then on. It is the *server* that holds it, deliberately: the
 * promise made to the player is that the same name on a different phone, a
 * different browser or after clearing the site data brings back the same
 * duelist, and localStorage cannot keep that promise.
 */

import { AREAS, FIRST_AREA, type AreaId } from './areas';
import type { PremadeCharacter } from './premade';

export interface WorldPosition {
  /**
   * Which area they are standing in.
   *
   * Optional, and read through `areaById`, because saves written before the
   * world had areas hold only an x and a z — those were coordinates in a single
   * open field that no longer exists, so they resolve to the first area and its
   * own spawn rather than to whatever those numbers happen to mean now.
   */
  area?: AreaId;
  x: number;
  z: number;
  /** Facing, in radians, around the world's Y axis. */
  facing: number;
}

export interface StoryProfile {
  /** Canonical spelling, as it will be printed back. Lookups are folded. */
  username: string;
  /**
   * Absent until the creation booth is finished — which is the whole test for
   * "has this player made a character yet". Once present it is never replaced:
   * the routes refuse a second write rather than merging one.
   *
   * Saves written before the model swap hold the old procedural spec here;
   * `loadProfile` runs every stored character through `normalisePremade`,
   * which seats those on a model, so nothing past the store ever meets the
   * old shape.
   */
  character: PremadeCharacter | null;
  /** The 25 the player chose. Absent until the first deck is confirmed. */
  deck: string[] | null;
  /**
   * Every card this account owns.
   *
   * Written at the same moment the first deck is locked, and written as exactly
   * the cards that went into it. The rest of what was on offer is not kept
   * anywhere: choosing the deck *is* choosing the collection.
   */
  collection: string[];
  /**
   * Unopened packs, oldest first, each naming the duelist it came off.
   *
   * A pack is stored rather than opened on the spot because winning and opening
   * are two moments: the duel ends, the win screen shows, and the pull happens
   * back in the world. Anything in between — a closed tab, a flat battery, a
   * refresh — must not lose the reward, and a list on the profile is the only
   * place that survives all three.
   */
  packs: string[];
  /**
   * Dollars, earned by winning and spent only in the Kame Game Shop.
   *
   * One-way: nothing sells a card back and nothing else costs money, so this
   * only ever goes up by a win and down by a purchase. Absent on saves written
   * before the shop existed, which every reader treats as nothing yet.
   */
  money?: number;
  /**
   * Which cards have already been pulled from each duelist, keyed by duelist id.
   *
   * The values are `slug#copy` entries — see `packs.ts` for why they are keyed
   * that way and not by index. Absent on saves written before packs existed,
   * which every reader treats as "nothing pulled yet".
   */
  pulled?: Record<string, string[]>;
  level: number;
  xp: number;
  world: WorldPosition;
  createdAt: number;
  updatedAt: number;
  /**
   * Bumped on every write, and the guard that makes two of them safe.
   *
   * Every route here is load → change → save, which without a check is a plain
   * lost update: two requests read the same profile, both write, and the second
   * silently erases the first. It is not theoretical — saving your position in
   * the world writes the *whole* profile back, so a position save that started
   * before a deck was sleeved would put the old deck back on top of it.
   *
   * Absent on anything written before this existed, which `updateProfile`
   * treats as revision zero.
   */
  rev?: number;
}

/** Inside the shop, a step in from the door, looking at the counter. */
export const STARTING_POSITION: WorldPosition = {
  area: FIRST_AREA,
  ...AREAS[FIRST_AREA].spawn,
};

export function newProfile(username: string, now: number): StoryProfile {
  return {
    username,
    character: null,
    deck: null,
    collection: [],
    packs: [],
    money: 0,
    pulled: {},
    level: 1,
    xp: 0,
    world: { ...STARTING_POSITION },
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };
}

/** Which screen a returning player lands on. */
export type StoryStage = 'character' | 'deck' | 'world';

export function stageFor(profile: StoryProfile | null): StoryStage {
  if (!profile?.character) return 'character';
  if (!profile.deck) return 'deck';
  return 'world';
}
