/**
 * Helpers the interface uses to work out what a card will ask the player for
 * before it is activated — derived from the effect data itself, so new cards
 * never need bespoke UI wiring.
 */
import { CARDS } from './cards';
import { changesAnything, matchesFilter, revivable } from './targeting';
import type { CardDef, CardEffect, CardFilter, CardInstance, DuelState, Op, PlayerId, Trigger } from './types';

export interface TargetSpec {
  /** Whose cards may be picked. */
  side: 'own' | 'opp' | 'both';
  /* `handOrDeck` is one pool spanning both, because that is what a card like
     Fortress Whale's Oath reaches into — "from your hand or Deck" is a single
     choice, not two prompts, and the copy you hold and the copy you have not
     drawn are the same option to the player. `deckOrGrave` and
     `handOrDeckOrGrave` are the same idea one and two piles wider: Gamma the
     Magnet Warrior fetches a brother "from your hand, Deck or Graveyard", and
     offering only some of those piles is the picker being narrower than the
     engine — the bug this file keeps relearning. */
  zone:
    | 'monster'
    | 'spellTrap'
    | 'backrow'
    | 'grave'
    | 'hand'
    | 'deck'
    | 'handOrDeck'
    | 'deckOrGrave'
    | 'handOrDeckOrGrave';
  count: number;
  prompt: string;
  /** Narrows what may be picked — a Deck search is rarely "any card". */
  filter?: CardFilter;
  /**
   * Only monsters this player could legally have on the field.
   *
   * A Toon Summoned Skull in the Graveyard is not a summon option with the
   * Field Zone empty, and offering it was the picker and the engine disagreeing
   * about the rule — the same class of bug as the Graverobber's empty modal.
   * State-dependent, so it cannot be a `CardFilter`.
   */
  revivableOnly?: boolean;
  /**
   * Who is asking, for `revivableOnly`. The Perfectly Ultimate Great Moth may
   * only be put on the field by its own ladder, and a picker that did not say
   * whose effect it belonged to would lay it out and then watch the engine
   * refuse it — the picker and the engine disagreeing about the rule, one more
   * time.
   */
  revivableBy?: string;
  /**
   * The op doing the asking, when what it does depends on how the target is
   * already standing. Stop Defense cannot drag a monster into Attack Position
   * that is standing there, so that monster is not one of its answers.
   * State-dependent, like `revivableOnly`, so it cannot be a `CardFilter`
   * either — and the rule itself lives in `targeting.ts`, where the engine's
   * own gate reads it.
   */
  changing?: string;
}

/**
 * The zones where two cards of the same name are two different answers.
 *
 * On the field they always are: one Summoned Skull is wearing an Axe of
 * Despair and kneeling, the other is standing bare, and "destroy one of them"
 * is a real decision. Everywhere else — a hand, a Deck, a Graveyard — a card
 * is only its name, and `resetInstance` has already wiped anything that could
 * have told the copies apart.
 */
const LIVE_ZONES = new Set<TargetSpec['zone']>(['monster', 'spellTrap', 'backrow']);

/**
 * Whether this pool holds a decision, which is not the same as holding more
 * cards than the effect will take.
 *
 * Two copies of Keldo in your Deck are one answer, not two, and a prompt that
 * lays them side by side is asking the player to pick a card off a shuffled
 * pile at random and call it a choice. The board's own type already says so —
 * see the note on `handOrDeck`, "the copy you hold and the copy you have not
 * drawn are the same option to the player" — but the rule had never reached
 * the question of whether to ask at all.
 *
 * The test is not "more than one distinct name", because an effect taking two
 * cards out of two copies of A and one B has a genuine choice between A+A and
 * A+B. It is: more cards than we will take, AND more than one name among them.
 *
 * Asked by the engine in `raiseChoice` and by the board before it sends an
 * action. Both, or they disagree — and a board that asks a question the engine
 * would not raise is how a pick ends up matching nothing at all.
 */
export function worthAsking(spec: TargetSpec, options: CardInstance[], want: number): boolean {
  if (options.length <= want) return false;
  if (LIVE_ZONES.has(spec.zone)) return true;
  return new Set(options.map((c) => c.slug)).size > 1;
}

/**
 * Has this op already answered its own question?
 *
 * "Special Summon the weakest monster from your Deck" is not a choice — the
 * card has made it, and putting a modal in front of the player there is the
 * game asking something it already knows. Sangan says exactly that, and was
 * the first card to be asked a question it had answered in its own text.
 *
 * `random` counts, and is the sharper case: Lady of Faith reaches into the
 * Graveyard *without looking*, and that is not a worse version of choosing, it
 * is what the card is. A prompt there would not be giving the player a choice
 * back — it would be deleting the card's only mechanic.
 *
 * Every other `pick` — `chosen`, `attacker`, `all` — is either the question
 * itself or a target with no alternatives, and neither is ruled out here.
 */
