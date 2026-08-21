/**
 * Every card in every deck must actually be playable.
 *
 * The card audit resolves each effect directly and proves it does what it says.
 * That is a different question from whether a player can ever *reach* the
 * effect — and three cards failed the second question while passing the first:
 * The Dark Door, Dark Sanctuary and Umi are Continuous or Field Spells whose
 * whole effect is an aura, so they carry no `activate` trigger, and the rule
 * that decides what may be played from the hand asked for one. They sat dead in
 * their owners' hands and the audit was perfectly happy.
 *
 * So this asks the engine itself, through the same gates the interface uses.
 *
 *   npx tsx scripts/playable-check.ts
 */
import {
  canActivateFromHand,
  canActivateSetCard,
  createDuel,
  isExtraDeckCard,
  matchesFilter,
  summonBlocked,
  tributesRequired,
} from '../src/game/engine';
import { CARDS, DUELISTS } from '../src/game/cards';
import { MONSTER_ZONES } from '../src/game/types';
import type { CardInstance, DuelState, Op, PlayerId } from '../src/game/types';

/** A monster slug this card's equip would accept, if it insists on a kind. */
function hostFor(slug: string): string | null {
  for (const eff of CARDS[slug]?.effects ?? []) {
    for (const op of eff.ops) {
      if (op.op !== 'equipTo' || !op.filter) continue;
      const match = Object.values(CARDS).find(
        (d) => d.kind === 'monster' && !isExtraDeckCard(d.slug) && matchesFilter({ slug: d.slug } as CardInstance, op.filter)
      );
      if (match) return match.slug;
    }
  }
  return null;
}

/**
 * A monster this card's Special Summon would accept, and the pile to put it in.
 *
 * Same shape and same reason as `hostFor` above: once a Spell that summons
 * nothing stopped being activatable — the Scapegoat report generalised — six
 * cards read as dead because the probe held no Dragon for the Flute, no
 * Machine for the Conversion Factory and no Relinquished for its Ritual. That
 * is a fault in the probe, not the cards.
 *
 * Read off the card, so the next one to name a requirement is stocked for
 * without anybody editing this. Monsters that answer to a ladder of their own
 * are skipped — the engine refuses those to every summon but their own rung,
 * so putting one in the pile would prove nothing.
 */
function fodderFor(slug: string): { zone: 'hand' | 'deck' | 'grave'; slug: string }[] {
  const out: { zone: 'hand' | 'deck' | 'grave'; slug: string }[] = [];
  const PILES = ['hand', 'deck', 'grave'] as const;
  for (const eff of CARDS[slug]?.effects ?? []) {
    for (const op of eff.ops) {
      if (op.op !== 'specialSummon') continue;
      const from = Array.isArray(op.from) ? op.from : [op.from];
      const zones = PILES.filter((z) => from.includes(z));
      if (!zones.length) continue;
      const match = Object.values(CARDS).find(
        (d) =>
          d.kind === 'monster' &&
          !isExtraDeckCard(d.slug) &&
          !d.summonRequires &&
          !d.summonOnlyBy?.length &&
          matchesFilter({ slug: d.slug } as CardInstance, op.filter)
      );
      if (match) out.push({ zone: zones[0], slug: match.slug });
    }
  }
  return out;
}

/**
 * A duel parked in Main Phase holding the card, with a board and a hand behind
 * it. The board matters: several cards cost a tribute or a discard, and probing
 * from an empty field reports them unplayable when they are merely unaffordable
 * — which is a fault in the probe, not the card.
 *
 * The *opponent's* board matters for exactly the same reason, and was empty:
 * once a Spell whose headline op has nothing to work on stopped being
 * activatable — De-Spell was being played at an empty Spell/Trap Zone, which
 * is what Mai kept doing — twelve perfectly good cards read as dead. So the
 * other seat gets monsters and a face-up Spell to point at too. A card is only
 * unplayable if it cannot be played against a board with something on it.
 */
