/**
 * Custom, anime-inspired effects for every monster in the game.
 *
 * These are deliberately more powerful than the printed cards — the goal is the
 * feel of the season 1 anime, where every monster did something spectacular.
 */
import type { CardEffect, Pick, Selector, Side } from '../types';

export interface EffectDef {
  text: string;
  cry?: string;
  effects: CardEffect[];
  fusionMaterials?: string[];
  /** Assembles with no Polymerization — see `CardDef.fusionFree`. */
  fusionFree?: boolean;
  atkOverride?: number;
  defOverride?: number;
  /** Must be face-up on your side before this monster can be Summoned. */
  summonRequires?: string;
  /** Our version of the card sits in a different zone than the printed one. */
  subKindOverride?: string;
  /**
   * ATK and DEF become the combined ATK and DEF of the monsters Tributed to
   * Summon this card — the Winged Dragon of Ra, and the reason the deck that
   * carries it wants a wide board rather than a full hand.
   *
   * A snapshot, deliberately: the monsters are in the Graveyard by the time
   * anybody reads the number, so there is nothing live left to track. The
   * sentence has a "to Summon it" clause for exactly that reason, which is
   * what `npm run text` looks for before it allows a one-shot.
   */
  statsFromTributes?: boolean;
}

const sel = (side: Side, pick: Pick, extra: Partial<Selector> = {}): Selector => ({ side, pick, ...extra });
const SELF = sel('own', 'self');
const OPP_PICK = sel('opp', 'chosen');
const OPP_ALL = sel('opp', 'all');
const OWN_ALL = sel('own', 'all');