const SELF_RULED = new Set(['strongest', 'weakest', 'random']);
function selfRuled(op: Op): boolean {
  return 'pick' in op && typeof op.pick === 'string' && SELF_RULED.has(op.pick);
}

function scanOps(ops: Op[], owner: string): TargetSpec | null {
  for (const op of ops) {
    if (selfRuled(op)) continue;
    if (op.op === 'coinFlip') {
      const r = scanOps(op.heads, owner) ?? scanOps(op.tails, owner);
      if (r) return r;
      continue;
    }
    if (op.op === 'diceRoll') {
      const r = scanOps(op.perPip, owner);
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
        /* "Monsters only" belongs to the *op*, not to the Graveyard.
           `targetCandidates` used to hardcode it into the grave branch, which
           was invisible while Monster Reborn and Call of the Haunted were the
           only cards that looked in there — and wrong the moment Graverobber
           did, because it takes any card and the pile in front of it held
           nothing but Spells and Traps. Reported from a real duel as "there is
           nothing it can target". Carried on the spec, each picker states its
           own rule and the zone stops guessing. */
        filter: { ...(op.filter ?? {}), kind: 'monster' },
        revivableOnly: true,
        revivableBy: owner,
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
    /* Naming tomorrow's draw is the whole card, so it has to be asked. The
       Temple of the Kings resolved with an empty target list and the engine
       took `deck[0]` — the card that was coming anyway, which is
       indistinguishable from the effect not existing. Reported by the owner as
       "it did not let me pick a card for the next draw". */
    if (op.op === 'destinyDraw') {
      return {
        side: 'own',
        zone: 'deck',
        count: 1,
        prompt: 'Choose the card you will draw next turn',
      };
    }
    /* And so is which Trap gets Set. The same silence sat on Mask of Darkness
       and Judgment of Anubis: the engine's fallback is "the first Trap in the
       pile", which in a Deck is whatever the shuffle left nearest — a choice
       the player was promised and never offered. */
    if (op.op === 'setTrap') {
      return {
        side: 'own',
        zone: op.from === 'deck' ? 'deck' : 'grave',
        count: 1,
        prompt: 'Choose a Trap to Set',
        filter: { kind: 'trap' },
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
      /* What it fits, not "any monster you control". 7 Completed bolts onto a
         Machine and nothing else, and the modal laid out every body on the
         board — so the player picked a Spellcaster, the equip correctly
         refused it at resolution, and the card was spent for nothing with the
         Spell/Trap Zone occupied. Reported. The engine's own gate reads the
         same filter; the two must not disagree about which hosts exist. */
      return {
        side: 'own',
        zone: 'monster',
        count: 1,
        prompt: 'Choose a monster to equip',
        filter: op.filter,
      };
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
      /* Which op is asking, so the picker can drop the monsters it would
         leave exactly as it found them. Stop Defense beside one kneeling
         monster and one already attacking is a legal card with one real
         answer, and the modal offered both — so the pick landed on the
         standing one and the card was spent changing nothing. The gate reads
         the same rule; the two must not disagree about which targets exist. */
      return { side: op.target.side, zone, count: op.target.count ?? 1, prompt: verb, changing: op.op };
    }
  }
  return null;
}

function specFromEffect(eff: CardEffect, owner: string): TargetSpec | null {
  const spec = scanOps(eff.ops, owner);
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
  /* Calling a monster out of the Deck. `scanOps` handles a Special Summon from
     the hand or the Graveyard and stops short of the Deck, which is a
     deliberate split rather than an oversight: this branch sits *after* the
     Tribute cost above, so a card that pays a price first is asked about the
     price first, and it cannot move into `scanOps` for that reason alone —
     Black Illusion Ritual would match it there, and its first question is which
     monster to Tribute, the summon coming after and asked by
     `summonRiderSpec`.

     What used to gate it was the effect's own `targets`, one card opting in at
     a time. Gravekeeper's Spy names *nine* possible Flip monsters and took the
     biggest one every single time, reported by the owner as "it should allow me
     to select which monster I would special summon" — and the fix was to switch
     that one card on. Eighty-odd others were still choosing for themselves, so
     the gate has gone; `worthAsking` keeps the silence where silence was the
     point. */
  {
    const summon = eff.ops.find((o) => o.op === 'specialSummon' && !selfRuled(o));
    if (summon && summon.op === 'specialSummon') {
      const zones = Array.isArray(summon.from) ? summon.from : [summon.from];
      if (zones.includes('deck')) {
        const zone: TargetSpec['zone'] = zones.includes('grave')
          ? zones.includes('hand')
            ? 'handOrDeckOrGrave'
            : 'deckOrGrave'
          : zones.includes('hand')
            ? 'handOrDeck'
            : 'deck';
        return {
          side: summon.side === 'both' ? 'both' : 'own',
          zone,
          count: summon.count ?? 1,
          prompt: 'Choose a monster to Special Summon',
          filter: { ...(summon.filter ?? {}), kind: 'monster' },
          revivableOnly: true,
          revivableBy: owner,
        };
      }
    }
  }
  /* And taking a card back out of a Graveyard. Graverobber is a player
     standing right there pressing a button, and Magician of Faith is a card
     turning face-up in the middle of somebody else's attack — the same
     question either way, and only the first of them was ever asked. */
  {
    const steal = eff.ops.find((o) => o.op === 'stealFromGrave' && !selfRuled(o));
    if (steal && steal.op === 'stealFromGrave') {
      return {
        /* An unset `from` is "either Graveyard", not the opponent's — which is
           what the engine has always done with it (`[own, theirs]`, own first)
           and the opposite of what this line used to say. Magician of Faith
           reaches into both piles and the picker would have offered her only
           the enemy's, so the one card she is actually for — your own Monster
           Reborn — was not among her answers. Invisible until she started
           asking, which is how this file keeps learning the same lesson: the
           picker and the engine must not hold two opinions about one word. */
        side: steal.from === 'own' ? 'own' : steal.from === 'opp' ? 'opp' : 'both',
        zone: 'grave',
        count: eff.targets ?? 1,
        prompt: 'Choose a card to take from the Graveyard',
        filter: steal.filter,
      };
    }
  }
  return null;
}

/** What the player must pick before this card's effect can be sent. */
export function targetSpecFor(slug: string, trigger: Trigger): TargetSpec | null {
  const def: CardDef | undefined = CARDS[slug];
  if (!def) return null;
  const eff = def.effects.find((e) => e.trigger === trigger);
  if (!eff) return null;
  return specFromEffect(eff, slug);
}

/**
 * The spec for one *named* effect on a card, rather than the first with a
 * matching trigger.
 *
 * Obelisk carries two ignitions, and the Fist of Fate's two-Tribute picker is
 * not the question the other one asks. `targetSpecFor` takes the first match,
 * which is right for every card that has one of a thing and silently wrong for
 * the first card that has two.
 */
export function targetSpecForEffect(slug: string, index: number): TargetSpec | null {
  const def: CardDef | undefined = CARDS[slug];
  const eff = def?.effects[index];
  if (!def || !eff) return null;
  return specFromEffect(eff, slug);
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
  isUntargetable: (c: CardInstance, owner: PlayerId) => boolean = () => false,
  /**
   * The card doing the asking, which is never one of its own answers.
   *
   * The engine has always struck it off — a monster does not Special Summon
   * itself with its own effect — but it did so in `raiseChoice` alone, so the
   * board kept its own opinion. Gamma the Magnet Warrior fetches a brother
   * "from your hand, Deck or Graveyard" and is itself a Magnet Warrior sitting
   * in that hand while the question is asked: the modal offered it as one of
   * its own answers, and by the time the effect resolved it had left the hand
   * and the pick matched nothing at all. One rule, asked here, by both.
   */
  exclude?: string
): CardInstance[] {
  const foe: PlayerId = viewer === 'p1' ? 'p2' : 'p1';
  const sides: PlayerId[] = spec.side === 'own' ? [viewer] : spec.side === 'opp' ? [foe] : [viewer, foe];
  const out: CardInstance[] = [];
  const keep = (c: CardInstance) => matchesFilter(c, spec.filter);
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
          /* And the monsters this op would leave exactly as it found them. */
          .filter((m) => changesAnything(spec.changing, m))
      );
    } else if (spec.zone === 'spellTrap' || spec.zone === 'backrow') {
      if (p.spellTrap) out.push(p.spellTrap);
      /* Only `backrow` reaches the Field Zone. `spellTrap` offering it was the
         client and the engine disagreeing about what the words meant, with the
         player pointing at a card nothing would destroy. */
      if (spec.zone === 'backrow' && p.field) out.push(p.field);
    } else if (spec.zone === 'grave') {
      /* Whatever the spec asks for. The monster restriction that used to live
         here is now carried by the specs that actually want it — see the
         `specialSummon` branch above. */
      out.push(...p.grave.filter((c) => keep(c) && (!spec.revivableOnly || revivable(state, viewer, c.slug, spec.revivableBy))));
    } else if (spec.zone === 'deck' && pid === viewer) {
      out.push(...p.deck.filter(keep));
    } else if ((spec.zone === 'handOrDeck' || spec.zone === 'deckOrGrave' || spec.zone === 'handOrDeckOrGrave') && pid === viewer) {
      /* One pool, laid out in the order a player would reach for it: the copy
         already in hand costs nothing, the Deck is next, and the Graveyard
         last. Which piles are in it is the card's own sentence — see the zone
         union — and the modal draws whatever this returns rather than deciding
         for itself, so the two cannot drift apart. */
      const legal = (c: CardInstance) =>
        keep(c) && (!spec.revivableOnly || revivable(state, viewer, c.slug, spec.revivableBy));
      if (spec.zone !== 'deckOrGrave') out.push(...p.hand.filter(legal));
      out.push(...p.deck.filter(legal));
      if (spec.zone !== 'handOrDeck') out.push(...p.grave.filter(legal));
    } else if (spec.zone === 'hand' && pid === viewer) {
      out.push(...p.hand.filter((c) => keep(c) && (!spec.revivableOnly || revivable(state, viewer, c.slug, spec.revivableBy))));
    }
  }
  return exclude ? out.filter((c) => c.uid !== exclude) : out;
}

