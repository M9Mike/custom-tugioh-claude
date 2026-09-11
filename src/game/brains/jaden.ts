/**
 * Jaden Yuki — what a HERO deck knows about itself.
 *
 * One of every HERO, two Polymerizations, fourteen Fusions waiting behind
 * them, and every monster that falls fetches the next. The general search
 * prices each card it can derive from the DSL; what it cannot derive is the
 * shape of the deck — that Avian in hand beside Burstinatrix and a
 * Polymerization is a Flame Wingman this Main Phase, that Winged Kuriboh and
 * Transcendent Wings are worth exactly the board across the table, that the
 * HERO a signal calls should be the one that finishes a Fusion rather than
 * the one with the biggest number. This file is those terms, and nothing
 * else: the beam, the worlds and the judge are the same for every deck.
 *
 * Public information only. Own hand and own Deck's CONTENTS (never its
 * order), both fields as shown, both Graveyards, the size of their hand.
 */
import { CARDS, baseAtk } from '../cards';
import { effAtk, other } from '../engine';
import { matchesFilter } from '../targeting';
import type { DuelistBrain } from '../brain';
import type { CardInstance, DuelState, PendingChoice, PlayerId } from '../types';

const HERO = 'Elemental HERO';
const isHero = (slug: string): boolean => (CARDS[slug]?.name ?? '').includes(HERO);
const isFusion = (slug: string): boolean => !!CARDS[slug]?.isFusion;
const known = (c: CardInstance): boolean => !c.turnFlags.worldBlind;

/** Their face-up bodies as they stand, and what they hide under card backs. */
function theirBoard(state: DuelState, me: PlayerId): { atks: number[]; hidden: number; backrow: number; hand: number } {
  const foe = state.players[other(me)];
  const atks: number[] = [];
  let hidden = 0;
  for (const m of foe.monsters) {
    if (!m) continue;
    if (m.face === 'down') hidden += 1;
    else atks.push(effAtk(state, m, other(me)));
  }
  const backrow = (foe.spellTrap ? 1 : 0) + (foe.field ? 1 : 0);
  return { atks, hidden, backrow, hand: foe.hand.length };
}

/** Printed ATK plus what the Graveyards already promise it — the Shining pair grow a thousand a head. */
function fusionAtk(state: DuelState, me: PlayerId, slug: string): number {
  let atk = baseAtk(slug);
  for (const eff of CARDS[slug]?.effects ?? []) {
    const per = eff.aura?.per;
    if (!per?.atk) continue;
    if (per.zone === 'ownGrave') atk += per.atk * state.players[me].grave.filter((c) => matchesFilter(c, per.filter)).length;
    else if (per.zone === 'oppGrave') atk += per.atk * state.players[other(me)].grave.filter((c) => matchesFilter(c, per.filter)).length;
  }
  return atk;
}

/**
 * What a Fusion is worth standing on this board, beyond its body: the giant
 * that sweeps the big monsters, the storm that strips their magic, the
 * four-element HERO that banishes the lot. Read off the board it would land
 * on, so Thunder Giant is worth nothing against three 1900s and most of the
 * game against a Blue-Eyes.
 */
function fusionWorth(state: DuelState, me: PlayerId, slug: string): number {
  const p = state.players[me];
  const t = theirBoard(state, me);
  const sum = t.atks.reduce((a, b) => a + b, 0);
  const max = t.atks.length ? Math.max(...t.atks) : 0;
  let worth = fusionAtk(state, me, slug) * 0.3 + (CARDS[slug]?.def ?? 0) * 0.05;
  switch (slug) {
    case 'elemental-hero-thunder-giant': {
      const big = t.atks.filter((a) => a >= 2400);
      worth += big.reduce((a, b) => a + b, 0) * 0.5 + (big.length ? 400 : 0);
      break;
    }
    case 'elemental-hero-electrum':
      worth += sum * 0.45 + t.hidden * 500 + t.backrow * 350 + t.hand * 220;
      break;
    case 'elemental-hero-tempest':
      worth += t.backrow * 300 + t.hand * 110 + 200;
      break;
    case 'elemental-hero-shining-flare-wingman':
      worth += 260 + max * 0.3 + (p.deck.some((c) => c.slug === 'skyscraper') && !p.field ? 120 : 0);
      break;
    case 'elemental-hero-flame-wingman':
      worth += max * 0.35 + (p.deck.some((c) => c.slug === 'skyscraper') && !p.field ? 120 : 0);
      break;
    case 'elemental-hero-rampart-blaster':
      worth += 380;
      break;
    case 'elemental-hero-wildedge':
      worth += sum * 0.3 + 200;
      break;
    case 'elemental-hero-wild-wingman':
      worth += 300;
      break;
    case 'elemental-hero-darkbright':
      worth += 320;
      break;
    case 'elemental-hero-phoenix-enforcer':
      worth += 220;
      break;
    case 'elemental-hero-shining-phoenix-enforcer':
      worth += 320;
      break;
    case 'elemental-hero-mudballman':
      worth += 260;
      break;
    case 'elemental-hero-mariner':
      worth += 200 + (max > 0 ? 150 : 0);
      break;
    case 'elemental-hero-steam-healer':
      worth += 220;
      break;
  }
  if (p.field?.slug === 'skyscraper') worth += 150;
  return worth;
}