function stateHolding(slug: string): { state: DuelState; card: CardInstance; me: PlayerId } {
  const state = createDuel({
    seed: 7,
    p1: { duelistId: 'yugi', name: 'A' },
    p2: { duelistId: 'kaiba', name: 'B' },
    firstPlayer: 'p1',
  });
  state.turn = 3; // past the first turn, so nothing is restricted by it
  state.phase = 'main';
  state.active = 'p1';
  const p = state.players.p1;
  p.spellTrap = null;
  p.field = null;
  const spare = (n: number, s = 'kuriboh'): CardInstance => ({ ...p.deck[0], uid: `spare${n}`, slug: s, face: 'up' });
  /* The Field Spell a card insists on standing beside. Tornado Wall says
     "activate only while Umi is on the field" and means it — once the door
     that flips a Set Trap up on your own turn started asking the condition,
     an empty Field Zone read as a card nobody could ever use. Read off the
     card, like the equip host and the summon fodder below it. */
  const needsField = (CARDS[slug]?.effects ?? []).find((e) => e.condition?.requiresField)?.condition?.requiresField;
  if (needsField) p.field = spare(8, needsField);
  /* Two bodies to tribute, and spare cards to discard. One of the bodies is a
     Winged Beast: a card may be gated on controlling a type — Phoenix
     Formation wants a Harpie flying it — and a probe that owns only Kuriboh
     reports such a card unplayable when it is merely alone. The same fault
     as probing from an empty field, one clause over. */
  p.monsters = [spare(1), spare(2, 'harpie-lady'), null];
  /* An equip that names what it fits needs one of those standing, or the probe
     reports a perfectly good card unplayable for a reason that is entirely
     about this board. 7 Completed bolts onto Machines alone, and the two bodies
     above are a Fiend and a Winged Beast.

     Read off the card rather than hard-coded, because the next equip to name a
     type would otherwise fail here in exactly the same way — and the report
     would again look like the card's fault. Same fix as `stockHostFor` in the
     audit, which learned this one card earlier. */
  const fitted = hostFor(slug);
  if (fitted) p.monsters[2] = spare(7, fitted);
  const card: CardInstance = { ...p.deck[0], uid: `probe_${slug}`, slug, face: 'up' };
  p.hand = [card, spare(3), spare(4)];
  /* And something already buried. A card conditioned on the Graveyard —
     Millennium Ankh pays 1000 Life Points to bring two bodies back — is
     perfectly playable in any real duel and completely dead from an empty
     Graveyard, which is the same fault as probing from an empty field, two
     clauses over. Two monsters, because the cards that read the Graveyard
     tend to want more than one. */
  p.grave = [spare(5, 'summoned-skull'), spare(6, 'battle-ox')];

  /* And whoever the card came to call. */
  fodderFor(slug).forEach((f, i) => {
    const body = spare(20 + i, f.slug);
    if (f.zone === 'hand') p.hand.push(body);
    else if (f.zone === 'grave') p.grave.push(body);
    else p.deck.push(body);
  });

  /* Something to aim at. Two monsters rather than one because a couple of
     cards want a choice, and an Insect among them because Weevil's Eradicating
     Aerosol only destroys those. The face-up Spell is what De-Spell and
     Harpie's Feather Duster are for.

     One of each posture, because a card that changes a monster's position is
     dead against a board already standing that way: Stop Defense read as
     unplayable against two attackers, which is exactly what the card would do
     in a real duel — nothing. */
  const o = state.players.p2;
  const theirs = (n: number, s: string): CardInstance => ({ ...o.deck[0], uid: `theirs${n}`, slug: s, face: 'up', position: 'atk' });
  o.monsters = [theirs(1, 'hitotsu-me-giant'), { ...theirs(2, 'basic-insect'), position: 'def' }, null];
  o.spellTrap = { ...theirs(3, 'de-spell'), face: 'up' };
  o.field = null;
  return { state, card, me: 'p1' };
}

/**
 * The card that brings a monster out when it cannot simply be Normal Summoned:
 * the card it names as a requirement, or whichever Ritual Spell Special Summons
 * it. Without one of those in the same deck the monster is a dead draw.
 */
function summonRoute(slug: string): string | null {
  const def = CARDS[slug];
  if (def?.summonRequires) return def.summonRequires;
  /* Down through the branches, not only across the top. A route can sit inside
     a coin flip (Time Wizard's Thousand Dragon), a dice roll, or a counter tier
     (the Cocoon giving up whichever moth it has grown into), and a flat scan of
     `eff.ops` sees none of those — it would call a perfectly reachable card a
     dead draw, or worse, miss that its only route had been removed. */
  const reaches = (ops: Op[]): boolean =>
    ops.some((op) => {
      if (op.op === 'specialSummon' && op.filter?.slugs?.includes(slug)) return true;
      // `search` counts too — Toon Alligator fetches the Toon World that the
      // rest of the Toons need before they can be Summoned at all.
      if (op.op === 'search' && op.filter?.slugs?.includes(slug)) return true;
      if (op.op === 'coinFlip') return reaches(op.heads) || reaches(op.tails);
      if (op.op === 'diceRoll') return reaches(op.perPip);
      if (op.op === 'byCounters') return op.tiers.some((t) => reaches(t.ops));
      return false;
    });
  for (const other of Object.values(CARDS)) {
    for (const eff of other.effects) if (reaches(eff.ops)) return other.slug;
  }
  return null;
}

