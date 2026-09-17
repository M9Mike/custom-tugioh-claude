/**
 * Ash Ketchum — what a Pokémon deck knows about itself.
 *
 * The search prices everything it can derive from the DSL: a 3300 body is
 * worth more than a 2400 one, a board wipe is worth the board. What it cannot
 * derive is which *form* to evolve into when the card offers three, which
 * Pokémon to fetch when a Poké Ball offers fifteen. This file is those
 * choices and nothing else; the beam, the worlds, the evaluation and the
 * judge are the same for every deck.
 *
 * Public information only: own hand and own Deck's CONTENTS (never its
 * order), both fields as shown, both Graveyards, the size of their hand.
 */
import { CARDS, baseAtk } from '../cards';
import type { DuelistBrain } from '../brain';
import type { CardInstance, DuelState, PendingChoice, PlayerId } from '../types';
import { findOwn, theirBoard } from './common';

const POKEMON = 'Pokémon';
const isPokemon = (slug: string): boolean => CARDS[slug]?.type === POKEMON;

/** The forms a Pokémon can still step into, read off its own evolution button. */
function formsOf(slug: string): string[] {
  for (const eff of CARDS[slug]?.effects ?? []) {
    if (eff.trigger !== 'ignition' || !eff.cost?.tributeSelf) continue;
    for (const op of eff.ops) if (op.op === 'specialSummon' && op.filter?.slugs) return op.filter.slugs;
  }
  return [];
}

/** Whether any of these forms is still somewhere the evolution can reach. */
function formAvailable(state: DuelState, me: PlayerId, forms: string[]): boolean {
  const p = state.players[me];
  return forms.some((f) => p.extra.some((c) => c.slug === f) || p.grave.some((c) => c.slug === f));
}

/**
 * What a form is worth *arriving* on this board, beyond its body.
 *
 * Read against what stands across the table, so Mega Charizard Y is the pick
 * over three small monsters and Gigantamax Charizard over one big one, and
 * the Thunder Emperor over a Set card is worth more than over an empty
 * backrow.
 */
function arrivalWorth(state: DuelState, me: PlayerId, slug: string): number {
  const t = theirBoard(state, me);
  const foe = state.players[me === 'p1' ? 'p2' : 'p1'];
  const sum = t.atks.reduce((a, b) => a + b, 0);
  const max = t.atks.length ? Math.max(...t.atks) : 0;
  const bodies = t.atks.length + t.hidden;
  const small = t.atks.filter((a) => a <= 2000);
  const mine = state.players[me].monsters.filter((m): m is CardInstance => !!m).length;
  let worth = baseAtk(slug) * 0.3;
  switch (slug) {
    case 'mega-charizard-y':
      worth += small.reduce((a, b) => a + b, 0) * 0.5 + t.hidden * 500 + (small.length ? 300 : 0);
      break;
    case 'mega-charizard-x':
      worth += (max > 2400 ? 500 : 150) + (bodies <= 1 ? 350 : 0);
      break;
    case 'gigantamax-charizard':
      worth += bodies * 350 + 200;
      break;
    case 'raichu':
      worth += 1500 * 0.5 + (foe.lp <= 1500 ? 4000 : foe.lp <= 3000 ? 600 : 0);
      break;
    case 'gigantamax-pikachu':
      worth += t.backrow * 650 + bodies * 500 * 0.5 + 100;
      break;
    case 'charizard-flame-emperor':
      worth += sum * 0.5 + bodies * 500 + t.hidden * 600;
      break;
    case 'pikachu-thunder-emperor':
      worth += t.backrow * 700 + (t.hand > 0 ? 300 : 0) + 250;
      break;
    case 'ash-greninja-ultimate-bond':
      worth += bodies * 450 + t.backrow * 200 + 150;
      break;
    case 'sceptile-forest-overlord':
      worth += Math.max(0, mine) * 400 + 100;
      break;
    case 'lucario-aura-master':
      worth += t.backrow * 350 + 300;
      break;
    case 'infernape-blaze-unleashed':
      worth += (state.players[me].lp <= 4000 ? 1000 * 0.3 : 0) + 250;
      break;
    case 'ash-greninja':
      worth += (bodies ? 700 : 0) + (t.backrow ? 400 : 0);
      break;
    case 'mega-lucario':
      worth += 1500 * 0.5 + (foe.lp <= 1500 ? 4000 : 0) + 200;
      break;
    case 'mega-sceptile':
      worth += (t.backrow ? 300 : 0) + 200;
      break;
    case 'gigantamax-gengar':
      worth += t.hand * 350 + 300;
      break;
    case 'gigantamax-snorlax':
      worth += max > 2800 ? 500 : 200;
      break;
    case 'venusaur':
      worth += 1500 * 0.5 + (mine >= 1 ? 300 : 0);
      break;
    case 'blastoise':
      worth += t.backrow * 700 + 150;
      break;
    case 'decidueye':
      worth += (bodies ? 500 : 250) + t.hand * 120;
      break;
    case 'charizard':
      worth += (max ? Math.min(max, 3000) * 0.5 : 0) + 200;
      break;
    case 'pikachu':
      worth += 420;
      break;
    case 'greninja':
      worth += state.players[me].deck.some((c) => c.slug === 'bond-evolution') ? 400 : 100;
      break;
    case 'gengar':
      worth += t.hand * 200 + 150;
      break;
    case 'krookodile':
      worth += bodies * 800 * 0.4;
      break;
    case 'butterfree':
      worth += bodies ? bodies * 350 : 0;
      break;
    case 'pidgeot':
      worth += bodies ? 500 : 250;
      break;
    case 'infernape':
      worth += bodies * 500 * 0.5 + (state.players[me].lp <= 4000 ? 300 : 0);
      break;
    case 'lucario':
      worth += 800 * 0.5 + 100;
      break;
    case 'snorlax':
      worth += max > 1800 ? 350 : 100;
      break;
    case 'talonflame':
      worth += 300;
      break;
    case 'rowlet':
      worth += 200;
      break;
    case 'bulbasaur':
      worth += 250;
      break;
    case 'squirtle':
      worth += max > 1500 ? 250 : 80;
      break;
  }
  /* A basic whose next form is still on the shelf is a threat that grows
     next turn; one whose forms are all spent is just its number. */
  if (isPokemon(slug) && !CARDS[slug]?.isFusion) {
    const forms = formsOf(slug);
    if (forms.length && formAvailable(state, me, forms)) worth += 260;
  }
  return worth;
}

