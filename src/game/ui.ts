/**
 * Helpers the interface uses to work out what a card will ask the player for
 * before it is activated — derived from the effect data itself, so new cards
 * never need bespoke UI wiring.
 */
import { CARDS } from './cards';
import type { CardDef, CardEffect, CardFilter, CardInstance, DuelState, Op, PlayerId, Trigger } from './types';

export interface TargetSpec {
  /** Whose cards may be picked. */
  side: 'own' | 'opp' | 'both';
  zone: 'monster' | 'spellTrap' | 'backrow' | 'grave' | 'hand' | 'deck';
  count: number;
  prompt: string;
  /** Narrows what may be picked — a Deck search is rarely "any card". */
  filter?: CardFilter;
}

function scanOps(ops: Op[]): TargetSpec | null {
  for (const op of ops) {
    if (op.op === 'coinFlip') {
      const r = scanOps(op.heads) ?? scanOps(op.tails);
      if (r) return r;
      continue;
    }
    if (op.op === 'diceRoll') {
      const r = scanOps(op.perPip);
      if (r) return r;
      continue;
    }
    if (op.op === 'specialSummon' && (op.from === 'grave' || op.from === 'hand')) {
      return {
        side: op.side === 'both' ? 'both' : 'own',
        zone: op.from === 'grave' ? 'grave' : 'hand',
        /* The op's own count, not a hardcoded 1. The Flute of Summoning Dragon
           brings out *two* Dragons and only ever asked for one, so it resolved
           the moment the first was picked and chose the second itself. */
        count: op.count ?? 1,
        prompt: 'Choose a monster to Special Summon',
        filter: op.filter,
      };
    }
    if (op.op === 'search') {
      return {
        side: 'own',
        zone: 'deck',
        count: op.count ?? 1,
        prompt: 'Choose a card to add to your hand',
        filter: op.filter,
      };
    }
    /* An equip that names its own host asks the player nothing. Spellbinding
       Circle attaches to the monster that just declared the attack, and
       falling through to the prompt below pointed the picker at the
       *responder's* own Monster Zones — so the card could not be activated at
       all when they controlled nothing, which is precisely when they are being
       attacked directly and want it most. */
    if (op.op === 'equipTo') {
      if (op.target) continue;
      return { side: 'own', zone: 'monster', count: 1, prompt: 'Choose a monster to equip' };
    }
    if ('target' in op && op.target && op.target.pick === 'chosen') {
      const zone = (op.target.zone ?? 'monster') as TargetSpec['zone'];
      const verb =
        op.op === 'destroy'
          ? 'Choose a card to destroy'
          : op.op === 'takeControl'
            ? 'Choose a monster to take'
            : op.op === 'absorb'
              ? 'Choose a monster to absorb'
              : op.op === 'bounce'
                ? 'Choose a card to return'
                : 'Choose a target';
      return { side: op.target.side, zone, count: op.target.count ?? 1, prompt: verb };
    }
  }
  return null;
}

function specFromEffect(eff: CardEffect): TargetSpec | null {
  const spec = scanOps(eff.ops);
  if (spec) return { ...spec, count: Math.max(spec.count, eff.targets ?? 1) };
  /* A cost is a choice too. Catapult Turtle says "Tribute 1 monster you
     control" and asked for nothing, so the engine paid with whatever happened
     to be standing in the first zone — invisible while the damage was a flat
     1000, and the whole card once it is worth what it throws. `tributeSelf`
     pays with the card itself and has nothing to ask. */
  if (eff.cost?.tribute && !eff.cost.tributeSelf) {
    return {
      side: 'own',
      zone: 'monster',
      count: eff.cost.tribute,
      prompt: 'Choose a monster to Tribute',
      filter: eff.cost.tributeFilter,
    };
  }
  return null;
}

/** What the player must pick before this card's effect can be sent. */
export function targetSpecFor(slug: string, trigger: Trigger): TargetSpec | null {
  const def: CardDef | undefined = CARDS[slug];
  if (!def) return null;
  const eff = def.effects.find((e) => e.trigger === trigger);
  if (!eff) return null;
  return specFromEffect(eff);
}