/** The materials a Fusion could be built from right now: known hand cards and own bodies. */
function materialsOf(state: DuelState, me: PlayerId): { slug: string; cost: number }[] {
  const p = state.players[me];
  const out: { slug: string; cost: number }[] = [];
  for (const h of p.hand) if (known(h) && CARDS[h.slug]?.kind === 'monster') out.push({ slug: h.slug, cost: 220 });
  for (const m of p.monsters) {
    if (!m || m.isToken) continue;
    out.push({ slug: m.slug, cost: effAtk(state, m, me) * 0.3 + 60 });
  }
  return out;
}

/** Whether `recipe` can be paid from `pool`, and what that costs; null if it cannot. */
function pay(recipe: readonly string[], pool: { slug: string; cost: number }[]): number | null {
  const left = pool.map((m) => ({ ...m, used: false }));
  let cost = 0;
  for (const need of recipe) {
    /* The cheapest copy that fits — a body already on the field is dearer
       than the same card in hand, and a card in hand is a card. */
    let pick = -1;
    for (let i = 0; i < left.length; i++) {
      if (left[i].used || left[i].slug !== need) continue;
      if (pick < 0 || left[i].cost < left[pick].cost) pick = i;
    }
    if (pick < 0) return null;
    left[pick].used = true;
    cost += left[pick].cost;
  }
  return cost;
}

/**
 * How close the Polymerization is: in hand, or one Avian summon away.
 * Zero with neither, because a Fusion nothing can assemble is a picture.
 */
function polyAccess(state: DuelState, me: PlayerId): number {
  const p = state.players[me];
  if (p.hand.some((h) => known(h) && h.slug === 'polymerization')) return 1;
  const inDeck = p.deck.some((c) => c.slug === 'polymerization');
  if (!inDeck) return 0;
  const fetcher = p.hand.some((h) => known(h) && h.slug === 'elemental-hero-avian') && !p.normalSummonUsed;
  return fetcher ? 0.6 : 0;
}

/**
 * The Fusions this hand and board could put on the table, priced against
 * what they cost to make. The best one at a third of its value — it is a
 * turn waiting to happen, not a turn taken — and the runner-up at a tenth,
 * so a hand holding two lines outranks a hand holding one.
 */
function fusionReadiness(state: DuelState, me: PlayerId, extraPool?: { slug: string; cost: number }[]): number {
  const access = polyAccess(state, me);
  if (access <= 0) return 0;
  const p = state.players[me];
  /* A Polymerization needs the Spell/Trap Zone to be activated in — see
     `fusionRoute`. Behind a Set trap the line waits for the trap to fire;
     behind a face-up card it waits for the card to leave. */
  const zone = !p.spellTrap ? 1 : p.spellTrap.face === 'down' ? 0.5 : 0.15;
  const pool = extraPool ?? materialsOf(state, me);
  const gains: number[] = [];
  for (const ex of p.extra) {
    const recipe = CARDS[ex.slug]?.fusionMaterials;
    if (!recipe?.length) continue;
    const cost = pay(recipe, pool);
    if (cost === null) continue;
    const gain = fusionWorth(state, me, ex.slug) - cost;
    if (gain > 0) gains.push(gain);
  }
  if (!gains.length) return 0;
  gains.sort((a, b) => b - a);
  return zone * access * (gains[0] * 0.35 + (gains[1] ?? 0) * 0.1);
}

/**
 * Winged Kuriboh LV10 is not a monster, it is the answer to a board: it flies
 * over the fight, and the moment it lands a hit their every monster is gone
 * and its ATK is billed to them. Holding the little one and the Wings is
 * therefore worth exactly what stands across the table — nothing against an
 * empty field, most of a duel against a full one.
 */
function wingsOption(state: DuelState, me: PlayerId): number {
  const p = state.players[me];
  if (!p.hand.some((h) => known(h) && h.slug === 'transcendent-wings')) return 0;
  const lv10 = [...p.hand, ...p.deck, ...p.grave].some((c) => c.slug === 'winged-kuriboh-lv10');
  if (!lv10) return 0;
  const onField = p.monsters.some((m) => m?.slug === 'winged-kuriboh');
  const inHand = p.hand.some((h) => known(h) && h.slug === 'winged-kuriboh');
  if (!onField && !inHand) return 0;
  /* A Kuriboh still in hand needs a Normal Summon first — this turn if it is
     unspent, next turn if not. */
  const reach = onField ? 1 : p.normalSummonUsed ? 0.35 : 0.7;
  const t = theirBoard(state, me);
  const board = t.atks.reduce((a, b) => a + b, 0) + t.hidden * 1000;
  return reach * (80 + Math.min(2400, board * 0.3));
}