/** The subset of the engine's card filter these pickers actually use. */


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
/**
 * The question a Spell's *summoned monster* asks, after the Spell's own.
 *
 * Black Illusion Ritual costs a Tribute and then puts Relinquished on the
 * field, whose arrival asks what to swallow. Two questions, one activation —
 * and the second had no way to be asked, so the engine fell back to "the
 * strongest" and the player watched it eat something they had not chosen.
 *
 * Only when the Spell names exactly one monster it can summon. Anything vaguer
 * cannot be asked about in advance, because what arrives is not yet decided.
 */
export function summonRiderSpec(slug: string, trigger: Trigger): TargetSpec | null {
  const eff = CARDS[slug]?.effects.find((e) => e.trigger === trigger);
  if (!eff) return null;
  for (const op of eff.ops) {
    if (op.op !== 'specialSummon') continue;
    const named = op.filter?.slugs;
    if (named?.length !== 1) continue;
    return summonTargetSpec(named[0]);
  }
  return null;
}

/**
 * "Special Summon A or B" — which one?
 *
 * Fortress Whale's Oath names two monsters and the engine, asked nothing, took
 * the bigger one: Crab Turtle arrived every single time and Fortress Whale was
 * unreachable from the card written to fetch it. Reported by the owner.
 *
 * Opt-in by the effect declaring `targets`, exactly as the Graveyard steal is,
 * because most cards with this shape resolve where there is nobody to ask —
 * Magical Hats fires inside an attack window, Chimera comes apart on its own
 * destruction, Agido on the way to the Graveyard. Those keep choosing for
 * themselves; a Spell a player is holding does not have to.
 */
