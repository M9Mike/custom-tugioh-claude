/**
 * Ash Ketchum's deck — forty-six cards from a different cartoon.
 *
 * None of these exist in any card database: the art is Mike's own, the stats
 * are written here, and `type: 'Pokémon'` is a monster type this game invented
 * so the deck can name itself the way "Elemental HERO" names Jaden's. It lives
 * in its own file rather than in `monsters.ts` and `spells.ts` because it is
 * one thing — every card in it points at another card in it — and a reader
 * should be able to hold the whole deck in one screen.
 *
 * ## The shape
 *
 * Fifteen Pokémon in the main deck, every one of them Level 4 or under, so a
 * hand is never a hand you cannot play. What each of them does on arrival is
 * small and useful — a search, a draw, a burn, a wall — and what each of them
 * is *for* is the button on it: **evolve**. Tribute the Pokémon and its next
 * form steps out of the Extra Deck, the way a cocoon hatches in Weevil's deck
 * and the way Winged Kuriboh becomes LV10 in Jaden's — the same road,
 * `summonOnlyBy`, so nothing else in the game can put an evolved form on the
 * table. Twenty evolutions wait in the Extra Deck: the Mega and Gigantamax
 * forms at Level 8, the six forms that carry Ash's own name at Level 10, and
 * the one at Level 12 that three Level 8s buy.
 *
 * Six Spells and four Traps do the rest: find a Pokémon, put one down, skip a
 * stage, bring one back, and punish anyone who attacks into the board or
 * summons in front of it.
 *
 * ## The twenty-first card
 *
 * Mewtwo is a Divine-Beast, which in this engine means the God decree applies
 * to it in full — no effect touches it, its own ignore every protection, and
 * the only answer is a bigger body in battle. It has exactly one road onto the
 * table and that road is written nowhere on the card that opens it: see
 * `ash-s-ultimate-pokemon-master-of-all`. That is deliberate, and it is the
 * owner's ask — an easter egg inside an easter egg is a thing you find out by
 * doing it.
 *
 * ## Voice
 *
 * Monsters say "this monster", Spells and Traps say "this card" — the house
 * rule `text-check` enforces. Every trigger clause is one the check knows how
 * to read, and every number in a sentence is the number the effect carries.
 */
import type { CardEffect, CardFilter, Pick, Selector, Side } from '../types';
import type { EffectDef } from './monsters';

const sel = (side: Side, pick: Pick, extra: Partial<Selector> = {}): Selector => ({ side, pick, ...extra });
const SELF = sel('own', 'self');
const OPP_ALL = sel('opp', 'all');
const OPP_ONE = sel('opp', 'chosen', { count: 1 });
const OPP_ONE_BACKROW = sel('opp', 'chosen', { zone: 'backrow', count: 1 });
const OPP_BACKROW = sel('opp', 'all', { zone: 'backrow' });

/** The archetype: a monster type this game made up, exactly like a real one. */
const POKEMON: CardFilter = { type: 'Pokémon' };
/** A Pokémon still in the main deck — an evolved form is never there, but a
 *  Graveyard holds both kinds and a hand can only ever use one of them. */
const BASIC: CardFilter = { type: 'Pokémon', kind: 'monster', isFusion: false };

const MASTER = 'ash-s-ultimate-pokemon-master-of-all';

/**
 * Every road that may put an evolved form on the field besides its own
 * evolution: the two cards in the main deck that reach into the Graveyard for
 * a Pokémon and do not care which stage it was.
 */
const REVIVE_ROADS = ['max-revive', 'substitute'];
const roads = (...by: string[]): string[] => [...by, ...REVIVE_ROADS];

/**
 * The evolution itself.
 *
 * Tribute the Pokémon and the next form arrives from the Extra Deck — or from
 * the Graveyard, if that form has already been out once and fallen: a
 * Charizard that comes back is the anime, and it is what makes one copy of
 * each form a deck rather than a wish. `from: ['extra', 'grave']` is the same
 * pair Transcendent Wings reads for LV10.
 *
 * The named list is what `playable-check` reads to prove the form reachable,
 * so it is written as slugs and never as a Level or a name fragment.
 */
/**
 * And it waits a turn. Without `stoodATurn` the AI climbed the whole ladder in
 * its first Main Phase — Lucario to Mega Lucario to Aura Master, Charizard to
 * Gigantamax to Flame Emperor, and the two of them into the Master of All,
 * banishing the other player's hand before they had drawn — which is not a
 * duel anybody loses, it is one nobody gets to play. Now a Pokémon has to have
 * stood through the opponent's turn before it evolves, so every rung is a
 * threat they can see and a turn they can spend on it. Bond Evolution is the
 * exception on purpose: it is a Spell, it costs a card, and one leap a duel
 * is the deck's burst.
 */
const evolve = (label: string, into: string[]): CardEffect => ({
  trigger: 'ignition',
  label,
  condition: { stoodATurn: true },
  cost: { tributeSelf: true },
  ops: [{ op: 'specialSummon', from: ['extra', 'grave'], filter: { slugs: into }, position: 'atk' }],
});
const STOOD = 'if this monster was on the field before this turn, ';