/**
 * Every card a target spec can legally reach, from the picking player's side.
 *
 * Lives here rather than inside the board so it can be asked a question
 * directly. It was a closure in `Duel.tsx`, which meant the only way to check
 * it was to re-implement it — and a test that re-implements the rule agrees
 * with the bug. This one honoured the filter for a Deck search and ignored it
 * for the Graveyard and the hand, so Valkyrion coming apart offered the
 * *entire* Graveyard for an effect that names exactly which three cards it
 * takes. That is also what opened the prompt at all: the interface only asks
 * when more cards qualify than the effect will take.
 */
export function targetCandidates(
  state: DuelState,
  viewer: PlayerId,
  spec: TargetSpec,
  isUntargetable: (c: CardInstance, owner: PlayerId) => boolean = () => false
): CardInstance[] {
  const foe: PlayerId = viewer === 'p1' ? 'p2' : 'p1';
  const sides: PlayerId[] = spec.side === 'own' ? [viewer] : spec.side === 'opp' ? [foe] : [viewer, foe];
  const out: CardInstance[] = [];
  const keep = (c: CardInstance) => matchesSpec(c, spec.filter);
  for (const pid of sides) {
    const p = state.players[pid];
    if (spec.zone === 'monster') {
      out.push(
        ...p.monsters
          .filter((m): m is CardInstance => !!m && keep(m))
          /* What the engine will actually accept. Celtic Guardian cannot be
             targeted by the opponent's effects and was still offered — Ring of
             Destruction pointed at it destroyed nothing. */
          .filter((m) => pid === viewer || !isUntargetable(m, pid))
      );
    } else if (spec.zone === 'spellTrap' || spec.zone === 'backrow') {
      if (p.spellTrap) out.push(p.spellTrap);
      /* Only `backrow` reaches the Field Zone. `spellTrap` offering it was the
         client and the engine disagreeing about what the words meant, with the
         player pointing at a card nothing would destroy. */
      if (spec.zone === 'backrow' && p.field) out.push(p.field);
    } else if (spec.zone === 'grave') {
      out.push(...p.grave.filter((c) => CARDS[c.slug]?.kind === 'monster' && keep(c)));
    } else if (spec.zone === 'deck' && pid === viewer) {
      out.push(...p.deck.filter(keep));
    } else if (spec.zone === 'hand' && pid === viewer) {
      out.push(...p.hand.filter(keep));
    }
  }
  return out;
}

/** The subset of the engine's card filter these pickers actually use. */
function matchesSpec(c: CardInstance, f?: CardFilter): boolean {
  if (!f) return true;
  const def = CARDS[c.slug];
  if (!def) return false;
  if (f.kind && def.kind !== f.kind) return false;
  if (f.type && def.type !== f.type) return false;
  if (f.excludeType && def.type === f.excludeType) return false;
  if (f.attribute && def.attribute !== f.attribute) return false;
  if (f.minLevel != null && (def.level ?? 0) < f.minLevel) return false;
  if (f.maxLevel != null && (def.level ?? 0) > f.maxLevel) return false;
  if (f.minAtk != null && (def.atk ?? 0) < f.minAtk) return false;
  if (f.maxAtk != null && (def.atk ?? 0) > f.maxAtk) return false;
  if (f.slugs && !f.slugs.includes(c.slug)) return false;
  if (f.nameIncludes && !def.name.toLowerCase().includes(f.nameIncludes.toLowerCase())) return false;
  return true;
}

export function effectLabel(slug: string, trigger: Trigger): string {
  const def = CARDS[slug];
  const eff = def?.effects.find((e) => e.trigger === trigger);
  return eff?.label ?? def?.name ?? 'Activate';
}

export function hasTrigger(slug: string, trigger: Trigger): boolean {
  return !!CARDS[slug]?.effects.some((e) => e.trigger === trigger);
}

/**
 * True when summoning this card will ask the player to choose a target.
 * Both summon triggers count: a card that only reacts to a Normal Summon still
 * needs its target picked at the moment it is Normal Summoned.
 */
export function summonTargetSpec(slug: string): TargetSpec | null {
  return targetSpecFor(slug, 'onSummon') ?? targetSpecFor(slug, 'onNormalSummon');
}

export const KIND_LABEL: Record<string, string> = {
  monster: 'Monster',
  spell: 'Spell',
  trap: 'Trap',
};