export function summonChoiceSpec(slug: string, trigger: Trigger): TargetSpec | null {
  const eff = CARDS[slug]?.effects.find((e) => e.trigger === trigger);
  if (!eff?.targets) return null;
  for (const op of eff.ops) {
    if (op.op !== 'specialSummon') continue;
    const named = op.filter?.slugs;
    if (!named || named.length < 2) continue;
    const zones = Array.isArray(op.from) ? op.from : [op.from];
    if (!zones.every((z) => z === 'hand' || z === 'deck')) continue;
    return {
      side: 'own',
      zone: zones.length > 1 ? 'handOrDeck' : (zones[0] as TargetSpec['zone']),
      count: 1,
      prompt: 'Choose a monster to Special Summon',
      filter: { ...(op.filter ?? {}), kind: 'monster' },
      revivableOnly: true,
      revivableBy: slug,
    };
  }
  return null;
}

export function summonTargetSpec(slug: string): TargetSpec | null {
  return targetSpecFor(slug, 'onSummon') ?? targetSpecFor(slug, 'onNormalSummon');
}

/**
 * Whose piles a picker should lay out, from the picking player's side.
 *
 * Lives here rather than inside the modal for the reason this file already
 * learned once: a rule written as a closure in `Duel.tsx` can only be tested by
 * re-implementing it, and a test that re-implements a rule agrees with its bug.
 * The Graveyard picker read `both ? [me, foe] : [me]` — correct while Monster
 * Reborn and Call of the Haunted were the only cards looking in a Graveyard,
 * and wrong the moment Graverobber read *theirs alone*: the modal listed my own
 * pile, filtered it against their cards, and opened empty.
 */
export function pickerSides(spec: TargetSpec, me: PlayerId, foe: PlayerId): PlayerId[] {
  if (spec.side === 'both') return [me, foe];
  if (spec.side === 'opp') return [foe];
  return [me];
}

export const KIND_LABEL: Record<string, string> = {
  monster: 'Monster',
  spell: 'Spell',
  trap: 'Trap',
};
