/**
 * Assembles the playable card list: real printed stats + artwork from the card
 * database, merged with the custom anime-inspired effects we wrote.
 */
import generated from './generated/cards.json';
import decklistsJson from './generated/decklists.json';
import { MONSTER_EFFECTS, type EffectDef } from './effects/monsters';
import { SPELL_EFFECTS, OWN_TARGET_CARDS } from './effects/spells';
import type { CardDef, CardEffect, EquipGrant, GeneratedCard } from './types';

const GENERATED = generated as unknown as Record<string, GeneratedCard>;
const CUSTOM: Record<string, EffectDef> = { ...MONSTER_EFFECTS, ...SPELL_EFFECTS };

/**
 * Fallback effect for any card we did not hand-author. Keeps the promise that
 * every card does something, scaled to the card's own strength.
 */
function fallbackEffect(card: GeneratedCard): EffectDef {
  if (card.kind === 'monster') {
    const atk = card.atk ?? 0;
    if (atk >= 2000) {
      return {
        text: 'When this monster is Summoned: inflict 500 damage to your opponent. This monster inflicts piercing battle damage.',
        effects: [
          {
            trigger: 'onSummon',
            ops: [
              { op: 'damage', amount: 500, to: 'opp' },
              { op: 'pierce', duration: 'permanent' },
            ],
          },
        ],
      };
    }
    if (atk >= 1400) {
      return {
        text: 'When this monster destroys a monster in battle: it gains 300 ATK permanently.',
        effects: [
          { trigger: 'onBattleDestroy', ops: [{ op: 'gainAtk', amount: 300, target: { side: 'own', pick: 'self' }, duration: 'permanent' }] },
        ],
      };
    }
    return {
      text: 'When this monster is Summoned: draw 1 card.',
      effects: [{ trigger: 'onSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
    };
  }
  return {
    text: 'Draw 2 cards.',
    effects: [{ trigger: 'activate', ops: [{ op: 'draw', count: 2, who: 'own' }] }],
  };
}

/** Stand-in used by `viewFor` to hide cards the viewer is not allowed to see. */
const FACEDOWN: CardDef = {
  slug: 'facedown',
  name: 'Face-down Card',
  kind: 'monster',
  subKind: null,
  type: null,
  attribute: null,
  level: 0,
  atk: 0,
  def: 0,
  frameType: 'normal',
  isFusion: false,
  isRitual: false,
  isEffect: false,
  artId: 0,
  text: '',
  effects: [],
};


/**
 * Ops that are properties of the card, not of having been summoned.
 *
 * A monster granting itself piercing or battle immunity "when summoned" does
 * not have it when an *attack* turns it face-up: being flipped by an attacker
 * is not a summon, so the trigger never fires and the card loses the very
 * battle its own text says it should survive. Winged Dragon, Guardian of the
 * Fortress #1 was reported for exactly that, and around forty cards share the
 * shape.
 *
 * So they are lifted out of the summon trigger into a continuous aura on the
 * card itself, which is read live from whatever is face-up on the field — it
 * holds however the monster arrived, lapses if the card is negated, and is
 * gone the moment the card is. This happens here, once, rather than in forty
 * card definitions: a definition may still say "when summoned: pierce", which
 * is how a player thinks of it, and the engine reads it as the property it is.
 */
const PASSIVE_OPS = new Set(['pierce', 'directAttack', 'halvedBattleDamage', 'halvedDirectDamage', 'reflectBattleDamage', 'indestructibleByBattle', 'indestructibleByEffect', 'untargetable']);

function liftPassives(effects: CardEffect[]): CardEffect[] {
  const out: CardEffect[] = [];
  /**
   * Lifted grants, grouped by the condition of the effect they came from.
   *
   * They all used to go into one bag and come out as a single *unconditional*
   * aura, which threw the condition away. The Legendary Fisherman says "While
   * Umi is on the field, this card cannot be targeted or destroyed by your
   * opponent's effects and can attack directly" — and got all of it with no
   * Umi anywhere, for the whole duel: he attacked directly from the turn he
   * arrived and walked out of a Dark Hole untouched. Reported from a real duel
   * as two separate bugs; it is one line of bookkeeping.
   *
   * The condition is keyed by value, so two effects gated the same way still
   * collapse into one aura.
   */
  const bags = new Map<string, { condition?: CardEffect['condition']; grants: Set<EquipGrant> }>();
  const bagFor = (condition?: CardEffect['condition']) => {
    const key = condition ? JSON.stringify(condition) : '';
    let bag = bags.get(key);
    if (!bag) {
      bag = { condition, grants: new Set() };
      bags.set(key, bag);
    }
    return bag.grants;
  };
  for (const eff of effects) {
    if (eff.trigger !== 'onSummon' && eff.trigger !== 'onNormalSummon') {
      out.push(eff);
      continue;
    }
    const grants = bagFor(eff.condition);
    const kept = eff.ops.filter((o) => {
      /* Only a *permanent* grant is a property. Sabersaurus can attack directly
         "this turn", which is tied to the moment it arrived — lifting that into
         an aura would quietly let it do so every turn instead, and the text
         check caught exactly that when it first ran. */
      /* "Attacks every monster once each" and "can attack twice" are
         properties of the monster too, and were granted the same broken way:
         a Monster Reborn'd Blue-Eyes Ultimate Dragon lost its multi-attack,
         and a Set Two-Headed King Rex flipped face-up by an attack attacked
         once for the rest of the duel. Neither op carries a duration — an
         explicitly turn-scoped grant (Parrot Dragon's) stays behind. */
      if (o.op === 'attackAllMonsters') {
        grants.add('attackAll');
        return false;
      }
      if (o.op === 'extraAttacks' && o.count === 1 && (!('duration' in o) || o.duration === 'permanent')) {
        grants.add('doubleAttack');
        return false;
      }
      if (!PASSIVE_OPS.has(o.op) || !('duration' in o) || o.duration !== 'permanent') return true;
      grants.add(o.op as EquipGrant);
      return false;
    });
    // An effect with nothing left to do is dropped entirely, so the interface
    // does not ask for targets for a trigger that no longer resolves anything.
    if (kept.length) out.push({ ...eff, ops: kept });
  }
  for (const { condition, grants } of bags.values()) {
    if (!grants.size) continue;
    out.push({
      trigger: 'continuous',
      ...(condition ? { condition } : {}),
      ops: [],
      aura: { target: { side: 'own', pick: 'self' }, grants: [...grants] },
    });
  }
  return out;
}

export const CARDS: Record<string, CardDef> = Object.fromEntries(
  Object.entries(GENERATED).map(([slug, gen]) => {
    const custom = CUSTOM[slug] ?? fallbackEffect(gen);
    return [
      slug,
      {
        ...gen,
        subKind: custom.subKindOverride ?? gen.subKind,
        text: custom.text,
        cry: custom.cry,
        effects: liftPassives(custom.effects),
        fusionMaterials: custom.fusionMaterials,
        fusionFree: custom.fusionFree,
        atkOverride: custom.atkOverride,
        defOverride: custom.defOverride,
        summonRequires: custom.summonRequires,
        summonOnlyBy: custom.summonOnlyBy,
        mayForgoTributes: custom.mayForgoTributes,
        subKindOverride: custom.subKindOverride,
        statsFromTributes: custom.statsFromTributes,
      } satisfies CardDef,
    ];
  })
);

CARDS.facedown = FACEDOWN;

/** Slugs whose "choose a target" selectors point at the controller's own field. */
export const OWN_TARGETING = OWN_TARGET_CARDS;

/** True for cards we hand-authored (used by the coverage check in tests). */
export const HAND_AUTHORED = new Set(Object.keys(CUSTOM));

export function card(slug: string): CardDef {
  const c = CARDS[slug];
  if (!c) throw new Error(`Unknown card: ${slug}`);
  return c;
}

export function baseAtk(slug: string): number {
  const c = card(slug);
  return c.atkOverride ?? c.atk ?? 0;
}

export function baseDef(slug: string): number {
  const c = card(slug);
  return c.defOverride ?? c.def ?? 0;
}

/* ------------------------------------------------------------------ */
/* Duelists                                                            */
/* ------------------------------------------------------------------ */

export interface Duelist {
  id: string;
  name: string;
  epithet: string;
  quote: string;
  accent: string;
  accent2: string;
  emblem: string;
  strategy: string;
  deck: [string, number][];
  extra: string[];
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const DUELISTS: Duelist[] = (decklistsJson.duelists as RawDuelist[]).map((d) => ({
  id: d.id,
  name: d.name,
  epithet: d.epithet,
  quote: d.quote,
  accent: d.accent,
  accent2: d.accent2,
  emblem: slugify(d.emblem),
  strategy: d.strategy,
  deck: d.deck.map(([name, count]) => [slugify(name), count] as [string, number]),
  extra: (d.extra ?? []).map(slugify),
}));

interface RawDuelist {
  id: string;
  name: string;
  epithet: string;
  quote: string;
  accent: string;
  accent2: string;
  emblem: string;
  strategy: string;
  deck: [string, number][];
  extra?: string[];
}

export const DUELIST_BY_ID = Object.fromEntries(DUELISTS.map((d) => [d.id, d]));

export function artUrl(slug: string): string {
  const c = CARDS[slug];
  return c ? `/art/${c.artId}.webp` : '/art/placeholder.webp';
}

/**
 * Pegasus's cartoon monsters that the card name does not give away.
 *
 * Toon World's whole job is to make these summonable and to buff them, and it
 * used to find them by looking for "Toon" in the name. That quietly left out
 * Ryu-Ran and friends — Toons every bit as much in the anime — so half his
 * deck stayed stranded behind two tributes with no payoff.
 *
 * Parrot Dragon and Ryu-Ran are off the list by the owner's ruling: neither was
 * ever a Toon. Ryu-Ran is an ordinary effect monster that happens to care about
 * the book — it fetches one and can be thrown away for one — and caring about a
 * card is not being part of it. It gets no protection, no direct attack, and
 * pays its Tributes with the book wide open. Their membership is also most of
 * why the book's search felt like it was offering the whole deck.
 */
const TOON_EXTRA = new Set(['manga-ryu-ran', 'bickuribox', 'dark-rabbit']);

/**
 * A monster the book can make a Toon of.
 *
 * Membership alone is not Toon-ness — see `toonActive`. This is the roster the
 * book *recruits from*, which is what a Deck search means when it says "add 1
 * Toon monster": you are looking for a card that will be a Toon once the book
 * is open, and the card sitting in the Deck is not one yet.
 */
export function isToon(slug: string): boolean {
  return CARDS[slug]?.name.includes('Toon') || TOON_EXTRA.has(slug);
}

/**
 * Monsters that are only *drawings* until somebody opens the book.
 *
 * These four are ordinary monsters in the hand and on the field — printed
 * stats, no effect, no protection, and their full Tribute cost — and become
 * Toons the moment their controller has Toon World face-up. That is the
 * owner's ruling and it is what makes them playable at all in a deck whose
 * enabler is a single card: a dead draw before the book is now just a monster.
 *
 * The three the name gives away (Toon Summoned Skull, Toon Mermaid, Blue-Eyes
 * Toon Dragon) are not here. They are Toons always, and carry
 * `summonRequires: 'toon-world'` for it — a Toon Summoned Skull without the
 * book is not a plain Summoned Skull, it is a card that cannot come out.
 */
const TOON_ONLY_WITH_BOOK = new Set(['dark-rabbit', 'bickuribox', 'manga-ryu-ran', 'toon-alligator']);

/** True while this card, in this player's hands, is actually a Toon. */
export function toonActive(slug: string, bookIsOpen: boolean): boolean {
  if (!isToon(slug)) return false;
  return TOON_ONLY_WITH_BOOK.has(slug) ? bookIsOpen : true;
}

/** Whether a monster is one of the drawings that needs the book to come alive. */
export function isToonWhenBookOpen(slug: string): boolean {
  return TOON_ONLY_WITH_BOOK.has(slug);
}

/**
 * The name to print, which for these four depends on the board.
 *
 * Bickuribox with the book open is Toon Bickuribox, and that rename is the only
 * warning a player gets that Dark Hole is about to sweep the field and leave it
 * standing. Without it the protection looks like the board cheating; with it,
 * the reason is written on the card.
 */
export function toonDisplayName(slug: string, bookIsOpen: boolean): string {
  const name = CARDS[slug]?.name ?? slug;
  if (!bookIsOpen || !TOON_ONLY_WITH_BOOK.has(slug)) return name;
  /* Toon Alligator is already called that. Prefixing regardless gave "Toon Toon
     Alligator", which reads as a bug because it is one. */
  return name.startsWith('Toon ') ? name : `Toon ${name}`;
}