const inDecks = new Map<string, string[]>();
for (const d of DUELISTS) {
  for (const [slug] of d.deck) inDecks.set(slug, [...(inDecks.get(slug) ?? []), d.name]);
  for (const s of d.extra) inDecks.set(s, [...(inDecks.get(s) ?? []), `${d.name} (Extra)`]);
}

const dead: string[] = [];
let checked = 0;

for (const [slug, owners] of inDecks) {
  const def = CARDS[slug];
  if (!def) {
    dead.push(`${slug} — no such card, held by ${owners.join(', ')}`);
    continue;
  }
  checked += 1;

  if (def.kind === 'monster') {
    // A monster is reachable if it can be Normal Summoned with the tributes it
    // asks for, or if it lives in an Extra Deck and is fusion-summoned.
    /* Extra Deck cards are validated by the Extra Deck pass above, and cannot
       be Normal Summoned at all — `isFusion` was standing in for that and got
       Valkyrion wrong, which the database does not flag as a Fusion. */
    if (isExtraDeckCard(slug)) continue;
    const { state } = stateHolding(slug);
    /* Some monsters are deliberately not Normal Summonable — a Ritual comes out
       through its Ritual Spell, a Toon needs Toon World down first. Those are
       reachable through another card, so what has to be checked is that the
       other card exists in the same deck and can itself be played. */
    const gate = summonBlocked(state, 'p1', slug);
    if (gate) {
      const route = summonRoute(slug);
      if (!route) {
        dead.push(`${def.name} (${slug}) cannot be Normal Summoned (${gate}) and nothing in the deck brings it out`);
        continue;
      }
      for (const owner of owners) {
        const d = DUELISTS.find((x) => x.name === owner || `${x.name} (Extra)` === owner);
        if (d && !d.deck.some(([s]) => s === route) && !d.extra.includes(route)) {
          dead.push(`${def.name} (${slug}) needs ${route}, which is not in ${owner}'s deck`);
        }
      }
      continue;
    }
    /* A Tribute Summon makes its own room: the tributes are paid first and the
       monster takes one of the zones they just left, so three tributes on a
       three-zone board is payable — you simply have to commit the whole field
       to it, which is exactly what a God is supposed to cost. Written as
       `need > 2` back when two was the ceiling, this called Slifer unplayable
       while the engine summoned him perfectly well. */
    const need = tributesRequired(slug, state, 'p1');
    if (need > MONSTER_ZONES) {
      dead.push(`${slug} needs ${need} tributes — more than ${MONSTER_ZONES} Monster Zones can ever field`);
    }
    continue;
  }

  if (slug === 'polymerization') continue; // reached through the Fusion button

  const { state, card } = stateHolding(slug);
  if (def.kind === 'trap') {
    /* Most traps are never tapped at all — they are offered in a response
       window when their moment comes (an attack declared, a monster summoned)
       and are reachable through that. Only the ones meant to be flipped by
       hand go through `canActivateSetCard`, so a trap is unreachable only if
       it carries no trap trigger whatsoever. */
    const windows = def.effects.filter((e) => e.trigger === 'trap');
    if (windows.length === 0) {
      dead.push(`${def.name} (${slug}) has no trap window at all — held by ${owners.join(', ')}`);
      continue;
    }
    if (windows.some((e) => e.window === 'anyOpponentTurn')) {
      state.players.p1.hand = [];
      card.face = 'down';
      card.summonedOnTurn = state.turn - 1;
      state.players.p1.spellTrap = card;
      if (!canActivateSetCard(state, 'p1', card)) {
        dead.push(`${def.name} (${slug}) is meant to be flipped by hand but cannot be — held by ${owners.join(', ')}`);
      }
    }
    continue;
  }

  if (!canActivateFromHand(state, 'p1', card)) {
    dead.push(`${def.name} (${slug}) can never be played from the hand — held by ${owners.join(', ')}`);
  }
}

