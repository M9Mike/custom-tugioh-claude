/**
 * Kaiba's broadcast: the words that open the tournament.
 *
 * Played once, the first time the player is in the world carrying ninety-nine
 * cards (`Cutscene`, from `OpenWorld`), and the only place the whole of the
 * tournament's rules are said in one breath — the chips, the city, the round
 * nobody watches, the four who go through. Everybody else in the city has one
 * half of it; he has all of it, because it is his.
 *
 * The film is `public/story/broadcast.mp4` — nine shots of him saying these,
 * one line a shot, made with Higgsfield from Mike's picture of him and cut by
 * `scripts/broadcast-film.ts` — and these are its captions: the words are
 * here, and the second each one is spoken is measured off the soundtrack when
 * the film is cut and written beside them (`generated/broadcast.json`), so the
 * caption and the mouth cannot drift. If
 * the film cannot be played, the same lines are the broadcast — read, a card at
 * a time, over his picture — so the rules the player hears and the rules
 * `tournament.ts` runs are written once each and read against each other by
 * `npm run talk`.
 */
import cut from './generated/broadcast.json';

export interface BroadcastLine {
  /** Seconds into the film this line is spoken. */
  at: number;
  text: string;
}

export const BROADCAST_FILM = '/story/broadcast.mp4';
export const BROADCAST_STILL = '/story/broadcast.jpg';

/** What he says, in the order he says it — word for word what the voice says. */
export const BROADCAST_WORDS: string[] = [
  'Duelists of Domino City! This is Seto Kaiba.',
  'Ninety-nine cards bought you a seat in my tournament. As of this moment, it has begun!',
  'My duelists are out there now. The market, the station, the shrine, the old cemetery...',
  'The plaza, the school, the towers. Everywhere but the street you started on.',
  'They won’t wait for you. But your duel disk tracks every one of them.',
  'Defeat a duelist, and their star chip is yours. One per duelist. Ten puts you in my finals.',
  'And don’t think the others are standing still. Every time you duel, they duel each other.',
  'The moment you hold ten, the three with the most chips join you at Central Towers.',
  'Four finalists. One champion. Show me something worth watching!',
];

export const BROADCAST: BroadcastLine[] = BROADCAST_WORDS.map((text, i) => ({
  text,
  at: (cut as { at: number[] }).at[i] ?? i * 7,
}));

/** How long the film runs. */
export const BROADCAST_LENGTH: number = (cut as { length: number }).length;
