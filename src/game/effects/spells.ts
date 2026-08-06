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
    /* Either Graveyard — owner's call, and the printed card's own wording.
       The balance pass had narrowed it to your own side because in eleven
       decks that all carry it, a dead signature bomb becomes the opponent's
       best play; that cost is accepted deliberately, because taking the
       other duelist's monster is the card's whole drama.

       A borrowed God is still only a rental: `returnBorrowedGods` sweeps
       every Divine-Beast that did not pay its three Tributes at the End
       Phase, and `toGrave` sends a card to its *owner's* Graveyard, so a
       stolen Slifer goes home rather than into the thief's. That rule was
       written for exactly this wording and is pinned. */
    text: "Special Summon 1 monster from either player's Graveyard in Attack Position.",
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
    text: "When your opponent declares an attack: negate the attack, end their Battle Phase, and Special Summon 1 Magician from your Deck face-down.",
    cry: 'Pick a hat, any hat!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Magical Hats',
        ops: [
          { op: 'negateAttack' },
          { op: 'endBattlePhase' },
          {
            op: 'specialSummon',
            from: 'deck',
            /* Named magicians, not every Spellcaster. The wide filter's worst
               output was pulling an Exodia piece under a hat: `checkExodia`
               reads the hand only, so a piece summoned to the field is
               stranded and the win it belongs to is dead. The hats hide
               magicians; the Forbidden One stays in the Deck where the hand
               can still assemble him. */
            filter: { slugs: ['dark-magician', 'dark-magician-girl', 'mystical-elf', 'magician-of-faith'] },
            count: 1,
            position: 'def',
            face: 'down',
          },
        ],
      },
    ],
  },

  'brain-control': {
    /* Owner's call: free. It carried 600 Life Points from the 4000-LP days as
       a brake on borrowing a body for tribute fodder or a lethal swing — the
       card is now priced by the turn limit alone, which is the register this
       game is written in. */
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
    /* One shot now, on purpose — and the text promises no permanence, so the
       "an ongoing effect belongs to its card" rule is not being broken, it is
       being priced. The equip version was correct about *duration* and wrong
       about *cost*: the circle parked face-up in its owner's ONLY Spell/Trap
       Zone for as long as the bound monster lived, so answering one attacker
       locked Yugi out of Mirror Force, Magical Hats and — because a Fusion
       needs a free zone — his own Dark Paladin. A trap that spends itself
       leaves the zone open, and the scar it leaves is permanent because a
       binding circle is not something a monster walks out of. */
    subKindOverride: 'Normal',
    text: 'When your opponent declares an attack: negate it, and the attacking monster permanently loses 700 ATK.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Spellbinding Circle',
        ops: [
          { op: 'negateAttack' },
          { op: 'gainAtk', amount: -700, target: sel('opp', 'attacker'), duration: 'permanent' },
        ],
      },
    ],
  },

  multiply: {
    /* Owner's call, and it is the anime's version: the horde comes out of
       nowhere. It was gated on a face-up Kuriboh during the balance pass
       because unconditional it is the fastest God line in the game — one card
       into three Slifer tributes — which is the point. Yami is the God deck
       and the God deck is decreed to sit at the top; the gate is off. */
    text: 'Special Summon 3 Kuriboh Tokens (300/200).',
    cry: 'Multiply!',
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
    /* The burn goes both ways now, as printed — and as aired: Kaiba straps the
       ring to a monster knowing the blast reaches him too. One-sided it was
       free removal plus a fifth of the opponent's Life Points at no stake;
       symmetric it is a real decision with the race on the table, and the AI
       prices both halves through the same damage op. */
    text: "Destroy 1 monster your opponent controls and inflict damage to BOTH players equal to that monster's ATK.",
    cry: 'Ring of Destruction!',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Ring of Destruction',
        targets: 1,
        ops: [
          { op: 'damage', scale: 'targetAtk', to: 'opp' },
          { op: 'damage', scale: 'targetAtk', to: 'own' },
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
    // "Deck or hand" is what the text always promised; the op only read the
    // Deck, so a drawn Sisters made the card weaker instead of faster.
    text: 'Special Summon 1 "Harpie Lady Sisters" from your Deck or hand.',
    cry: 'Multiply, my Harpies!',
    effects: [
      {
        trigger: 'activate',
        ops: [{ op: 'specialSummon', from: ['deck', 'hand'], filter: { slugs: ['harpie-lady-sisters', 'cyber-harpie-lady', 'harpie-lady'] }, count: 1, position: 'atk' }],
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
    /* The wall bills its keeper now — the printed card's own upkeep. Free
       and healing on top, it was a standing "no" to every attack for the
       rest of the duel; at 500 a reflection every "no" spends a real slice
       of the Life Points it is protecting. The trap path pays `cost.lp` and
       `activatableTraps` stops offering it when the Life Points are not
       there. */
    text: 'Stays face-up. Each time your opponent declares an attack, pay 500 Life Points: negate it, and the attacking monster loses half its ATK permanently.',
    cry: 'Your own strength, turned against you!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Mirror Wall',
        reusable: true,
        cost: { lp: 500 },
        ops: [
          { op: 'negateAttack' },
          { op: 'halveAtk', target: sel('opp', 'attacker') },
        ],
      },
    ],
  },

  'malevolent-nuzzler': {
    text: 'Equip to a monster you control: it gains 700 ATK.',
    effects: [{ trigger: 'activate', targets: 1, ops: [{ op: 'equipTo', atk: 700, def: 0 }] }],
  },

  'harpie-lady-phoenix-formation': {
    /* It is a Harpie manoeuvre, so it needs Harpies flying it. Condition-free
       it was generic removal that won duels the flock never appeared in. */
    text: 'If you control a Winged Beast monster: destroy up to 2 monsters your opponent controls, then inflict 500 damage to them.',
    cry: 'Phoenix Formation!',
    effects: [
      {
        trigger: 'activate',
        targets: 2,
        condition: { controlsOtherOfType: 'Winged Beast' },
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
    text: 'Field Spell: pay 1000 Life Points and add 1 Toon monster from your Deck to your hand. While this card is face-up, your Toon monsters need no Tribute to Summon, gain 800 ATK, inflict piercing battle damage, cannot be destroyed by your opponent\'s card effects, and can attack your opponent directly at a cost of 500 Life Points per attack — but cannot attack the turn they are Summoned. When this card is sent to the Graveyard: destroy all your Toon monsters.',
    cry: 'Welcome to my Toon World!',
    effects: [
      {
        trigger: 'activate',
        /* The printed cost, finally chargeable: 1000 was absurd against a
           4000 pool and is exactly right against 8000 — at the old 500 the
           8000-point format let Pegasus open the book for pocket change and
           he benched 75. The search alone; the draw-2 rider died earlier,
           because a deck's engine card must not also be its best
           card-advantage card. */
        cost: { lp: 1000 },
        ops: [{ op: 'search', filter: { kind: 'monster', toon: true } }],
      },
      {
        /* The printed rule, and the whole counterplay story: the Toons only
           exist while the book is open. Destroying Toon World — De-Spell,
           Feather Duster, a Hunting Ground pop, Ultimate Dragon's arrival —
           was already the intended answer to Pegasus; now it answers the
           board too, not just the next summon. `onSentToGrave` fires when the
           card is destroyed or replaced; a bounce keeps the book intact, so a
           returned Toon World spares the Toons — closed, not burned. */
        trigger: 'onSentToGrave',
        ops: [{ op: 'destroy', target: sel('own', 'all', { filter: { toon: true, kind: 'monster' } }) }],
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
          /* The toll rides with the mischief: every direct attack a Toon
             declares costs Pegasus 500 Life Points — the printed rule.
             Effect-indestructible, NOT untargetable, since the 8000 pool:
             this engine's `untargetable` skips every opposing effect, so
             Mirror Wall could not halve a Toon and Skull Dice could not
             shrink one, and at 8000 Life Points an attacker no card may
             even touch simply grinds the duel out (pegasus benched 74).
             Nothing can DESTROY a Toon while the book is open — that is
             the cartoon promise — but binds, debuffs and borrowings land,
             and half the roster carries one. */
          grants: ['directAttack', 'directAttackTax', 'indestructibleByEffect', 'pierce', 'summonSick'],
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
    /* One shot now. Reusable, this was a standing "no, and it costs you 800"
       to every attack for the rest of the duel, in the deck least in need of
       the help — and its freeze locked the opponent's whole board for a
       sentence about one monster, the exact shape the Spellbinding Circle
       lesson is about. The chains bind the one monster they caught, hard,
       and the card is spent. */
    subKindOverride: 'Normal',
    text: 'When your opponent declares an attack: negate it, and the attacking monster permanently loses 800 ATK.',
    cry: 'Bound in shadow!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Shadow Spell',
        ops: [
          { op: 'negateAttack' },
          { op: 'gainAtk', amount: -800, target: sel('opp', 'attacker'), duration: 'permanent' },
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
    /* The old text promised "only one of their monsters may attack each turn"
       and no effect backed it — a per-side attack cap does not exist in this
       engine. The door's sentence is rewritten to what a door can honestly
       be here: the big cannot fit through. Mid-sized attackers still walk in,
       so it walls the bosses without stalling the duel, and destroying the
       door (the one Spell/Trap Zone) opens it again. */
    text: "Continuous Spell: your opponent's monsters lose 300 ATK, and their monsters with 2000 or more ATK cannot attack.",
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -300 } },
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('opp', 'all', { filter: { minAtk: 2000 } }), grants: ['cannotAttack'] },
      },
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
    /* The ghost took a coin from Barrel Dragon: the flat 300 tick was too
       small to ever matter and too flat to feel haunted. Heads is a real
       bite; tails is still the old tick. Same expected burn roughly doubled,
       and the End Phase becomes a beat worth watching. */
    text: 'Field Spell: all monsters your opponent controls lose 400 ATK and your Fiend monsters gain 300 ATK. At the end of each of your turns, flip a coin: Heads — inflict 800 damage to your opponent. Tails — inflict 300.',
    cry: 'Welcome to the Shadow Realm.',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -400 } },
      /* The haunted house feeds its own ghosts — a 700-point field-wide swing
         once the sanctuary stands, which is what a Field Spell is for. */
      { trigger: 'continuous', ops: [], aura: { target: sel('own', 'all', { filter: { kind: 'monster', type: 'Fiend' } }), atk: 300 } },
      {
        trigger: 'onOwnTurnEnd',
        ops: [
          {
            op: 'coinFlip',
            heads: [{ op: 'damage', amount: 800, to: 'opp' }],
            tails: [{ op: 'damage', amount: 300, to: 'opp' }],
          },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Mako                                                              */
  /* ---------------------------------------------------------------- */

  umi: {
    text: 'Field Spell: all WATER monsters gain 500 ATK and 300 DEF.',
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
        aura: { target: sel('both', 'all', { filter: { attribute: 'WATER' } }), atk: 500, def: 300 },
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
    /* Gated on the sea. Ungated this was a permanent "battle damage no longer
       exists" from any deck state — the strongest defensive write in the game
       with no theme attached. The waterspouts are drawn up out of Umi, so Umi
       is what the activation requires; the trap path already enforces
       `condition` at fire time. The protection itself stays for the duel,
       which is the over-anime register — the wall, once raised, holds. */
    text: "Activate only while 'Umi' is on the field: you take no battle damage for the rest of the Duel.",
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Tornado Wall',
        condition: { requiresField: 'umi' },
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
    /* A factory, not a coat of paint. As an equip (+400/+400) it competed for
       Keith's one Spell/Trap Zone against Metalmorph and his traps and lost
       every time. His real structural problem is the curve — seven of his
       monsters cost tributes — so the factory now fixes exactly that: it
       ships the small machines out onto the line, and the line is what the
       tributes are paid from. */
    text: 'Special Summon up to 2 Machine monsters with 1600 or less ATK from your hand.',
    cry: 'Production line, roll out!',
    effects: [
      {
        trigger: 'activate',
        ops: [{ op: 'specialSummon', from: 'hand', filter: { kind: 'monster', type: 'Machine', maxAtk: 1600 }, count: 2, position: 'atk' }],
      },
    ],
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
          /* 'summoned', not 'strongest' — the 300 belongs to what the machine
             just brought back, the same Call of the Haunted-class mistake as
             "it gains 400 ATK" once buffing whatever was already biggest. */
          { op: 'gainAtk', amount: 300, target: sel('own', 'summoned'), duration: 'permanent' },
        ],
      },
    ],
  },
  /* ---------------------------------------------------------------- */
  /* Yami Marik                                                        */
  /* ---------------------------------------------------------------- */

  'left-arm-offering': {
    /* Give up everything you are holding to reach the one card you want.
       It is the deck's tutor for Ra, and the cost is real — but this deck
       cares less about a full hand than any other in the game, because Ra
       is priced by the board rather than the hand. Slifer's opposite,
       again. */
    text: 'Discard your entire hand, then add 1 card from your Deck to your hand.',
    cry: 'An arm for a wish.',
    effects: [
      {
        trigger: 'activate',
        ops: [
          { op: 'discard', count: 99, who: 'own' },
          { op: 'search', filter: {} },
        ],
      },
    ],
  },

  'nightmare-s-steelcage': {
    /* The card that makes the theme work, and the reason it was missing is
       written down in CLAUDE.md now: instrumenting real duels showed Marik
       dead by turn ten having never once reached Ra. A burn deck does not
       need more burn, it needs *turns* — and a cage that stops the Battle
       Phase dead is two full turns of Bowganian ticking while nothing can be
       done about it.

       Both players, exactly as printed. It costs Marik nothing because his
       plan was never to attack, which is the whole joke of the card, and it
       leaves the opponent a real answer: outlast it, or break the board he
       builds behind it. */
    text: 'Neither player can attack for 2 turns.',
    cry: 'Welcome to the cage.',
    effects: [
      {
        trigger: 'activate',
        ops: [{ op: 'freezeMonsters', who: 'both', turns: 2 }],
      },
    ],
  },

  'nightmare-wheel': {
    /* Genuinely Continuous, unlike Spellbinding Circle — which was made a
       one-shot precisely because parking in the only Spell/Trap Zone was too
       high a price for Yugi. Marik pays it deliberately: the wheel attaches
       to the monster it binds, so it holds for exactly as long as the card
       does and any backrow removal frees the prisoner. That is the
       counterplay, and it is one the whole roster can reach.

       Written as an equip on purpose. A one-shot trap leaves the field, and
       an equip grant is read live — so the bind would have lapsed the instant
       the card hit the Graveyard, leaving a card whose whole sentence did
       nothing. `npm run text` cannot see that and the audit cannot either;
       only driving the attack and reading the flag afterwards can. */
    text: 'Stays face-up. When your opponent declares an attack: negate the attack, and that monster cannot attack while this card remains face-up. Inflict 500 damage to your opponent.',
    cry: 'Turn, and keep turning.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Nightmare Wheel — bind the attacker',
        ops: [
          { op: 'negateAttack' },
          { op: 'equipTo', atk: 0, def: 0, grants: ['cannotAttack'], target: sel('opp', 'attacker') },
          { op: 'damage', amount: 500, to: 'opp' },
        ],
      },
    ],
  },

  'coffin-seller': {
    /* Marik profits from his own dead, and this is the card that turns a
       losing board into a clock: it stays face-up and bills them *every*
       time something of his is broken, which is the deck's whole plan — his
       monsters are small, they die, and dying is the point.

       Continuous and `reusable`, which is the pair that makes a standing
       threat: the `monsterDestroyed` window belongs to the player whose
       monster died, so it is always his own. The price is the single
       Spell/Trap Zone it sits in for the rest of the duel, and any backrow
       removal in the game answers it. */
    text: 'Stays face-up. Each time a monster you control is destroyed: inflict 1500 damage to your opponent.',
    cry: 'Someone always pays for the burial.',
    effects: [
      {
        trigger: 'trap',
        window: 'monsterDestroyed',
        label: 'Coffin Seller — 1500 damage',
        reusable: true,
        ops: [{ op: 'damage', amount: 1500, to: 'opp' }],
      },
    ],
  },

  'metal-reflect-slime': {
    /* A wall that is also a body, and the answer to the thing that kept Ra
       off the board entirely: instrumented duels had Ra in hand and three
       monsters standing *at the same time* in 3 games out of 24. Yami reaches
       Slifer because Multiply makes three bodies out of one card; Marik had
       nothing that did that. The slime spends itself into a 3000 DEF token —
       a wall this turn, a Tribute for the God later.

       One-shot, so the zone is free again immediately: this is the deck's
       Spell/Trap Zone and Coffin Seller wants to live in it. */
    subKindOverride: 'Normal',
    text: "During your opponent's turn: Special Summon 2 Reflect Slime Tokens (1000/3000) in Defence Position.",
    cry: 'It takes the shape of your fear.',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Metal Reflect Slime — two walls of 3000',
        ops: [{ op: 'summonToken', name: 'Reflect Slime Token', atk: 1000, def: 3000, count: 2, artSlug: 'metal-reflect-slime' }],
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
  '7-completed',
  'metalmorph',
]);

export { OWN_PICK };
