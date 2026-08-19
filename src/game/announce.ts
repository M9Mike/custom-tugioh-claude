/**
 * What the board says out loud for a beat, and which beats earn a flourish.
 *
 * These two rules used to live as closures inside the duel screen, where no
 * test could reach them — and that is exactly how Barrel Dragon shipped saying
 * the wrong thing. The engine emitted a beat carrying the coin tally, every
 * engine-side check agreed the tally was there, and the board said "Barrel
 * Dragon's effect activates" instead, twice, because the rule that chooses the
 * sentence answered for any `activate` beat with a slug on it. The whole
 * battery stayed green through a bug the owner could see in one duel.
 *
 * So the announcing rule is a function of (state, beat) now, living beside the
 * engine that writes the beats. The screen renders what this returns.
 */
import { CARDS, DUELISTS, toonDisplayName } from './cards';
import { displayName } from './engine';
import type { AnimEvent, CardInstance, DuelState, PlayerId } from './types';

/* A duelist's signature card gets a moment. Only these ten, and only when they
   attack or go off — otherwise the game would be all cutscene.

   Exodia is nobody's emblem and wins from the hand rather than the field, so it
   never qualified — the five pieces came together and the victory modal simply
   appeared, with no moment at all for the one card in the game that ends a duel
   outright. */
const SIGNATURE = new Set([...DUELISTS.map((d) => d.emblem), 'exodia-the-forbidden-one']);

export function isSignatureBeat(a: AnimEvent | null): boolean {
  if (!a || !a.slug) return false;
  /* A result is not an entrance. Barrel Dragon is Keith's emblem and flips
     three coins, and the coin beat carries his slug so the board can show his
     face beside the tally — which also made it play his whole signature moment
     a second time, on every single ignition. */
  if (a.reports) return false;
  // A Fusion Summon is rare, costs three cards, and is the most spectacular
  // thing in the game — it earns the flourish whoever is holding it, not only
  // when the result happens to be a duelist's emblem.
  if (a.kind === 'fusion') return true;
  if (!SIGNATURE.has(a.slug)) return false;
  return (
    a.kind === 'attack' ||
    a.kind === 'directAttack' ||
    a.kind === 'activate' ||
    a.kind === 'trap' ||
    a.kind === 'win'
  );
}

/** Whose Toon World is open — for the beats, which carry a slug and a duelist
 *  rather than a card. A beat that names nobody claims nobody's field spell. */
const bookOpenFor = (state: DuelState, pid: PlayerId | undefined) =>
  !!pid && state.players[pid].field?.slug === 'toon-world';

/**
 * `form: 'actor'` reads "Kaiba activates Dark Hole"; `form: 'card'` reads
 * "Blue-Eyes White Dragon's effect activates" — a monster already on the field
 * going off is not the same sentence as a Spell being played, and "Kaiba
 * activates Blue-Eyes White Dragon" while the dragon stands there is nonsense.
 */
function declare(
  state: DuelState,
  a: AnimEvent
): { verb: string; name: string; slug: string; who: PlayerId; form: 'actor' | 'card' } | null {
  if (!a.slug || !a.player) return null;
  // `as` when the beat is not about the card its art comes from — a Kuriboh
  // Token wears Kuriboh's face and is not Kuriboh, and announcing it as such
  // meant a second body arrived carrying the first one's line.
  const name = a.as ?? (CARDS[a.slug] ? toonDisplayName(a.slug, bookOpenFor(state, a.player)) : a.slug);
  const actor = { name, slug: a.slug, who: a.player, form: 'actor' as const };
  switch (a.kind) {
    case 'activate':
      return CARDS[a.slug]?.kind === 'monster'
        ? { ...actor, form: 'card', verb: "'s effect activates" }
        : { ...actor, verb: 'activates' };
    case 'summon':
      // The arrival is its own beat: without it a monster fetched by a Spell
      // simply appeared, with nothing saying where it had come from.
      return { ...actor, verb: 'summons' };
    case 'trap':
      return { ...actor, verb: 'springs' };
    case 'fusion':
      return { ...actor, verb: 'fusion summons' };
    case 'attack':
      return { ...actor, verb: `attacks ${a.text ?? ''} with`.replace('  ', ' ') };
    case 'directAttack':
      return { ...actor, verb: 'attacks directly with' };
    case 'win':
      // Only Exodia carries a slug here, and "assembles" is the line that
      // belongs to it — the five pieces coming together, not a card played.
      return { ...actor, verb: 'assembles' };
    default:
      return null;
  }
}

/**
 * What the board says for the beat currently resolving.
 *
 * A card-shaped declaration when there is one, and otherwise the log line the
 * engine paired with this beat. Nothing the duel records should have to be read
 * out of the log afterwards — the log is a memory aid, not the place a player
 * goes to find out what just happened.
 */
export function spokenFor(
  state: DuelState,
  a: AnimEvent | null
): { text: string; slug?: string; who?: PlayerId } | null {
  if (!a) return null;
  /* An effect that fired because the card arrived says the card's cry. The
     generic "…'s effect activates" is right for a monster *choosing* to go off,
     and wrong on a Summon: a card with more than one effect announces every one
     of them identically, so Slifer's draw rider read as his second mouth —
     reported as the mouth firing on his own Summon, which it never did. The
     beat itself stays; it is what carries the flourish. */
  if (a.kind === 'activate' && a.arrival && a.text) {
    return { text: a.text, slug: a.slug, who: a.player };
  }
  /* A beat that reports an outcome says the outcome. `declare` speaks for the
     card — "Barrel Dragon's effect activates" — which is the right sentence
     once, for the beat announcing the activation, and the wrong one for every
     beat the effect emits afterwards. Checked before `declare` rather than
     after, because `declare` answers for any activate beat carrying a slug and
     would swallow the line on its way past. */
  if (a.reports && a.note) return { text: a.note, slug: a.slug, who: a.player };
  const d = declare(state, a);
  if (d) {
    const actor = state.players[d.who].name;
    return {
      text: d.form === 'actor' ? `${actor} ${d.verb} ${d.name}` : `${d.name}${d.verb}`,
      slug: d.slug,
      who: d.who,
    };
  }
  if (a.note) return { text: a.note, slug: a.slug, who: a.player };
  return null;
}

/**
 * What the board is calling this card right now.
 *
 * A card in a Monster Zone is named for the side standing it; anywhere else it
 * answers to its owner. Only the four that the book brings to life care, and for
 * everything else this is the printed name.
 *
 * The rule itself lives in the engine, which is the side that writes the log
 * lines. The screen used to hold a second copy of it, and a second copy of a
 * rule is a rule that will one day disagree with itself — which is precisely
 * what every card face on the screen must not do.
 */
export const shownNameFor = (state: DuelState, c: CardInstance | null | undefined): string | undefined =>
  c ? displayName(state, c) : undefined;
