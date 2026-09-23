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
import type { TournamentState } from './tournament';

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
   * Cards in the Trunk the player has not looked at yet.
   *
   * Written when a card *arrives* — a pack opened, a card bought — and never
   * when the first deck is locked, because those twenty-five were chosen one
   * at a time and looked at harder than anything else in the game. Cleared a
   * card at a time as the player passes over them in the deck builder.
   *
   * A list of what is new rather than a list of what has been seen, which is
   * the same information the other way up and a great deal smaller: the seen
   * list would grow to the size of the collection and be written on every
   * glance, and this one empties itself.
   *
   * Absent on saves written before it existed, which every reader treats as
   * nothing new — the right answer for a player who has been collecting since
   * before the badge existed and should not be handed a screen full of them.
   */
  fresh?: string[];
  /**
   * How much money each duelist who plays for money has left, keyed by their id.
   *
   * Only the ones with a line in `PURSE` ever appear here, and only once the
   * player has taken something off them — an absent entry is somebody who still
   * has everything they came with, which is the right reading for a save written
   * before any of this existed. `purseOf` in `story/shop.ts` is the only thing
   * that should read it, because it is also what applies the floor.
   */
  purse?: Record<string, number>;
  /**
   * Everybody this player has already talked to, by NPC id.
   *
   * What it buys is the *second* conversation. Meeting somebody is a scene —
   * their name, what they play, what they know about the tournament — and a
   * scene replayed every time you walk past is a scene the player learns to
   * skip, which in this game means holding the tap button through the only
   * writing in it. So a script may carry an `again` node, and this is the
   * record that says which one you get (`openingNode` in `story/npcs.ts`).
   *
   * On the profile rather than in the page, because the promise the save makes
   * is that the same name on a different phone is the same duelist: somebody
   * who has met Tina has met her tomorrow as well. Absent on saves written
   * before it existed, which every reader treats as having met nobody — one
   * more introduction each, which is the harmless way round.
   */
  met?: string[];
  /**
   * Which cards have already been pulled from each duelist, keyed by duelist id.
   *
   * The values are `slug#copy` entries — see `packs.ts` for why they are keyed
   * that way and not by index. Absent on saves written before packs existed,
   * which every reader treats as "nothing pulled yet".
   */
  pulled?: Record<string, string[]>;
  /**
   * The tournament, once Kaiba has opened it for this player — see
   * `story/tournament.ts`.
   *
   * Absent until the broadcast has played, which is the only test anything
   * makes for whether it has begun: ninety-nine cards open the door and the
   * broadcast is walking through it, so a player who reaches the count with
   * the app closed still sees it the next time they are in the world. Written
   * only by the server — the start by `/api/story/tournament`, every chip by
   * `/api/story/save` settling a duel against the room's own verdict.
   */
  tournament?: TournamentState;
  level: number;
  xp: number;
  world: WorldPosition;
  /**
   * The duel this duelist walked into from a conversation and has not come
   * back from. Written by `/api/room` when the room is made, read back by
   * `/api/story/login` with the room's own verdict attached, and cleared by
   * `/api/story/save` once the conversation has picked up. The server owns
   * it because the browser could not be trusted to: a note in
   * `sessionStorage` was the whole road back, and on Mike's phone the road
   * back was a sign-in card and the first field.
   */
  pendingDuel?: DuelInProgress | null;
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
export interface DuelInProgress {
  /** The room, and the seat in it — the server's own token, kept server-side. */
  code: string;
  token: string;
  npcId: string;
  /** Which node the conversation resumes on, per outcome. */
  won: string;
  lost: string;
  startedAt: number;
  /**
   * The card the player put on the table, if the duel was played for one.
   *
   * Carried so the conversation can name it on the way back — "that Pidgeot
   * is mine". The room holds the copy that decides anything (see
   * `Room.wagerCard`); this one is for the sentence.
   */
  wagered?: string;
  /** Attached on the way back by `login`, read off the room; never stored. */
  outcome?: 'won' | 'lost';
}

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
    fresh: [],
    pulled: {},
    met: [],
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