/**
 * What a card is worth *in the hand*: a Pokémon is worth the arrival it will
 * make, discounted for the summon it still costs; a Spell is worth the line
 * it opens.
 */
function handWorth(state: DuelState, me: PlayerId, slug: string): number {
  const p = state.players[me];
  const t = theirBoard(state, me);
  const bodies = t.atks.length + t.hidden;
  if (isPokemon(slug)) {
    let v = arrivalWorth(state, me, slug) * 0.55;
    /* Pikachu walks in for free onto an empty field, which is a whole extra
       body this turn. */
    if (slug === 'pikachu' && !p.monsters.some(Boolean)) v += 400;
    return v;
  }
  switch (slug) {
    case 'bond-evolution':
      return p.monsters.some((m) => m && isPokemon(m.slug)) ? 900 : 350;
    case 'poke-ball':
      return 500;
    case 'evolution-stone':
      return p.deck.some((c) => isPokemon(c.slug)) ? 650 : 200;
    case 'max-revive':
      return p.grave.some((c) => isPokemon(c.slug)) ? 700 : 150;
    case 'the-heart-of-the-trainer':
      return 450 + (p.grave.some((c) => CARDS[c.slug]?.isFusion) ? 250 : 0);
    case 'pokemon-battle-arena':
      return p.field ? 100 : 500;
    case 'substitute':
    case 'pikachu-s-quick-attack':
    case 'charizard-s-rage':
    case 'blaze-of-determination':
      return p.spellTrap ? 150 : 400 + bodies * 60;
  }
  return baseAtk(slug) * 0.1;
}

/*
 * No evaluation term, and that is a measurement, not an omission.
 *
 * The first version priced the ladder's shadow — a Pokémon standing with its
 * next form still on the shelf worth a share of that form now — and raced
 * 83% ±12 against the field where the general search alone read 90% ±9, with
 * Jaden and Solomon both a few points worse. Inside the noise, but every
 * number moved the wrong way, and the house rule for an evaluation term is
 * the one Workstream D wrote down: a term that does not move the race is
 * deleted, not kept for plausibility. What is left is the choices, which are
 * about *which* form arrives rather than how strong the deck is.
 */

/**
 * Which Pokémon, which form. The engine's default takes the biggest number;
 * the deck knows the board.
 */
function rankChoice(state: DuelState, me: PlayerId, pending: PendingChoice): string[] | null {
  const summoning = /Special Summon/i.test(pending.reason);
  const ranked = pending.options
    .map((uid) => ({ uid, c: findOwn(state, me, uid) }))
    .filter((x): x is { uid: string; c: CardInstance } => !!x.c)
    .map((x) => ({
      uid: x.uid,
      worth: summoning ? arrivalWorth(state, me, x.c.slug) : handWorth(state, me, x.c.slug),
    }))
    .sort((a, b) => b.worth - a.worth);
  return ranked.length ? ranked.map((r) => r.uid) : null;
}

export const ASH: DuelistBrain = { id: 'ash', rankChoice };