/* ---------------------------------------------------------------------- *
 * The Extra Deck, which the loop above never sees.
 *
 * Every check here drives a card the player could hold. A Fusion monster is
 * never held, so nothing was asking whether one could actually come out — and
 * four duelists were carrying a Polymerization with no Fusion to summon, which
 * is a dead card in a twenty-five card deck, plus Mai had a Normal Spell filed
 * in her Extra Deck where it could never be reached at all.
 *
 * Polymerization is the whole relationship: it does nothing on its own, so it
 * is only playable if some Fusion in the same Extra Deck has a recipe whose
 * materials are in the same main deck.
 * ---------------------------------------------------------------------- */
for (const du of DUELISTS) {
  const owned: Record<string, number> = {};
  for (const [slug, n] of du.deck) owned[slug] = (owned[slug] ?? 0) + n;

  const summonable: string[] = [];
  for (const slug of du.extra ?? []) {
    const def = CARDS[slug];
    if (!def) {
      dead.push(`${slug} is in ${du.name}'s Extra Deck but is not a card`);
      continue;
    }
    /* A Fusion recipe is not the only way out of the Extra Deck. Thousand
       Dragon has none on purpose — Time Wizard's heads Special Summons it from
       there, which is the whole reward for taking the coin flip. So before
       calling an Extra Deck card unreachable, ask whether anything in the same
       main deck names it in a `specialSummon ... from: 'extra'`. */
    const calledOut = du.deck.some(([mainSlug]) =>
      (CARDS[mainSlug]?.effects ?? []).some(function reaches(eff): boolean {
        const scan = (ops: readonly Op[]): boolean =>
          ops.some((o) => {
            if (o.op === 'coinFlip') return scan(o.heads) || scan(o.tails);
            if (o.op === 'diceRoll') return scan(o.perPip);
            if (o.op !== 'specialSummon') return false;
            const from = Array.isArray(o.from) ? o.from : [o.from];
            return from.includes('extra') && !!o.filter?.slugs?.includes(slug);
          });
        return scan(eff.ops);
      })
    );

    const recipe = def.fusionMaterials ?? [];
    if (!recipe.length) {
      if (calledOut) {
        summonable.push(slug);
        continue;
      }
      dead.push(
        `${def.name} (${slug}) sits in ${du.name}'s Extra Deck with no Fusion recipe and nothing in the deck ` +
          'Special Summons it from there, so it can never be summoned'
      );
      continue;
    }
    const need: Record<string, number> = {};
    for (const m of recipe) need[m] = (need[m] ?? 0) + 1;
    const missing = Object.entries(need).filter(([m, n]) => (owned[m] ?? 0) < n);
    if (missing.length) {
      dead.push(
        `${def.name} (${slug}) needs ${recipe.join(' + ')}, but ${du.name}'s deck is missing ` +
          missing.map(([m, n]) => `${m} ×${n - (owned[m] ?? 0)}`).join(', ')
      );
      continue;
    }
    /* A free Fusion is its own enabler — the three Magnet Warriors combine
       with no card spent, so Valkyrion is reachable in a deck holding no
       Polymerization at all. Asking for one anyway would refuse a deck that
       works, which is the same fault as the tribute ceiling below. */
    if (!owned['polymerization'] && !def.fusionFree) {
      dead.push(`${def.name} (${slug}) is in ${du.name}'s Extra Deck but the deck has no Polymerization`);
      continue;
    }
    summonable.push(slug);
  }

  /* A Polymerization is only earning its slot if some Fusion in the same Extra
     Deck *needs* it — one that assembles for free does not, so it cannot be
     the reason the card is in the deck. */
  if (owned['polymerization'] && !summonable.some((s) => !CARDS[s].fusionFree)) {
    dead.push(`Polymerization is in ${du.name}'s deck with no Fusion monster it can ever summon`);
  }
}

console.log(`Playability — ${checked} distinct cards across ${DUELISTS.length} decks\n`);
if (dead.length) {
  console.log('Cards a player can never use:');
  for (const d of dead) console.log(`  ❌ ${d}`);
  console.log(`\n${dead.length} unplayable card(s)`);
  process.exitCode = 1;
} else {
  console.log('Every card in every deck can be played. ✅');
}