/**
 * The top of the ladder, on every Level 10 form.
 *
 * Two *other* Level 8 or higher Pokémon are the price, on top of the one doing
 * the calling — three evolved bodies on a three-zone board, which is a board
 * this deck builds by the middle of a duel and no other deck builds at all.
 * The filter is the cost's own, and `text-check` reads it for the "Level 8 or
 * higher" in the sentence.
 */
const masterRoad: CardEffect = {
  trigger: 'ignition',
  label: 'Call the Master of All',
  condition: { stoodATurn: true },
  cost: { tribute: 2, tributeFilter: { type: 'Pokémon', minLevel: 8 } },
  ops: [{ op: 'specialSummon', from: ['extra', 'grave'], filter: { slugs: [MASTER] }, position: 'atk' }],
};
const MASTER_TEXT =
  'Once per turn: if this monster was on the field before this turn, Tribute 2 other Level 8 or higher Pokémon you control; ' +
  'Special Summon "Ash\'s Ultimate Pokémon — Master of All" from your Extra Deck or Graveyard.';

const EVOLVED = 'Cannot be Normal Summoned or Set. ';

export const POKEMON_EFFECTS: Record<string, EffectDef> = {
  /* ================================================================ */
  /* The team                                                          */
  /* ================================================================ */

  pikachu: {
    /* The partner, and the engine of the deck: he comes down for free onto an
       empty field like Bubbleman, finds the next Pokémon on arrival like
       Avian, and the whole time he is the one card in it every other card
       can reach. Two forms to evolve into, because the anime's Pikachu never
       took the stone and this one may choose. */
    text:
      'If you control no monsters, this monster can be Special Summoned from your hand. ' +
      'When this monster is Summoned: add 1 Pokémon from your Deck to your hand. ' +
      'When this monster destroys a monster in battle: inflict 1000 damage to your opponent. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Raichu" or "Gigantamax Pikachu" from your Extra Deck or Graveyard.',
    cry: 'Pika… CHUUU!',
    effects: [
      {
        trigger: 'handSummon',
        condition: { controlsNoOtherMonster: true },
        label: 'I choose you!',
        ops: [{ op: 'summonSelf', position: 'atk', face: 'up' }],
      },
      { trigger: 'onSummon', ops: [{ op: 'search', filter: BASIC }] },
      { trigger: 'onBattleDestroy', ops: [{ op: 'damage', amount: 1000, to: 'opp' }] },
      evolve('Evolve', ['raichu', 'gigantamax-pikachu']),
    ],
  },

  charizard: {
    /* Ash's Charizard was never a Level 4 body, and the deck says so: a 2400
       that arrives, burns something off the table and pierces from then on.
       Three forms wait for it, and which one is a decision. */
    text:
      'When this monster is Summoned: destroy 1 monster your opponent controls. ' +
      'This monster inflicts piercing battle damage. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Mega Charizard X", "Mega Charizard Y" or "Gigantamax Charizard" from your Extra Deck or Graveyard.',
    cry: 'Flamethrower!',
    effects: [
      { trigger: 'onSummon', targets: 1, ops: [{ op: 'destroy', target: OPP_ONE }] },
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['pierce'] } },
      evolve('Evolve', ['mega-charizard-x', 'mega-charizard-y', 'gigantamax-charizard']),
    ],
  },

  greninja: {
    /* The bond. He fetches the card that makes him Ash-Greninja, and every
       swing is a shuriken through their backrow first. */
    text:
      'When this monster is Summoned: add 1 "Bond Evolution" from your Deck to your hand. ' +
      'When this monster attacks: destroy 1 Spell or Trap your opponent controls. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Ash-Greninja" from your Extra Deck or Graveyard.',
    cry: 'Water Shuriken!',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'search', filter: { slugs: ['bond-evolution'] } }] },
      { trigger: 'onDeclareAttack', ops: [{ op: 'destroy', target: OPP_ONE_BACKROW }] },
      evolve('Evolve', ['ash-greninja']),
    ],
  },

  sceptile: {
    text:
      'This monster inflicts piercing battle damage. ' +
      'When this monster destroys a monster in battle: draw 1 card. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Mega Sceptile" from your Extra Deck or Graveyard.',
    cry: 'Leaf Blade!',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['pierce'] } },
      { trigger: 'onBattleDestroy', ops: [{ op: 'draw', count: 1, who: 'own' }] },
      evolve('Evolve', ['mega-sceptile']),
    ],
  },

  infernape: {
    /* Blaze: the ability every fire starter has, which is the anime's whole
       idea of a comeback — it fights hardest when its trainer is losing. Read
       live off the Life Points, so it switches on the moment they drop. */
    text:
      'While your Life Points are 4000 or less, this monster gains 1000 ATK. ' +
      'When this monster is Summoned: inflict 500 damage to your opponent for each monster they control. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Infernape — Blaze Unleashed" from your Extra Deck or Graveyard.',
    cry: 'Blaze — Flare Blitz!',
    effects: [
      { trigger: 'continuous', condition: { ownLpBelow: 4000 }, ops: [], aura: { target: SELF, atk: 1000 } },
      { trigger: 'onSummon', ops: [{ op: 'damage', amount: 500, scale: 'perOppMonster', to: 'opp' }] },
      evolve('Evolve', ['infernape-blaze-unleashed']),
    ],
  },

  lucario: {
    /* Aura reads intent, which here is "cannot be targeted": a Change of
       Heart or a Spellbinding Circle finds nothing to point at. */
    text:
      "This monster cannot be targeted by your opponent's card effects. " +
      'When this monster is Summoned: inflict 800 damage to your opponent. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Mega Lucario" from your Extra Deck or Graveyard.',
    cry: 'Aura Sphere!',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['untargetable'] } },
      { trigger: 'onSummon', ops: [{ op: 'damage', amount: 800, to: 'opp' }] },
      evolve('Evolve', ['mega-lucario']),
    ],
  },

  gengar: {
    /* Destiny Bond: whatever kills it goes with it. `onDestroyed` rather than
       `onSentToGrave`, because being evolved is a Tribute and a Tribute is
       not a death — a Gengar hatching into its Gigantamax form must not take
       one of theirs on the way. */
    text:
      'When this monster is Summoned: your opponent discards 1 random card. ' +
      'When this monster is destroyed: destroy 1 monster your opponent controls. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Gigantamax Gengar" from your Extra Deck or Graveyard.',
    cry: 'Shadow Ball!',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'discard', count: 1, who: 'opp' }] },
      { trigger: 'onDestroyed', targets: 1, ops: [{ op: 'destroy', target: OPP_ONE }] },
      evolve('Evolve', ['gigantamax-gengar']),
    ],
  },

  bulbasaur: {
    text:
      'When this monster is Summoned: inflict 500 damage to your opponent and gain 500 Life Points. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Venusaur" from your Extra Deck or Graveyard.',
    cry: 'Leech Seed!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'damage', amount: 500, to: 'opp' },
          { op: 'heal', amount: 500, to: 'own' },
        ],
      },
      evolve('Evolve', ['venusaur']),
    ],
  },

  squirtle: {
    /* Withdraw. The same thousand every wall in this game takes off an
       attacker, on the smallest body that has it. */
    text:
      'Anything that attacks this monster does so 1000 ATK lighter. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Blastoise" from your Extra Deck or Graveyard.',
    cry: 'Withdraw!',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['sapsAttacker'] } },
      evolve('Evolve', ['blastoise']),
    ],
  },

  pidgeot: {
    /* Gust on the way in, and then it flies over the fight — at half, which is
       the price Sky Scout pays for the same sentence. */
    text:
      'When this monster is Summoned: return 1 monster your opponent controls to their hand. ' +
      'This monster can attack your opponent directly, but its battle damage is halved.',
    cry: 'Gust!',
    effects: [
      { trigger: 'onSummon', targets: 1, ops: [{ op: 'bounce', target: OPP_ONE }] },
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['directAttack', 'halvedBattleDamage'] } },
    ],
  },

  krookodile: {
    /* Intimidate, kept: every monster across the table is 800 smaller for the
       rest of the duel, and the next one to arrive is not. */
    text:
      'When this monster is Summoned: every monster your opponent controls loses 800 ATK permanently. ' +
      'This monster inflicts piercing battle damage.',
    cry: 'Intimidate!',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'gainAtk', amount: -800, target: OPP_ALL, duration: 'permanent' }] },
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['pierce'] } },
    ],
  },

  snorlax: {
    /* A wall that sleeps: the thousand comes off an attacker only while it is
       lying down, and it heals its trainer every morning. */
    text:
      'While this monster is in Defence Position, anything that attacks it does so 1000 ATK lighter. ' +
      'At the start of your turn: gain 1000 Life Points. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Gigantamax Snorlax" from your Extra Deck or Graveyard.',
    cry: 'Rest.',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['sapsAttackerInDefense'] } },
      { trigger: 'onOwnTurnStart', ops: [{ op: 'heal', amount: 1000, to: 'own' }] },
      evolve('Evolve', ['gigantamax-snorlax']),
    ],
  },

  talonflame: {
    text:
      'This monster can attack twice each Battle Phase. ' +
      'When this monster destroys a monster in battle: draw 1 card.',
    cry: 'Brave Bird!',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'extraAttacks', count: 1 }] },
      { trigger: 'onBattleDestroy', ops: [{ op: 'draw', count: 1, who: 'own' }] },
    ],
  },

  rowlet: {
    /* The smallest body in the deck and never a dead card: it replaces itself
       on arrival and it is a Decidueye by the end of the turn. */
    text:
      'When this monster is Summoned: draw 1 card. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Decidueye" from your Extra Deck or Graveyard.',
    cry: 'Hoo!',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] },
      evolve('Evolve', ['decidueye']),
    ],
  },

  butterfree: {
    /* Sleep Powder: the turn it buys is the turn the board evolves. The same
       lock Swords of Revealing Light applies, one turn of it. */
    text:
      "When this monster is Summoned: your opponent's monsters cannot attack or change position for 1 turn.",
    cry: 'Sleep Powder!',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'freezeMonsters', who: 'opp', turns: 1 }] }],
  },

  /* ================================================================ */
  /* The trainer's cards                                               */
  /* ================================================================ */

  'poke-ball': {
    /* E - Emergency Call with a different picture: a Pokémon to the hand, or
       onto an empty field. */
    text:
      'Add 1 Pokémon from your Deck to your hand — or, if you control no monsters, ' +
      'Special Summon it from your Deck instead.',
    cry: 'Go!',
    effects: [
      {
        trigger: 'activate',
        ops: [
          {
            op: 'cascade',
            branches: [
              { condition: { controlsMonster: true }, ops: [{ op: 'search', filter: BASIC }] },
              { ops: [{ op: 'specialSummon', from: 'deck', filter: BASIC, position: 'atk' }] },
            ],
          },
        ],
      },
    ],
  },

  'evolution-stone': {
    /* A second body on the table without spending the Normal Summon — and a
       body on the table is a body that can evolve this turn, which is what
       the stone is for. */
    text: 'Special Summon 1 Pokémon from your hand or Deck in Attack Position.',
    cry: 'It is glowing!',
    effects: [
      {
        trigger: 'activate',
        ops: [{ op: 'specialSummon', from: ['hand', 'deck'], filter: BASIC, position: 'atk' }],
      },
    ],
  },

  'bond-evolution': {
    /* The Ash-Greninja card, and in this deck it skips a stage for anyone:
       one Pokémon goes in, one of Ash's own Level 10 forms comes out, five
       hundred heavier for the trust. The six are named so the playability
       sweep can see the road; the Level is on the filter so the sentence is
       honest. */
    text:
      'Tribute 1 Pokémon you control: Special Summon 1 Level 10 Pokémon from your Extra Deck or Graveyard. ' +
      'It gains 500 ATK permanently.',
    cry: 'Our bond is our strength!',
    effects: [
      {
        trigger: 'activate',
        cost: { tribute: 1, tributeFilter: POKEMON },
        ops: [
          {
            op: 'specialSummon',
            from: ['extra', 'grave'],
            filter: {
              minLevel: 10,
              maxLevel: 10,
              slugs: [
                'ash-greninja-ultimate-bond',
                'charizard-flame-emperor',
                'pikachu-thunder-emperor',
                'infernape-blaze-unleashed',
                'sceptile-forest-overlord',
                'lucario-aura-master',
              ],
            },
            position: 'atk',
          },
          { op: 'gainAtk', amount: 500, target: sel('own', 'summoned'), duration: 'permanent' },
        ],
      },
    ],
  },

  'pokemon-battle-arena': {
    /* The city behind Jaden's HEROes is a thousand on the swing; the arena
       behind Ash's team is five hundred on everything and a board that no
       Dark Hole clears. The Field Zone is the one zone this deck never
       fights over, so it is the one place a whole-board buff can live. */
    text: 'Your Pokémon gain 500 ATK and DEF, and cannot be destroyed by card effects.',
    cry: 'Welcome to the arena!',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: POKEMON }), atk: 500, def: 500, grants: ['indestructibleByEffect'] },
      },
    ],
  },

  'the-heart-of-the-trainer': {
    /* Fusion Recovery's shape: the pile comes back. Two cards, a Pokémon out
       of the Graveyard, and every fallen form home to the Extra Deck where
       the next evolution can reach it. Every part is "up to", so the card is
       never dead. */
    text:
      'Draw 2 cards, then add 1 Pokémon from your Graveyard to your hand, ' +
      'and return every evolved Pokémon in your Graveyard to your Extra Deck.',
    cry: 'I believe in you!',
    effects: [
      {
        trigger: 'activate',
        targets: 1,
        ops: [
          { op: 'draw', count: 2, who: 'own' },
          { op: 'stealFromGrave', from: 'own', filter: BASIC },
          { op: 'returnToExtra', target: sel('own', 'all', { zone: 'grave', filter: { isFusion: true } }) },
        ],
      },
    ],
  },

  'max-revive': {
    /* Any stage — a fallen Mega form comes back as readily as a Bulbasaur,
       which is why every evolved form names this card as a road in. */
    text: 'Special Summon 1 Pokémon from your Graveyard in Attack Position. It gains 500 ATK permanently.',
    cry: 'Get up!',
    effects: [
      {
        trigger: 'activate',
        targets: 1,
        ops: [
          { op: 'specialSummon', from: 'grave', filter: POKEMON, count: 1, position: 'atk' },
          { op: 'gainAtk', amount: 500, target: sel('own', 'summoned'), duration: 'permanent' },
        ],
      },
    ],
  },

  'pikachu-s-quick-attack': {
    /* The blow never lands and the attacker is the one that falls, billed at
       its own ATK. `destroyedAtk` is what this effect's own destruction was
       worth, which is exactly the number. */
    text:
      'Trap: when your opponent declares an attack: negate the attack, destroy the attacking monster, ' +
      'and inflict damage to your opponent equal to its ATK.',
    cry: 'Quick Attack!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: "Pikachu's Quick Attack — strike first",
        ops: [
          { op: 'negateAttack' },
          { op: 'destroy', target: sel('opp', 'attacker') },
          { op: 'damage', scale: 'destroyedAtk', to: 'opp' },
        ],
      },
    ],
  },

  'charizard-s-rage': {
    /* Trap Hole with the dragon's temper: the monster that just arrived burns,
       and its ATK is the burn. */
    text: 'Trap: when your opponent Summons a monster: destroy it and inflict damage to your opponent equal to its ATK.',
    cry: 'Blast Burn!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentSummon',
        label: "Charizard's Rage — burn what just arrived",
        ops: [
          { op: 'destroy', target: sel('opp', 'attacker') },
          { op: 'damage', scale: 'destroyedAtk', to: 'opp' },
        ],
      },
    ],
  },

  substitute: {
    /* The doll takes the hit and the team keeps its shape: whatever fell is
       replaced from wherever the next Pokémon is waiting, Graveyard included,
       so an evolved form that died is one Trap from standing again. */
    text: 'Trap: when a monster you control is destroyed: Special Summon 1 Pokémon from your hand, Deck or Graveyard.',
    cry: 'Substitute!',
    effects: [
      {
        trigger: 'trap',
        window: 'monsterDestroyed',
        label: 'Substitute — the next one steps in',
        targets: 1,
        ops: [{ op: 'specialSummon', from: ['hand', 'deck', 'grave'], filter: POKEMON, position: 'atk' }],
      },
    ],
  },

  'blaze-of-determination': {
    /* Not a wall. The attack goes ahead — into a board that just grew by a
       thousand a head, for good, and cannot be broken this turn. */
    text:
      'Trap: when your opponent declares an attack: every Pokémon you control gains 1000 ATK permanently, ' +
      'and your monsters cannot be destroyed by battle this turn.',
    cry: 'We never give up!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Blaze of Determination — stand and grow',
        ops: [
          { op: 'gainAtk', amount: 1000, target: sel('own', 'all', { filter: POKEMON }), duration: 'permanent' },
          { op: 'preventBattleDestruction', who: 'own', duration: 'turn' },
        ],
      },
    ],
  },

  /* ================================================================ */
  /* The Extra Deck: first evolutions                                  */
  /* ================================================================ */

  raichu: {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Pikachu", "Max Revive" or "Substitute". ' +
      'When this monster is Summoned: inflict 1500 damage to your opponent. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Pikachu — Thunder Emperor" from your Extra Deck or Graveyard.',
    cry: 'Thunder!',
    summonOnlyBy: roads('pikachu'),
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'damage', amount: 1500, to: 'opp' }] },
      evolve('Evolve', ['pikachu-thunder-emperor']),
    ],
  },

  'gigantamax-pikachu': {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Pikachu", "Max Revive" or "Substitute". ' +
      'When this monster is Summoned: destroy every Spell and Trap your opponent controls, ' +
      'and inflict 500 damage to your opponent for each monster they control. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Pikachu — Thunder Emperor" from your Extra Deck or Graveyard.',
    cry: 'G-Max Volt Crash!',
    summonOnlyBy: roads('pikachu'),
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'destroy', target: OPP_BACKROW },
          { op: 'damage', amount: 500, scale: 'perOppMonster', to: 'opp' },
        ],
      },
      evolve('Evolve', ['pikachu-thunder-emperor']),
    ],
  },

  'mega-charizard-x': {
    /* The black one: it hits twice and it goes through what it hits. */
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Charizard", "Max Revive" or "Substitute". ' +
      'This monster can attack twice each Battle Phase and inflicts piercing battle damage. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Charizard — Flame Emperor" from your Extra Deck or Graveyard.',
    cry: 'Dragon Claw!',
    summonOnlyBy: roads('charizard'),
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'extraAttacks', count: 1 }, { op: 'pierce', duration: 'permanent' }] },
      evolve('Evolve', ['charizard-flame-emperor']),
    ],
  },

  'mega-charizard-y': {
    /* The other one sweeps: Drought, then everything small enough burns. */
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Charizard", "Max Revive" or "Substitute". ' +
      'When this monster is Summoned: destroy every monster your opponent controls with 2000 or less ATK. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Charizard — Flame Emperor" from your Extra Deck or Graveyard.',
    cry: 'Heat Wave!',
    summonOnlyBy: roads('charizard'),
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'destroy', target: sel('opp', 'all', { filter: { maxAtk: 2000 } }) }] },
      evolve('Evolve', ['charizard-flame-emperor']),
    ],
  },

  'gigantamax-charizard': {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Charizard", "Max Revive" or "Substitute". ' +
      'This monster attacks every monster your opponent controls once each Battle Phase and inflicts piercing battle damage. ' +
      'When this monster destroys a monster in battle: inflict 500 damage to your opponent. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Charizard — Flame Emperor" from your Extra Deck or Graveyard.',
    cry: 'G-Max Wildfire!',
    summonOnlyBy: roads('charizard'),
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['attackAll', 'pierce'] } },
      { trigger: 'onBattleDestroy', ops: [{ op: 'damage', amount: 500, to: 'opp' }] },
      evolve('Evolve', ['charizard-flame-emperor']),
    ],
  },

  'mega-lucario': {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Lucario", "Max Revive" or "Substitute". ' +
      "This monster is unaffected by your opponent's Spell and Trap effects. " +
      'When this monster is Summoned: inflict 1500 damage to your opponent. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Lucario — Aura Master" from your Extra Deck or Graveyard.',
    cry: 'Aura Sphere — full power!',
    summonOnlyBy: roads('lucario'),
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['unaffectedByOpponentSpellsAndTraps'] } },
      { trigger: 'onSummon', ops: [{ op: 'damage', amount: 1500, to: 'opp' }] },
      evolve('Evolve', ['lucario-aura-master']),
    ],
  },

  'mega-sceptile': {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Sceptile", "Max Revive" or "Substitute". ' +
      'This monster inflicts piercing battle damage. ' +
      'When this monster attacks: destroy 1 Spell or Trap your opponent controls. ' +
      'When this monster destroys a monster in battle: draw 1 card. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Sceptile — Forest Overlord" from your Extra Deck or Graveyard.',
    cry: 'Leaf Storm!',
    summonOnlyBy: roads('sceptile'),
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['pierce'] } },
      { trigger: 'onDeclareAttack', ops: [{ op: 'destroy', target: OPP_ONE_BACKROW }] },
      { trigger: 'onBattleDestroy', ops: [{ op: 'draw', count: 1, who: 'own' }] },
      evolve('Evolve', ['sceptile-forest-overlord']),
    ],
  },

  'gigantamax-gengar': {
    /* The end of the Gengar line. It empties their hand on arrival and takes
       their whole board with it when it goes. */
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Gengar", "Max Revive" or "Substitute". ' +
      "This monster cannot be targeted by your opponent's card effects. " +
      'When this monster is Summoned: your opponent discards 2 random cards. ' +
      'When this monster is destroyed: destroy every monster your opponent controls.',
    cry: 'G-Max Terror!',
    summonOnlyBy: roads('gengar'),
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['untargetable'] } },
      { trigger: 'onSummon', ops: [{ op: 'discard', count: 2, who: 'opp' }] },
      { trigger: 'onDestroyed', ops: [{ op: 'destroy', target: OPP_ALL }] },
    ],
  },

  'gigantamax-snorlax': {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Snorlax", "Max Revive" or "Substitute". ' +
      'This monster cannot be destroyed by battle, and anything that attacks it does so 1000 ATK lighter. ' +
      'At the start of your turn: gain 1000 Life Points.',
    cry: 'G-Max Replenish!',
    summonOnlyBy: roads('snorlax'),
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['indestructibleByBattle', 'sapsAttacker'] } },
      { trigger: 'onOwnTurnStart', ops: [{ op: 'heal', amount: 1000, to: 'own' }] },
    ],
  },

  venusaur: {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Bulbasaur", "Max Revive" or "Substitute". ' +
      'When this monster is Summoned: inflict 1500 damage to your opponent and gain 1500 Life Points. ' +
      'While this monster is face-up, your other Pokémon cannot be destroyed by battle.',
    cry: 'Solar Beam!',
    summonOnlyBy: roads('bulbasaur'),
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'damage', amount: 1500, to: 'opp' },
          { op: 'heal', amount: 1500, to: 'own' },
        ],
      },
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: POKEMON, excludeSelf: true }), grants: ['indestructibleByBattle'] },
      },
    ],
  },

  blastoise: {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Squirtle", "Max Revive" or "Substitute". ' +
      'When this monster is Summoned: destroy every Spell and Trap your opponent controls. ' +
      'Anything that attacks this monster does so at half its ATK.',
    cry: 'Hydro Pump!',
    summonOnlyBy: roads('squirtle'),
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'destroy', target: OPP_BACKROW }] },
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['halvesAttacker'] } },
    ],
  },

  decidueye: {
    /* Spirit Shackle: the arrow goes past the board and pins the card they
       were going to answer with. */
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Rowlet", "Max Revive" or "Substitute". ' +
      'This monster can attack your opponent directly. ' +
      'When this monster inflicts battle damage to your opponent: they discard 1 random card.',
    cry: 'Spirit Shackle!',
    summonOnlyBy: roads('rowlet'),
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['directAttack'] } },
      { trigger: 'onDealBattleDamage', ops: [{ op: 'discard', count: 1, who: 'opp' }] },
    ],
  },

  'ash-greninja': {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Greninja", "Max Revive" or "Substitute". ' +
      'When this monster is Summoned: destroy 1 monster and 1 Spell or Trap your opponent controls. ' +
      'Once per turn: ' + STOOD + 'Tribute this monster; Special Summon "Ash-Greninja — Ultimate Bond" from your Extra Deck or Graveyard.',
    cry: 'Water Shuriken — full bond!',
    summonOnlyBy: roads('greninja'),
    effects: [
      {
        trigger: 'onSummon',
        targets: 2,
        ops: [
          { op: 'destroy', target: OPP_ONE },
          { op: 'destroy', target: OPP_ONE_BACKROW },
        ],
      },
      evolve('Evolve', ['ash-greninja-ultimate-bond']),
    ],
  },

  /* ================================================================ */
  /* The Extra Deck: Ash's own forms                                   */
  /* ================================================================ */

  'infernape-blaze-unleashed': {
    /* Straight from the Level 4, because the list has no Mega Infernape:
       the Blaze form is its one evolution, and Bond Evolution reaches it too. */
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Infernape", "Bond Evolution", "Max Revive" or "Substitute". ' +
      'While your Life Points are 4000 or less, this monster gains 1000 ATK. ' +
      'This monster can attack twice each Battle Phase. ' +
      'When this monster destroys a monster in battle: inflict 1000 damage to your opponent. ' +
      MASTER_TEXT,
    cry: 'Blaze Unleashed!',
    summonOnlyBy: roads('infernape', 'bond-evolution'),
    effects: [
      { trigger: 'continuous', condition: { ownLpBelow: 4000 }, ops: [], aura: { target: SELF, atk: 1000 } },
      { trigger: 'onSummon', ops: [{ op: 'extraAttacks', count: 1 }] },
      { trigger: 'onBattleDestroy', ops: [{ op: 'damage', amount: 1000, to: 'opp' }] },
      masterRoad,
    ],
  },

  'ash-greninja-ultimate-bond': {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Ash-Greninja", "Bond Evolution", "Max Revive" or "Substitute". ' +
      'This monster attacks every monster your opponent controls once each Battle Phase, ' +
      "and is unaffected by your opponent's Spell and Trap effects. " +
      "When this monster destroys a monster in battle: inflict damage to your opponent equal to that monster's ATK. " +
      MASTER_TEXT,
    cry: 'Ultimate Bond!',
    summonOnlyBy: roads('ash-greninja', 'bond-evolution'),
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['attackAll', 'unaffectedByOpponentSpellsAndTraps'] } },
      { trigger: 'onBattleDestroy', ops: [{ op: 'damage', scale: 'destroyedAtk', to: 'opp' }] },
      masterRoad,
    ],
  },

  'charizard-flame-emperor': {
    /* Blast Burn: the field, then the bill. `perDestroyed` counts what
       actually died, so a monster something protected is not charged for. */
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Mega Charizard X", "Mega Charizard Y", "Gigantamax Charizard", "Bond Evolution", "Max Revive" or "Substitute". ' +
      'When this monster is Summoned: destroy every monster your opponent controls, and inflict 500 damage to your opponent for each one destroyed. ' +
      'This monster inflicts piercing battle damage. ' +
      MASTER_TEXT,
    cry: 'Blast Burn!',
    summonOnlyBy: roads('mega-charizard-x', 'mega-charizard-y', 'gigantamax-charizard', 'bond-evolution'),
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'destroy', target: OPP_ALL },
          { op: 'damage', amount: 500, scale: 'perDestroyed', to: 'opp' },
        ],
      },
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['pierce'] } },
      masterRoad,
    ],
  },

  'pikachu-thunder-emperor': {
    /* Ten Million Volt Thunderbolt. The turn it lands nobody answers it, and
       every hit after that carries a thousand more. */
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Raichu", "Gigantamax Pikachu", "Bond Evolution", "Max Revive" or "Substitute". ' +
      'When this monster is Summoned: destroy every Spell and Trap your opponent controls, ' +
      'and for the rest of that turn your opponent cannot activate Spells, Traps or hand traps. ' +
      'When this monster inflicts battle damage to your opponent: inflict 1000 more. ' +
      MASTER_TEXT,
    cry: 'Ten Million Volt Thunderbolt!',
    summonOnlyBy: roads('raichu', 'gigantamax-pikachu', 'bond-evolution'),
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'destroy', target: OPP_BACKROW },
          { op: 'silenceOpponent' },
        ],
      },
      { trigger: 'onDealBattleDamage', ops: [{ op: 'damage', amount: 1000, to: 'opp' }] },
      masterRoad,
    ],
  },

  'sceptile-forest-overlord': {
    /* The team's shield: standing beside it nothing else can be broken by a
       card, and everything else hits harder. Venusaur holds the other axis —
       battle — and the two are deliberately not on one card: nothing below a
       God may be proof against both, which `npm run rules` holds every
       monster in the game to. */
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Mega Sceptile", "Bond Evolution", "Max Revive" or "Substitute". ' +
      'This monster inflicts piercing battle damage. ' +
      'While this monster is face-up, your other Pokémon gain 500 ATK and cannot be destroyed by card effects. ' +
      'When this monster destroys a monster in battle: draw 1 card. ' +
      MASTER_TEXT,
    cry: 'Frenzy Plant!',
    summonOnlyBy: roads('mega-sceptile', 'bond-evolution'),
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['pierce'] } },
      {
        trigger: 'continuous',
        ops: [],
        aura: {
          target: sel('own', 'all', { filter: POKEMON, excludeSelf: true }),
          atk: 500,
          grants: ['indestructibleByEffect'],
        },
      },
      { trigger: 'onBattleDestroy', ops: [{ op: 'draw', count: 1, who: 'own' }] },
      masterRoad,
    ],
  },

  'lucario-aura-master': {
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Mega Lucario", "Bond Evolution", "Max Revive" or "Substitute". ' +
      "This monster is unaffected by your opponent's Spell and Trap effects. " +
      'A monster it attacks has its ATK and DEF halved for that battle. ' +
      'When this monster attacks: destroy 1 Spell or Trap your opponent controls. ' +
      MASTER_TEXT,
    cry: 'Aura Master — Bone Rush!',
    summonOnlyBy: roads('mega-lucario', 'bond-evolution'),
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['unaffectedByOpponentSpellsAndTraps', 'halvesDefender'] } },
      { trigger: 'onDeclareAttack', ops: [{ op: 'destroy', target: OPP_ONE_BACKROW }] },
      masterRoad,
    ],
  },

  /* ================================================================ */
  /* The top, and what is above it                                     */
  /* ================================================================ */

  [MASTER]: {
    /* Electrum's arrival on a 5000 body that swings at everything: three
       evolved Pokémon and a turn buy a player with nothing on the table,
       nothing in the backrow and nothing in hand.

       And the sentence that is not on the card. When this monster is
       destroyed — by battle or by an effect, it does not matter which —
       Mewtwo steps out of the Extra Deck in its place. Nothing here says so,
       on purpose: the owner asked for an easter egg inside the easter egg,
       and the whole point of one is that you find it by killing the thing
       you were sure was the end of the deck. `onDestroyed` rather than
       `onLeaveField`, so a Tribute, a bounce or a banish opens nothing —
       destroying the Master is the price, and it is a real one. */
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of one of Ash\'s Level 10 Pokémon, "Max Revive" or "Substitute". ' +
      'When this monster is Summoned: banish every monster and every Spell and Trap your opponent controls, and every card in their hand. ' +
      'This monster attacks every monster your opponent controls once each Battle Phase and inflicts piercing battle damage.',
    cry: 'Master of All!',
    summonOnlyBy: roads(
      'infernape-blaze-unleashed',
      'ash-greninja-ultimate-bond',
      'charizard-flame-emperor',
      'pikachu-thunder-emperor',
      'sceptile-forest-overlord',
      'lucario-aura-master'
    ),
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'banish', target: OPP_ALL },
          { op: 'banish', target: OPP_BACKROW },
          { op: 'banish', target: sel('opp', 'all', { zone: 'hand' }) },
        ],
      },
      /* No `untargetable`, deliberately: in this engine that word shrugs off
         every opponent effect, Dark Hole included, and a Master nothing can
         destroy is a Mewtwo nobody ever meets. It arrives having banished
         their whole hand and board; what they draw after that is their one
         road to the surprise, and it has to stay open. */
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['attackAll', 'pierce'] } },
      {
        trigger: 'onDestroyed',
        ops: [{ op: 'specialSummon', from: 'extra', filter: { slugs: ['mewtwo'] }, position: 'atk' }],
      },
    ],
  },

  mewtwo: {
    /* A Divine-Beast, so the engine's decree carries it: no effect reaches
       it, its own reach through everything, and a bigger body is the answer
       — and there is not one. It counts the fallen, the way Ra counts the
       Graveyard, so the longer the duel that reached it, the larger it is.
       No piercing, for the reason the three Gods have none: putting a body in
       the way has to stay an answer to something nothing else answers. */
    text:
      EVOLVED +
      'Can only be Special Summoned by the effect of "Ash\'s Ultimate Pokémon — Master of All". ' +
      'When this monster is Summoned: destroy every monster your opponent controls, and inflict 1000 damage to your opponent for each one destroyed. ' +
      'This monster gains 500 ATK for each Pokémon in your Graveyard, and attacks every monster your opponent controls once each Battle Phase. ' +
      "This monster cannot be targeted by your opponent's card effects. " +
      "A God is above everything: this monster's attacks and effects ignore your opponent's protections.",
    cry: 'I was created to be the strongest.',
    summonOnlyBy: [MASTER],
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'destroy', target: OPP_ALL },
          { op: 'damage', amount: 1000, scale: 'perDestroyed', to: 'opp' },
        ],
      },
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, grants: ['attackAll', 'untargetable'], per: { zone: 'ownGrave', filter: POKEMON, atk: 500 } },
      },
    ],
  },
};
