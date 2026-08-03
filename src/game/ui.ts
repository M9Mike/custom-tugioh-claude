/**
 * Helpers the interface uses to work out what a card will ask the player for
 * before it is activated — derived from the effect data itself, so new cards
 * never need bespoke UI wiring.
 */
import { CARDS } from './cards';
import type { CardDef, CardEffect, CardFilter, Op, Trigger } from './types';

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
