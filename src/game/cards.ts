/**
 * Assembles the playable card list: real printed stats + artwork from the card
 * database, merged with the custom anime-inspired effects we wrote.
 */
import generated from './generated/cards.json';
import decklistsJson from './generated/decklists.json';
import { MONSTER_EFFECTS, type EffectDef } from './effects/monsters';
import { SPELL_EFFECTS, OWN_TARGET_CARDS } from './effects/spells';
import type { CardDef, GeneratedCard } from './types';

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
        text: 'When this card is Normal Summoned: inflict 500 damage to your opponent. This card inflicts piercing battle damage.',
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
        text: 'When this card destroys a monster in battle: it gains 300 ATK permanently.',
        effects: [
          { trigger: 'onBattleDestroy', ops: [{ op: 'gainAtk', amount: 300, target: { side: 'own', pick: 'self' }, duration: 'permanent' }] },
        ],
      };
    }
    return {
      text: 'When this card is Normal Summoned: draw 1 card.',
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

export const CARDS: Record<string, CardDef> = Object.fromEntries(
  Object.entries(GENERATED).map(([slug, gen]) => {
    const custom = CUSTOM[slug] ?? fallbackEffect(gen);
    return [
      slug,
      {
        ...gen,
        text: custom.text,
        cry: custom.cry,
        effects: custom.effects,
        fusionMaterials: custom.fusionMaterials,
        atkOverride: custom.atkOverride,
        defOverride: custom.defOverride,
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
 */
const TOON_EXTRA = new Set(['ryu-ran', 'manga-ryu-ran', 'bickuribox', 'parrot-dragon', 'dark-rabbit']);

export function isToon(slug: string): boolean {
  return CARDS[slug]?.name.includes('Toon') || TOON_EXTRA.has(slug);
}
