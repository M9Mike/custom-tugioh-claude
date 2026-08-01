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
  atkOverride?: number;
  defOverride?: number;
  /** Must be face-up on your side before this monster can be Summoned. */
  summonRequires?: string;
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
    text: 'Fusion: 3 × Blue-Eyes White Dragon. When Fusion Summoned: destroy every Spell, Trap and Field card your opponent controls. This card attacks every monster your opponent controls once each and inflicts piercing battle damage.',
    cry: 'Neutron Blast!',
    fusionMaterials: ['blue-eyes-white-dragon', 'blue-eyes-white-dragon', 'blue-eyes-white-dragon'],
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'destroy', target: sel('opp', 'all', { zone: 'spellTrap' }) },
          { op: 'destroy', target: sel('opp', 'all', { zone: 'field' }) },
          { op: 'attackAllMonsters' },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'dark-paladin': {
    text: 'Fusion: Dark Magician + Dark Magician Girl. When Fusion Summoned: negate the effects of every monster your opponent controls. Gains 200 ATK for each card in your Graveyard. Once per turn: destroy 1 Spell or Trap your opponent controls.',
    cry: 'Knight of Dark Magic!',
    fusionMaterials: ['dark-magician', 'dark-magician-girl'],
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'negateEffects', target: OPP_ALL },
          { op: 'gainAtk', scale: 'perCardInGrave', target: SELF, duration: 'permanent' },
        ],
      },
      {
        trigger: 'ignition',
        label: 'Shatter a Spell/Trap',
        oncePerTurn: true,
        targets: 1,
        ops: [{ op: 'destroy', target: sel('opp', 'chosen', { zone: 'spellTrap' }) }],
      },
    ],
  },

  'gaia-the-dragon-champion': {
    text: 'Fusion: Gaia The Fierce Knight + Curse of Dragon. When Fusion Summoned: this card can attack twice each Battle Phase and inflicts piercing battle damage.',
    cry: 'Charge, my champion!',
    fusionMaterials: ['gaia-the-fierce-knight', 'curse-of-dragon'],
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'extraAttacks', count: 1 },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'alligator-s-sword-dragon': {
    text: "Fusion: Alligator's Sword + Baby Dragon. When Fusion Summoned: destroy 1 monster your opponent controls and gain Life Points equal to half its ATK.",
    fusionMaterials: ["alligator-s-sword", 'baby-dragon'],
    effects: [
      {
        trigger: 'onSummon',
        targets: 1,
        ops: [
          { op: 'heal', amount: 700, to: 'own' },
          { op: 'destroy', target: OPP_PICK },
        ],
      },
    ],
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
    text: 'The ultimate wizard in terms of attack and defense. When Summoned: it gains 200 ATK for each card in your Graveyard. Once per turn: destroy every Spell and Trap your opponent controls.',
    cry: 'Dark Magic Attack!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'gainAtk', scale: 'perCardInGrave', target: SELF, duration: 'permanent' }],
      },
      {
        trigger: 'ignition',
        label: 'Dark Magic Attack',
        oncePerTurn: true,
        ops: [
          { op: 'destroy', target: sel('opp', 'all', { zone: 'spellTrap' }) },
          { op: 'destroy', target: sel('opp', 'all', { zone: 'field' }) },
        ],
      },
    ],
  },

  'dark-magician-girl': {
    text: 'Gains 400 ATK for each "Dark Magician" in either Graveyard. When this card destroys a monster in battle: draw 1 card.',
    cry: 'Never underestimate an apprentice!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [{ op: 'gainAtk', scale: 'perCardInGrave', target: SELF, duration: 'permanent' }],
      },
      { trigger: 'onBattleDestroy', ops: [{ op: 'draw', count: 1, who: 'own' }] },
    ],
  },

  'summoned-skull': {
    text: 'When this card is Normal Summoned: inflict 600 damage to your opponent. This card inflicts piercing battle damage.',
    cry: 'Lightning Strike!',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'damage', amount: 600, to: 'opp' },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'gaia-the-fierce-knight': {
    text: 'When this card is summoned: it may attack twice this turn. This card inflicts piercing battle damage.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'extraAttacks', count: 1 },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'curse-of-dragon': {
    text: 'When this card is summoned: destroy 1 Spell or Trap your opponent controls. This card inflicts piercing battle damage.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'destroy', target: sel('opp', 'all', { zone: 'spellTrap' }) },
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
    text: 'While this card is face-up, your other Defense Position monsters cannot be destroyed by battle. When summoned: gain 800 Life Points.',
    cry: 'A gentle light shields us.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'heal', amount: 800, to: 'own' }] },
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { position: 'def' } }), grants: ['indestructibleByBattle'] },
      },
    ],
  },

  'feral-imp': {
    text: 'When this card is summoned: your opponent discards 1 random card.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'discard', count: 1, who: 'opp' }] }],
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
    text: 'If you have all five pieces of the Forbidden One in your hand, you win the Duel immediately. When Normal Summoned: draw 2 cards.',
    cry: 'EXODIA! OBLITERATE!',
    effects: [{ trigger: 'onNormalSummon', ops: [{ op: 'draw', count: 2, who: 'own' }] }],
  },
  'left-arm-of-the-forbidden-one': {
    text: 'A piece of the Forbidden One. Gather all five in your hand to win the Duel. When Normal Summoned: draw 1 card.',
    effects: [{ trigger: 'onNormalSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
  },
  'right-arm-of-the-forbidden-one': {
    text: 'A piece of the Forbidden One. Gather all five in your hand to win the Duel. When Normal Summoned: draw 1 card.',
    effects: [{ trigger: 'onNormalSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
  },
  'left-leg-of-the-forbidden-one': {
    text: 'A piece of the Forbidden One. Gather all five in your hand to win the Duel. When Normal Summoned: draw 1 card.',
    effects: [{ trigger: 'onNormalSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
  },
  'right-leg-of-the-forbidden-one': {
    text: 'A piece of the Forbidden One. Gather all five in your hand to win the Duel. When Normal Summoned: draw 1 card.',
    effects: [{ trigger: 'onNormalSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
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
    text: 'Requires "Toon World". Can attack your opponent directly. When summoned: your opponent discards 1 random card.',
    cry: 'Toon power!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'directAttack', duration: 'permanent' },
          { op: 'discard', count: 1, who: 'opp' },
        ],
      },
    ],
  },

  'lord-of-d': {
    text: 'While this card is face-up, Dragon monsters you control cannot be targeted or destroyed by your opponent\'s card effects.',
    cry: 'Dragons, heed my call!',
    effects: [
      {
        trigger: 'continuous',
        ops: [],
        aura: { target: sel('own', 'all', { filter: { type: 'Dragon' } }), grants: ['untargetable'] },
      },
    ],
  },

  'kaiser-sea-horse': {
    text: 'This card counts as two tributes for the Tribute Summon of a LIGHT monster. When summoned: gain 500 Life Points.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'heal', amount: 500, to: 'own' }] }],
  },

  'battle-ox': {
    text: 'When this card destroys a monster in battle: it gains 300 ATK permanently.',
    effects: [{ trigger: 'onBattleDestroy', ops: [{ op: 'gainAtk', amount: 300, target: SELF, duration: 'permanent' }] }],
  },

  'saggi-the-dark-clown': {
    text: 'While face-up, your opponent\'s monsters lose 400 ATK. When this card is destroyed by battle: inflict 800 damage to your opponent.',
    effects: [
      { trigger: 'continuous', ops: [], aura: { target: OPP_ALL, atk: -400 } },
      { trigger: 'onDestroyedByBattle', ops: [{ op: 'damage', amount: 800, to: 'opp' }] },
    ],
  },

  'rude-kaiser': {
    text: 'When this card declares an attack: it gains 400 ATK until the end of the turn.',
    effects: [{ trigger: 'onDeclareAttack', ops: [{ op: 'gainAtk', amount: 400, target: SELF, duration: 'turn' }] }],
  },

  'judge-man': {
    text: 'When this card is Normal Summoned: destroy all face-down monsters your opponent controls.',
    effects: [
      { trigger: 'onNormalSummon', ops: [{ op: 'destroy', target: sel('opp', 'all', { filter: { face: 'down' } }) }] },
    ],
  },

  'vorse-raider': {
    text: 'When this card destroys a monster in battle: inflict 500 damage to your opponent.',
    effects: [{ trigger: 'onBattleDestroy', ops: [{ op: 'damage', amount: 500, to: 'opp' }] }],
  },

  'la-jinn-the-mystical-genie-of-the-lamp': {
    text: 'When this card is Normal Summoned: draw 1 card, then discard 1 card at random.',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'draw', count: 1, who: 'own' },
          { op: 'discard', count: 1, who: 'own' },
        ],
      },
    ],
  },

  'hitotsu-me-giant': {
    text: 'This card inflicts piercing battle damage.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'pierce', duration: 'permanent' }] }],
  },

  'ryu-kishin-powered': {
    text: 'When this card is Normal Summoned: destroy 1 Spell or Trap your opponent controls.',
    effects: [{ trigger: 'onNormalSummon', ops: [{ op: 'destroy', target: sel('opp', 'all', { zone: 'spellTrap' }) }] }],
  },

  /* ================================================================ */
  /* Joey                                                              */
  /* ================================================================ */

  'red-eyes-black-dragon': {
    text: 'Once per turn: inflict 700 damage to your opponent. Each time this card destroys a monster in battle it gains 300 ATK permanently.',
    cry: 'Inferno Fire Blast!',
    effects: [
      {
        trigger: 'ignition',
        label: 'Inferno Fire Blast',
        oncePerTurn: true,
        ops: [{ op: 'damage', amount: 700, to: 'opp' }],
      },
      { trigger: 'onBattleDestroy', ops: [{ op: 'gainAtk', amount: 300, target: SELF, duration: 'permanent' }] },
    ],
  },

  'flame-swordsman': {
    text: 'When this card is summoned: destroy all monsters your opponent controls with 1500 or less ATK. This card inflicts piercing battle damage.',
    cry: 'Flame Blast!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'pierce', duration: 'permanent' },
          { op: 'destroy', target: sel('opp', 'all', { filter: { maxAtk: 1500 } }) },
        ],
      },
    ],
  },

  'baby-dragon': {
    text: 'While you control "Time Wizard", this card gains 1200 ATK. When summoned: draw 1 card.',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] },
      // The pair-up was written in the text and nowhere else.
      {
        trigger: 'continuous',
        condition: { requiresOnField: 'time-wizard' },
        ops: [],
        aura: { target: SELF, atk: 1200 },
      },
    ],
  },

  'time-wizard': {
    text: 'Once per turn: flip a coin. Heads — destroy every monster your opponent controls. Tails — destroy every monster you control and take 800 damage.',
    cry: 'Time Roulette!',
    effects: [
      {
        trigger: 'ignition',
        label: 'Time Roulette',
        oncePerTurn: true,
        ops: [
          {
            op: 'coinFlip',
            heads: [{ op: 'destroy', target: OPP_ALL }],
            tails: [
              { op: 'destroy', target: OWN_ALL },
              { op: 'damage', amount: 800, to: 'own' },
            ],
          },
        ],
      },
    ],
  },

  'panther-warrior': {
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
    text: 'When this card is Normal Summoned: it gains 400 ATK until the end of the turn and can attack directly this turn.',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'gainAtk', amount: 400, target: SELF, duration: 'turn' },
          { op: 'directAttack', duration: 'turn' },
        ],
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
    text: 'When this card destroys a monster in battle: inflict 400 damage to your opponent and draw 1 card.',
    effects: [
      {
        trigger: 'onBattleDestroy',
        ops: [
          { op: 'damage', amount: 400, to: 'opp' },
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
        ops: [
          { op: 'pierce', duration: 'permanent' },
          { op: 'gainAtk', scale: 'perCardInGrave', target: SELF, duration: 'permanent' },
        ],
      },
    ],
  },

  'tiger-axe': {
    text: 'When this card is Normal Summoned: force 1 monster your opponent controls into face-up Defense Position.',
    effects: [{ trigger: 'onNormalSummon', targets: 1, ops: [{ op: 'forceDefense', target: OPP_PICK }] }],
  },

  'masaki-the-legendary-swordsman': {
    /* "While you control another Warrior" — granted permanently on summon, it
       held whether or not he had anyone beside him, which is the opposite of
       what the card says. A conditional aura is read live instead, so the
       moment his last comrade falls he is mortal again. */
    text: 'This card cannot be destroyed by battle while you control another Warrior.',
    cry: 'I do not stand alone!',
    effects: [
      {
        trigger: 'continuous',
        condition: { controlsOtherOfType: 'Warrior' },
        ops: [],
        aura: { target: SELF, grants: ['indestructibleByBattle'] },
      },
    ],
  },

  'battle-steer': {
    text: 'When this card destroys a monster in battle: it gains 400 ATK permanently.',
    effects: [{ trigger: 'onBattleDestroy', ops: [{ op: 'gainAtk', amount: 400, target: SELF, duration: 'permanent' }] }],
  },

  kojikocy: {
    text: 'When this card is Normal Summoned: your opponent discards 1 random card and you draw 1 card.',
    effects: [
      {
        trigger: 'onNormalSummon',
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
      { trigger: 'onSummon', ops: [{ op: 'destroy', target: sel('opp', 'all', { zone: 'spellTrap' }) }] },
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
          { op: 'destroy', target: sel('opp', 'all', { zone: 'spellTrap' }) },
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
    effects: [{ trigger: 'onSummon', ops: [{ op: 'directAttack', duration: 'permanent' }] }],
  },

  'dunames-dark-witch': {
    text: 'When this card is Normal Summoned: gain 700 Life Points and inflict 400 damage to your opponent.',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'heal', amount: 700, to: 'own' },
          { op: 'damage', amount: 400, to: 'opp' },
        ],
      },
    ],
  },

  'winged-dragon-guardian-of-the-fortress-1': {
    text: 'This card cannot be destroyed by battle with monsters of Level 4 or lower.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'indestructibleByBattle', duration: 'permanent' }] }],
  },

  'amazon-of-the-seas': {
    text: 'When this card is summoned: return 1 monster your opponent controls to their hand.',
    effects: [{ trigger: 'onSummon', targets: 1, ops: [{ op: 'bounce', target: OPP_PICK }] }],
  },

  'sonic-maid': {
    text: 'When this card is Normal Summoned: draw 1 card.',
    effects: [{ trigger: 'onNormalSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
  },

  'happy-lover': {
    text: 'When this card is Normal Summoned: gain 1000 Life Points.',
    effects: [{ trigger: 'onNormalSummon', ops: [{ op: 'heal', amount: 1000, to: 'own' }] }],
  },

  /* ================================================================ */
  /* Pegasus                                                           */
  /* ================================================================ */

  relinquished: {
    text:
      'When this card is summoned: absorb 1 monster your opponent controls — this card gains its ATK and DEF, ' +
      'and the monster is banished. This card cannot be destroyed by battle or by card effects, and its battle ' +
      'damage pierces defence.',
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
          { op: 'indestructibleByEffect', duration: 'permanent' },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'toon-summoned-skull': {
    summonRequires: 'toon-world',
    text: 'Requires "Toon World". Can attack your opponent directly. When summoned: inflict 600 damage to your opponent.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'directAttack', duration: 'permanent' },
          { op: 'damage', amount: 600, to: 'opp' },
        ],
      },
    ],
  },

  'toon-mermaid': {
    summonRequires: 'toon-world',
    text: 'Requires "Toon World". Can attack your opponent directly. When summoned: draw 1 card.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'directAttack', duration: 'permanent' },
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  'toon-alligator': {
    text: 'Can attack your opponent directly. When this card is Normal Summoned: add "Toon World" from your Deck to your hand.',
    cry: 'Snap to it!',
    effects: [
      { trigger: 'onSummon', ops: [{ op: 'directAttack', duration: 'permanent' }] },
      // Pegasus's deck does nothing until Toon World is down, and drawing into
      // one of two copies is not something to leave to luck. The cheapest body
      // in the deck is the one that goes and fetches it.
      { trigger: 'onNormalSummon', ops: [{ op: 'search', filter: { slugs: ['toon-world'] } }] },
    ],
  },

  'manga-ryu-ran': {
    summonRequires: 'toon-world',
    text: 'Requires "Toon World". Can attack your opponent directly and cannot be targeted by your opponent\'s effects.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'directAttack', duration: 'permanent' },
          { op: 'untargetable', duration: 'permanent' },
        ],
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
    effects: [{ trigger: 'onBattleDestroy', ops: [{ op: 'extraAttacks', count: 1 }] }],
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
    text: 'Requires "Toon World". Can attack your opponent directly. When summoned: your opponent discards 1 random card.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'directAttack', duration: 'permanent' },
          { op: 'discard', count: 1, who: 'opp' },
        ],
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
    text: 'When this card inflicts battle damage to your opponent: they discard 1 random card.',
    effects: [{ trigger: 'onDealBattleDamage', ops: [{ op: 'discard', count: 1, who: 'opp' }] }],
  },

  'lady-of-faith': {
    text: 'When this card is Normal Summoned: gain 600 Life Points and draw 1 card.',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'heal', amount: 600, to: 'own' },
          { op: 'draw', count: 1, who: 'own' },
        ],
      },
    ],
  },

  'souls-of-the-forgotten': {
    text: 'At the end of your turn: inflict 300 damage to your opponent.',
    effects: [{ trigger: 'onOwnTurnEnd', ops: [{ op: 'damage', amount: 300, to: 'opp' }] }],
  },

  'the-gross-ghost-of-fled-dreams': {
    text: 'FLIP: your opponent discards 2 random cards.',
    effects: [{ trigger: 'onFlip', ops: [{ op: 'discard', count: 2, who: 'opp' }] }],
  },

  'dark-necrofear': {
    text: 'When this card is summoned: take control of 1 monster your opponent controls permanently.',
    cry: 'The darkness claims your soul.',
    effects: [{ trigger: 'onSummon', targets: 1, ops: [{ op: 'takeControl', target: OPP_PICK, duration: 'permanent' }] }],
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
    text: 'When this card is Normal Summoned: destroy 1 set card your opponent controls.',
    /* The filter is the whole point: it said "face-down" and did not check,
       so summoning this blew up a Spell the opponent had already played. */
    effects: [
      {
        trigger: 'onNormalSummon',
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
    effects: [
      {
        trigger: 'onSummon',
        condition: { requiresField: 'umi' },
        ops: [
          { op: 'untargetable', duration: 'permanent' },
          { op: 'directAttack', duration: 'permanent' },
        ],
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
    text: 'When this card destroys a monster in battle: inflict 400 damage to your opponent.',
    effects: [{ trigger: 'onBattleDestroy', ops: [{ op: 'damage', amount: 400, to: 'opp' }] }],
  },

  jellyfish: {
    text: 'FLIP: return 1 monster your opponent controls to their hand.',
    effects: [{ trigger: 'onFlip', targets: 1, ops: [{ op: 'bounce', target: OPP_PICK }] }],
  },

  '7-colored-fish': {
    text: 'While "Umi" is on the field, this card gains 800 ATK and inflicts piercing battle damage.',
    effects: [
      {
        trigger: 'onSummon',
        condition: { requiresField: 'umi' },
        ops: [
          { op: 'gainAtk', amount: 800, target: SELF, duration: 'permanent' },
          { op: 'pierce', duration: 'permanent' },
        ],
      },
    ],
  },

  'giant-red-seasnake': {
    text: 'When this card is Normal Summoned: Special Summon 1 WATER monster with 1600 or less ATK from your Graveyard.',
    effects: [
      { trigger: 'onNormalSummon', ops: [{ op: 'specialSummon', from: 'grave', filter: { attribute: 'WATER', maxAtk: 1600 }, count: 1, position: 'atk' }] },
    ],
  },

  'deepsea-warrior': {
    text: 'This card cannot be targeted by Spell or Trap effects and cannot be destroyed by battle.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'untargetable', duration: 'permanent' },
          { op: 'indestructibleByBattle', duration: 'permanent' },
        ],
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
    text: 'This card can attack your opponent directly.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'directAttack', duration: 'permanent' }] }],
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
    effects: [
      {
        trigger: 'onSummon',
        condition: { requiresField: 'umi' },
        ops: [
          { op: 'gainAtk', amount: 500, target: SELF, duration: 'permanent' },
          { op: 'extraAttacks', count: 1 },
        ],
      },
    ],
  },

  /* ================================================================ */
  /* Weevil                                                            */
  /* ================================================================ */

  'petit-moth': {
    text: 'Gains 1 Evolution Counter during each of your End Phases. At 2 counters it becomes Larvae Moth, at 3 Great Moth, and at 4 the Perfectly Ultimate Great Moth.',
    cry: 'My insect will evolve!',
    effects: [
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
    text: 'Cannot be targeted or destroyed by Spell or Trap effects. Inflicts piercing battle damage and can attack twice each Battle Phase. When summoned: destroy every Spell and Trap on the field.',
    cry: 'Behold, the ultimate insect!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'untargetable', duration: 'permanent' },
          { op: 'pierce', duration: 'permanent' },
          { op: 'extraAttacks', count: 1 },
          { op: 'destroy', target: sel('both', 'all', { zone: 'spellTrap' }) },
        ],
      },
    ],
  },

  'cocoon-of-evolution': {
    /* Granted permanently on summon, so a Cocoon that had been bounced back and
       replayed, or revived, carried immunity it should have lost. It holds while
       the card is on the field, which is what the text says. */
    text: 'While this card is face-up, it cannot be destroyed by battle.',
    effects: [{ trigger: 'continuous', ops: [], aura: { target: SELF, grants: ['indestructibleByBattle'] } }],
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
    text: 'When this card is Normal Summoned: draw 1 card. This card inflicts piercing battle damage.',
    effects: [
      {
        trigger: 'onNormalSummon',
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
    text: 'When this card is Normal Summoned: your opponent sends the top 3 cards of their Deck to the Graveyard and discards 1 random card.',
    cry: 'My parasite is inside your deck!',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'mill', count: 3, who: 'opp' },
          { op: 'discard', count: 1, who: 'opp' },
        ],
      },
    ],
  },

  'insect-soldiers-of-the-sky': {
    text: 'This card gains 1000 ATK when it battles a Winged Beast monster. When summoned: draw 1 card.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'draw', count: 1, who: 'own' }] }],
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
    text: 'This card can attack twice each Battle Phase and gains 200 ATK for each Dinosaur in your Graveyard.',
    cry: 'Tear them apart!',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'extraAttacks', count: 1 },
          { op: 'gainAtk', scale: 'perCardInGrave', target: SELF, duration: 'permanent' },
        ],
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
    text: 'When this card is Normal Summoned: Special Summon 1 Dinosaur with 1500 or less ATK from your Graveyard.',
    effects: [
      { trigger: 'onNormalSummon', ops: [{ op: 'specialSummon', from: 'grave', filter: { type: 'Dinosaur', maxAtk: 1500 }, count: 1, position: 'def' }] },
    ],
  },

  'crawling-dragon-2': {
    text: 'This card gains 200 ATK for each card in your Graveyard.',
    effects: [{ trigger: 'onSummon', ops: [{ op: 'gainAtk', scale: 'perCardInGrave', target: SELF, duration: 'permanent' }] }],
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
    text: 'When this card is summoned: destroy every face-down card your opponent controls.',
    effects: [
      {
        trigger: 'onNormalSummon',
        ops: [
          { op: 'destroy', target: sel('opp', 'all', { zone: 'spellTrap' }) },
          { op: 'destroy', target: sel('opp', 'all', { filter: { face: 'down' } }) },
        ],
      },
    ],
  },

  trakodon: {
    text: 'When this card is Normal Summoned: inflict 400 damage to your opponent.',
    effects: [{ trigger: 'onNormalSummon', ops: [{ op: 'damage', amount: 400, to: 'opp' }] }],
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
      { trigger: 'continuous', ops: [], aura: { target: sel('own', 'all', { filter: { type: 'Machine' } }), atk: 200 } },
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
          { op: 'destroy', target: sel('opp', 'all', { zone: 'spellTrap' }) },
          { op: 'pierce', duration: 'permanent' },
          { op: 'indestructibleByBattle', duration: 'permanent' },
        ],
      },
    ],
  },

  zoa: {
    text: 'When this card destroys a monster in battle: it gains that monster\'s ATK permanently.',
    effects: [{ trigger: 'onBattleDestroy', ops: [{ op: 'gainAtk', amount: 400, target: SELF, duration: 'permanent' }] }],
  },

  'slot-machine': {
    text: 'Once per turn: roll a die. This card gains 300 ATK for each pip until the end of the turn.',
    cry: 'Jackpot!',
    effects: [
      {
        trigger: 'ignition',
        label: 'Spin the reels',
        oncePerTurn: true,
        ops: [{ op: 'diceRoll', perPip: [{ op: 'gainAtk', amount: 300, target: SELF, duration: 'turn' }] }],
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
    text: 'All Machine monsters you control gain 300 ATK.',
    effects: [{ trigger: 'continuous', ops: [], aura: { target: sel('own', 'all', { filter: { type: 'Machine' } }), atk: 300 } }],
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
    /* The threshold does not exist in the engine, so "1800 or less" read as
       "never" — the same hole that left Sword Arm of Dragon immortal. It is a
       wall of stone instead, which is what its 1900 DEF already says. */
    text: 'This card gains 400 DEF permanently each time it survives a battle. When summoned: gain 600 Life Points.',
    effects: [
      {
        trigger: 'onSummon',
        ops: [
          { op: 'indestructibleByBattle', duration: 'permanent' },
          { op: 'heal', amount: 600, to: 'own' },
        ],
      },
    ],
  },

  'ground-attacker-bugroth': {
    text: 'This card can attack your opponent directly if they control no monsters, and gains 400 ATK when it does.',
    effects: [{ trigger: 'onDeclareAttack', ops: [{ op: 'gainAtk', amount: 400, target: SELF, duration: 'turn' }] }],
  },
};
