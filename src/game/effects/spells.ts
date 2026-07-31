/**
 * Custom, anime-inspired effects for every Spell and Trap in the game.
 */
import type { Pick, Selector, Side } from '../types';
import type { EffectDef } from './monsters';

const sel = (side: Side, pick: Pick, extra: Partial<Selector> = {}): Selector => ({ side, pick, ...extra });
const OPP_PICK = sel('opp', 'chosen');
const OPP_ALL = sel('opp', 'all');
const OPP_ST = sel('opp', 'all', { zone: 'spellTrap' });
const OWN_PICK = sel('own', 'chosen');

export const SPELL_EFFECTS: Record<string, EffectDef> = {
  /* ---------------------------------------------------------------- */
  /* Universal staples                                                 */
  /* ---------------------------------------------------------------- */

  'monster-reborn': {
    text: 'Special Summon 1 monster from either Graveyard to your field in Attack Position.',
    cry: 'Rise again!',
    effects: [
      {
        trigger: 'activate',
        targets: 1,
        ops: [{ op: 'specialSummon', from: 'grave', side: 'both', count: 1, position: 'atk' }],
      },
    ],
  },

  'dark-hole': {
    text: 'Destroy every monster on the field.',
    cry: 'Into the void!',
    effects: [{ trigger: 'activate', ops: [{ op: 'destroy', target: sel('both', 'all') }] }],
  },

  'pot-of-greed': {
    text: 'Draw 2 cards.',
    effects: [{ trigger: 'activate', ops: [{ op: 'draw', count: 2, who: 'own' }] }],
  },

  polymerization: {
    text: 'Fusion Summon 1 Fusion Monster from your Extra Deck by sending the listed materials from your field or hand to the Graveyard. Use the Fusion button on your Extra Deck to activate.',
    cry: 'Fusion Summon!',
    effects: [],
  },

  'swords-of-revealing-light': {
    text: "Flip every face-down monster your opponent controls face-up. Your opponent's monsters cannot attack or change position for 3 turns.",
    cry: 'Let there be light!',
    effects: [
      {
        trigger: 'activate',
        ops: [
          { op: 'flipFaceUp', target: OPP_ALL },
          { op: 'freezeMonsters', who: 'opp', turns: 3 },
        ],
      },
    ],
  },

  'trap-hole': {
    text: 'When your opponent Normal Summons a monster: destroy it and inflict 400 damage to your opponent.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentSummon',
        label: 'Trap Hole — destroy the summoned monster',
        ops: [
          { op: 'destroy', target: sel('opp', 'attacker') },
          { op: 'damage', amount: 400, to: 'opp' },
        ],
      },
    ],
  },

  'negate-attack': {
    text: "When your opponent declares an attack: negate the attack and end their Battle Phase.",
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Negate Attack',
        ops: [{ op: 'negateAttack' }, { op: 'endBattlePhase' }],
      },
    ],
  },

  'just-desserts': {
    text: 'Inflict 600 damage to your opponent for each monster they control.',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Just Desserts',
        ops: [{ op: 'damage', amount: 600, scale: 'perOppMonster', to: 'opp' }],
      },
    ],
  },

  'stop-defense': {
    text: 'Force 1 monster your opponent controls into face-up Attack Position.',
    effects: [{ trigger: 'activate', targets: 1, ops: [{ op: 'forceAttackPosition', target: OPP_PICK }] }],
  },

  'de-spell': {
    text: 'Destroy 1 Spell or Trap your opponent controls, then draw 1 card.',
    effects: [
      {
        trigger: 'activate',
        ops: [
          { op: 'destroy', target: OPP_ST },
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  'tribute-to-the-doomed': {
    text: 'Discard 1 card, then destroy 1 monster your opponent controls.',
    effects: [
      {
        trigger: 'activate',
        targets: 1,
        cost: { discard: 1 },
        ops: [{ op: 'destroy', target: OPP_PICK }],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Yugi                                                              */
  /* ---------------------------------------------------------------- */

  'magical-hats': {
    text: "When your opponent declares an attack: negate the attack, end their Battle Phase, and Special Summon 1 Spellcaster from your Deck.",
    cry: 'Pick a hat, any hat!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Magical Hats',
        ops: [
          { op: 'negateAttack' },
          { op: 'endBattlePhase' },
          { op: 'specialSummon', from: 'deck', filter: { type: 'Spellcaster' }, count: 1, position: 'def', face: 'down' },
        ],
      },
    ],
  },

  'brain-control': {
    text: 'Pay 800 Life Points: take control of 1 monster your opponent controls until the end of the turn.',
    cry: 'Your mind is mine!',
    effects: [
      {
        trigger: 'activate',
        targets: 1,
        cost: { lp: 800 },
        ops: [{ op: 'takeControl', target: OPP_PICK, duration: 'turn' }],
      },
    ],
  },

  'mirror-force': {
    text: 'When your opponent declares an attack: destroy every Attack Position monster they control.',
    cry: 'Reflect their power!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Mirror Force',
        ops: [
          { op: 'negateAttack' },
          { op: 'destroy', target: sel('opp', 'all', { filter: { position: 'atk' } }) },
        ],
      },
    ],
  },

  'spellbinding-circle': {
    text: 'When your opponent declares an attack: negate it. The attacking monster loses 700 ATK and cannot attack while this card remains face-up.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Spellbinding Circle',
        reusable: true,
        ops: [
          { op: 'negateAttack' },
          { op: 'gainAtk', amount: -700, target: sel('opp', 'attacker'), duration: 'permanent' },
          { op: 'freezeMonsters', who: 'opp', turns: 1 },
        ],
      },
    ],
  },

  multiply: {
    text: 'Special Summon 3 Kuriboh Tokens (300/200) to your field.',
    effects: [
      {
        trigger: 'activate',
        ops: [{ op: 'summonToken', name: 'Kuriboh Token', atk: 300, def: 200, count: 3, artSlug: 'kuriboh' }],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Kaiba                                                             */
  /* ---------------------------------------------------------------- */

  'the-flute-of-summoning-dragon': {
    text: 'Special Summon up to 2 Dragon monsters from your hand.',
    cry: 'Come forth, my dragons!',
    effects: [
      {
        trigger: 'activate',
        ops: [{ op: 'specialSummon', from: 'hand', filter: { type: 'Dragon' }, count: 2, position: 'atk' }],
      },
    ],
  },

  'enemy-controller': {
    text: 'Take control of 1 monster your opponent controls until the end of the turn, and force it into Attack Position.',
    effects: [
      {
        trigger: 'activate',
        targets: 1,
        ops: [
          { op: 'takeControl', target: OPP_PICK, duration: 'turn' },
          { op: 'forceAttackPosition', target: sel('own', 'chosen') },
        ],
      },
    ],
  },

  'crush-card-virus': {
    text: 'Destroy every monster your opponent controls with 1500 or more ATK, then they discard 2 random cards.',
    cry: 'Crush Card!',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Crush Card Virus',
        ops: [
          { op: 'destroy', target: sel('opp', 'all', { filter: { minAtk: 1500 } }) },
          { op: 'discard', count: 2, who: 'opp' },
        ],
      },
    ],
  },

  'ring-of-destruction': {
    text: "Destroy 1 monster your opponent controls and inflict damage to your opponent equal to that monster's ATK.",
    cry: 'Ring of Destruction!',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Ring of Destruction',
        targets: 1,
        ops: [
          { op: 'damage', scale: 'targetAtk', to: 'opp' },
          { op: 'destroy', target: OPP_PICK },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Joey                                                              */
  /* ---------------------------------------------------------------- */

  scapegoat: {
    text: 'Special Summon 3 Sheep Tokens (0/500) in Defense Position.',
    effects: [
      {
        trigger: 'activate',
        ops: [{ op: 'summonToken', name: 'Sheep Token', atk: 0, def: 500, count: 3, artSlug: 'scapegoat' }],
      },
    ],
  },

  'shield-sword': {
    text: 'Swap the ATK and DEF of every monster on the field until the end of the turn.',
    effects: [{ trigger: 'activate', ops: [{ op: 'swapAtkDef', target: sel('both', 'all') }] }],
  },

  'giant-trunade': {
    text: 'Return every Spell and Trap on the field to their owners\' hands.',
    effects: [{ trigger: 'activate', ops: [{ op: 'bounce', target: sel('both', 'all', { zone: 'spellTrap' }) }] }],
  },

  salamandra: {
    text: 'Equip to a monster you control: it gains 700 ATK and inflicts piercing battle damage.',
    effects: [
      { trigger: 'activate', targets: 1, ops: [{ op: 'equipTo', atk: 700, def: 0, grants: ['pierce'] }] },
    ],
  },

  'legendary-sword': {
    text: 'Equip to a monster you control: it gains 400 ATK and 400 DEF and cannot be destroyed by battle.',
    effects: [
      { trigger: 'activate', targets: 1, ops: [{ op: 'equipTo', atk: 400, def: 400, grants: ['indestructibleByBattle'] }] },
    ],
  },

  'kunai-with-chain': {
    text: 'When your opponent declares an attack: negate it, then 1 monster you control gains 500 ATK permanently.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Kunai with Chain',
        ops: [
          { op: 'negateAttack' },
          { op: 'gainAtk', amount: 500, target: sel('own', 'strongest'), duration: 'permanent' },
        ],
      },
    ],
  },

  graverobber: {
    text: "Add 1 card from your opponent's Graveyard to your hand.",
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Graverobber',
        ops: [{ op: 'stealFromGrave' }],
      },
    ],
  },

  'skull-dice': {
    text: "Roll a die: every monster your opponent controls loses 200 ATK for each pip until the end of the turn.",
    cry: 'Roll them bones!',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Skull Dice',
        ops: [{ op: 'diceRoll', perPip: [{ op: 'gainAtk', amount: -200, target: OPP_ALL, duration: 'turn' }] }],
      },
    ],
  },

  'graceful-dice': {
    text: 'Roll a die: every monster you control gains 200 ATK for each pip until the end of the turn.',
    effects: [
      {
        trigger: 'activate',
        ops: [{ op: 'diceRoll', perPip: [{ op: 'gainAtk', amount: 200, target: sel('own', 'all'), duration: 'turn' }] }],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Mai                                                               */
  /* ---------------------------------------------------------------- */

  'elegant-egotist': {
    text: 'Special Summon 1 "Harpie Lady Sisters" from your Deck or hand.',
    cry: 'Multiply, my Harpies!',
    effects: [
      {
        trigger: 'activate',
        ops: [{ op: 'specialSummon', from: 'deck', filter: { slugs: ['harpie-lady-sisters', 'cyber-harpie-lady', 'harpie-lady'] }, count: 1, position: 'atk' }],
      },
    ],
  },

  'cyber-shield': {
    text: 'Equip to a monster you control: it gains 500 ATK and cannot be targeted by your opponent\'s effects.',
    effects: [
      { trigger: 'activate', targets: 1, ops: [{ op: 'equipTo', atk: 500, def: 0, grants: ['untargetable'] }] },
    ],
  },

  'harpie-s-feather-duster': {
    text: 'Destroy every Spell and Trap your opponent controls, then draw 1 card.',
    cry: 'Sweep them away!',
    effects: [
      {
        trigger: 'activate',
        ops: [
          { op: 'destroy', target: OPP_ST },
          { op: 'destroy', target: sel('opp', 'all', { zone: 'field' }) },
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  'harpies-hunting-ground': {
    text: 'Field Spell: all Winged Beast monsters gain 300 ATK and 300 DEF. When activated: destroy 1 Spell or Trap your opponent controls.',
    effects: [
      { trigger: 'activate', ops: [{ op: 'destroy', target: OPP_ST }] },
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { type: 'Winged Beast' } }), atk: 300, def: 300 },
      },
    ],
  },

  'mirror-wall': {
    text: 'Stays face-up. Each time your opponent declares an attack: negate it, the attacking monster loses half its ATK permanently, and you gain 300 Life Points.',
    cry: 'Your own strength, turned against you!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Mirror Wall',
        reusable: true,
        ops: [
          { op: 'negateAttack' },
          { op: 'halveAtk', target: sel('opp', 'attacker') },
          { op: 'heal', amount: 300, to: 'own' },
        ],
      },
    ],
  },

  'malevolent-nuzzler': {
    text: 'Equip to a monster you control: it gains 700 ATK.',
    effects: [{ trigger: 'activate', targets: 1, ops: [{ op: 'equipTo', atk: 700, def: 0 }] }],
  },

  'harpie-lady-phoenix-formation': {
    text: 'Destroy up to 2 monsters your opponent controls, then inflict 500 damage to them.',
    cry: 'Phoenix Formation!',
    effects: [
      {
        trigger: 'activate',
        targets: 2,
        ops: [
          { op: 'destroy', target: sel('opp', 'chosen', { count: 2 }) },
          { op: 'damage', amount: 500, to: 'opp' },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Pegasus                                                           */
  /* ---------------------------------------------------------------- */

  'toon-world': {
    text: 'Continuous Spell: pay 500 Life Points. While this card is face-up, your Toon monsters can attack your opponent directly and cannot be targeted by their effects.',
    cry: 'Welcome to my Toon World!',
    effects: [
      {
        trigger: 'activate',
        cost: { lp: 500 },
        ops: [{ op: 'draw', count: 1, who: 'own' }],
      },
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { nameIncludes: 'Toon' } }), atk: 300, grants: ['directAttack', 'untargetable'] },
      },
    ],
  },

  'black-illusion-ritual': {
    text: 'Tribute 1 monster you control: Special Summon "Relinquished" from your hand or Deck.',
    effects: [
      {
        trigger: 'activate',
        cost: { tribute: 1 },
        ops: [{ op: 'specialSummon', from: 'deck', filter: { slugs: ['relinquished'] }, count: 1, position: 'atk' }],
      },
    ],
  },

  'shadow-spell': {
    text: 'When your opponent declares an attack: negate it. That monster loses 800 ATK and cannot attack for 1 turn.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Shadow Spell',
        reusable: true,
        ops: [
          { op: 'negateAttack' },
          { op: 'gainAtk', amount: -800, target: sel('opp', 'attacker'), duration: 'permanent' },
          { op: 'freezeMonsters', who: 'opp', turns: 1 },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Bakura                                                            */
  /* ---------------------------------------------------------------- */

  'change-of-heart': {
    text: 'Take control of 1 monster your opponent controls until the end of the turn.',
    cry: 'Your heart belongs to the shadows.',
    effects: [
      { trigger: 'activate', targets: 1, ops: [{ op: 'takeControl', target: OPP_PICK, duration: 'turn' }] },
    ],
  },

  'the-dark-door': {
    text: 'Continuous Spell: your opponent\'s monsters lose 300 ATK and only one of their monsters may attack each turn.',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -300 } },
    ],
  },

  'call-of-the-haunted': {
    text: 'Special Summon 1 monster from your Graveyard in Attack Position. It gains 400 ATK.',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Call of the Haunted',
        ops: [
          { op: 'specialSummon', from: 'grave', count: 1, position: 'atk' },
          { op: 'gainAtk', amount: 400, target: sel('own', 'strongest'), duration: 'permanent' },
        ],
      },
    ],
  },

  michizure: {
    text: 'When a monster you control is destroyed: destroy 1 monster your opponent controls.',
    effects: [
      {
        trigger: 'trap',
        window: 'monsterDestroyed',
        label: 'Michizure — drag them down',
        targets: 1,
        ops: [{ op: 'destroy', target: OPP_PICK }],
      },
    ],
  },

  'dark-sanctuary': {
    text: 'Field Spell: all monsters your opponent controls lose 400 ATK. At the end of each of your turns, inflict 300 damage to your opponent.',
    cry: 'Welcome to the Shadow Realm.',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -400 } },
      { trigger: 'onOwnTurnEnd', ops: [{ op: 'damage', amount: 300, to: 'opp' }] },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Mako                                                              */
  /* ---------------------------------------------------------------- */

  umi: {
    text: 'Field Spell: all WATER monsters gain 400 ATK and 300 DEF.',
    cry: 'The sea answers my call!',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { attribute: 'WATER' } }), atk: 400, def: 300 },
      },
    ],
  },

  'fortress-whale-s-oath': {
    text: 'Tribute 1 monster you control: Special Summon "Fortress Whale" from your hand or Deck.',
    effects: [
      {
        trigger: 'activate',
        cost: { tribute: 1 },
        ops: [{ op: 'specialSummon', from: 'deck', filter: { slugs: ['fortress-whale'] }, count: 1, position: 'atk' }],
      },
    ],
  },

  'torrential-tribute': {
    text: 'When your opponent summons a monster: destroy every monster on the field.',
    cry: 'The tide sweeps all!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentSummon',
        label: 'Torrential Tribute',
        ops: [{ op: 'destroy', target: sel('both', 'all') }],
      },
    ],
  },

  'tornado-wall': {
    text: 'You take no battle damage for the rest of the Duel while this card remains face-up.',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Tornado Wall',
        ops: [{ op: 'preventBattleDamage', who: 'own', duration: 'permanent' }],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Weevil                                                            */
  /* ---------------------------------------------------------------- */

  'laser-cannon-armor': {
    text: 'Equip to a monster you control: it gains 400 ATK and inflicts piercing battle damage.',
    effects: [{ trigger: 'activate', targets: 1, ops: [{ op: 'equipTo', atk: 400, def: 0, grants: ['pierce'] }] }],
  },

  'insect-armor-with-laser-cannon': {
    text: 'Equip to a monster you control: it gains 700 ATK and can attack twice each Battle Phase.',
    effects: [{ trigger: 'activate', targets: 1, ops: [{ op: 'equipTo', atk: 700, def: 0, grants: ['doubleAttack'] }] }],
  },

  'gift-of-the-mystical-elf': {
    text: 'Gain 1500 Life Points.',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Gift of The Mystical Elf',
        ops: [{ op: 'heal', amount: 1500, to: 'own' }],
      },
    ],
  },

  'insect-barrier': {
    text: "Continuous Spell: your opponent's monsters lose 400 ATK and cannot attack during their next turn.",
    effects: [
      { trigger: 'activate', ops: [{ op: 'freezeMonsters', who: 'opp', turns: 1 }] },
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -400 } },
    ],
  },

  'eradicating-aerosol': {
    text: 'Destroy 1 monster your opponent controls, then draw 1 card.',
    effects: [
      {
        trigger: 'activate',
        targets: 1,
        ops: [
          { op: 'destroy', target: OPP_PICK },
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Bandit Keith                                                      */
  /* ---------------------------------------------------------------- */

  'machine-conversion-factory': {
    text: 'Equip to a monster you control: it gains 400 ATK and 400 DEF.',
    effects: [{ trigger: 'activate', targets: 1, ops: [{ op: 'equipTo', atk: 400, def: 400 }] }],
  },

  '7-completed': {
    text: 'Equip to a monster you control: it gains 700 ATK and cannot be destroyed by battle.',
    effects: [
      { trigger: 'activate', targets: 1, ops: [{ op: 'equipTo', atk: 700, def: 0, grants: ['indestructibleByBattle'] }] },
    ],
  },

  metalmorph: {
    text: 'Equip to a monster you control: it gains 800 ATK, cannot be destroyed by battle, and inflicts piercing battle damage.',
    cry: 'Metalmorph!',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Metalmorph',
        targets: 1,
        ops: [{ op: 'equipTo', atk: 800, def: 0, grants: ['indestructibleByBattle', 'pierce'] }],
      },
    ],
  },

  'time-machine': {
    text: 'Special Summon 1 monster from your Graveyard in Attack Position, and it gains 300 ATK.',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Time Machine',
        ops: [
          { op: 'specialSummon', from: 'grave', count: 1, position: 'atk' },
          { op: 'gainAtk', amount: 300, target: sel('own', 'strongest'), duration: 'permanent' },
        ],
      },
    ],
  },
};

/** Cards whose "chosen" target is on the controller's own side of the field. */
export const OWN_TARGET_CARDS = new Set([
  'salamandra',
  'legendary-sword',
  'cyber-shield',
  'malevolent-nuzzler',
  'laser-cannon-armor',
  'insect-armor-with-laser-cannon',
  'machine-conversion-factory',
  '7-completed',
  'metalmorph',
]);

export { OWN_PICK };
