/**
 * Custom, anime-inspired effects for every Spell and Trap in the game.
 */
import type { Pick, Selector, Side } from '../types';
import type { EffectDef } from './monsters';

const sel = (side: Side, pick: Pick, extra: Partial<Selector> = {}): Selector => ({ side, pick, ...extra });
const OPP_PICK = sel('opp', 'chosen');
const OPP_ALL = sel('opp', 'all');
const OPP_ST = sel('opp', 'all', { zone: 'spellTrap' });
/* "1 Spell or Trap your opponent controls" — a Field Spell is a Spell they
   control, so this reaches the Field Zone too and the player picks which.
   Toon World sat in that zone untouchable by everything that says those
   words, which against Pegasus is the card the whole deck is built on. */
const OPP_ONE_BACKROW = sel('opp', 'chosen', { zone: 'backrow', count: 1 });
const OWN_PICK = sel('own', 'chosen');

export const SPELL_EFFECTS: Record<string, EffectDef> = {
  /* ---------------------------------------------------------------- */
  /* Universal staples                                                 */
  /* ---------------------------------------------------------------- */

  'card-of-sanctity': {
    /* The card that makes Slifer terrifying, and the reason he is not simply
       unbeatable: it fills the opponent's hand just as generously, and a full
       hand is what everybody else spends on answers. */
    text: 'Each player draws until they hold 6 cards.',
    cry: 'Draw, both of us!',
    effects: [{ trigger: 'activate', ops: [{ op: 'drawTo', count: 6, who: 'both' }] }],
  },

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
        // "Normal Summons", and it means it: a Fusion Summon is a Special
        // Summon and opens the wider `opponentSummon` window, which Torrential
        // Tribute watches and this card does not.
        window: 'opponentNormalSummon',
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
        targets: 1,
        ops: [
          { op: 'destroy', target: OPP_ONE_BACKROW },
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
    // No Life Point cost here, by the owner's decision. Four thousand Life
    // Points is a two-attack game, so 800 is a fifth of the duel for one turn
    // of borrowing — the card was priced for a format that starts at 8000.
    text: 'Take control of 1 monster your opponent controls until the end of the turn.',
    cry: 'Your mind is mine!',
    effects: [
      {
        trigger: 'activate',
        targets: 1,
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
    /* The circle binds one monster, and it binds it by staying on the field —
       both of which the old version got wrong. `freezeMonsters` locks down
       *every* monster its target controls, so answering one attacker stopped
       their whole board; it ran on a one-turn timer rather than on the card
       still being there; and the −700 was written into the monster, so it kept
       the penalty after the circle was destroyed and the circle itself went
       straight to the Graveyard having promised to remain face-up.
       Attaching it is all three at once: an equip is read live as an aura, so
       the penalty and the lock last exactly as long as the card does, they
       reach only the monster it is on, and `toGrave` already sends an equip
       down with its host — which is what happens when the bound monster
       leaves the field. */
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Spellbinding Circle',
        ops: [
          { op: 'negateAttack' },
          { op: 'equipTo', atk: -700, def: 0, grants: ['cannotAttack'], target: sel('opp', 'attacker') },
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
    effects: [{ trigger: 'activate', ops: [{ op: 'bounce', target: sel('both', 'all', { zone: 'backrow' }) }] }],
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
        // Theirs, and only theirs — the card is named for it.
        ops: [{ op: 'stealFromGrave', from: 'opp' }],
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
      { trigger: 'activate', targets: 1, ops: [{ op: 'destroy', target: OPP_ONE_BACKROW }] },
      {
        trigger: 'continuous',
        ops: [],
        // "All Winged Beast monsters" — the weather again, both sides of it.
        aura: { target: sel('both', 'all', { filter: { type: 'Winged Beast' } }), atk: 300, def: 300 },
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
    /* A Field Spell in this game rather than a Continuous one. Pegasus has a
       single Spell/Trap Zone and his entire deck is gated on this card being
       down — spending that one slot on it permanently meant he could never hold
       a Trap, and the deck that most needs its enabler was the deck least able
       to afford it. The Field Zone is separate, so it costs him nothing now. */
    subKindOverride: 'Field',
    text: 'Field Spell: pay 500 Life Points, draw 2 cards and add 1 Toon monster from your Deck to your hand. While this card is face-up, your Toon monsters need no Tribute to Summon, gain 800 ATK, inflict piercing battle damage, can attack your opponent directly, and cannot be targeted by your opponent\'s effects.',
    cry: 'Welcome to my Toon World!',
    effects: [
      {
        trigger: 'activate',
        cost: { lp: 500 },
        // Pegasus's whole deck is built on getting this down and then having a
        // Toon to put under it, so the card that enables the deck is also the
        // card that finds the rest of it.
        ops: [
          { op: 'draw', count: 2, who: 'own' },
          { op: 'search', filter: { kind: 'monster', toon: true } },
        ],
      },
      {
        trigger: 'continuous',
        ops: [],
        aura: {
          /* Toon *monsters*. Without `kind`, `isToon` matches the card's own
             name, so Toon World granted itself `untargetable` — the one card
             Pegasus's whole deck depends on could not be destroyed by anything
             that targets, sitting in a zone nothing could reach either.
             Reported as "Toon World as a field spell should be destroyable". */
          target: sel('own', 'all', { filter: { toon: true, kind: 'monster' } }),
          atk: 800,
          grants: ['directAttack', 'untargetable', 'pierce'],
        },
      },
    ],
  },

  'black-illusion-ritual': {
    text: 'Tribute 1 monster you control: Special Summon "Relinquished" from your hand or Deck.',
    effects: [
      {
        trigger: 'activate',
        cost: { tribute: 1 },
        // Hand as well as Deck: Relinquished cannot be Normal Summoned, so a
        // drawn copy would otherwise sit in hand for the rest of the duel.
        ops: [{ op: 'specialSummon', from: ['hand', 'deck'], filter: { slugs: ['relinquished'] }, count: 1, position: 'atk' }],
      },
    ],
  },

  'shadow-spell': {
    /* Continuous, and it says so. It read like a one-shot Trap and then kept
       being offered every time an attack was declared, which looks like a card
       being activated twice rather than one that never left. */
    text: 'Stays face-up. Each time your opponent declares an attack: negate it. That monster loses 800 ATK permanently and cannot attack for 1 turn.',
    cry: 'Bound in shadow!',
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
    /* Printed as a Continuous Trap, played here as a one-shot.
     *
     * The real card equips itself to what it revived: the monster dies when
     * the trap goes, the trap goes when the monster does. None of that
     * machinery was here — nothing linked the two — so it simply sat face-up
     * in the one Spell/Trap Zone for the rest of the duel, and tributing the
     * revived monster left it stranded there doing nothing at all.
     *
     * Rather than build the link, the card is a Normal Trap: it brings the
     * monster back, hands over the 400 ATK, and goes to the Graveyard. The
     * revival is unconditional and the zone is free again — stronger than the
     * printed card, and the way it reads in the anime, which is the point.
     */
    subKindOverride: 'Normal',
    text: 'Special Summon 1 monster from your Graveyard in Attack Position. It gains 400 ATK.',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Call of the Haunted',
        ops: [
          { op: 'specialSummon', from: 'grave', count: 1, position: 'atk' },
          /* "It gains 400 ATK" — *it*, the monster just revived. `strongest`
             handed the bonus to whatever was already the biggest thing on your
             side, so reviving anything small buffed the wrong monster and the
             card read as doing nothing. */
          { op: 'gainAtk', amount: 400, target: sel('own', 'summoned'), duration: 'permanent' },
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
    /* A Field Spell is the weather, not a personal buff: "all WATER monsters"
       means both sides of the table, which is how the real card reads and how
       it was reported from a real duel — one player's Umi lifted their own
       Fish and left the opponent's alone. The Legendary Fisherman needs no
       change to go with it, because `requiresField` already looks at either
       Field Zone. */
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('both', 'all', { filter: { attribute: 'WATER' } }), atk: 400, def: 300 },
      },
    ],
  },

  /* The oath is sworn to the sea, not to one animal: it brings out either of
     Mako's Ritual monsters. Crab Turtle has no Oath card of its own, and a
     Ritual monster with nothing to Summon it is simply a dead draw. */
  'fortress-whale-s-oath': {
    text: 'Tribute 1 monster you control: Special Summon "Fortress Whale" or "Crab Turtle" from your hand or Deck.',
    cry: 'Rise from the depths!',
    effects: [
      {
        trigger: 'activate',
        cost: { tribute: 1 },
        ops: [
          {
            op: 'specialSummon',
            from: ['hand', 'deck'],
            filter: { slugs: ['fortress-whale', 'crab-turtle'] },
            count: 1,
            position: 'atk',
          },
        ],
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
