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
    /* One-sided again, by the owner's call. The symmetric version was the
       printed card and the aired one — Kaiba straps the ring on knowing the
       blast reaches him too — but paying half a duel's Life Points to answer a
       monster made it a card you held rather than played. The recoil is gone;
       the removal and the burn stay. */
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
    /* One-sided, by the owner's call: swapping both boards handed the trick
       back as often as it won anything, since Joey's own bodies are the ones
       with ATK worth keeping. Turning only their monsters inside out is the
       play the card is picked up for. */
    text: "Swap the ATK and DEF of every monster your opponent controls until the end of the turn.",
    effects: [{ trigger: 'activate', ops: [{ op: 'swapAtkDef', target: OPP_ALL }] }],
  },

  'giant-trunade': {
    text: 'Return every Spell and Trap on the field to their owners\' hands, then your opponent discards 1 card.',
    effects: [
      {
        trigger: 'activate',
        ops: [
          { op: 'bounce', target: sel('both', 'all', { zone: 'backrow' }) },
          { op: 'discard', count: 1, who: 'opp' },
        ],
      },
    ],
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
    /* You pick the card now, the way Monster Reborn picks its monster.
       `stealFromGrave` already honours an explicit choice — it only falls back
       to "take the strongest" for the effects that fire mid-resolution with
       nobody to ask. This one is activated by a player who is right there, so
       `targets: 1` puts the pile in front of them. */
    text: "Add 1 card from your opponent's Graveyard to your hand.",
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Graverobber',
        targets: 1,
        // Theirs, and only theirs — the card is named for it.
        ops: [{ op: 'stealFromGrave', from: 'opp' }],
      },
    ],
  },

  /* Both dice used to apply their swing once per pip, and `gainAtk` writes a
     log line every time it moves a number — so a roll of 6 was six banners
     reading "loses 200 ATK" instead of one reading the total. Reported by the
     owner. The roll is read back afterwards through `scale: 'dicePips'`, which
     lands the whole amount in a single beat; `perPip` is left empty because the
     die itself already announces what it rolled. */
  'skull-dice': {
    text: "Roll a die: every monster your opponent controls loses 200 ATK for each pip until the end of the turn.",
    cry: 'Roll them bones!',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Skull Dice',
        ops: [
          { op: 'diceRoll', perPip: [] },
          { op: 'gainAtk', amount: -200, scale: 'dicePips', target: OPP_ALL, duration: 'turn' },
        ],
      },
    ],
  },

  'graceful-dice': {
    text: 'Roll a die: every monster you control gains 200 ATK for each pip until the end of the turn.',
    effects: [
      {
        trigger: 'activate',
        ops: [
          { op: 'diceRoll', perPip: [] },
          { op: 'gainAtk', amount: 200, scale: 'dicePips', target: sel('own', 'all'), duration: 'turn' },
        ],
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
    text: 'Field Spell: all monsters you control gain 300 ATK and 300 DEF. When activated: destroy 1 Spell or Trap your opponent controls.',
    effects: [
      { trigger: 'activate', targets: 1, ops: [{ op: 'destroy', target: OPP_ONE_BACKROW }] },
      {
        trigger: 'continuous',
        ops: [],
        /* Hers alone, by the owner's call. It read "all monsters" on both sides
           of the field — the weather, which is what a Field Spell usually is —
           and once the Winged Beast clause came off, that generosity stopped
           being a flavour note and started handing the opponent's whole board
           the same 300. `own` is the controller of the Field Spell, so the
           ground only ever favours the duelist who laid it. */
        aura: { target: sel('own', 'all'), atk: 300, def: 300 },
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
    /* It is a formation, so it needs somebody flying it — but by the owner's
       rule for Mai's cards that is any monster she controls, not only a Winged
       Beast. Condition-free it was generic removal that won duels the flock
       never appeared in, so the gate stays; only the type goes.

       "500 for each" is priced per kill rather than a flat 500: one monster
       destroyed bills 500, two bills 1000, and a target that survived — a God,
       or anything standing beyond reach — is not charged for at all. */
    text: 'If you control a monster: destroy up to 2 monsters your opponent controls, then inflict 500 damage to them for each monster destroyed this way.',
    cry: 'Phoenix Formation!',
    effects: [
      {
        trigger: 'activate',
        targets: 2,
        condition: { controlsMonster: true },
        ops: [
          { op: 'destroy', target: sel('opp', 'chosen', { count: 2 }) },
          { op: 'damage', amount: 500, scale: 'perDestroyed', to: 'opp' },
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
    text:
      'Field Spell: add 1 Toon monster from your Deck to your hand. While this card is face-up, your Toon monsters need no Tribute to Summon, ' +
      'inflict piercing battle damage, cannot be destroyed by battle or by card effects, and can attack your opponent directly. ' +
      'When this card is destroyed: your monsters lose 1000 ATK, and any left with 0 ATK are destroyed.',
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
        /* Free to open, by the owner's ruling. The 1000 was the printed cost and
           it was charged twice over: Pegasus pays for this card again every time
           it is answered, because the whole deck stops until another copy shows
           up. A toll on the one card that has to land is a toll on being allowed
           to play at all. */
        ops: [{ op: 'search', filter: { kind: 'monster', toon: true } }],
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
          /* `sel('own', …)` and not `both`: the book is Pegasus's, and a mirror
             where the other seat's Toons drank from it too was never the deal.
             Deliberately unsaid on the card — "your Toon monsters" already says
             whose, and a clause explaining that the opponent's are not yours
             would be explaining the word "your". */
          target: sel('own', 'all', { filter: { toon: true, kind: 'monster' } }),
          /* Effect-indestructible, NOT untargetable, since the 8000 pool:
             this engine's `untargetable` skips every opposing effect, so
             Mirror Wall could not halve a Toon and Skull Dice could not
             shrink one, and at 8000 Life Points an attacker no card may
             even touch simply grinds the duel out (pegasus benched 74).
             Nothing can DESTROY a Toon while the book is open — that is
             the cartoon promise — but binds, debuffs and borrowings land,
             and half the roster carries one.

             Battle now too, by the owner's ruling. A cartoon does not lose a
             fight — it gets flattened and walks off the next panel — and with
             the +600 gone the Toons are small bodies, so surviving the swing
             is what they have instead of winning it. The answer is no longer
             a bigger monster, it is the book.

             Three prices have come off this card, all reported. The 500-a-swing
             toll and the clause that killed the Toons the moment the book shut
             went first; the +600 ATK and the 1000 Life Points to open it went
             now. What is left is a card that costs nothing and does everything
             — which is the point, because answering it answers the whole deck,
             and the cascade below is what that answer is worth. */
          grants: ['directAttack', 'indestructibleByEffect', 'indestructibleByBattle', 'pierce'],
        },
      },
      /* Closing the book.
         The Toons do not die with it — that clause came off earlier and stays
         off — but the drawings stop being drawings: the aura vanishes with the
         card, so protection, piercing and the direct attack all go at once, and
         the four that are only Toons while it is open go back to being ordinary
         monsters. This is the part that hurts: every monster the controller has
         is flattened by 1000, and the ones that had nothing left to give are
         destroyed.
         Deliberately all their monsters, not just the Toons. The book is what
         holds Pegasus's whole board up, and answering it is meant to be worth
         the card it cost — the whole roster carries something that says
         "destroy 1 Spell or Trap", and this is what they get for it. */
      {
        trigger: 'onDestroyed',
        ops: [
          { op: 'gainAtk', amount: -1000, target: sel('own', 'all'), duration: 'permanent' },
          /* Reads live ATK, not printed — see `passesLiveAtk`. A 1000 ATK body
             is at 0 by the line above and is exactly what this is for. */
          { op: 'destroy', target: sel('own', 'all', { filter: { maxAtk: 0 } }) },
        ],
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
    text:
      'Stays face-up. When your opponent declares an attack: negate the attack, and that monster cannot attack ' +
      'while this card remains face-up. Inflict 500 damage to your opponent. ' +
      'At the start of each of your turns, inflict a further 800 damage to your opponent.',
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
      {
        /* The wheel turns. Reported as "too weak for a continuous trap card",
           and that was the right complaint about the wrong axis: binding one
           monster is a fine effect for a card that leaves, and a poor one for
           a card that parks in Marik's only Spell/Trap Zone forever. So it
           tortures, which is the register of the whole deck — Bowganian
           bleeds them on a timer, Granadora bleeds them and heals him, and
           now the wheel bleeds them for as long as it holds someone.

           It needs no condition. An equip follows its host down (`toGrave`
           sends a Spell equipped to a monster to the Graveyard with it), so a
           face-up Nightmare Wheel is by construction a wheel with a prisoner
           on it — and the turn the prisoner leaves, the wheel stops. */
        trigger: 'onOwnTurnStart',
        ops: [{ op: 'damage', amount: 800, to: 'opp' }],
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

  /* ---------------------------------------------------------------- */
  /* Priest Seto                                                       */
  /* ---------------------------------------------------------------- */

  'mound-of-the-bound-creator': {
    /* The place the God sleeps. A Field Spell, so it never touches the single
       Spell/Trap Zone — the same reasoning that put Toon World in the Field
       Zone, and the reason a deck can hinge on a card at all here.

       The aura deliberately excludes Divine-Beasts: a God buffed by its own
       shrine stands at 4500, untargetable, wiping the board every turn, and
       there is no honest answer to that. The mound feeds the *servants* who
       will be spent for the God, which is the right way round for this deck. */
    subKindOverride: 'Field',
    text:
      'Field Spell: your monsters other than Divine-Beast monsters gain 300 ATK. ' +
      'At the start of your turn: Special Summon 1 "Ka Token" (Fiend/DARK/Level 1/ATK 800/DEF 800).',
    cry: 'The mound remembers every soul it swallowed.',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { kind: 'monster', excludeType: 'Divine-Beast' } }), atk: 300 },
      },
      {
        /* The body engine, and the one income source that is not a card out of
           hand: three Tributes are only payable if the board refills itself. */
        trigger: 'onOwnTurnStart',
        ops: [{ op: 'summonToken', name: 'Ka Token', atk: 800, def: 800, count: 1, artSlug: 'aswan-apparition' }],
      },
    ],
  },

  'millennium-ankh': {
    /* What makes the Fist repeatable: the two bodies it ate last turn are
       exactly the two this brings back. Conditioned on a Graveyard that can
       actually pay, because `specialSummon` is neither a targeting op nor a
       rider, so `activationIsDead` would never refuse it and the card would
       cheerfully cost 1000 Life Points for nothing. */
    text: 'Pay 1000 Life Points: Special Summon 2 monsters from your Graveyard, except Divine-Beast monsters.',
    cry: 'Rise. You are not finished serving me.',
    effects: [
      {
        trigger: 'activate',
        condition: { graveAtLeast: 2 },
        cost: { lp: 1000 },
        ops: [{ op: 'specialSummon', from: 'grave', side: 'own', filter: { kind: 'monster', excludeType: 'Divine-Beast' }, count: 2, position: 'atk' }],
      },
    ],
  },

  'soul-exchange': {
    /* Borrow one of theirs to pay for the God. Conditioned on them actually
       having a monster: conditions on an `activate` effect ARE enforced, and
       without it the card is playable into an empty board for nothing. */
    text: 'Select 1 monster your opponent controls. Take control of it until the End Phase; it may be Tributed this turn.',
    cry: 'Your soul will pay for this.',
    effects: [
      {
        trigger: 'activate',
        condition: { opponentHasMonster: true },
        ops: [{ op: 'takeControl', target: OPP_PICK, duration: 'turn' }],
      },
    ],
  },

  'snatch-steal': {
    /* The same theft, kept. The signature line of the deck, and the reason
       "yours were never yours" is on the card back. */
    text: 'Take control of 1 monster your opponent controls. At the start of each of your turns, your opponent gains 1000 Life Points.',
    cry: 'Mine now.',
    effects: [
      {
        trigger: 'activate',
        condition: { opponentHasMonster: true },
        ops: [{ op: 'takeControl', target: OPP_PICK, duration: 'permanent' }],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Ishizu                                                            */
  /* ---------------------------------------------------------------- */

  'necrovalley': {
    /* The hinge, and a Field Spell so the whole roster's backrow removal can
       still reach it — the counterplay rule, satisfied by the zone rather than
       by an exception.

       The aura is written for every monster she controls rather than for
       Fairies, because her ace is a Beast-Warrior: a Fairy-typed aura would
       have skipped the one card the deck exists to land.

       Flat, and that is the whole balance of this deck. The valley used to pay
       *per monster in the Graveyard* — and so does Mudora, onto the same
       cards, which is the Gazelle-and-Berfomet double-dip written down in
       CLAUDE.md, one theme over: two auras counting the same quantity, where
       the second one's only real function is doubling the first. Ishizu's mill
       fills the tomb by design, so the two of them together were compounding
       against a number the deck itself was racing upward: 3490 board ATK by
       turn 4 against Yami's 2269, and 87% on the bench. Cutting the
       coefficients moved nothing (83 → 87, inside the interval) because the
       shape was wrong, not the number.
       So the valley guards and Mudora counts. One card counting the dead is a
       theme with an answer — destroy her, or destroy the valley — and it is
       still read live, which is what keeps the tomb visible to an AI that
       scores stats and is blind to Graveyards. */
    text: 'Field Spell: monsters you control gain 300 ATK.',
    cry: 'The valley has been waiting for you.',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { kind: 'monster' } }), atk: 300 },
      },
    ],
  },

  'royal-tribute': {
    /* The offering, and the deck's engine in one card: what she buries is what
       her guardians are paid for. Conditioned so it is never a blank — a mill
       into an empty board is the state the design is built for, but paying a
       card for nothing is not. */
    text: 'Send the top 3 cards of your Deck to the Graveyard, then draw 1 card.',
    cry: 'The tomb takes its due.',
    effects: [{ trigger: 'activate', ops: [{ op: 'mill', count: 3, who: 'own' }, { op: 'draw', count: 1, who: 'own' }] }],
  },

  'exchange-of-the-spirit': {
    /* Her signature, and the one card that says "I have already seen this".
       A one-shot rather than the printed Graveyard swap, which this engine has
       no way to express and which would be a deck-out win condition the AI
       cannot see coming. */
    subKindOverride: 'Normal',
    text: 'Trap: when your opponent declares an attack — negate the attack, send the top 3 cards of your Deck to the Graveyard, and each guardian you control gains 600 ATK until the end of the turn.',
    cry: 'I saw this before you drew it.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Exchange of the Spirit',
        ops: [
          { op: 'negateAttack' },
          /* The mill is the buff here: every card it buries is another 300 on
             every guardian through Necrovalley, so the negate and the pump are
             the same sentence read twice. */
          { op: 'mill', count: 3, who: 'own' },
          { op: 'gainAtk', amount: 600, target: sel('own', 'all', { filter: { kind: 'monster' } }), duration: 'turn' },
        ],
      },
    ],
  },

  'blast-held-by-a-tribute': {
    /* Pre-emption that lands as removal AND damage, so the AI can see it. */
    text: 'Trap: when your opponent declares an attack — destroy the attacking monster and inflict 800 damage to your opponent.',
    cry: 'The blast was set long before you came.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Blast Held by a Tribute',
        ops: [
          { op: 'destroy', target: sel('opp', 'attacker') },
          { op: 'damage', amount: 800, to: 'opp' },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Odion                                                             */
  /* ---------------------------------------------------------------- */

  'temple-of-the-kings': {
    /* Odion's engine, moved to the Field Zone for the same reason Toon World
       was: his deck is the one deck in the game that genuinely wants its
       single Spell/Trap Zone free, because his traps are his monsters. A
       Continuous Spell here would have been the deck strangling itself. */
    subKindOverride: 'Field',
    text: 'Field Spell: monsters you control gain 300 ATK, a further 100 ATK for each monster you control, and inflict piercing battle damage. Required to Summon "Mystical Beast of Serket".',
    cry: 'The temple opens for its keeper.',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { kind: 'monster' } }), atk: 300, grants: ['pierce'] },
      },
      {
        /* The shrine pays the assembled guard. Odion's whole engine makes
           bodies three at a time, so a bonus that counts them is the payoff
           the deck was missing: a full board is +400 +900 on every one of
           them, which is what "when three stand, they are terrible" should
           feel like. Read live through `per`, so breaking the board takes the
           bonus with it — that is the counterplay. */
        trigger: 'continuous',
        ops: [],
        aura: {
          target: sel('own', 'all', { filter: { kind: 'monster' } }),
          per: { zone: 'ownField', filter: { kind: 'monster' }, atk: 100 },
        },
      },
    ],
  },

  'embodiment-of-apophis': {
    /* The thesis of the whole deck in one card: a trap that answers the attack
       and then STAYS, as a body. It leaves the Spell/Trap Zone the moment it
       resolves, which is what stops a trap deck strangling itself on a single
       zone — the backrow becomes the board. */
    subKindOverride: 'Normal',
    text: 'Trap: when your opponent declares an attack — negate the attack and Special Summon 3 "Apophis Serpent" Tokens (1300/1500) in Attack Position.',
    cry: 'The serpent was always coiled here.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Embodiment of Apophis',
        ops: [
          { op: 'negateAttack' },
          /* Three, not one. A trap that spends the single Spell/Trap Zone and
             leaves one body behind is a bad rate in a game whose register is
             above anime OP; a trap that answers the attack and fills the board
             is the card the deck is named for. It also turns the Temple on:
             the shrine pays per monster standing, so the swarm buffs itself. */
          { op: 'summonToken', name: 'Apophis Serpent', atk: 1300, def: 1500, count: 3, artSlug: 'embodiment-of-apophis', position: 'atk' },
        ],
      },
    ],
  },

  'apophis-the-swamp-deity': {
    /* The width version of the same idea: two bodies instead of one, and no
       attack needed to trigger it. */
    subKindOverride: 'Normal',
    text: 'Trap: when your opponent Summons a monster — Special Summon 3 "Swamp Serpent" Tokens (1400/1400).',
    cry: 'The swamp rises to meet you.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentSummon',
        label: 'Apophis the Swamp Deity',
        ops: [{ op: 'summonToken', name: 'Swamp Serpent', atk: 1400, def: 1400, count: 3, artSlug: 'apophis-the-swamp-deity' }],
      },
    ],
  },

  'statue-of-the-wicked': {
    /* Removal becomes income: killing one of his leaves two behind. */
    text: 'Trap: when a monster you control is destroyed — Special Summon 3 "Wicked Tokens" (1200/1200).',
    cry: 'Break one, and two stand up.',
    effects: [
      {
        trigger: 'trap',
        window: 'monsterDestroyed',
        label: 'Statue of the Wicked',
        ops: [{ op: 'summonToken', name: 'Wicked Token', atk: 1200, def: 1200, count: 3, artSlug: 'statue-of-the-wicked', position: 'atk' }],
      },
    ],
  },

  'judgment-of-anubis': {
    /* The single clean answer: the attack is refused and the attacker is
       destroyed. One copy, because a deck this wide does not also need to be
       this safe. */
    text: 'Trap: when your opponent declares an attack — negate the attack, destroy the attacking monster and gain 1000 Life Points.',
    cry: 'Anubis judges you unworthy.',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        label: 'Judgment of Anubis',
        ops: [
          { op: 'negateAttack' },
          { op: 'destroy', target: sel('opp', 'attacker') },
          { op: 'heal', amount: 1000, to: 'own' },
        ],
      },
    ],
  },

  'fake-trap': {
    /* The forgery. Odion plays a Ra that is not Ra, and the counterfeit is
       worth exactly as much as the faith people put in it: a 4000/4000 body
       that costs 1000 Life Points and is, in the end, only a token. It is not
       a Divine-Beast, it is not untargetable, and nothing about it is above
       anything — which is the whole point of a forgery, and why it may wear
       the real God's numbers without being the real God. */
    text: 'Trap: pay 1000 Life Points; Special Summon 1 "Forged God Token" (Winged Beast/DIVINE/ATK 4000/DEF 4000). It is not a Divine-Beast.',
    cry: 'They will believe it is a god. That is enough.',
    effects: [
      {
        trigger: 'trap',
        window: 'anyOpponentTurn',
        label: 'Fake Trap — reveal the forgery',
        cost: { lp: 1000 },
        ops: [{ op: 'summonToken', name: 'Forged God Token', atk: 4000, def: 4000, count: 1, artSlug: 'fake-trap', position: 'atk' }],
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