export const MONSTER_EFFECTS: Record<string, EffectDef> = {
  /* ================================================================ */
  /* Extra Deck / Fusion bosses                                        */
  /* ================================================================ */

  'blue-eyes-ultimate-dragon': {
    text: 'Fusion: 3 × Blue-Eyes White Dragon. When Fusion Summoned: destroy every Spell, Trap and Field card your opponent controls. This card attacks every monster your opponent controls once each and inflicts piercing battle damage. Once per turn: shuffle 1 "Blue-Eyes White Dragon" from your Graveyard into your Deck, then destroy 1 Spell or Trap your opponent controls.',
    cry: 'Neutron Blast!',
    fusionMaterials: ['blue-eyes-white-dragon', 'blue-eyes-white-dragon', 'blue-eyes-white-dragon'],
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'destroy', target: sel('opp', 'all', { zone: 'backrow' }) },
          { op: 'destroy', target: sel('opp', 'all', { zone: 'field' }) },
          { op: 'attackAllMonsters' },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
      /* The three dragons it was built from are its ammunition: feed one back
         into the Deck and it shatters a card across the table. Modelled on
         Dark Paladin's ignition, with the Graveyard cost in front of the
         payoff.

         `condition.graveHasSlug` gates it, so the button is only offered while
         there is actually a dragon down there to spend — an ignition that
         resolves into nothing is the "card looks inert" trap this file keeps
         relearning. The cost is written first and targets the Graveyard
         directly; `shuffleIntoDeck` sends a card to its owner's Deck from
         wherever it is. */
      {
        trigger: 'ignition',
        label: 'Return a Blue-Eyes, shatter a Spell/Trap',
        oncePerTurn: true,
        condition: { graveHasSlug: 'blue-eyes-white-dragon' },
        targets: 1,
        ops: [
          {
            op: 'shuffleIntoDeck',
            /* `strongest` rather than a player choice: every Blue-Eyes in the
               pile is the same 3000-ATK card, so there is nothing to choose
               between them and nobody should be asked. */
            target: sel('own', 'strongest', { zone: 'grave', filter: { slugs: ['blue-eyes-white-dragon'] }, count: 1 }),
          },
          { op: 'destroy', target: sel('opp', 'chosen', { zone: 'backrow', count: 1 }) },
        ],
      },
    ],
  },

  'dark-paladin': {
    text: 'Fusion: Dark Magician + Dark Magician Girl. When Fusion Summoned: negate the effects of every monster your opponent controls. Gains 200 ATK for each card in your Graveyard. When this card declares an attack: draw 1 card. Once per turn: destroy 1 Spell or Trap your opponent controls.',
    cry: 'Knight of Dark Magic!',
    fusionMaterials: ['dark-magician', 'dark-magician-girl'],
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'negateEffects', target: OPP_ALL },
        ],
      },
      // "Gains 200 ATK for each card in your Graveyard" is ongoing, not a
      // snapshot taken the moment he arrived.
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: { side: 'own', pick: 'self' }, per: { zone: 'ownGrave', atk: 200 } },
      },
      // Every swing refills the hand that fused him.
      { trigger: 'onDeclareAttack', ops: [{ op: 'draw', count: 1, who: 'own' }] },
      {
        trigger: 'ignition',
        label: 'Shatter a Spell/Trap',
        oncePerTurn: true,
        targets: 1,
        ops: [{ op: 'destroy', target: sel('opp', 'chosen', { zone: 'backrow', count: 1 }) }],
      },
    ],
  },

  'gaia-the-dragon-champion': {
    /* The rider can now go *around* the board as well as through it, and the
       choice is the card: both of its swings pick freely between a monster for
       full damage and the player for half. `directAttack` leaves every monster
       on the menu (see `legalAttackTargets`), so the pair of attacks is intact
       either way — and the halving is `halvedDirectDamage`, which is charged on
       the direct path alone. `halvedBattleDamage` is Sky Scout's whole-sentence
       version and would quietly halve the Champion's charges into monsters too,
       which is the opposite of the bargain.

       The half is the toll for *flying over a guard*, so it is charged only
       while the opponent actually controls one. Against an empty board he is an
       ordinary attacker hitting for everything — anything else would have made
       the Champion worse than a vanilla body precisely when there is no defence
       left, which is not what "can attack directly" is for. */
    text: 'Fusion: Gaia The Fierce Knight + Curse of Dragon. When Fusion Summoned: draw 1 card. This card can attack twice each Battle Phase, inflicts piercing battle damage, and can attack directly. While your opponent controls a monster, its battle damage from a direct attack is halved.',
    cry: 'Charge, my champion!',
    fusionMaterials: ['gaia-the-fierce-knight', 'curse-of-dragon'],
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'extraAttacks', count: 1 },
          { op: 'pierce', duration: 'permanent' },
          { op: 'directAttack', duration: 'permanent' },
          { op: 'halvedDirectDamage', duration: 'permanent' },
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  'alligator-s-sword-dragon': {
    /* The underdog's fusion earns its two cards now: it arrives clearing a
       path, pumped, and goes straight for the face the turn it lands — the
       anime play, where the dragon leaps OVER the blockers. The rider stays
       a rider; the arrival is the payoff. */
    text: "Fusion: Alligator's Sword + Baby Dragon. When Fusion Summoned: destroy 1 monster your opponent controls, gain 700 Life Points, and this card gains 700 ATK and can attack directly this turn.",
    cry: 'Over their heads!',
    fusionMaterials: ["alligator-s-sword", 'baby-dragon'],
    effects: [
      {
        trigger: 'onSummon',
        targets: 1,
        ops: [
          { op: 'heal', amount: 700, to: 'own' },
          { op: 'destroy', target: OPP_PICK },
          { op: 'gainAtk', amount: 700, target: SELF, duration: 'turn' },
          { op: 'directAttack', duration: 'turn' },
        ],
      },
    ],
  },

  'thousand-dragon': {
    /* Deliberately vanilla — the owner asked for a plain body, and without an
       entry here `fallbackEffect` would have handed a 2400 ATK monster the
       stock "500 damage and piercing" package. A 2400 beater arriving free off
       a coin flip is the whole reward; it does not need a rider.

       No `fusionMaterials`, so it is never offered to Polymerization. Time
       Wizard's heads is the only way it reaches the field, which is what makes
       the gamble worth taking. */
    text: 'A dragon aged a thousand years by the magic of Time Wizard. Its roar is the sound of centuries.',
    effects: [],
  },

  'thousand-eyes-restrict': {
    /* The lock was a 99-turn ongoing effect, which outlived the card that cast
       it — destroying Thousand-Eyes Restrict left the opponent frozen anyway.
       Its own text says "while this card is face-up", and now that is what it
       does: an aura, read live, gone the moment the card is. */
    text: 'Fusion: Relinquished + Illusionist Faceless Mage. When Fusion Summoned: absorb 1 monster your opponent controls and gain its ATK and DEF. While this card is face-up, your opponent\'s monsters cannot attack.',
    cry: 'A thousand eyes are watching you.',
    fusionMaterials: ['relinquished', 'illusionist-faceless-mage'],
    effects: [
      {
        trigger: 'onSummon',
        targets: 1,
        ops: [{ op: 'absorb', target: OPP_PICK }],
      },
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, grants: ['cannotAttack'] } },
    ],
  },

  /* ================================================================ */
  /* Yugi                                                              */
  /* ================================================================ */

  'dark-magician': {
    /* The full wipe fires once, on arrival — the anime beat is Dark Magic
       Attack blasting the backrow the moment he appears. As a free ignition it
       repeated every turn forever, and in a one-Spell/Trap-Zone format that
       meant the opponent could never keep a Set card or a Field Spell again:
       whole archetypes (Toon World, Mirror Wall, Tornado Wall) stopped
       existing the moment he resolved, in both decks that run him. The
       ignition keeps him the best backrow answer in the game — one chosen
       card, every turn — but the opponent gets to rebuild, and timing his
       summon becomes the skill. */
    text: 'The ultimate wizard in terms of attack and defense. When Summoned: it gains 200 ATK for each card in your Graveyard, and destroys every Spell, Trap and Field card your opponent controls. While you control "Dark Magician Girl", this card cannot be targeted by your opponent\'s effects. Once per turn: destroy 1 Spell or Trap your opponent controls.',
    cry: 'Dark Magic Attack!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'gainAtk', scale: 'perCardInGrave', target: SELF, duration: 'permanent' },
          { op: 'destroy', target: sel('opp', 'all', { zone: 'backrow' }) },
          { op: 'destroy', target: sel('opp', 'all', { zone: 'field' }) },
        ],
      },
      {
        /* The pair protect each other — the reciprocal of her aura. Master
           and apprentice standing together is the formation the deck plays
           for, and it holds exactly while both do. */
        trigger: 'continuous',
        condition: { requiresOnField: 'dark-magician-girl' },
        ops: [],
        aura: { target: SELF, grants: ['untargetable'] },
      },
      {
        trigger: 'ignition',
        label: 'Dark Magic Attack',
        oncePerTurn: true,
        targets: 1,
        ops: [{ op: 'destroy', target: sel('opp', 'chosen', { zone: 'backrow', count: 1 }) }],
      },
    ],
  },

  'dark-magician-girl': {
    text: 'Gains 400 ATK for each "Dark Magician" in either Graveyard. While you control "Dark Magician", this card gains 600 ATK and cannot be targeted by your opponent\'s effects. When this card destroys a monster in battle: draw 1 card.',
    cry: 'Never underestimate an apprentice!',
    effects: [
      /* "for each Dark Magician in either Graveyard" — a number that keeps
         moving, and the whole point of her: she grows as Dark Magicians fall.
         Granted once on summon she gained nothing at all, because at that
         moment none had died yet. The old scale also counted every card in her
         own Graveyard at 200, which is neither the pool nor the figure. */
      {
        trigger: 'continuous',
        ops: [],
        aura: {
          target: { side: 'own', pick: 'self' },
          per: { zone: 'eitherGrave', filter: { slugs: ['dark-magician'] }, atk: 400 },
        },
      },
      /* Her master standing beside her — which is also literally the Dark
         Paladin material board — used to be worth nothing until he DIED.
         Now the pair together is the formation the deck is trying to reach,
         rewarded before the fusion as well as after it. */
      {
        trigger: 'continuous',
        condition: { requiresOnField: 'dark-magician' },
        ops: [],
        aura: { target: { side: 'own', pick: 'self' }, atk: 800, grants: ['untargetable'] },
      },
      { trigger: 'onBattleDestroy', ops: [{ op: 'draw', count: 1, who: 'own' }] },
    ],
  },

  'summoned-skull': {
    text: 'When this card is summoned: inflict 600 damage to your opponent. This card inflicts piercing battle damage.',
    cry: 'Lightning Strike!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'damage', amount: 600, to: 'opp' },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'gaia-the-fierce-knight': {
    /* Said "attack twice this turn" while the engine had always granted it
       permanently — the words were wrong long before the grant became an aura;
       the trigger's mere existence was what satisfied the text check. Worded
       like its siblings now, matching what it has always actually done.

       The knight now fetches his own dragon and the card that marries them.
       Two searches rather than one: a `search` op adds a single card, and the
       slug list inside one is a *preference order* — "Poly or Curse of Dragon",
       whichever it found first — which is not what "add both" means. One op per
       card is the only way to take both, and each is a no-op when its card is
       elsewhere, so a Curse of Dragon already in hand costs nothing. */
    text: 'This card can attack twice each Battle Phase and inflicts piercing battle damage. When this card is summoned: draw 1 card, then add "Polymerization" and "Curse of Dragon" from your Deck to your hand.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'extraAttacks', count: 1 },
          { op: 'pierce', duration: 'permanent' },
          { op: 'draw', count: 1, who: 'own' },
          { op: 'search', filter: { slugs: ['polymerization'] } },
          { op: 'search', filter: { slugs: ['curse-of-dragon'] } },
        ],
      },
    ],
  },

  'curse-of-dragon': {
    text: 'When this card is summoned: destroy 1 Spell or Trap your opponent controls, then draw 1 card. This card inflicts piercing battle damage.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'destroy', target: sel('opp', 'chosen', { zone: 'backrow', count: 1 }) },
          { op: 'draw', count: 1, who: 'own' },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'celtic-guardian': {
    /* "With a monster whose ATK is 1900 or more" is a threshold the engine
       cannot express, so what it actually did was make a 1400 body immune to
       every battle forever — the Sword Arm of Dragon hole again. Elusive rather
       than invincible now, which is the same idea and is true. */
    text: 'This card cannot be targeted by your opponent\'s card effects, and inflicts piercing battle damage.',
    cry: 'Too slow!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'untargetable', duration: 'permanent' },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'beaver-warrior': {
    /* Was a flat, permanent +500 handed out on summon — it kept the bonus with a
       full board and kept it outside the Battle Phase. A live aura is read every
       time the stat is asked for, so it lapses the moment a comrade arrives. */
    text: 'Gains 500 ATK while you control no other monsters.',
    effects: [
      {
        trigger: 'continuous',
        condition: { controlsNoOtherMonster: true },
        ops: [],
        aura: { target: SELF, atk: 500 },
      },
    ],
  },

  'mystical-elf': {
    /* The protection sentence had nothing behind it. Expressed as what the
       engine can actually do — she shields the monsters beside her rather than
       nothing at all. */
    text: 'While this card is face-up, your other Defense Position monsters cannot be destroyed by battle and your other Spellcasters gain 300 ATK. When summoned: gain 800 Life Points.',
    cry: 'A gentle light shields us.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'heal', amount: 800, to: 'own' }] },
      {
        /* Her chant is support magic — in the anime it feeds power to the
           monsters fighting in front of her. A tribe aura beside her shield
           gives Yugi's magician line the push its bodies were missing. */
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { type: 'Spellcaster' }, excludeSelf: true }), atk: 300 },
      },
      {
        trigger: 'continuous',
        ops: [],
        /* "Your **other** Defense Position monsters" — and a plain `all` with a
           position filter includes the Elf herself, who is normally sitting in
           Defence, so she was shielding herself and could not be killed in
           battle at all. */
        aura: {
          target: sel('own', 'all', { filter: { position: 'def' }, excludeSelf: true }),
          grants: ['indestructibleByBattle'],
        },
      },
    ],
  },

  'feral-imp': {
    /* The Exodia engine the deck never had. The limbs' own draw-a-card
       consolation actively removes a piece from the hand the win condition
       counts; the Imp finds a piece without spending one, and a 1300 body
       plus a card of advantage already looks good to the generic evaluate —
       so the AI takes the step without being told there is a combo. */
    text: 'When this card is summoned: add 1 piece of the Forbidden One from your Deck to your hand.',
    cry: 'The pieces gather…',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          {
            op: 'search',
            filter: {
              slugs: [
                'exodia-the-forbidden-one',
                'left-arm-of-the-forbidden-one',
                'right-arm-of-the-forbidden-one',
                'left-leg-of-the-forbidden-one',
                'right-leg-of-the-forbidden-one',
              ],
            },
          },
        ],
      },
    ],
  },

  kuriboh: {
    text: 'During your opponent\'s attack, you may discard this card from your hand: you take no battle damage for the rest of the turn.',
    cry: 'Kuri-kuri!',
    effects: [
      {
        trigger: 'trap',
        window: 'opponentDeclareAttack',
        fromHand: true,
        label: 'Kuriboh — negate all battle damage',
        ops: [{ op: 'preventBattleDamage', who: 'own', duration: 'turn' }],
      },
      { trigger: 'onSummon', ops: [{ op: 'summonToken', name: 'Kuriboh Token', atk: 300, def: 200, count: 1, artSlug: 'kuriboh' }] },
    ],
  },

  'magician-of-faith': {
    // Either Graveyard — which is what the effect has always done, while the
    // text claimed otherwise and made the card look broken when it reached
    // across the field.
    text: 'FLIP: add 1 Spell Card from either Graveyard to your hand, then draw 1 card.',
    cry: 'The faith is repaid!',
    effects: [
      {
        trigger: 'onFlip',
        ops: [
          { op: 'stealFromGrave', filter: { kind: 'spell' } },
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  'exodia-the-forbidden-one': {
    text: 'If you have all five pieces of the Forbidden One in your hand or on your field, you win the Duel immediately. When summoned: draw 2 cards.',
    cry: 'EXODIA! OBLITERATE!',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'draw', count: 2, who: 'own' }] }],
  },
  'left-arm-of-the-forbidden-one': {
    text: 'A piece of the Forbidden One. Gather all five in your hand or on your field to win the Duel. When summoned: draw 1 card.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
  },
  'right-arm-of-the-forbidden-one': {
    text: 'A piece of the Forbidden One. Gather all five in your hand or on your field to win the Duel. When summoned: draw 1 card.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
  },
  'left-leg-of-the-forbidden-one': {
    text: 'A piece of the Forbidden One. Gather all five in your hand or on your field to win the Duel. When summoned: draw 1 card.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
  },
  'right-leg-of-the-forbidden-one': {
    text: 'A piece of the Forbidden One. Gather all five in your hand or on your field to win the Duel. When summoned: draw 1 card.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
  },

  /* ================================================================ */
  /* Kaiba                                                             */
  /* ================================================================ */

  'blue-eyes-white-dragon': {
    text: 'This legendary dragon is a powerful engine of destruction. When summoned: destroy 1 monster your opponent controls. This card inflicts piercing battle damage.',
    cry: 'White Lightning!',
    effects: [
      {
        trigger: 'onSummon',
        targets: 1,
        ops: [
          { op: 'pierce', duration: 'permanent' },
          { op: 'destroy', target: OPP_PICK },
        ],
      },
    ],
  },

  'blue-eyes-toon-dragon': {
    summonRequires: 'toon-world',
    text: 'Requires "Toon World", and attacks directly only while it is face-up. When summoned: your opponent discards 1 random card.',
    cry: 'Toon power!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'discard', count: 1, who: 'opp' }],
      },
    ],
  },

  'lord-of-d': {
    /* He also brings the Flute now. A 1200 body spending one of three Monster
       Zones was only worth playing once dragons already stood — exactly
       backwards for the card whose art is holding the instrument that calls
       them. Summon him, fetch the Flute, and next turn the shield arrives
       with the dragons it shields. */
    text: 'When this card is summoned: add "The Flute of Summoning Dragon" from your Deck to your hand. While this card is face-up, Dragon monsters you control cannot be targeted or destroyed by your opponent\'s card effects. This card gains 400 ATK for each Dragon on the field.',
    cry: 'Dragons, heed my call!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'search', filter: { slugs: ['the-flute-of-summoning-dragon'] } }],
      },
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { type: 'Dragon' } }), grants: ['untargetable'] },
      },
      /* "Each Dragon on the field" — both sides of it, which is the literal
         reading and the flavour: he is the Lord of *Dragons*, not the lord of
         his own. `zone: 'field'` is the both-sides count. No `excludeSelf`
         needed and none would do anything: Lord of D. is a Spellcaster, so he
         never counts himself. Read live, so the number falls with the board. */
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, per: { zone: 'field', filter: { type: 'Dragon' }, atk: 400 } },
      },
    ],
  },

  'kaiser-sea-horse': {
    /* He fetches the dragon he is worth two tributes towards, which is the
       whole point of the body: two of him is a Blue-Eyes, and now one of him
       finds one. Deck first and the Graveyard only as a fallback — a single
       `search` with `orGrave` rather than a search beside a `stealFromGrave`,
       because Kaiba runs three Blue-Eyes and those two ops are independent:
       one in the Deck and one in the pile would have handed over both. */
    text: 'This card counts as two tributes for the Tribute Summon of a LIGHT monster. When summoned: gain 500 Life Points, then add 1 "Blue-Eyes White Dragon" from your Deck or Graveyard to your hand.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'heal', amount: 500, to: 'own' },
          { op: 'search', filter: { slugs: ['blue-eyes-white-dragon'] }, orGrave: true },
        ],
      },
    ],
  },

  'battle-ox': {
    text: 'When this card destroys a monster in battle: it gains 300 ATK permanently.',
    effects: [{ trigger: 'onBattleDestroy', ops: [{ op: 'gainAtk', amount: 300, target: SELF, duration: 'permanent' }] }],
  },

  'saggi-the-dark-clown': {
    text: 'While face-up, your opponent\'s monsters lose 400 ATK. When this card is summoned: add "Crush Card Virus" from your Deck to your hand. When this card is destroyed by battle: inflict 800 damage to your opponent.',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -400 } },
      /* The clown finds the virus he is famous for carrying. Kaiba's own
         combo: a 600 ATK body nobody fears, holding the card that empties a
         board. */
      { trigger: 'onSummon', ops: [{ op: 'search', filter: { slugs: ['crush-card-virus'] } }] },
      { trigger: 'onDestroyedByBattle', ops: [{ op: 'damage', amount: 800, to: 'opp' }] },
    ],
  },

  'rude-kaiser': {
    text: 'When this card declares an attack: it gains 1000 ATK until the end of the turn.',
    effects: [{ trigger: 'onDeclareAttack', ops: [{ op: 'gainAtk', amount: 1000, target: SELF, duration: 'turn' }] }],
  },

  'judge-man': {
    text: 'When this card is summoned: destroy all face-down monsters your opponent controls.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'destroy', target: sel('opp', 'all', { filter: { face: 'down' } }) }] },
    ],
  },

  'vorse-raider': {
    text: 'When this card destroys a monster in battle: inflict 500 damage to your opponent, then draw 1 card.',
    effects: [
      {
        trigger: 'onBattleDestroy',
        ops: [
          { op: 'damage', amount: 500, to: 'opp' },
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  'la-jinn-the-mystical-genie-of-the-lamp': {
    text: 'When this card is summoned: draw 1 card, then discard 1 card at random.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'draw', count: 1, who: 'own' },
          { op: 'discard', count: 1, who: 'own' },
        ],
      },
    ],
  },

  'hitotsu-me-giant': {
    /* `stealFromGrave` reads a Graveyard and puts the card in the hand, which
       is what "return it to your hand" is; `from: 'own'` keeps it to Kaiba's
       own, and the slug filter means it can only ever come back with the one
       card. Nothing there to take is simply nothing — the op leaves the rest
       of the summon alone. */
    text: 'This card inflicts piercing battle damage. When this card is summoned: if "Pot of Greed" is in your Graveyard, return it to your hand.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'pierce', duration: 'permanent' },
          { op: 'stealFromGrave', from: 'own', filter: { slugs: ['pot-of-greed'] } },
        ],
      },
    ],
  },

  'ryu-kishin-powered': {
    text: 'When this card is summoned: destroy 1 Spell or Trap your opponent controls.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'destroy', target: sel('opp', 'chosen', { zone: 'backrow', count: 1 }) }] }],
  },

  /* ================================================================ */
  /* Joey                                                              */
  /* ================================================================ */

  'red-eyes-black-dragon': {
    text: 'Once per turn: inflict 800 damage to your opponent. Each time this card destroys a monster in battle it gains 400 ATK permanently.',
    cry: 'Inferno Fire Blast!',
    effects: [
      {
        trigger: 'ignition',
        label: 'Inferno Fire Blast',
        oncePerTurn: true,
        ops: [{ op: 'damage', amount: 800, to: 'opp' }],
      },
      { trigger: 'onBattleDestroy', ops: [{ op: 'gainAtk', amount: 400, target: SELF, duration: 'permanent' }] },
    ],
  },

  'flame-swordsman': {
    /* He arms himself, Deck before Graveyard.

       This was a `search` beside a `stealFromGrave`, which was safe only
       because Joey runs exactly one Salamandra: the two ops are independent
       and both fire, so a second copy would have been fetched twice. Same
       behaviour today, no longer a trap for whoever adds the second copy. */
    text: 'When this card is summoned: destroy all monsters your opponent controls with 1500 or less ATK, then add "Salamandra" from your Deck or Graveyard to your hand. This card inflicts piercing battle damage.',
    cry: 'Flame Blast!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'pierce', duration: 'permanent' },
          { op: 'destroy', target: sel('opp', 'all', { filter: { maxAtk: 1500 } }) },
          { op: 'search', filter: { slugs: ['salamandra'] }, orGrave: true },
        ],
      },
    ],
  },

  'baby-dragon': {
    /* The search, not a blind draw: Baby Dragon is one half of both of Joey's
       combos (Time Wizard beside it, Alligator's Sword above it), and a draw
       found the other half a fifth of the time. The enabler now enables. */
    text: 'When summoned: add "Time Wizard" or "Alligator\'s Sword" from your Deck to your hand. While you control "Time Wizard", this card gains 1200 ATK.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'search', filter: { slugs: ['time-wizard', 'alligator-s-sword'] } }],
      },
      {
        trigger: 'continuous',
        condition: { requiresOnField: 'time-wizard' },
        ops: [],
        aura: { target: SELF, atk: 1200 },
      },
    ],
  },

  'time-wizard': {
    /* Losing the board is the whole of the bad half now — the 800 on top was
       a second price for one bet, and the owner's call is that the wipe pays
       for itself. Heads and tails still cost the same to reach. */
    text: 'Once per turn: flip a coin. Heads — destroy every monster your opponent controls and Special Summon "Thousand Dragon" from your Extra Deck. Tails — destroy every monster you control.',
    cry: 'Time Roulette!',
    effects: [
      {
        trigger: 'ignition',
        label: 'Time Roulette',
        oncePerTurn: true,
        ops: [
          {
            op: 'coinFlip',
            /* The sweep first, then the dragon — the board is clear by the time
               it arrives, so there is a free zone for it even on a full field.
               The other order would have the Extra Deck summon fail against
               three blockers, which is exactly the turn heads is for. */
            heads: [
              { op: 'destroy', target: OPP_ALL },
              {
                op: 'specialSummon',
                from: 'extra',
                side: 'own',
                filter: { slugs: ['thousand-dragon'] },
                count: 1,
                position: 'atk',
              },
            ],
            tails: [{ op: 'destroy', target: OWN_ALL }],
          },
        ],
      },
    ],
  },

  'panther-warrior': {
    /* Unconditional again, measured rather than principled: the balance pass
       tried gating the second attack on "another Warrior" and Joey — already
       last — fell further; the underdog cannot afford a nerf to his one
       no-setup muscle card. The audit's flag was right that this card wins
       duels outside the theme; the bench says the deck needs exactly that. */
    text: 'This card inflicts piercing battle damage and can attack twice each Battle Phase.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'pierce', duration: 'permanent' },
          { op: 'extraAttacks', count: 1 },
        ],
      },
    ],
  },

  'rocket-warrior': {
    /* The second sentence had no effect behind it at all — the card was half
       written. It reads the same as before; it now also does it. */
    text: 'This card cannot be destroyed by battle. When it attacks, the monster it battles loses 500 ATK permanently.',
    cry: 'Rocket punch!',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'indestructibleByBattle', duration: 'permanent' }] },
      {
        trigger: 'onDeclareAttack',
        ops: [{ op: 'gainAtk', amount: -500, target: sel('opp', 'attackTarget'), duration: 'permanent' }],
      },
    ],
  },

  "alligator-s-sword": {
    /* The rider stops being a body that pokes and becomes the other half of
       the fusion, the mirror of what Baby Dragon already does: one names Time
       Wizard or the sword, this one names the dragon or the Polymerization
       that joins them. A single `search` with both slugs is the "or" — the
       list is a preference order and it adds exactly one card. */
    text: 'When this card is summoned: add "Baby Dragon" or "Polymerization" from your Deck to your hand.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'search', filter: { slugs: ['baby-dragon', 'polymerization'] } }],
      },
    ],
  },

  'swordsman-of-landstar': {
    text: 'When this card is destroyed by battle: Special Summon 1 Warrior from your Graveyard.',
    effects: [
      { trigger: 'onDestroyedByBattle', ops: [{ op: 'specialSummon', from: 'grave', filter: { type: 'Warrior' }, count: 1, position: 'atk' }] },
    ],
  },

  garoozis: {
    /* The flat 400 became a die — Joey's whole deck runs on the bet, and a
       kill that rolls between 200 and 1200 (average 700) is both stronger
       and more him than a fixed ping. The same roll now feeds him too.

       The ATK gain sits *after* the roll rather than inside `perPip`, reading
       it back through `scale: 'dicePips'`: `perPip` runs its ops once per pip,
       and `gainAtk` logs every time it moves a number, so a 100-per-pip gain
       written there would be six beats saying "gains 100 ATK" for one die. */
    text: 'When this card destroys a monster in battle: roll a die, inflict 200 damage to your opponent for each pip, gain 100 ATK for each pip, then draw 1 card.',
    cry: 'Lady luck, smile on me!',
    effects: [
      {
        trigger: 'onBattleDestroy',
        ops: [
          { op: 'diceRoll', perPip: [{ op: 'damage', amount: 200, to: 'opp' }] },
          { op: 'gainAtk', amount: 100, scale: 'dicePips', target: SELF, duration: 'permanent' },
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  'axe-raider': {
    text: 'This card inflicts piercing battle damage and gains 200 ATK for each card in your Graveyard.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'pierce', duration: 'permanent' }],
      },
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: { side: 'own', pick: 'self' }, per: { zone: 'ownGrave', atk: 200 } },
      },
    ],
  },

  'tiger-axe': {
    /* Every monster, not one: a 1300 body bending a single blocker was the
       weakest tempo play in the deck. The whole board flinching sets up the
       deck's piercers — Flame Swordsman, Axe Raider, Salamandra — which is
       the synergy the card was always supposed to be. */
    text: 'When this card is summoned: force every monster your opponent controls into face-up Defense Position. When this card declares an attack: destroy 1 Spell or Trap your opponent controls.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'forceDefense', target: sel('opp', 'all') }] },
      {
        trigger: 'onDeclareAttack',
        ops: [{ op: 'destroy', target: sel('opp', 'chosen', { zone: 'backrow', count: 1 }) }],
      },
    ],
  },

  'masaki-the-legendary-swordsman': {
    /* He counts his company instead of leaning on one comrade: a flat 800 that
       switched on at the first Warrior and never grew again is now a rate, and
       the fallen count too. Both halves are live auras, so a comrade dying
       moves him from the field column into the Graveyard one in the same
       instant rather than dropping him off a cliff.

       `excludeSelf` on the field count is load-bearing — Masaki is himself a
       Warrior standing on his own field, and without it he would count his own
       body and never be alone. The Graveyard half needs no such guard: a card
       cannot be in its own Graveyard while it is on the field granting this.

       Two sentences, not one: `npm run text` reads a single sentence for its
       "for each …" rule, so a combined line would have left the Graveyard rate
       unchecked. Split, the second half is driven by the checker and the first
       is pinned in `npm run rules`. */
    text: 'This card gains 500 ATK for every other Warrior you control. It also gains 100 ATK for every Warrior in your Graveyard.',
    cry: 'I do not stand alone!',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: {
          target: SELF,
          per: { zone: 'ownField', filter: { type: 'Warrior' }, excludeSelf: true, atk: 500 },
        },
      },
      {
        trigger: 'continuous',
        ops: [],
        aura: {
          target: SELF,
          per: { zone: 'ownGrave', filter: { type: 'Warrior' }, atk: 100 },
        },
      },
    ],
  },

  'battle-steer': {
    text: 'When this card destroys a monster in battle: it gains 400 ATK permanently.',
    effects: [{ trigger: 'onBattleDestroy', ops: [{ op: 'gainAtk', amount: 400, target: SELF, duration: 'permanent' }] }],
  },

  kojikocy: {
    text: 'When this card is summoned: your opponent discards 1 random card and you draw 1 card.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'discard', count: 1, who: 'opp' },
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  /* ================================================================ */
  /* Mai                                                               */
  /* ================================================================ */

  'harpie-lady': {
    text: 'All Winged Beast monsters you control gain 200 ATK. When this card is summoned: destroy 1 Spell or Trap your opponent controls.',
    cry: 'Sisters, take flight!',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: sel('own', 'all', { filter: { type: 'Winged Beast' } }), atk: 200 } },
      { trigger: 'onSummon', ops: [{ op: 'destroy', target: sel('opp', 'chosen', { zone: 'backrow', count: 1 }) }] },
    ],
  },

  'harpie-lady-sisters': {
    text: 'This card can attack all monsters your opponent controls once each. When summoned: destroy every Spell and Trap your opponent controls.',
    cry: 'Triple attack!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'attackAllMonsters' },
          { op: 'destroy', target: sel('opp', 'all', { zone: 'backrow' }) },
        ],
      },
    ],
  },

  'cyber-harpie-lady': {
    text: 'This card inflicts piercing battle damage. When it destroys a monster in battle: draw 1 card.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'pierce', duration: 'permanent' }] },
      { trigger: 'onBattleDestroy', ops: [{ op: 'draw', count: 1, who: 'own' }] },
    ],
  },

  'harpie-s-pet-dragon': {
    text: 'Gains 300 ATK and DEF for each Winged Beast you control. When summoned: destroy 1 monster your opponent controls.',
    cry: 'Feed on their fear!',
    effects: [
      {
        trigger: 'onSummon',
        targets: 1,
        ops: [
          { op: 'gainAtk', scale: 'perMonsterOnField', target: SELF, duration: 'permanent' },
          { op: 'destroy', target: OPP_PICK },
        ],
      },
    ],
  },

  'sky-scout': {
    text: 'This card can attack your opponent directly, but its battle damage is halved.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'directAttack', duration: 'permanent' },
          // The price for it. Only the first op existed, so this was an
          // unblockable 1800 every turn for one Normal Summon.
          { op: 'halvedBattleDamage', duration: 'permanent' },
        ],
      },
    ],
  },

  'dunames-dark-witch': {
    text: 'When this card is summoned: gain 700 Life Points and inflict 400 damage to your opponent.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'heal', amount: 700, to: 'own' },
          { op: 'damage', amount: 400, to: 'opp' },
        ],
      },
    ],
  },

  'winged-dragon-guardian-of-the-fortress-1': {
    /* "Of Level 4 or lower" was a bound the engine cannot express, so what it
       really meant was "never" — the same hole as Sword Arm of Dragon. And the
       immunity was granted by a summon trigger, so a copy that had been Set and
       was turned face-up by an attack never had it at all, and died to the very
       battle its text says it survives. It is a property of the card now. */
    text: 'While face-up, this card cannot be destroyed by battle.',
    cry: 'The fortress holds!',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'indestructibleByBattle', duration: 'permanent' }] }],
  },

  'amazon-of-the-seas': {
    text: 'When this card is summoned: return 1 monster your opponent controls to their hand.',
    effects: [{ trigger: 'onSummon', targets: 1, ops: [{ op: 'bounce', target: OPP_PICK }] }],
  },

  'sonic-maid': {
    text: 'When this card is summoned: draw 1 card.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
  },

  'happy-lover': {
    text: 'When this card is summoned: gain 1000 Life Points.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'heal', amount: 1000, to: 'own' }] }],
  },

  /* ================================================================ */
  /* Pegasus                                                           */
  /* ================================================================ */

  relinquished: {
    /* Immunity to card effects went back to the Gods, and the mirror came in
       its place — which is the printed card's most famous clause and a far
       better one. Blanket immunity is the absence of an answer; this is a
       reason not to attack, which the other player gets to weigh. The
       monster it swallowed is the shield, and what still gets through goes
       straight back across the table. */
    text:
      'When this card is summoned: absorb 1 monster your opponent controls — this card gains its ATK and DEF, ' +
      'and the monster is banished. This card cannot be destroyed by battle, and its battle damage pierces defence. ' +
      'Any battle damage you take from a battle involving this card is dealt to your opponent as well.',
    cry: 'Your monster is mine now, Yugi-boy.',
    effects: [
      {
        /* `onSummon`, not `onNormalSummon`. Relinquished is a Ritual monster —
           it only ever arrives through Black Illusion Ritual, which Special
           Summons it, so the normal-summon trigger never fired and the card did
           nothing at all. */
        trigger: 'onSummon',
        targets: 1,
        ops: [
          { op: 'absorb', target: OPP_PICK },
          { op: 'indestructibleByBattle', duration: 'permanent' },
          { op: 'pierce', duration: 'permanent' },
          { op: 'reflectBattleDamage', duration: 'permanent' },
        ],
      },
    ],
  },

  'toon-summoned-skull': {
    summonRequires: 'toon-world',
    /* The mischief belongs to the book, not to the monster — see the note on
       Toon World. Owning it outright meant destroying Toon World took the 600
       ATK and left the Toon still walking past blockers, which is the opposite
       of "when the toon world is gone they just can't attack directly". */
    text: 'Requires "Toon World", and attacks directly only while it is face-up. When summoned: inflict 600 damage to your opponent.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'damage', amount: 600, to: 'opp' }],
      },
    ],
  },

  'toon-mermaid': {
    summonRequires: 'toon-world',
    text: 'Requires "Toon World", and attacks directly only while it is face-up. When summoned: draw 1 card.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'draw', count: 1, who: 'own' }],
      },
    ],
  },

  'toon-alligator': {
    text: 'Can attack your opponent directly. When this card is summoned: add "Toon World" from your Deck to your hand.',
    cry: 'Snap to it!',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'directAttack', duration: 'permanent' }] },
      // Pegasus's deck does nothing until Toon World is down, and drawing into
      // one of two copies is not something to leave to luck. The cheapest body
      // in the deck is the one that goes and fetches it.
      { trigger: 'onSummon', ops: [{ op: 'search', filter: { slugs: ['toon-world'] } }] },
    ],
  },

  'manga-ryu-ran': {
    summonRequires: 'toon-world',
    text: 'Requires "Toon World", and attacks directly only while it is face-up. Cannot be targeted by your opponent\'s effects.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'untargetable', duration: 'permanent' }],
      },
    ],
  },

  'ryu-ran': {
    text: 'When this card is summoned: destroy 1 monster your opponent controls with 1600 or less ATK.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'destroy', target: sel('opp', 'weakest', { filter: { maxAtk: 1600 } }) }] }],
  },

  'dark-eyes-illusionist': {
    text: 'When this card is summoned: your opponent\'s monsters cannot attack or change position during their next turn.',
    cry: 'Look into my eyes...',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'freezeMonsters', who: 'opp', turns: 1 }] }],
  },

  'illusionist-faceless-mage': {
    text: 'FLIP: take control of 1 monster your opponent controls until the end of your turn.',
    effects: [{ trigger: 'onFlip', targets: 1, ops: [{ op: 'takeControl', target: OPP_PICK, duration: 'turn' }] }],
  },

  'parrot-dragon': {
    text: 'When this card destroys a monster in battle: it may attack once more this turn.',
    effects: [{ trigger: 'onBattleDestroy', ops: [{ op: 'extraAttacks', count: 1, duration: 'turn' }] }],
  },

  'dragon-piper': {
    text: 'FLIP: take control of every Dragon your opponent controls until the end of your turn.',
    effects: [{ trigger: 'onFlip', ops: [{ op: 'takeControl', target: sel('opp', 'all', { filter: { type: 'Dragon' } }), duration: 'turn' }] }],
  },

  'doma-the-angel-of-silence': {
    text: 'When this card is summoned: your opponent sends the top 3 cards of their Deck to the Graveyard.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'mill', count: 3, who: 'opp' }] }],
  },

  bickuribox: {
    text: 'When this card is summoned: destroy 1 monster your opponent controls. This card can attack twice each Battle Phase.',
    effects: [
      {
        trigger: 'onSummon',
        targets: 1,
        ops: [
          { op: 'extraAttacks', count: 1 },
          { op: 'destroy', target: OPP_PICK },
        ],
      },
    ],
  },

  'dark-rabbit': {
    summonRequires: 'toon-world',
    text: 'Requires "Toon World", and attacks directly only while it is face-up. When summoned: your opponent discards 1 random card.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'discard', count: 1, who: 'opp' }],
      },
    ],
  },

  /* ================================================================ */
  /* Bakura                                                            */
  /* ================================================================ */

  'man-eater-bug': {
    text: 'FLIP: destroy 1 monster your opponent controls, then inflict 300 damage to them.',
    cry: 'Into the shadows with you!',
    effects: [
      {
        trigger: 'onFlip',
        targets: 1,
        ops: [
          { op: 'destroy', target: OPP_PICK },
          { op: 'damage', amount: 300, to: 'opp' },
        ],
      },
    ],
  },

  'morphing-jar': {
    text: 'FLIP: both players discard their entire hand, then each draws 5 cards.',
    effects: [
      {
        trigger: 'onFlip',
        ops: [
          { op: 'discard', count: 99, who: 'both' },
          { op: 'draw', count: 5, who: 'both' },
        ],
      },
    ],
  },

  'the-portrait-s-secret': {
    text: 'When this card is destroyed by battle: inflict 700 damage to your opponent.',
    effects: [{ trigger: 'onDestroyedByBattle', ops: [{ op: 'damage', amount: 700, to: 'opp' }] }],
  },

  'headless-knight': {
    text: 'When this card is sent to the Graveyard: inflict 500 damage to your opponent and gain 500 Life Points.',
    effects: [
      {
        trigger: 'onSentToGrave',
        ops: [
          { op: 'damage', amount: 500, to: 'opp' },
          { op: 'heal', amount: 500, to: 'own' },
        ],
      },
    ],
  },

  'earthbound-spirit': {
    text: 'While this card is face-up, your opponent\'s monsters lose 500 ATK. This card cannot be destroyed by battle.',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -500 } },
      { trigger: 'onSummon', ops: [{ op: 'indestructibleByBattle', duration: 'permanent' }] },
    ],
  },

  'white-magical-hat': {
    /* A thief needs to reach the victim. His discard only fires on battle
       damage, and a 1000 body never lands any through a blocker — so the
       whole card sat dead behind the first monster the opponent played.
       Attacking directly is what the hat does in the anime: slip past, lift
       a card on the way. */
    text: 'This card can attack your opponent directly. When it inflicts battle damage to your opponent: they discard 1 random card.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'directAttack', duration: 'permanent' }] },
      { trigger: 'onDealBattleDamage', ops: [{ op: 'discard', count: 1, who: 'opp' }] },
    ],
  },

  'lady-of-faith': {
    /* The draw became a séance: she reaches into the Graveyard the deck spends
       the whole duel filling and hands a Fiend back. On-theme card advantage
       — the horror returns to the hand to be Set again. */
    text: 'When this card is summoned: gain 600 Life Points and add 1 Fiend monster from your Graveyard to your hand.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'heal', amount: 600, to: 'own' },
          { op: 'stealFromGrave', from: 'own', filter: { kind: 'monster', type: 'Fiend' } },
        ],
      },
    ],
  },

  'souls-of-the-forgotten': {
    /* The forgotten grow as the Graveyard fills — a live aura over the pile of
       Fiends this deck feeds all duel. Late it is a real body wearing every
       horror that came before it, and the burn keeps ticking. */
    text: 'Gains 300 ATK for each Fiend monster in your Graveyard. At the end of your turn: inflict 300 damage to your opponent.',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: { side: 'own', pick: 'self' }, per: { zone: 'ownGrave', filter: { kind: 'monster', type: 'Fiend' }, atk: 300 } },
      },
      { trigger: 'onOwnTurnEnd', ops: [{ op: 'damage', amount: 300, to: 'opp' }] },
    ],
  },

  'the-gross-ghost-of-fled-dreams': {
    text: 'FLIP: your opponent discards 2 random cards.',
    effects: [{ trigger: 'onFlip', ops: [{ op: 'discard', count: 2, who: 'opp' }] }],
  },

  'dark-necrofear': {
    /* She is built from the Fiends that came before her, so she wears them:
       100/100 for every Fiend in either Graveyard, read live. In a deck whose
       whole game plan is filling graves with horrors she grows past her
       printed 2200 by mid-duel — and against the mirror she reads the other
       side's dead too. */
    text: 'Gains 100 ATK and DEF for each Fiend monster in either Graveyard. When this card is summoned: take control of 1 monster your opponent controls permanently.',
    cry: 'The darkness claims your soul.',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: {
          target: { side: 'own', pick: 'self' },
          per: { zone: 'eitherGrave', filter: { kind: 'monster', type: 'Fiend' }, atk: 100, def: 100 },
        },
      },
      { trigger: 'onSummon', targets: 1, ops: [{ op: 'takeControl', target: OPP_PICK, duration: 'permanent' }] },
    ],
  },

  sangan: {
    text: 'When this card is sent to the Graveyard: add the strongest monster with 1500 or less ATK from your Deck to your hand.',
    effects: [{ trigger: 'onSentToGrave', ops: [{ op: 'search', filter: { kind: 'monster', maxAtk: 1500 } }] }],
  },

  'witch-of-the-black-forest': {
    text: 'When this card is sent to the Graveyard: add the strongest monster from your Deck to your hand.',
    effects: [{ trigger: 'onSentToGrave', ops: [{ op: 'search', filter: { kind: 'monster' } }] }],
  },

  'dark-elf': {
    text: 'Once per turn, pay 500 Life Points: this card gains 1000 ATK until the end of the turn.',
    effects: [
      {
        trigger: 'ignition',
        label: 'Pay 500 LP: +1000 ATK',
        oncePerTurn: true,
        cost: { lp: 500 },
        ops: [{ op: 'gainAtk', amount: 1000, target: SELF, duration: 'turn' }],
      },
    ],
  },

  'the-earl-of-demise': {
    text: 'When this card is summoned: destroy 1 set card your opponent controls.',
    /* The filter is the whole point: it said "face-down" and did not check,
       so summoning this blew up a Spell the opponent had already played. */
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'destroy', target: sel('opp', 'all', { zone: 'spellTrap', filter: { face: 'down' } }) }],
      },
    ],
  },

  'dark-assailant': {
    text: 'When this card is destroyed by battle: destroy the monster that destroyed it.',
    effects: [{ trigger: 'onDestroyedByBattle', ops: [{ op: 'destroy', target: sel('opp', 'attacker') }] }],
  },

  /* ================================================================ */
  /* Mako                                                              */
  /* ================================================================ */

  'the-legendary-fisherman': {
    text: 'While "Umi" is on the field, this card cannot be targeted or destroyed by your opponent\'s effects and can attack directly.',
    cry: 'Ride the waves!',
    /* Written as a conditional aura rather than a conditional `onSummon`, like
       7 Colored Fish and Amphibian Beast beside him. It reads the same either
       way — `liftPassives` turns permanent summon grants into an aura and now
       carries the condition across with them — but this is the shape the
       sentence actually has: a state of the field, asked every time, not a
       question answered once on the way in. */
    effects: [
      {
        trigger: 'continuous',
        condition: { requiresField: 'umi' },
        ops: [],
        aura: { target: { side: 'own', pick: 'self' }, grants: ['untargetable', 'directAttack'] },
      },
    ],
  },

  'fortress-whale': {
    text: 'When this card is summoned: destroy every monster your opponent controls with 1800 or less ATK.',
    cry: 'Rise from the depths!',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'destroy', target: sel('opp', 'all', { filter: { maxAtk: 1800 } }) }] }],
  },

  'kairyu-shin': {
    text: 'While face-up, all monsters your opponent controls lose 400 ATK. This card inflicts piercing battle damage.',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -400 } },
      { trigger: 'onSummon', ops: [{ op: 'pierce', duration: 'permanent' }] },
    ],
  },

  'great-white': {
    /* A shark in open water bites through the shield: pierce under Umi turns
       the deck's two 1600 vanillas into real tide payoffs (2000 piercing with
       the weather up). */
    text: 'While "Umi" is on the field, this card inflicts piercing battle damage. When this card destroys a monster in battle: inflict 400 damage to your opponent.',
    effects: [
      {
        trigger: 'continuous',
        condition: { requiresField: 'umi' },
        ops: [],
        aura: { target: SELF, grants: ['pierce'] },
      },
      { trigger: 'onBattleDestroy', ops: [{ op: 'damage', amount: 400, to: 'opp' }] },
    ],
  },

  jellyfish: {
    text: 'FLIP: return 1 monster your opponent controls to their hand.',
    effects: [{ trigger: 'onFlip', targets: 1, ops: [{ op: 'bounce', target: OPP_PICK }] }],
  },

  '7-colored-fish': {
    text: 'While "Umi" is on the field, this card gains 800 ATK and inflicts piercing battle damage.',
    /* "While Umi is on the field" is a live condition, not a question asked
       once. As a one-shot on summon the order of play decided everything:
       Umi down first and the fish kept the 800 for good, even after Umi was
       destroyed; summon first and it never got them at all, however long Umi
       then sat there. A conditional aura is read from the field every time the
       stat is calculated, so it simply follows Umi. */
    effects: [
      {
        trigger: 'continuous',
        condition: { requiresField: 'umi' },
        ops: [],
        aura: { target: { side: 'own', pick: 'self' }, atk: 800, grants: ['pierce'] },
      },
    ],
  },

  'giant-red-seasnake': {
    /* 1850, not 1600: the old ceiling missed 7 Colored Fish (1800), Kairyu-Shin
       (1800) and Great White's twin — most of the school the reviver exists to
       revive. The deck's one recursion now reaches its own payoffs. */
    text: 'When this card is Normal Summoned: Special Summon 1 WATER monster with 1850 or less ATK from your Graveyard.',
    effects: [
      { trigger: 'onNormalSummon', ops: [{ op: 'specialSummon', from: 'grave', filter: { attribute: 'WATER', maxAtk: 1850 }, count: 1, position: 'atk' }] },
    ],
  },

  'deepsea-warrior': {
    /* The other way round from the three above: this one keeps the effect
       half, because being untouchable by Spells and Traps is the whole of its
       name, and gives up battle immunity — so the answer is simply a bigger
       monster. The text also said "Spell or Trap effects" while the grant is
       `untargetable`, which in this engine no opposing effect gets past at
       all; it now says what it does rather than the narrower thing. */
    text: "This card cannot be targeted or destroyed by your opponent's card effects. While \"Umi\" is on the field, it gains 600 ATK.",
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'untargetable', duration: 'permanent' }],
      },
      /* A deep-sea creature in its own water: the tribute he costs finally
         buys a body (2200 under Umi) instead of only an immunity. */
      {
        trigger: 'continuous',
        condition: { requiresField: 'umi' },
        ops: [],
        aura: { target: SELF, atk: 600 },
      },
    ],
  },

  'aqua-madoor': {
    /* "Monsters with 1500 or less ATK cannot attack" is not something the engine
       can express — there is no per-monster attack ban, only a whole-side lock.
       So the wall does what a wall does: it drains what comes at it. */
    text: 'While face-up, all monsters your opponent controls lose 400 ATK. When summoned: gain 800 Life Points.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'heal', amount: 800, to: 'own' }] },
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -400 } },
    ],
  },

  'flying-fish': {
    /* The way in — the Toon Alligator pattern. Umi is the hinge of the whole
       deck and used to be a single copy nothing could find; the fish that
       leaps OUT of the sea is the one that goes and gets it. */
    text: 'This card can attack your opponent directly. When it is summoned: add "Umi" from your Deck to your hand.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'directAttack', duration: 'permanent' }] },
      { trigger: 'onSummon', ops: [{ op: 'search', filter: { slugs: ['umi'] } }] },
    ],
  },

  'kappa-avenger': {
    text: 'When this card is destroyed by battle: destroy the monster that destroyed it and inflict 400 damage.',
    effects: [
      {
        trigger: 'onDestroyedByBattle',
        ops: [
          { op: 'destroy', target: sel('opp', 'attacker') },
          { op: 'damage', amount: 400, to: 'opp' },
        ],
      },
    ],
  },

  'crab-turtle': {
    text: 'When this card is summoned: return every monster your opponent controls to their hand.',
    cry: 'The tide takes everything!',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'bounce', target: OPP_ALL }] }],
  },

  'amphibian-beast': {
    text: 'While "Umi" is on the field, this card gains 500 ATK and can attack twice each Battle Phase.',
    // Same as 7 Colored Fish: the condition has to keep being asked.
    effects: [
      {
        trigger: 'continuous',
        condition: { requiresField: 'umi' },
        ops: [],
        aura: { target: { side: 'own', pick: 'self' }, atk: 500, grants: ['doubleAttack'] },
      },
    ],
  },

  /* ================================================================ */
  /* Yami Yugi — the Pharaoh's swarm, and the God it calls down       */
  /* ================================================================ */

  'slifer-the-sky-dragon': {
    /* The printed card has "?" for both stats, which the card database gives
       as -1. Zero is the honest floor here: Slifer is worth exactly what your
       hand is worth, and an empty hand leaves a God that anything can run
       over. That is the whole tension of playing him — every card you spend
       developing the board takes 1000 ATK off the thing you spent three
       monsters to summon. */
    atkOverride: 0,
    defOverride: 0,
    text:
      'Requires 3 Tributes. When this card is Summoned: draw 1 card. ' +
      'Gains 1000 ATK and 1000 DEF for each card in your hand. ' +
      "When your opponent Summons a monster: it loses 2000 ATK, and if that leaves it with nothing, destroy it. " +
      "This card cannot be targeted by your opponent's card effects. " +
      /* The decree, printed where the rule lives: a God's attacks and effects
         ignore every protection, and no mortal trap may reach one. */
      "A God is above everything: this card's attacks and effects ignore your opponent's protections. " +
      /* Said out loud on the card, unlike the Magnet Warriors' secret. That
         one is a bonus to find; this is a restriction, and a God vanishing
         with nothing having explained why is the bad kind of surprise. */
      'If this card is Special Summoned, it returns to the Graveyard at the end of that turn.',
    cry: 'The Sky Dragon answers!',
    effects: [
      {
        /* The draw is the floor. Three Tributes is the whole board, so the
           hand that pays for a God is usually the hand that was about to be
           spent — and Slifer with nothing left is a 0/0 that a Kuriboh runs
           over. One card off the top is worth exactly 1000 ATK to this
           monster and nothing to any other, which is the neatest way a God
           could possibly arrive with a body. */
        trigger: 'onSummon',
        ops: [{ op: 'draw', count: 1, who: 'own' }],
      },
      {
        trigger: 'continuous',
        ops: [],
        aura: {
          target: SELF,
          /* No piercing. A God is not a damage engine, and the decree that
             makes it untouchable by card effects already means the only
             answer to one is a bigger body — so it must not also punish the
             player for putting a body in the way. Defence is the counterplay;
             piercing was quietly deleting it. */
          per: { zone: 'ownHand', atk: 1000, def: 1000 },
          grants: ['untargetable'],
        },
      },
      {
        /* The second mouth, on every Summon the other player makes — Normal,
           Fusion, Special, Token. It used to hear only the first two, which in
           this game is a minority of them: a Monster Reborn'd Blue-Eyes, a
           Magnet Warrior pulled out by Gamma, a revived anything, all walked
           past the God untouched.

           A Set still wakes nothing, deliberately. It is not a Summon, it is
           the rule every trap window here follows, and it leaves the player a
           real answer to a God — lay them face-down and Slifer cannot reach
           them until they turn over. A card with no counterplay is not a card.

           The drain lands first and the destroy reads the effective stat
           afterwards, so the two halves of the sentence resolve in the order
           it is written. */
        trigger: 'onOpponentSummon',
        ops: [
          { op: 'gainAtk', amount: -2000, target: sel('opp', 'attacker'), duration: 'permanent' },
          { op: 'destroyIfNoAtk', target: sel('opp', 'attacker') },
        ],
      },
    ],
  },

  'alpha-the-magnet-warrior': {
    /* One search was never the magnetism. Alpha finds the whole set — and the
       two cards it puts in hand are also 2000 ATK on a Slifer, which is the
       quiet reason this deck wants its hand full. */
    text: 'When this card is summoned: add 2 Magnet Warriors from your Deck to your hand.',
    cry: 'Magnet Warriors, assemble!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'search', filter: { nameIncludes: 'Magnet Warrior' }, count: 2 }],
      },
    ],
  },

  'beta-the-magnet-warrior': {
    /* The immovable one. Blow the trio apart and Beta drags a piece back out
       of the Graveyard — magnets do not stay separated. */
    /* Battle only, for the same reason as Big Shield Gardna. The condition
       made it feel earned, but while it held Beta could not be removed by
       anything at all — and a conditional stalemate is still a stalemate. */
    text:
      'When this card is Summoned: Special Summon 1 Magnet Warrior from your Graveyard. ' +
      'While you control another Rock monster, this card gains 800 ATK and cannot be destroyed by battle.',
    cry: 'Steel holds!',
    effects: [
      {
        /* `onSummon`, not `onNormalSummon`: revived by Monster Reborn or
           dragged out by Alpha, Beta still reaches back for the next magnet —
           on the narrow trigger the chain broke on every Special Summon. */
        trigger: 'onSummon',
        ops: [
          {
            op: 'specialSummon',
            from: 'grave',
            filter: { nameIncludes: 'Magnet Warrior' },
            count: 1,
            position: 'atk',
          },
        ],
      },
      {
        trigger: 'continuous',
        condition: { controlsOtherOfType: 'Rock' },
        ops: [],
        aura: { target: SELF, atk: 800, grants: ['indestructibleByBattle'] },
      },
    ],
  },

  'gamma-the-magnet-warrior': {
    /* Reaching only the hand meant the line took two turns: Alpha searches,
       and Gamma cannot use what it found until you draw into a summon for it.
       From the Deck, one Normal Summon is two magnets standing — and two
       magnets plus Alpha's search is Valkyrion on the spot.

       `onSummon` rather than `onNormalSummon` so it works however Gamma
       arrives, including out of Valkyrion coming apart. It cannot loop: every
       Magnet Warrior it could reach is already on the field by then. */
    text: 'When this card is Summoned: Special Summon 1 Magnet Warrior from your hand, Deck or Graveyard.',
    cry: 'Three become one!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          {
            op: 'specialSummon',
            from: ['hand', 'deck', 'grave'],
            filter: { nameIncludes: 'Magnet Warrior' },
            count: 1,
            position: 'atk',
          },
        ],
      },
    ],
  },

  'valkyrion-the-magna-warrior': {
    /* The printed card is Special Summoned by tributing the three Magnet
       Warriors. Here that is a Fusion, because tributing three specific bodies
       for one is exactly what a Fusion already is in this engine — and it puts
       Valkyrion in direct competition with Slifer for the same three monsters,
       which is the most interesting decision in the deck.

       There is no Fusion card when Yugi calls them, so `fusionFree` — but only
       from the field: three bodies already standing is a real commitment,
       where three cards falling out of a hand is not, and it keeps
       Polymerization worth its slot as the thing that buys the shortcut.
       And he comes apart again, which is the other half of the printed card
       and the thing that resolves the competition with Slifer — assemble,
       swing, then split into exactly the three tributes a God costs. */
    /* The text says none of this on purpose. Standing all three on the field
       and watching them combine with no Fusion card is a thing to *find*, and
       a sentence explaining it in advance is a worse card than a secret. The
       rule is in `fusionRoute` and pinned by `npm run rules`; the player gets
       the moment. */
    text:
      'Fusion: Alpha + Beta + Gamma the Magnet Warrior. ' +
      'When Fusion Summoned: destroy 1 monster your opponent controls. ' +
      'Once per turn: Tribute this card to Special Summon Alpha, Beta and Gamma the Magnet Warrior from your Graveyard. ' +
      'This card inflicts piercing battle damage.',
    cry: 'The Magna Warrior stands whole!',
    fusionMaterials: ['alpha-the-magnet-warrior', 'beta-the-magnet-warrior', 'gamma-the-magnet-warrior'],
    fusionFree: true,
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'destroy', target: sel('opp', 'chosen', { count: 1 }) },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
      {
        trigger: 'ignition',
        label: 'Magna Warrior — come apart',
        oncePerTurn: true,
        cost: { tributeSelf: true },
        ops: [
          {
            op: 'specialSummon',
            from: 'grave',
            filter: {
              slugs: ['alpha-the-magnet-warrior', 'beta-the-magnet-warrior', 'gamma-the-magnet-warrior'],
            },
            count: 3,
            position: 'atk',
          },
        ],
      },
    ],
  },

  'queen-s-knight': {
    /* She summons him rather than searching him — which fires his effect,
       which fetches Jack's. One Normal Summon stands the whole court up: three
       bodies, which is three Tributes, which is a God on the same turn. That
       chain is the deck. */
    text: "When this card is summoned: Special Summon King's Knight from your Deck.",
    cry: 'My King, to me!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          {
            op: 'specialSummon',
            from: ['deck', 'grave'],
            filter: { slugs: ['king-s-knight'] },
            count: 1,
            position: 'atk',
          },
        ],
      },
    ],
  },

  'king-s-knight': {
    /* `onSummon`, so the chain still runs when the Queen brings him out — as
       `onNormalSummon` he arrived by her hand and then did nothing at all,
       which is the one case that matters. */
    text: "When this card is Summoned while you control another Warrior: Special Summon Jack's Knight from your Deck or Graveyard.",
    cry: 'The court assembles!',
    effects: [
      {
        trigger: 'onSummon',
        condition: { controlsOtherOfType: 'Warrior' },
        ops: [
          {
            op: 'specialSummon',
            from: ['deck', 'grave'],
            filter: { slugs: ['jack-s-knight'] },
            count: 1,
            position: 'atk',
          },
        ],
      },
    ],
  },

  'jack-s-knight': {
    text:
      'All Warrior monsters you control gain 300 ATK. ' +
      "While you control Queen's Knight and King's Knight, this card can attack your opponent directly.",
    cry: 'For the crown!',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { type: 'Warrior' } }), atk: 300 },
      },
      {
        /* The court complete, and only then. Written as a conditional aura
           rather than an on-summon grant so it lapses the moment one of them
           is destroyed — the same shape as The Legendary Fisherman, whose
           permanent version of this was a reported bug. */
        trigger: 'continuous',
        condition: { requiresOnFieldAll: ['queen-s-knight', 'king-s-knight'] },
        ops: [],
        aura: { target: SELF, grants: ['directAttack'] },
      },
    ],
  },

  'gazelle-the-king-of-mythical-beasts': {
    /* Deliberately a search and not a Summon, unlike the Queen: Berfomet is a
       Tribute monster and staying one is the point. Gazelle finds him and then
       Gazelle *is* what you pay — and Berfomet puts him straight back. The two
       of them keep swapping in for each other, which is exactly how they read
       on the page. */
    text:
      'When this card is summoned: add Berfomet from your Deck to your hand. ' +
      'While you control Berfomet, this card and your other Beast monsters gain 600 ATK.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'search', filter: { slugs: ['berfomet'] } }],
      },
      {
        trigger: 'continuous',
        condition: { requiresOnField: 'berfomet' },
        ops: [],
        aura: { target: SELF, atk: 600 },
      },
      {
        /* The pride buff sits on Gazelle, not on Berfomet, and it is the King
           of Mythical Beasts who carries it — a Fiend lifting every Beast on
           the field was always the odd way round.

           It also has to be *other* Beasts. Berfomet used to hold this aura
           with a plain `all`, and Gazelle is a Beast, so Gazelle collected the
           pair bonus twice: 1500 + 800 + 800 = 3100, stronger than Blue-Eyes
           off two level-4-and-5 bodies. Reported for exactly that. `excludeSelf`
           is the same word the text uses, and Berfomet is a Fiend so he is
           untouched by it and keeps his own clause. */
        trigger: 'continuous',
        condition: { requiresOnField: 'berfomet' },
        ops: [],
        aura: { target: sel('own', 'all', { filter: { type: 'Beast' }, excludeSelf: true }), atk: 600 },
      },
    ],
  },

  berfomet: {
    /* He costs a Tribute, so he brings the Tribute back. Pay Gazelle, and
       Berfomet returns Gazelle from the Graveyard — one body in, two bodies
       out, and both of them 800 bigger for standing together. */
    text:
      'When this card is Summoned: Special Summon Gazelle the King of Mythical Beasts from your Deck or Graveyard. ' +
      'While you control Gazelle the King of Mythical Beasts, this card gains 600 ATK.',
    cry: 'Come, my other half!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          {
            op: 'specialSummon',
            from: ['deck', 'grave'],
            filter: { slugs: ['gazelle-the-king-of-mythical-beasts'] },
            count: 1,
            position: 'atk',
          },
        ],
      },
      {
        /* One aura, and only on himself. The "all Beast monsters" half moved
           to Gazelle, who is the one the sentence is about — and who can say
           "other" and mean it, which is what stopped the pair bonus being
           paid to him twice. */
        trigger: 'continuous',
        condition: { requiresOnField: 'gazelle-the-king-of-mythical-beasts' },
        ops: [],
        aura: { target: SELF, atk: 600 },
      },
    ],
  },

  'chimera-the-flying-mythical-beast': {
    /* Two heads, two attacks — and when it dies it comes apart into both
       halves, the same idea as Valkyrion. Two bodies back on an empty board is
       two thirds of a God, and the Fusion is live again the moment they land. */
    text:
      'Fusion: Gazelle the King of Mythical Beasts + Berfomet. ' +
      'When Fusion Summoned: destroy 1 monster your opponent controls. ' +
      'This card can attack twice each Battle Phase. ' +
      'When this card is destroyed: Special Summon Gazelle the King of Mythical Beasts and Berfomet from your Graveyard.',
    cry: 'Two beasts, one beast!',
    fusionMaterials: ['gazelle-the-king-of-mythical-beasts', 'berfomet'],
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'destroy', target: sel('opp', 'chosen', { count: 1 }) }] },
      {
        /* A permanent extra attack is a property, not a summon bonus — written
           as an `extraAttacks` op it was lost the moment the card was revived
           and stacked when it was not. */
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, grants: ['doubleAttack'] },
      },
      {
        /* `onDestroyed`, not `onSentToGrave`. The card says "destroyed", and
           on the wider trigger it also fired when Chimera was *tributed* — so
           tributing it towards a God put Gazelle and Berfomet back on the
           board while the summon was still being paid for, and the summon
           then landed on a zone that had just refilled. */
        trigger: 'onDestroyed',
        ops: [
          {
            op: 'specialSummon',
            from: 'grave',
            filter: { slugs: ['gazelle-the-king-of-mythical-beasts', 'berfomet'] },
            count: 2,
            position: 'atk',
          },
        ],
      },
    ],
  },

  'big-shield-gardna': {
    /* A wall, and only a wall — proof against battle and nothing else.
       Immunity to *both* battle and card effects is a God's privilege: a
       monster nothing on either axis can remove is not a wall, it is a
       stalemate, and the only honest answer to it would be having no answer.
       A Dark Hole or a Mirror Force takes it now, which is the counterplay
       that makes 2600 DEF fair rather than final. */
    text: 'This card cannot be destroyed by battle.',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, grants: ['indestructibleByBattle'] },
      },
    ],
  },

  'buster-blader': {
    /* Two auras because the count spans two pools and `per` reads one. Against
       seven of the eleven decks he was a vanilla 2600 — the Graveyard is where
       the dragons he has already beaten are, and counting them is what makes
       him the reason Kaiba loses rather than a large Warrior. */
    text: 'This card gains 800 ATK for each Dragon on the field and in either Graveyard.',
    cry: 'Dragons fall before me!',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, per: { zone: 'field', filter: { type: 'Dragon' }, atk: 800 } },
      },
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, per: { zone: 'eitherGrave', filter: { type: 'Dragon' }, atk: 800 } },
      },
    ],
  },

  'catapult-turtle': {
    /* A flat 1000 was the one card in this deck that ignored everything else
       in it. Worth what it throws, it is the finish: stand the court up, buff
       them, and fire one across the field.

       A God is not ammunition. Slifer with a full hand is worth more damage
       than a duel has Life Points, and firing the thing three bodies paid for
       is not a play anybody would call anime-accurate. */
    text:
      'Once per turn: Tribute 1 monster you control, except a Divine-Beast, ' +
      "to inflict damage equal to that monster's ATK to your opponent.",
    cry: 'Launch!',
    effects: [
      {
        trigger: 'ignition',
        label: 'Catapult — launch a monster',
        oncePerTurn: true,
        cost: { tribute: 1, tributeFilter: { excludeType: 'Divine-Beast' } },
        ops: [{ op: 'damage', scale: 'tributedAtk', to: 'opp' }],
      },
    ],
  },

  /* ================================================================ */
  /* Weevil                                                            */
  /* ================================================================ */

  'petit-moth': {
    /* It fetches its own shell. A 300/200 body asked to survive two End
       Phases naked never reached rung two in real play; summoning it now
       puts the Cocoon in hand, and the Cocoon shields it while it climbs. */
    text: 'When this card is summoned: add "Cocoon of Evolution" from your Deck to your hand. Gains 1 Evolution Counter during each of your End Phases. At 2 counters it becomes Larvae Moth, at 3 Great Moth, and at 4 the Perfectly Ultimate Great Moth.',
    cry: 'My insect will evolve!',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'search', filter: { slugs: ['cocoon-of-evolution'] } }] },
      { trigger: 'onOwnTurnEnd', ops: [{ op: 'addCounter', amount: 1 }] },
    ],
  },

  'larvae-moth': {
    text: 'Continues to evolve during each of your End Phases. When this card is summoned: inflict 300 damage to your opponent.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'damage', amount: 300, to: 'opp' }] },
      { trigger: 'onOwnTurnEnd', ops: [{ op: 'addCounter', amount: 1 }] },
    ],
  },

  'great-moth': {
    text: 'Inflicts piercing battle damage and cannot be destroyed by battle. Gains 1 Evolution Counter during each of your End Phases; at 4 it becomes the Perfectly Ultimate Great Moth.',
    cry: 'The cocoon opens!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'pierce', duration: 'permanent' },
          // The old text promised immunity to anything under 2000 ATK and the
          // card did not have it at all. Straight battle immunity is what a
          // four-turn evolution deserves, and now the text is true.
          { op: 'indestructibleByBattle', duration: 'permanent' },
        ],
      },
      { trigger: 'onOwnTurnEnd', ops: [{ op: 'addCounter', amount: 1 }] },
    ],
  },

  'perfectly-ultimate-great-moth': {
    /* Two trims that keep it the apex without keeping it unanswerable.
       `untargetable` in this engine skips EVERY opposing effect — Dark Hole,
       Mirror Force, Ring — so four End Phases of patience bought a monster
       with no answers at all; effect-indestructibility still shrugs off
       removal while leaving it targetable (a Shadow Spell can bind it, a
       Brain Control can borrow it — which is comedy worth having). And the
       second attack belongs to the swarm: alone it strikes once, over its
       hive it strikes twice. */
    text: 'Cannot be destroyed by card effects. Inflicts piercing battle damage, and while you control another Insect it can attack twice each Battle Phase. When summoned: destroy every Spell and Trap on the field.',
    cry: 'Behold, the ultimate insect!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'indestructibleByEffect', duration: 'permanent' },
          { op: 'pierce', duration: 'permanent' },
          { op: 'destroy', target: sel('both', 'all', { zone: 'backrow' }) },
        ],
      },
      {
        trigger: 'continuous',
        condition: { controlsOtherOfType: 'Insect' },
        ops: [],
        aura: { target: SELF, grants: ['doubleAttack'] },
      },
    ],
  },

  'cocoon-of-evolution': {
    /* Granted permanently on summon, so a Cocoon that had been bounced back and
       replayed, or revived, carried immunity it should have lost. It holds while
       the card is on the field, which is what the text says.
       And it finally does its job: the strategy blurb has said "cocoon your
       larva" since the first commit, and the card never touched the larva —
       the shell now shields the moths still climbing the ladder. */
    text: 'While this card is face-up, it and your Petit Moth and Larvae Moth cannot be destroyed by battle.',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['indestructibleByBattle'] } },
      {
        trigger: 'continuous',
        ops: [],
        aura: {
          target: sel('own', 'all', { filter: { slugs: ['petit-moth', 'larvae-moth'] } }),
          grants: ['indestructibleByBattle'],
        },
      },
    ],
  },

  'hercules-beetle': {
    text: 'While face-up, all monsters your opponent controls lose 500 ATK.',
    effects: [{ trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -500 } }],
  },

  'killer-needle': {
    text: 'When this card inflicts battle damage: inflict an additional 500 damage to your opponent.',
    effects: [{ trigger: 'onDealBattleDamage', ops: [{ op: 'damage', amount: 500, to: 'opp' }] }],
  },

  'basic-insect': {
    text: 'All Insect monsters you control gain 200 ATK.',
    effects: [{ trigger: 'continuous', ops: [], aura: { target: sel('own', 'all', { filter: { type: 'Insect' } }), atk: 200 } }],
  },

  kuwagata: {
    text: 'When this card is summoned: draw 1 card. This card inflicts piercing battle damage.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'draw', count: 1, who: 'own' },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'flying-kamakiri-1': {
    text: 'When this card is sent to the Graveyard: add the strongest Insect monster from your Deck to your hand.',
    effects: [{ trigger: 'onSentToGrave', ops: [{ op: 'search', filter: { type: 'Insect' } }] }],
  },

  'parasite-paracide': {
    text: 'When this card is summoned: your opponent sends the top 3 cards of their Deck to the Graveyard and discards 1 random card.',
    cry: 'My parasite is inside your deck!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'mill', count: 3, who: 'opp' },
          { op: 'discard', count: 1, who: 'opp' },
        ],
      },
    ],
  },

  'insect-soldiers-of-the-sky': {
    /* The Winged Beast clause had no effect behind it at all — a sentence
       from the printed card that this engine cannot express per-battle. It
       flies with the swarm instead: a real, live wording the aura system
       backs. */
    text: 'While you control another Insect, this card gains 300 ATK. When summoned: draw 1 card.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] },
      {
        trigger: 'continuous',
        condition: { controlsOtherOfType: 'Insect' },
        ops: [],
        aura: { target: SELF, atk: 300 },
      },
    ],
  },

  leghul: {
    text: 'This card can attack your opponent directly.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'directAttack', duration: 'permanent' }] }],
  },

  'man-eating-treasure-chest': {
    text: 'When this card inflicts battle damage: your opponent sends the top 2 cards of their Deck to the Graveyard.',
    effects: [{ trigger: 'onDealBattleDamage', ops: [{ op: 'mill', count: 2, who: 'opp' }] }],
  },

  /* ================================================================ */
  /* Rex                                                               */
  /* ================================================================ */

  'two-headed-king-rex': {
    text: 'This card can attack twice each Battle Phase and gains 300 ATK for each Dinosaur in your Graveyard.',
    cry: 'Tear them apart!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'extraAttacks', count: 1 }],
      },
      /* "for each Dinosaur in your Graveyard" — the old scale counted every
         card there regardless of type, so Rex's signature monster was both
         frozen at summon time and reading the wrong number. 300 a fossil now:
         at 200 the king needed FIVE dead dinosaurs just to stand level with
         a one-tribute Summoned Skull, in a deck whose fuel arrives at the
         pace of its own funerals. Three fossils is a 2500 double-attacker —
         the payoff lands inside a real duel's length. */
      {
        trigger: 'continuous',
        ops: [],
        aura: {
          target: { side: 'own', pick: 'self' },
          per: { zone: 'ownGrave', filter: { type: 'Dinosaur' }, atk: 300 },
        },
      },
    ],
  },

  'serpent-night-dragon': {
    text: 'When this card is summoned: destroy 1 monster your opponent controls. This card inflicts piercing battle damage.',
    effects: [
      {
        trigger: 'onSummon',
        targets: 1,
        ops: [
          { op: 'pierce', duration: 'permanent' },
          { op: 'destroy', target: OPP_PICK },
        ],
      },
    ],
  },

  uraby: {
    text: 'This card inflicts piercing battle damage. When it destroys a monster in battle: it gains 300 ATK permanently.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'pierce', duration: 'permanent' }] },
      { trigger: 'onBattleDestroy', ops: [{ op: 'gainAtk', amount: 300, target: SELF, duration: 'permanent' }] },
    ],
  },

  'crawling-dragon': {
    /* 1600 reaches the herd the reviver exists for — Two-Headed King Rex and
       Uraby are both 1500-1600 printed, and both were just out of reach. In
       Attack Position, because a revived King Rex is there to swing. */
    text: 'When this card is summoned: Special Summon 1 Dinosaur with 1600 or less ATK from your Graveyard in Attack Position.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'specialSummon', from: 'grave', filter: { type: 'Dinosaur', maxAtk: 1600 }, count: 1, position: 'atk' }] },
    ],
  },

  'crawling-dragon-2': {
    text: 'This card gains 200 ATK for each card in your Graveyard.',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: { side: 'own', pick: 'self' }, per: { zone: 'ownGrave', atk: 200 } },
      },
    ],
  },

  'sword-arm-of-dragon': {
    /* The old text promised immunity to monsters "of 1800 or less ATK" — a
       threshold the engine has no concept of, so what it actually did was make
       a 1750 ATK monster permanently unkillable in battle. A cut-off of 1800 on
       a body of 1750 says almost nothing anyway. It grows instead, which is
       what a dinosaur with a sword for an arm ought to do. */
    text: 'This card inflicts piercing battle damage, and gains 400 ATK each time it destroys a monster in battle.',
    cry: 'Cut them down!',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'pierce', duration: 'permanent' }] },
      {
        trigger: 'onBattleDestroy',
        ops: [{ op: 'gainAtk', amount: 400, target: SELF, duration: 'permanent' }],
      },
    ],
  },

  megazowler: {
    /* The stampede tramples what hides on the ground — face-down monsters.
       It used to take the Spell/Trap Zone too, which was a one-tribute
       Feather Duster stapled to a body: removal that won duels the fossil
       theme never took part in. The backrow is the traps' business now. */
    text: 'When this card is summoned: destroy every face-down monster your opponent controls.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'destroy', target: sel('opp', 'all', { filter: { face: 'down' } }) }],
      },
    ],
  },

  trakodon: {
    /* The fossil pile is the deck's mana, and nothing was filling it on
       purpose. Trakodon buries three of its own on arrival — every Dinosaur
       among them is +300 on a standing King Rex immediately, read live. */
    text: 'When this card is summoned: send the top 3 cards of your Deck to the Graveyard and inflict 400 damage to your opponent.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'mill', count: 3, who: 'own' },
          { op: 'damage', amount: 400, to: 'opp' },
        ],
      },
    ],
  },

  anthrosaurus: {
    text: 'When this card is destroyed by battle: Special Summon 1 Dinosaur from your Graveyard.',
    effects: [
      { trigger: 'onDestroyedByBattle', ops: [{ op: 'specialSummon', from: 'grave', filter: { type: 'Dinosaur' }, count: 1, position: 'atk' }] },
    ],
  },

  'mad-sword-beast': {
    text: 'This card inflicts piercing battle damage. When it attacks, it gains 500 ATK until the end of the turn.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'pierce', duration: 'permanent' }] },
      { trigger: 'onDeclareAttack', ops: [{ op: 'gainAtk', amount: 500, target: SELF, duration: 'turn' }] },
    ],
  },

  sabersaurus: {
    text: 'When this card is summoned: it can attack directly this turn.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'directAttack', duration: 'turn' }] }],
  },

  /* ================================================================ */
  /* Bandit Keith                                                      */
  /* ================================================================ */

  'barrel-dragon': {
    text: 'Once per turn: flip a coin. Heads — destroy 1 monster your opponent controls and inflict 500 damage. Tails — inflict 300 damage to yourself.',
    cry: 'Blowback!',
    effects: [
      {
        trigger: 'ignition',
        label: 'Blowback',
        oncePerTurn: true,
        targets: 1,
        ops: [
          {
            op: 'coinFlip',
            heads: [
              { op: 'destroy', target: OPP_PICK },
              { op: 'damage', amount: 500, to: 'opp' },
            ],
            tails: [{ op: 'damage', amount: 300, to: 'own' }],
          },
        ],
      },
    ],
  },

  'machine-king': {
    text: 'Gains 200 ATK for each Machine monster on the field. When summoned: all Machines you control gain 400 ATK.',
    cry: 'All machines answer to me.',
    effects: [
      /* "Gains 200 ATK for each Machine monster on the field" — *he* gains it,
         and it counts both sides. The old aura handed a flat 200 to every
         Machine you controlled instead, which is a different card: it never
         scaled, and the King himself got the same 200 whether he stood alone or
         led an army. Counting reads printed types, never effective stats, so
         a Machine counting Machines cannot recurse. */
      {
        trigger: 'continuous',
        ops: [],
        aura: {
          target: { side: 'own', pick: 'self' },
          per: { zone: 'field', filter: { type: 'Machine' }, atk: 200 },
        },
      },
      {
        trigger: 'onSummon',
        ops: [{ op: 'gainAtk', amount: 400, target: sel('own', 'all', { filter: { type: 'Machine' } }), duration: 'permanent' }],
      },
    ],
  },

  metalzoa: {
    text: 'When this card is summoned: destroy every Spell and Trap your opponent controls. This card inflicts piercing battle damage and cannot be destroyed by battle.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'destroy', target: sel('opp', 'all', { zone: 'backrow' }) },
          { op: 'pierce', duration: 'permanent' },
          { op: 'indestructibleByBattle', duration: 'permanent' },
        ],
      },
    ],
  },

  zoa: {
    /* The anime beat, finally in the game: Keith seals Zoa in Metalmorph and
       it rises as Metalzoa. The old effect was a text/op mismatch — "gains
       that monster's ATK" over a flat 400 — on a card whose whole identity
       was always the transformation. Tribute the beast, call the metal. */
    text: 'Once per turn: tribute this card — Special Summon "Metalzoa" from your hand or Deck.',
    cry: 'Witness the metal rebirth!',
    effects: [
      {
        trigger: 'ignition',
        label: 'Metalmorph — become Metalzoa',
        cost: { tributeSelf: true },
        ops: [
          {
            op: 'specialSummon',
            from: ['hand', 'deck'],
            filter: { slugs: ['metalzoa'] },
            count: 1,
            position: 'atk',
          },
        ],
      },
    ],
  },

  'slot-machine': {
    /* The reels keep what they pay. The old +300/pip lasted "until the end of
       the turn" — rolled in your own Main Phase, it evaporated before the
       opponent ever swung back, a stat that only existed while nobody could
       touch it. (`duration: 'opponentTurn'` is declared in the DSL and
       implemented by nothing — endOfTurnCleanup zeroes every turn mod for
       both players — so the honest choices were new expiry machinery or a
       smaller number that stays.) Permanent at 200 a pip, each spin ratchets:
       a two-tribute body that grows every turn it stands is a machine worth
       feeding. */
    text: 'Once per turn: roll a die. This card permanently gains 200 ATK for each pip.',
    cry: 'Jackpot!',
    effects: [
      {
        trigger: 'ignition',
        label: 'Spin the reels',
        oncePerTurn: true,
        ops: [{ op: 'diceRoll', perPip: [{ op: 'gainAtk', amount: 200, target: SELF, duration: 'permanent' }] }],
      },
    ],
  },

  'blast-sphere': {
    text: 'When this card is destroyed by battle: destroy the monster that destroyed it and inflict damage equal to that monster\'s ATK.',
    cry: 'Self destruct!',
    effects: [
      {
        trigger: 'onDestroyedByBattle',
        ops: [
          { op: 'damage', scale: 'targetAtk', to: 'opp' },
          { op: 'destroy', target: sel('opp', 'attacker') },
        ],
      },
    ],
  },

  'launcher-spider': {
    text: 'This card can attack all monsters your opponent controls once each.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'attackAllMonsters' }] }],
  },

  'pendulum-machine': {
    text: 'This card cannot be destroyed by battle and inflicts piercing battle damage.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'indestructibleByBattle', duration: 'permanent' },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'cannon-soldier': {
    text: 'Once per turn, tribute 1 other monster you control: inflict 800 damage to your opponent.',
    effects: [
      {
        trigger: 'ignition',
        label: 'Tribute 1: 800 damage',
        oncePerTurn: true,
        cost: { tribute: 1 },
        ops: [{ op: 'damage', amount: 800, to: 'opp' }],
      },
    ],
  },

  'robotic-knight': {
    /* The commander carries Bandit Keith's whole Duelist Kingdom boast: his
       machines shrugged off magic. While the knight stands, the *other*
       Machines cannot be destroyed by card effects — one immunity axis, so
       battle still breaks them and the house rule holds; and "other", so the
       knight himself is always the answerable head of the formation. */
    text: 'All Machine monsters you control gain 300 ATK, and your other Machines cannot be destroyed by card effects.',
    cry: 'Metal does not break.',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: sel('own', 'all', { filter: { type: 'Machine' } }), atk: 300 } },
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { type: 'Machine' }, excludeSelf: true }), grants: ['indestructibleByEffect'] },
      },
    ],
  },

  mechanicalchaser: {
    text: 'This card can attack twice each Battle Phase.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'extraAttacks', count: 1 }] }],
  },

  'giant-rat': {
    text: 'When this card is sent to the Graveyard: add the strongest EARTH monster with 1500 or less ATK from your Deck to your hand.',
    effects: [{ trigger: 'onSentToGrave', ops: [{ op: 'search', filter: { attribute: 'EARTH', maxAtk: 1500 } }] }],
  },

  'steel-ogre-grotto-1': {
    /* Two lies in one text, both retired: "gains 400 DEF each time it
       survives" had no effect behind it, and the battle immunity it really
       had was permanent from summon — held even standing alone. The armour
       is the assembly line's now: a live conditional aura, so the wall holds
       exactly while another Machine stands beside it. */
    text: 'While you control another Machine, this card cannot be destroyed by battle. When summoned: gain 600 Life Points.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'heal', amount: 600, to: 'own' }],
      },
      {
        trigger: 'continuous',
        condition: { controlsOtherOfType: 'Machine' },
        ops: [],
        aura: { target: SELF, grants: ['indestructibleByBattle'] },
      },
    ],
  },

  'ground-attacker-bugroth': {
    /* The old text promised a conditional direct attack that nothing
       implemented — "if they control no monsters" is when EVERY monster
       attacks directly, so the clause was vacuous twice over. It says what
       it does now. */
    text: 'When this card attacks: it gains 400 ATK until the end of the turn.',
    effects: [{ trigger: 'onDeclareAttack', ops: [{ op: 'gainAtk', amount: 400, target: SELF, duration: 'turn' }] }],
  },

  /* ---------------------------------------------------------------- */
  /* Yami Marik — the torture chamber, and the Sun Dragon it feeds     */
  /* ---------------------------------------------------------------- */

  'the-winged-dragon-of-ra': {
    /* The second God, and deliberately the opposite of the first. Slifer is
       worth whatever is left in your *hand*, so he shrinks as you develop;
       Ra is worth whatever you put on the *board* and then spent. One God
       rewards holding back, the other rewards committing everything — and
       both cost the same three bodies.

       The printed "?" stats come through as -1, so the floor is 0 and the
       monsters Tributed are the whole of the number. */
    atkOverride: 0,
    defOverride: 0,
    statsFromTributes: true,
    text:
      'Requires 3 Tributes. This card\'s ATK and DEF become the combined ATK and DEF of the monsters Tributed to Summon it. ' +
      'This card gains 300 ATK for each monster in your Graveyard. ' +
      'Once per turn: pay 1000 Life Points; destroy every monster your opponent controls. ' +
      "This card cannot be targeted by your opponent's card effects. " +
      "A God is above everything: this card's attacks and effects ignore your opponent's protections. " +
      'If this card is Special Summoned, it returns to the Graveyard at the end of that turn.',
    cry: 'The sun itself answers!',
    effects: [
      {
        /* Untargetable like Slifer — the God privilege, and the reason the
           only answer to one is a bigger body. `summonSick` is the price of
           that: Ra hatches out of Sphere Mode, so the turn it lands is the
           turn its owner is given nothing, and the other player gets one
           full turn to find an answer to a monster they cannot touch. That
           is the same lever that brought Pegasus home — nerf the clock, not
           the number. No pierce: a God does not pierce, so putting a body in
           the way really is an answer, which is what the torture engine
           below exists to punish. */
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, grants: ['untargetable'] },
      },
      {
        /* Slifer counts what is still in your hand and shrinks as you spend
           it; Ra counts what you have already lost and grows as you are
           ground down. Two Gods, one register, opposite directions — and it
           is what makes paying three bodies worth doing, because the three
           you paid are in the Graveyard feeding it a moment later. */
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, per: { zone: 'ownGrave', filter: { kind: 'monster' }, atk: 300 } },
      },
      {
        /* The God Phoenix. Ra rises out of the Graveyard as a bird of fire in
           the anime and burns the field clean; here it is the reason paying
           three bodies for the God is worth it at all. Marik's deck has no
           other removal to speak of, while the deck it has to face carries
           Mirror Force, Magical Hats, Spellbinding Circle, Swords of Revealing
           Light and Dark Hole. A God's effect ignores protections, so this
           really does clear the board. */
        trigger: 'ignition',
        label: 'God Phoenix — pay 1000, burn the field clean',
        oncePerTurn: true,
        cost: { lp: 1000 },
        ops: [{ op: 'destroy', target: OPP_ALL }],
      },
    ],
  },

  bowganian: {
    /* The engine of the whole deck, and it sits in the Monster Zone on
       purpose: `onOwnTurnStart` only ever fires for monsters, and with a
       single Spell/Trap Zone a backrow full of tickers could never have
       existed anyway.

       It brings its twin, which is Queen's Knight's trick and the reason
       Yami Yugi's board is three bodies deep off one card: measured against
       him, Marik held 1.72 monsters at turn six and had *no* free summons at
       all — every body cost a card and the one Normal Summon a turn. Two
       crossbows is 2400 a turn and, more importantly, two thirds of the
       Tributes the God needs.

       `onNormalSummon`, so the copy it fetches cannot fetch another: the
       chain is one link long by construction rather than by counting the
       deck. */
    text: "When this card is Normal Summoned: Special Summon 1 'Bowganian' from your Deck. While you control another Bowganian, this card gains 800 ATK and cannot be destroyed by battle. At the start of your turn: inflict 1100 damage to your opponent.",
    cry: 'The bolt finds you again.',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [{ op: 'specialSummon', from: 'deck', side: 'own', filter: { slugs: ['bowganian'] }, count: 1, position: 'atk' }],
      },
      {
        /* Gazelle and Berfomet's clause: the pair is worth more than two
           singles, and this card now always arrives in twos. */
        trigger: 'continuous',
        condition: { requiresOnField: 'bowganian' },
        ops: [],
        /* Battle immunity only — the one axis a mortal card is allowed, per
           the rule that only a God is proof against both. Card effects still
           break the pair, which is the counterplay every deck can reach, and
           it is why the clock is worth building around rather than merely
           worth playing. */
        aura: { target: SELF, atk: 800, grants: ['indestructibleByBattle'] },
      },
      { trigger: 'onOwnTurnStart', ops: [{ op: 'damage', amount: 1100, to: 'opp' }] },
    ],
  },

  'revival-jam': {
    /* It does not stay dead, which is three things at once here: a wall that
       cannot be cleared, a body that is always available for Ra's three, and
       — with Coffin Seller face-up — a repeating 800 to the face every time
       the opponent breaks it. */
    /* Once per turn, and the limit is the card working rather than the card
       being nerfed: without it, a Revival Jam facing Slifer's second mouth
       revives into the very effect that killed it, forever — the pair
       overflowed the call stack the first time this deck was benched against
       Yami's. The engine carries a depth backstop for the general case; a
       card that can obviously loop should still carry its own limit. */
    text: 'While you control a Fiend monster, this card gains 800 ATK. Once per turn, when this card is destroyed: Special Summon it and 1 other monster with 1500 or less ATK from your Graveyard, both in face-up Defense Position.',
    cry: 'You cannot kill what will not die.',
    effects: [
      {
        /* Beta the Magnet Warrior's clause, which is the shape of every buff
           in Yami Yugi's deck: a live condition on the board, paid while the
           theme is assembled. A 1500 that keeps coming back is a speed bump;
           2300 that keeps coming back is a wall. */
        trigger: 'continuous',
        condition: { controlsOtherOfType: 'Fiend' },
        ops: [],
        aura: { target: SELF, atk: 800 },
      },
      {
        trigger: 'onDestroyed',
        oncePerTurn: true,
        ops: [
          { op: 'specialSummon', from: 'grave', side: 'own', filter: { slugs: ['revival-jam'] }, count: 1, position: 'def', includeSelf: true },
          /* Removal becomes income: the opponent breaking his board is how
             Marik rebuilds it. `oncePerTurn` is keyed by slug, so two copies
             share one revival a turn and the A-revives-B-revives-A shape is
             closed along with the original Slifer loop. */
          { op: 'specialSummon', from: 'grave', side: 'own', filter: { kind: 'monster', maxAtk: 1500 }, count: 1, position: 'def' },
        ],
      },
    ],
  },

  'viser-des': {
    /* The enabler that finds itself — the rule every deck here follows. A
       500 ATK body is nothing on its own; what it does is make the next step
       visible, which is also how the generic AI pilots a combo nobody has
       told it about. */
    /* The enabler that finds itself, and the God is part of what it finds.
       Instrumenting real duels said Ra reached the field in 0 of 24 — one
       copy in twenty-five cards, in duels that end around turn ten, is a
       signature card nobody ever sees. Every other deck here searches its
       hinge (Toon Alligator finds Toon World, Baby Dragon finds Time Wizard,
       Lord of D. finds the Flute); the God deck was hoping to draw it. */
    text: "When this card is Normal Summoned: add 1 'The Winged Dragon of Ra', 'Bowganian', 'Nightmare Wheel' or 'Coffin Seller' from your Deck to your hand, then Special Summon 1 'Viser Des' from your Deck or Graveyard in face-up Defence Position.",
    cry: 'Into the vise.',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'search', filter: { slugs: ['the-winged-dragon-of-ra', 'bowganian', 'nightmare-wheel', 'coffin-seller'] } },
          /* The fetched copy arrives by *Special* Summon, so it fires
             `onSummon` and not `onNormalSummon` — it neither searches again
             nor reaches for a third. The chain is one link by construction. */
          /* Face-up Defence, like the Metal Reflect Slime's tokens: the twin is
             a body to Tribute for the God, not a 500 ATK attacker, and standing
             it up in Attack only fed it to the first thing that swung. */
          { op: 'specialSummon', from: ['deck', 'grave'], side: 'own', filter: { slugs: ['viser-des'] }, count: 1, position: 'def' },
        ],
      },
    ],
  },

  'legendary-fiend': {
    text: 'At the start of your turn: this card gains 700 ATK.',
    cry: 'Every hour, stronger.',
    effects: [{ trigger: 'onOwnTurnStart', ops: [{ op: 'gainAtk', amount: 700, target: SELF, duration: 'permanent' }] }],
  },

  'dark-jeroid': {
    text: 'When this card is Summoned: 1 monster your opponent controls loses 1500 ATK.',
    cry: 'Wither.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'gainAtk', amount: -1500, target: sel('opp', 'strongest'), duration: 'permanent' }],
      },
    ],
  },

  granadora: {
    /* Marik's whole register in one card: take something now, pay for it
       later, and the paying is not optional.
     *
     * The bargain had no upside, which is the one thing a bargain must have.
     * Reported exactly: "it's just too weak to cost ultimately 1000LP for a
     * 1900atk monster in this format with nothing extra" — and the
     * arithmetic was that blunt, +1000 on arrival against −2000 on death, so
     * a four-star vanilla body charged its owner a net 1000 Life Points for
     * the privilege. That is a printed drawback card in a game whose whole
     * register is over anime OP.
     *
     * So the loan pays interest, and it collects it from across the table:
     * every one of Marik's turns the lizard drains 800 out of the opponent
     * and puts it in his own pocket, which is a 1600-point swing a turn on a
     * card that also gave 1000 up front. The 2000 bill stays, because the
     * Faustian shape *is* the card and because it is what the opponent buys
     * when they finally break it — but one turn of life now clears it, which
     * is the difference between a bargain and a tax. The first draft drained
     * 500 and was still net negative after a turn, which is the same mistake
     * one size smaller.
     *
     * It is also the deck's second clock. Bowganian bleeds them on a timer;
     * this one bleeds them *and* heals him, which is the torture chamber
     * sustaining its keeper — and both are answerable the same way, by
     * killing the small body doing it. */
    text:
      'When this card is Summoned: gain 1000 Life Points. ' +
      'At the start of your turn: inflict 800 damage to your opponent and gain 800 Life Points. ' +
      'When this card is destroyed: take 2000 damage.',
    cry: 'A loan, and the interest is yours to pay.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'heal', amount: 1000, to: 'own' }] },
      {
        trigger: 'onOwnTurnStart',
        ops: [
          { op: 'damage', amount: 800, to: 'opp' },
          { op: 'heal', amount: 800, to: 'own' },
        ],
      },
      /* `onDestroyed`, not `onSentToGrave`: Tributing it towards Ra is
         spending it, not losing it, and charging the bill for the God's own
         summon was taxing the play the card exists to enable. */
      { trigger: 'onDestroyed', ops: [{ op: 'damage', amount: 2000, to: 'own' }] },
    ],
  },

  'masked-beast-des-gardius': {
    /* The mask outlives the beast: 3300 is the biggest body in the deck and
       therefore the best single Tribute for Ra, and spending it hands you
       one of their monsters — which is another body for the same summon. */
    text: 'When this card leaves the field: take control of 1 monster your opponent controls.',
    cry: 'The mask chooses its next face.',
    effects: [
      {
        trigger: 'onSentToGrave',
        ops: [{ op: 'takeControl', target: sel('opp', 'strongest'), duration: 'permanent' }],
      },
    ],
  },

  drillago: {
    /* The answer to the answer. A God that cannot pierce is walled by any
       body in Defence, so the deck carries one drill of its own — this is
       the card that makes hiding behind a 3000 DEF wall cost real Life
       Points. */
    text: 'This card inflicts piercing battle damage.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'pierce', duration: 'permanent' }] }],
  },

  'melchid-the-four-face-beast': {
    /* The torture chamber is staffed by Fiends, and a deck of 1500s loses
       every race it enters. The mask lifts the whole cell block rather than
       only itself — a live condition on the board, which is the shape every
       theme here is supposed to have. */
    text: 'All monsters you control gain 500 ATK.',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all'), atk: 500 },
      },
    ],
  },

  juragedo: {
    text: 'When this card is destroyed by battle: gain 1000 Life Points.',
    effects: [{ trigger: 'onDestroyedByBattle', ops: [{ op: 'heal', amount: 1000, to: 'own' }] }],
  },

  helpoemer: {
    /* Gamma the Magnet Warrior's clause. Helpoemer costs a Tribute to put
       down, and arriving hands the Tribute straight back out of the
       Graveyard — which in this deck is where its small bodies always are,
       because the deck is built around them dying. */
    text: 'When this card is Summoned: Special Summon 1 monster with 1500 or less ATK from your Graveyard. When this card is sent to the Graveyard: your opponent discards 1 card.',
    cry: 'From the grave, I still take from you.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'specialSummon', from: 'grave', side: 'own', filter: { kind: 'monster', maxAtk: 1500 }, count: 1, position: 'atk' }],
      },
      { trigger: 'onSentToGrave', ops: [{ op: 'discard', count: 1, who: 'opp' }] },
    ],
  },

  /* ================================================================ */
  /* Priest Seto                                                       */
  /* ================================================================ */

  'obelisk-the-tormentor': {
    /* The third God, and the one that does not scale at all.
     *
     * Slifer is worth whatever is still in your *hand*, so he shrinks as you
     * develop. Ra is worth whatever you put on the board and then spent, so he
     * grows as you are ground down. Obelisk is the constant: a flat 4000 that
     * neither swells nor withers, and the only God whose printed stats are real
     * numbers rather than a "?" — no override, unlike the other two.
     *
     * Its power is not in the body, it is in what the body will spend. The Fist
     * of Fate eats two of your own monsters and erases their field, and the
     * souls it ate come out the other side as damage. That is what keeps it
     * from being a re-skin of Ra's God Phoenix, which is the one thing a third
     * God had to avoid: Ra pays Life Points and sweeps, Obelisk pays BODIES and
     * sweeps *and* burns for exactly what those bodies were worth. The deck
     * around it therefore wants a wide, cheap board rather than a full hand or
     * a full Graveyard — a third shape for a third God.
     */
    text:
      'Requires 3 Tributes. ' +
      'Once per turn: Tribute 2 monsters you control, except a Divine-Beast; ' +
      'destroy every monster your opponent controls and inflict damage equal to their combined ATK. ' +
      "This card cannot be targeted by your opponent's card effects. " +
      "A God is above everything: this card's attacks and effects ignore your opponent's protections. " +
      'This card cannot attack the turn it is Summoned. ' +
      'If this card is Special Summoned, it returns to the Graveyard at the end of that turn.',
    cry: 'Obelisk — Fist of Fate!',
    effects: [
      {
        /* The God privilege, and the same clock Ra carries. `summonSick` is
           deliberate and copied on purpose: a 4000 body that swings the turn it
           lands is a two-turn kill, and the lesson already written down here is
           to nerf the clock rather than the number. The turn it arrives is the
           turn the other player is given to find an answer to something they
           cannot target. No pierce — a God does not pierce, so putting a body
           in the way is a real answer, which is what the Fist exists to punish. */
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, grants: ['untargetable', 'summonSick'] },
      },
      {
        /* Soul energy MAX. The printed Fist of Fate is "Tribute 2 monsters:
           destroy all monsters your opponent controls"; the burn is this game's
           addition and it is what makes the button worth pressing over simply
           attacking. `scale: 'tributedAtk'` sums what was paid, so feeding it
           the fat bodies hurts more than feeding it tokens — the choice of
           *which* two to spend is the play. */
        trigger: 'ignition',
        label: 'Fist of Fate — spend two souls, clear the field',
        oncePerTurn: true,
        cost: { tribute: 2, tributeFilter: { excludeType: 'Divine-Beast' } },
        ops: [
          { op: 'destroy', target: OPP_ALL },
          { op: 'damage', scale: 'tributedAtk', to: 'opp' },
        ],
      },
    ],
  },

  'millennium-seeker': {
    /* The enabler that finds itself, which every deck here has: a 1000 body
       whose whole job is to make the next step visible — to the player, and to
       the AI's enumeration, which can only plan with what it can see in hand. */
    text:
      'When this card is Normal Summoned: add 1 "Obelisk the Tormentor" or "Mound of the Bound Creator" ' +
      'from your Deck to your hand, then Special Summon 1 "Millennium Seeker" from your Deck.',
    cry: 'The Rod shows me where it sleeps.',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'search', filter: { slugs: ['obelisk-the-tormentor', 'mound-of-the-bound-creator'] } },
          /* The fetched twin arrives by Special Summon, so it fires `onSummon`
             and not `onNormalSummon` — no chain, by construction, the same way
             Viser Des is built. Two bodies off one Normal Summon is the shape
             that makes Yami Yugi the deck he is, and it is what makes three
             Tributes payable at all.
             It was three for a while, with a `per: ownField` aura on top so
             the swarm bought its own buff. Measured: 1.74 bodies and 3598 board
             ATK by turn 4, against 1.25 and 2269 for Yami — half again as much
             board, a turn and a half sooner, and 75% on the bench. Three bodies
             on a three-zone field is not a strong opening, it is a finished
             duel, and the self-scaling aura was the Mound's flat buff counted a
             second time on a swarm the same card had just made. */
          { op: 'specialSummon', from: 'deck', side: 'own', filter: { slugs: ['millennium-seeker'] }, count: 1, position: 'atk' },
        ],
      },
    ],
  },

  'double-coston': {
    /* The printed card counts as two Tributes for a DARK monster, and this is
       the line that makes Obelisk reachable without a perfect board.
       "Counts as two" is *said* the printed way and *done* one clause over: a
       card that pays double would have to be understood by five separate
       tribute pickers (the interface, the AI, autoplay, the simulator, the
       audit), and this file already records what happens when one rule lives in
       five places. Lightening the God's price instead lives in
       `tributesRequired` alone, which every one of the five already asks — so
       the text says what the engine does and nothing can drift. */
    text:
      'While you control this face-up card, a Divine-Beast monster you Tribute Summon requires 1 less Tribute. ' +
      'While you control another Zombie monster, this card gains 900 ATK.',
    cry: 'Two souls, one body.',
    effects: [
      {
        trigger: 'continuous',
        condition: { controlsOtherOfType: 'Zombie' },
        ops: [],
        aura: { target: SELF, atk: 900 },
      },
    ],
  },

  'pharaoh-s-servant': {
    /* A 900 body that is worth more spent than standing, which is the whole
       deck in one card. It pays on the way out however it leaves — tributed
       for the God, eaten by the Fist, or destroyed — because `onSentToGrave`
       fires for every departure from the field, which is exactly right for a
       card whose text says "sent to the Graveyard". */
    text: 'When this card is sent to the Graveyard from the field: inflict 900 damage to your opponent.',
    cry: 'My life is his to spend.',
    effects: [{ trigger: 'onSentToGrave', ops: [{ op: 'damage', amount: 900, to: 'opp' }] }],
  },

  'newdoria': {
    /* Sacrifice converted into removal, and the reason spending bodies is a
       play rather than a cost. Deliberately `onSentToGrave` and not
       `onDestroyed`: being Tributed for the God is the *intended* way to cash
       it, so it has to pay out on a tribute too. */
    text:
      'When this card is sent to the Graveyard from the field: destroy 1 monster your opponent controls ' +
      'and inflict 300 damage to your opponent.',
    cry: 'I take one with me.',
    effects: [
      {
        trigger: 'onSentToGrave',
        ops: [
          { op: 'destroy', target: OPP_PICK },
          /* The burn is what makes feeding the Fist a *play* rather than a
             price. Two of these eaten by Obelisk is two monsters gone, 1600
             straight off the top, and the Fist's own damage on top of that. */
          { op: 'damage', amount: 300, to: 'opp' },
        ],
      },
    ],
  },

  'aswan-apparition': {
    /* The renewable body. Once per turn, so the Fist cannot be fed from an
       infinite well — the same limit Revival Jam carries, and for the same
       reason: a card that answers its own destruction needs its own ceiling
       rather than relying on the engine's depth backstop. */
    text:
      'Once per turn, when this card is destroyed: Special Summon 1 "Aswan Apparition" from your Deck or Graveyard, ' +
      'then Special Summon 1 "Ka Token" (Fiend/DARK/Level 1/ATK 800/DEF 800).',
    cry: 'The tomb is not empty yet.',
    effects: [
      {
        trigger: 'onDestroyed',
        oncePerTurn: true,
        ops: [
          { op: 'specialSummon', from: ['deck', 'grave'], side: 'own', filter: { slugs: ['aswan-apparition'] }, count: 1, position: 'atk' },
          /* The token is the guarantee. Two Apparitions in the deck means the
             revival can come up empty late, and a card whose whole job is to
             refill the board must never answer a destruction with nothing —
             that is the difference between a resilient deck and a deck that
             only looks resilient in the opening hand. */
          { op: 'summonToken', name: 'Ka Token', atk: 800, def: 800, count: 1, artSlug: 'aswan-apparition', position: 'atk' },
        ],
      },
    ],
    /* Once per turn, so the Fist cannot be fed from an infinite well — the same
       limit Revival Jam carries, and for the same reason: a card that answers
       its own destruction needs its own ceiling rather than relying on the
       engine's depth backstop. */
  },

  'possessed-dark-soul': {
    /* Ka hunting, printed almost as it stands. `tributeSelf` is what makes it
       work at all: the cost is paid before the ops run, so the zone this card
       vacates is the zone the stolen monster lands in — on a full board every
       other theft in the deck silently fizzles, and this one cannot. */
    text: 'Tribute this card: take control of 1 monster your opponent controls with 2000 or less ATK.',
    cry: 'Your ka answers to me now.',
    effects: [
      {
        trigger: 'ignition',
        /* 2500 rather than 1500 reaches almost everything on the roster that is
           not a God or a Fusion — and a stolen body is worth double here,
           because it is one fewer blocker across the table *and* one more soul
           to feed the Fist with. */
        label: 'Tear out their ka',
        cost: { tributeSelf: true },
        ops: [{ op: 'takeControl', target: sel('opp', 'chosen', { filter: { kind: 'monster', maxAtk: 2000 } }), duration: 'permanent' }],
      },
    ],
  },

  /* ================================================================ */
  /* Ishizu                                                            */
  /* ================================================================ */

  'mystical-knight-of-jackal': {
    /* Anubis, who weighs what is left. Her ace, and the reason Necrovalley's
       aura is written for every monster she controls rather than for Fairies:
       the Jackal is a Beast-Warrior, so a Fairy-typed aura would have skipped
       the one card the deck is built to land. A deck whose ace does not
       benefit from its own field is a deck with two themes. */
    text:
      'When this card destroys a monster by battle: send the top 3 cards of your opponent\'s Deck to the Graveyard. ' +
      'While you control another Fairy monster, this card cannot be destroyed by battle.',
    cry: 'Anubis has already weighed you.',
    effects: [
      {
        trigger: 'onBattleDestroy',
        ops: [
          { op: 'mill', count: 3, who: 'opp' },
        ],
      },
      {
        /* "Another Fairy" rather than "another monster": every tomb guardian
           in the deck is a Fairy, so the sentence is the same promise with a
           condition the DSL can actually read — and it says out loud that the
           Jackal is protected by the guard around him, not by himself. */
        trigger: 'continuous',
        condition: { controlsOtherOfType: 'Fairy' },
        ops: [],
        aura: { target: SELF, grants: ['indestructibleByBattle'] },
      },
    ],
  },

  'mudora': {
    /* The guardian who counts the dead. Read live through `aura.per`, so the
       tomb filling up is ATK on the board in the same instant rather than
       stored value — which is the one thing that makes this theme visible to
       an AI that scores stats and is blind to Graveyards. */
    text: 'This card gains 200 ATK for each monster in your Graveyard. When this card is Normal Summoned: send the top 2 cards of your Deck to the Graveyard, then Special Summon 1 "Mudora" from your Deck.',
    cry: 'The dead are counted, and they answer to me.',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, per: { zone: 'ownGrave', filter: { kind: 'monster' }, atk: 200 } },
      },
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'mill', count: 2, who: 'own' },
          /* The mill and the twin are one sentence: four cards buried is 1200
             on every guardian through Necrovalley and 1600 on each Mudora, and
             the second body is what turns that arithmetic into a board. This is
             the deck's whole engine in one Normal Summon — bury, then stand up
             something that got bigger while you were burying. */
          { op: 'specialSummon', from: 'deck', side: 'own', filter: { slugs: ['mudora'] }, count: 1, position: 'atk' },
        ],
      },
    ],
  },

  'keldo': {
    /* The enabler that finds itself: the deck hinges on Necrovalley and cannot
       be left hoping to draw it. */
    text: 'When this card is Normal Summoned: add "Necrovalley" from your Deck to your hand, then Special Summon 1 "Keldo" from your Deck.',
    cry: 'The valley remembers.',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'search', filter: { slugs: ['necrovalley'] } },
          { op: 'specialSummon', from: 'deck', side: 'own', filter: { slugs: ['keldo'] }, count: 1, position: 'atk' },
        ],
      },
    ],
  },

  'kelbek': {
    /* The foretold attack: she has seen the swing coming and the attacker is
       simply sent home. Once per turn on purpose — an unconditional free
       bounce on every attack is an unlimited lock, invisible to the AI's
       evaluate(), and the kind of thing this file already refuses to ship. */
    text: 'Once per turn, when this card is attacked: return the attacking monster to its owner\'s hand.',
    cry: 'That attack was never going to land.',
    effects: [
      {
        trigger: 'onAttacked',
        oncePerTurn: true,
        ops: [
          { op: 'bounce', target: sel('opp', 'attacker') },
        ],
      },
    ],
  },

  'agido': {
    /* Body income out of the tomb, and the second half of the mill engine:
       every guardian that dies makes the next one bigger, so the deck is paid
       for losing as well as for winning. */
    text: 'When this card is sent to the Graveyard from the field: Special Summon 1 "Agido" or "Keldo" from your Deck, and send the top 2 cards of your Deck to the Graveyard.',
    cry: 'One falls, another rises.',
    effects: [
      {
        trigger: 'onSentToGrave',
        oncePerTurn: true,
        ops: [
          { op: 'specialSummon', from: 'deck', side: 'own', filter: { slugs: ['agido', 'keldo'] }, count: 1, position: 'atk' },
          /* Two up and two buried, so losing a guardian makes the survivors
             bigger as well as more numerous. That is the whole promise of a
             tomb deck and it was being paid one card at a time. */
          { op: 'mill', count: 2, who: 'own' },
        ],
      },
    ],
  },

  'zolga': {
    /* The offering. Her biggest guardian, and worth more spent than standing —
       `onSentToGrave` so it pays whether it is Tributed for the Jackal or
       simply destroyed. */
    text: 'When this card is sent to the Graveyard from the field: gain 1500 Life Points and draw 1 card.',
    cry: 'Take what is left of me.',
    effects: [
      {
        trigger: 'onSentToGrave',
        ops: [
          { op: 'heal', amount: 1500, to: 'own' },
          /* A 3500 Life Point swing and a card, for a body that was going to be
             spent anyway. Ishizu's game is the long one — she wins by still
             being there — and the offering is what buys the turns her Graveyard
             needs to fill. */
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  /* ================================================================ */
  /* Odion                                                             */
  /* ================================================================ */

  'ra-s-disciple': {
    /* The enabler that finds itself. Odion's whole deck wants the Temple down,
       and a deck that hopes to draw its hinge is a deck that loses to its own
       shuffle. */
    text: 'When this card is Normal Summoned: add "Temple of the Kings" from your Deck to your hand, then Special Summon 2 "Ra\'s Disciple" from your Deck in Attack Position.',
    cry: 'I keep the forgery, and the faith.',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'search', filter: { slugs: ['temple-of-the-kings'] } },
          /* Two, and in Attack Position. The Temple pays 400 flat plus 300 for
             every monster standing, so three Disciples are 1100 + 400 + 900 =
             2400 each rather than three 1100 bodies hiding in Defence — the
             swarm is the payoff, and a swarm in Defence is invisible to the
             race term the AI actually scores. */
          { op: 'specialSummon', from: 'deck', side: 'own', filter: { slugs: ['ra-s-disciple'] }, count: 2, position: 'atk' },
        ],
      },
    ],
  },

  'mystical-beast-of-serket': {
    /* The captured ka, and the one card in the deck that actually kills.
       Gated on the Temple exactly as the Toons are gated on Toon World —
       `summonRequires` is the one place that decides, and the player, the AI
       and both test drivers all ask it. Take the Temple away and Odion is
       back to being only a wall, which is the counterplay. */
    summonRequires: 'temple-of-the-kings',
    text:
      'Requires "Temple of the Kings". ' +
      'Each time this card destroys a monster by battle, it gains 500 ATK permanently. ' +
      'This card can attack twice during each Battle Phase.',
    cry: 'The scorpion feeds.',
    effects: [
      {
        /* Two swings. The scorpion is the only card in Odion's deck that
           actually kills, and a single 2500 attack a turn is not a win
           condition behind a wall of traps — it is a clock so slow the deck
           loses to time. Two attacks with a body that grows 800 every kill is
           the finisher the traps have been buying turns for. */
        trigger: 'continuous',
        ops: [],
        aura: { target: SELF, grants: ['doubleAttack'] },
      },
      {
        trigger: 'onBattleDestroy',
        ops: [
          { op: 'gainAtk', amount: 500, target: SELF, duration: 'permanent' },
        ],
      },
    ],
  },

  'gravekeeper-s-spy': {
    /* A face-down card that turns out to be a threat — the shape of the whole
       deck, in monster form. */
    text: 'FLIP: Special Summon 2 "Gravekeeper\'s Spy" from your Deck in Attack Position.',
    cry: 'You were watched the whole time.',
    effects: [
      {
        trigger: 'onFlip',
        /* Attack Position, and two of them. A 1200 body is nothing; a 1200 body
           under the Temple standing beside two more is 1200 + 400 + 900 = 2500,
           three times over. Every one of Odion's summons had been putting cards
           down in Defence, which is exactly the shape of deck that never
           closes a duel out. */
        ops: [{ op: 'specialSummon', from: 'deck', side: 'own', filter: { slugs: ['gravekeeper-s-spy'] }, count: 2, position: 'atk' }],
      },
    ],
  },

  'mask-of-darkness': {
    /* Trap recursion. In this deck the traps ARE the bodies, so getting one
       back is getting a monster back. */
    text: 'FLIP: add 1 Trap Card from your Graveyard to your hand.',
    cry: 'Nothing is ever really spent.',
    effects: [
      {
        trigger: 'onFlip',
        ops: [
          { op: 'stealFromGrave', from: 'own', filter: { kind: 'trap' } },
        ],
      },
    ],
  },

  'wall-of-illusion': {
    /* The shield's shield: anything that hits it is sent home. Odion does not
       open, he answers, and this is the cheapest answer in the deck. */
    text: 'When this card is attacked: return the attacking monster to its owner\'s hand after the damage step and inflict 600 damage to your opponent.',
    cry: 'A shield does not need to strike back.',
    effects: [
      {
        trigger: 'onAttacked',
        ops: [
          { op: 'bounce', target: sel('opp', 'attacker') },
          { op: 'damage', amount: 600, to: 'opp' },
        ],
      },
    ],
  },

  'guardian-sphinx': {
    /* The trap clog, answered with a monster. Seven traps through a single
       Spell/Trap Zone is the Yami Marik shape and it benched Odion at 28 —
       a face-down trap cannot fire the turn it is Set, so the honest ceiling
       is one per turn cycle and the rest sit in hand. Two of those slots are
       this instead: a card that is face-down like a trap, answers like a trap,
       and is a 2400 wall in the meantime. */
    text: 'FLIP: inflict 400 damage to your opponent for each monster they control, then return every monster your opponent controls to their hand.',
    cry: 'The sphinx wakes, and the field is swept.',
    effects: [
      {
        trigger: 'onFlip',
        /* The damage is read *before* the sweep, because `perOppMonster` counts
           what is standing when the op runs — put the bounce first and the
           burn is always zero. Ops resolve in order, so the order is the
           card. */
        ops: [
          { op: 'damage', amount: 400, scale: 'perOppMonster', to: 'opp' },
          { op: 'bounce', target: OPP_ALL },
        ],
      },
    ],
  },
};