/** The whole of what the deck knows, on top of the general evaluation. */
function bonus(state: DuelState, me: PlayerId): number {
  return fusionReadiness(state, me) + wingsOption(state, me);
}

function findCard(state: DuelState, me: PlayerId, uid: string): CardInstance | null {
  const p = state.players[me];
  return (
    p.hand.find((c) => c.uid === uid) ??
    p.deck.find((c) => c.uid === uid) ??
    p.grave.find((c) => c.uid === uid) ??
    p.monsters.find((c) => c?.uid === uid) ??
    p.extra.find((c) => c.uid === uid) ??
    null
  );
}

/**
 * Which HERO. The engine's default takes the biggest number; the deck knows
 * better: a card fetched to the hand is worth the Fusion it completes, a body
 * called to the field is worth what it does on arrival, and Bubbleman on an
 * empty field is two cards and a body for free.
 */
function rankChoice(state: DuelState, me: PlayerId, pending: PendingChoice): string[] | null {
  const p = state.players[me];
  const summoning = /Special Summon/i.test(pending.reason);
  const heroesInHand = p.hand.filter((h) => isHero(h.slug)).length;
  const fusionsInGrave = p.grave.filter((c) => isFusion(c.slug)).length;
  const myField = p.monsters.filter((m): m is CardInstance => !!m);
  const t = theirBoard(state, me);
  const theirBest = t.atks.length ? Math.max(...t.atks) : 0;
  const myBest = myField.length ? Math.max(...myField.map((m) => effAtk(state, m, me))) : 0;
  const base = materialsOf(state, me);
  const readyNow = fusionReadiness(state, me, base);

  const worthOf = (c: CardInstance): number => {
    const slug = c.slug;
    if (summoning) {
      /* Arriving on the field. Effective ATK plus what the arrival pays. */
      let v = baseAtk(slug) * 0.3;
      switch (slug) {
        case 'elemental-hero-bladedge':
          v += 1000 * 0.3 * (heroesInHand - (p.hand.some((h) => h.uid === c.uid) ? 1 : 0));
          break;
        case 'elemental-hero-sparkman':
          v += 1000 * 0.3 * fusionsInGrave + 120;
          break;
        case 'elemental-hero-bubbleman':
          v += 440;
          break;
        case 'elemental-hero-burstinatrix':
          v += 500 * t.hand * 0.6;
          break;
        case 'elemental-hero-avian':
          v += (p.deck.some((d) => d.slug === 'polymerization') ? 200 : 0) + (t.backrow ? 250 : 120);
          break;
        case 'elemental-hero-wildheart':
          v += (t.backrow ? 300 : 80) + 200;
          break;
        case 'elemental-hero-necroshade':
          v += 350;
          break;
        case 'elemental-hero-clayman':
          v += theirBest > 1500 ? 200 : 0;
          break;
      }
      return v;
    }
    /* Coming to the hand. */
    let v = baseAtk(slug) * 0.12;
    if (CARDS[slug]?.kind === 'monster') {
      const withIt = fusionReadiness(state, me, [...base, { slug, cost: 220 }]);
      v += Math.max(0, withIt - readyNow) * 1.2;
    }
    switch (slug) {
      case 'polymerization':
        v += fusionReadiness(state, me, base) > 0 ? 400 : 150;
        break;
      case 'elemental-hero-bubbleman':
        v += myField.length === 0 ? 420 : 60;
        break;
      case 'elemental-hero-bladedge':
        v += p.hand.every((h) => h.uid === c.uid || CARDS[h.slug]?.kind !== 'monster') ? 420 : heroesInHand * 60;
        break;
      case 'elemental-hero-burstinatrix':
        v += p.normalSummonUsed ? 60 : 150 * Math.min(4, t.hand) * 0.6;
        break;
      case 'elemental-hero-avian':
        v += p.deck.some((d) => d.slug === 'polymerization') ? 180 : 40;
        break;
      case 'elemental-hero-sparkman':
        v += 90 * fusionsInGrave + 40;
        break;
      case 'elemental-hero-clayman':
        v += theirBest > myBest ? 220 : 60;
        break;
      case 'elemental-hero-necroshade':
        v += 90;
        break;
      case 'elemental-hero-wildheart':
        v += t.backrow ? 160 : 40;
        break;
      case 'skyscraper':
        v += p.field ? 0 : 160;
        break;
      case 'winged-kuriboh':
        v += theirBest > 2000 ? 200 : 80;
        break;
    }
    return v;
  };

  const ranked = pending.options
    .map((uid) => ({ uid, c: findCard(state, me, uid) }))
    .filter((x): x is { uid: string; c: CardInstance } => !!x.c)
    .map((x) => ({ uid: x.uid, worth: worthOf(x.c) }))
    .sort((a, b) => b.worth - a.worth);
  return ranked.length ? ranked.map((r) => r.uid) : null;
}

export const JADEN: DuelistBrain = { id: 'jaden', bonus, rankChoice };
