/**
 * Core type definitions for the duel engine.
 *
 * House rules for this game (deliberately different from the real TCG):
 *  - 8000 Life Points, 25-card decks, 5-card opening hand.
 *  - 3 Monster Zones, 1 Spell/Trap Zone, 1 separate Field Zone.
 *  - One Main Phase per turn: Draw -> Main -> Battle -> End.
 *  - Every card has a custom, anime-flavoured "overpowered" effect.
 */

export type PlayerId = 'p1' | 'p2';
export type Phase = 'draw' | 'main' | 'battle' | 'end';
export type Position = 'atk' | 'def';
export type Face = 'up' | 'down';
export type CardKind = 'monster' | 'spell' | 'trap';

export const MONSTER_ZONES = 3;
export const STARTING_LP = 8000;
export const DECK_SIZE = 25;
export const OPENING_HAND = 5;

/* ------------------------------------------------------------------ */
/* Card definitions                                                    */
/* ------------------------------------------------------------------ */

/** Raw record produced by scripts/fetch-cards.mjs from the real card database. */
export interface GeneratedCard {
  slug: string;
  name: string;
  kind: CardKind;
  subKind: string | null; // Normal / Continuous / Equip / Field / Quick-Play / Ritual
  type: string | null; // Dragon, Spellcaster, ...
  attribute: string | null; // DARK, LIGHT, ...
  level: number | null;
  atk: number | null;
  def: number | null;
  frameType: string;
  isFusion: boolean;
  isRitual: boolean;
  isEffect: boolean;
  artId: number;
}

/** A fully assembled card: real stats + our custom effect. */
export interface CardDef extends GeneratedCard {
  /** Rules text we wrote for this game. */
  text: string;
  /** Flavour line shown when the card resolves. */
  cry?: string;
  effects: CardEffect[];
  /** Fusion recipe (slugs) for Extra Deck monsters. */
  fusionMaterials?: string[];
  /**
   * Assembles without Polymerization. There is no Fusion card in the anime
   * when Yugi calls "Alpha! Beta! Gamma!" — the three Magnet Warriors simply
   * combine, and the tribute of three specific bodies is the whole cost.
   * Every other Fusion still pays for the card.
   */
  fusionFree?: boolean;
  /** Stat overrides so our custom versions can differ from the printed card. */
  atkOverride?: number;
  defOverride?: number;
  /**
   * A card that must be face-up on your side before this monster can be
   * Summoned — the Toon monsters and their Toon World. The requirement is in
   * their rules text either way; this is what makes the engine agree.
   */
  summonRequires?: string;
  /** See `EffectDef.mayForgoTributes`. */
  mayForgoTributes?: boolean;
  /** Our version of the card sits in a different zone than the printed one. */
  subKindOverride?: string;
  /**
   * ATK and DEF become the combined ATK and DEF of the monsters Tributed to
   * Summon this card — the Winged Dragon of Ra. Written on the card rather
   * than as a branch in the summon path, so a second card that works this way
   * needs no engine change.
   */
  statsFromTributes?: boolean;
}

/* ------------------------------------------------------------------ */
/* Effect system                                                       */
/* ------------------------------------------------------------------ */

export type Trigger =
  /** Passive aura, applied continuously while this card is face-up on the field. */
  | 'continuous'
  /** Monster was summoned face-up by any means, including Special Summons. */
  | 'onSummon'
  /**
   * Monster was Normal Summoned or Flip Summoned — deliberately *not* fired by
   * Monster Reborn, fusion, or any other Special Summon. Cards whose text says
   * "When this card is Normal Summoned" use this; using `onSummon` for them let
   * a revived monster re-trigger its summon bonus.
   */
  | 'onNormalSummon'
  /**
   * Discarded from the hand, on purpose, to make something happen.
   *
   * The card is not summoned and never reaches the field — it is spent from the
   * hand and goes straight to the Graveyard. Ryu-Ran throws itself away to dig
   * Toon World out of the Deck, and pays for it by taking your board with it.
   */
  | 'handDiscard'
  /** Monster was flipped face-up (from a face-down defence position). */
  | 'onFlip'
  /**
   * The *opponent* summoned a monster, face-up. Fires on every face-up monster
   * the other player controls, with the summoned card in the trigger context —
   * so `pick: 'attacker'` resolves to what just arrived, exactly as it does in
   * a summon trap window.
   *
   * Slifer's second mouth is the reason this exists: "if a monster is Summoned
   * to your opponent's field, it loses 2000 ATK, and if that leaves it with
   * nothing, destroy it." A Set opens no window and fires nothing, the same
   * rule the trap windows follow.
   */
  | 'onOpponentSummon'
  /** This monster was destroyed in battle. */
  | 'onDestroyedByBattle'
  /**
   * This card was *destroyed* — by battle or by an effect — as opposed to
   * having merely left the field.
   *
   * A tribute is not a destruction, and neither is being spent as a Fusion
   * material, paid as a cost, or replaced in the Field Zone. Chimera says
   * "when this card is destroyed: Special Summon Gazelle and Berfomet", and
   * it was written as `onSentToGrave`, which fires on every one of those —
   * so tributing Chimera for a God put two bodies back on the board in the
   * middle of paying for it, filling the zone the summon was headed for.
   * Reported as "sometimes I get the monster zone is occupied".
   *
   * `onSentToGrave` stays exactly as it is and still fires for everything:
   * the five cards using it all say "when this card is sent to the
   * Graveyard", which a tribute genuinely is. Only "destroyed" needed its
   * own word.
   */
  | 'onDestroyed'
  /** This card was sent from the field to the Graveyard for any reason. */
  | 'onSentToGrave'
  /** This monster declared an attack (resolves before damage). */
  | 'onDeclareAttack'
  /** This monster was chosen as an attack target (resolves before damage). */
  | 'onAttacked'
  /** This monster inflicted battle damage to the opponent. */
  | 'onDealBattleDamage'
  /** This monster destroyed another monster in battle. */
  | 'onBattleDestroy'
  /** Start of controller's turn (Draw Phase). */
  | 'onOwnTurnStart'
  /** End of controller's turn. */
  | 'onOwnTurnEnd'
  /** Spell activation. */
  | 'activate'
  /** Manual once-per-turn activation from the field during Main Phase. */
  | 'ignition'
  /** Trap activation, gated by `window`. */
  | 'trap';

/** When a Trap or hand-trap may be activated. */
export type TrapWindow =
  | 'opponentDeclareAttack'
  /**
   * Any Summon the opponent performs — a Normal Summon or a Fusion Summon.
   * Setting a monster face-down is *not* a Summon and opens no window at all:
   * Trap Hole was firing on a Set, and the prompt naming the card ("Mihail
   * summoned Man-Eater Bug.") gave away what had just been set into the
   * bargain.
   */
  | 'opponentSummon'
  /**
   * A Normal Summon specifically. Trap Hole says "When your opponent Normal
   * Summons a monster" and was going off on Fusion Summons too, which are
   * Special Summons. A card watching the wider `opponentSummon` still fires
   * here — a Normal Summon is a Summon — so Torrential Tribute's "when your
   * opponent summons" keeps catching both.
   */
  | 'opponentNormalSummon'
  | 'opponentActivateSpell'
  | 'opponentTurnStart'
  | 'monsterDestroyed'
  | 'anyOpponentTurn';

export type Side = 'own' | 'opp' | 'both';
/** Where a Special Summon may pull a monster from. */
export type SummonZone = 'hand' | 'deck' | 'grave' | 'extra';
export type Pick =
  | 'self' // the card that owns this effect
  | 'chosen' // player selects when activating
  | 'all'
  | 'random'
  | 'strongest'
  | 'weakest'
  | 'attacker' // context: the attacking monster
  | 'attackTarget' // context: the monster being attacked
  /** The monster this same effect just Special Summoned. Call of the Haunted
   *  revives one and then buffs it; `strongest` handed the bonus to whatever
   *  was already the biggest thing you controlled instead. */
  | 'summoned';

export interface CardFilter {
  type?: string; // monster type (Dragon, Insect, ...)
  /**
   * Everything *except* this type. Catapult Turtle launches a monster you
   * control, and a God is not ammunition — Slifer with a full hand is worth
   * more damage than a duel has Life Points, and firing the thing you paid
   * three bodies for is not a play anybody would call anime-accurate.
   */
  excludeType?: string;
  attribute?: string;
  kind?: CardKind;
  minLevel?: number;
  maxLevel?: number;
  minAtk?: number;
  maxAtk?: number;
  nameIncludes?: string;
  slugs?: string[];
  /** Pegasus's cartoon monsters — see `isToon`, which knows the ones the name
      does not give away. */
  toon?: boolean;
  position?: Position;
  face?: Face;
}

export interface Selector {
  side: Side;
  /** Defaults to 'monster'. */
  /**
   * `spellTrap` is the Spell/Trap Zone only; `field` the Field Zone only;
   * `backrow` is both, which is what "1 Spell or Trap your opponent controls"
   * actually means — a Field Spell is a Spell they control. Toon World could
   * not be removed by De-Spell, Harpie Lady or anything else that says those
   * words, which in Pegasus's matchup is the whole duel.
   */
  zone?: 'monster' | 'spellTrap' | 'field' | 'backrow' | 'hand' | 'grave' | 'deck' | 'extra' | 'banished';
  pick: Pick;
  count?: number;
  filter?: CardFilter;
  /**
   * Never the card the effect belongs to. "Your **other** Defense Position
   * monsters cannot be destroyed by battle" was a plain `pick: 'all'` with a
   * position filter, so Mystical Elf — herself a Defense Position monster —
   * was shielding herself and could not be killed in battle at all.
   */
  excludeSelf?: boolean;
  /**
   * Reaches a monster that no other effect may touch.
   *
   * Relinquished and Thousand-Eyes Restrict swallow things: the eye does not
   * care that a card says it cannot be targeted, and the owner's ruling is that
   * it reaches them. A God is still a God — that rule is checked separately and
   * this never lifts it.
   */
  piercesProtection?: boolean;
}

export type Duration = 'permanent' | 'turn' | 'opponentTurn';

/** A single atomic action an effect can perform. */
export type Op =
  /** `tributedAtk` is the ATK of what this effect's own cost just tributed —
   *  Catapult Turtle throws a monster and it lands for what it was worth. */
  /**
   * `perDestroyed` multiplies `amount` by how many cards this same effect has
   * destroyed so far — "destroy up to 2 monsters, then inflict 500 damage for
   * each". Counted from what actually died rather than from what was aimed at,
   * so a card that was protected, or a second target that was never chosen,
   * does not get billed for.
   */
  | { op: 'damage'; amount?: number; scale?: 'targetAtk' | 'selfAtk' | 'halfTargetAtk' | 'perOppMonster' | 'tributedAtk' | 'perDestroyed'; to: Side }
  | { op: 'heal'; amount: number; to: Side }
  /** `perCardInGrave` and `dicePips` both multiply `amount`, so the rate is
   *  written on the card: Headless Knight counts 100 a corpse, the Magician of
   *  Black Chaos counts 200. `perMonsterOnField` still carries its own 300. */
  | { op: 'gainAtk'; amount?: number; scale?: 'targetAtk' | 'perCardInGrave' | 'perMonsterOnField' | 'dicePips'; target: Selector; duration: Duration }
  | { op: 'gainDef'; amount: number; target: Selector; duration: Duration }
  | { op: 'setAtk'; value: number; target: Selector }
  | { op: 'halveAtk'; target: Selector }
  | { op: 'swapAtkDef'; target: Selector }
  | { op: 'destroy'; target: Selector }
  | { op: 'banish'; target: Selector }
  | { op: 'bounce'; target: Selector }
  /** `turns` is how many turns a non-permanent borrowing lasts; 1 by default,
   *  which is the end of the turn it was taken on. */
  | { op: 'takeControl'; target: Selector; duration: Duration; turns?: number }
  | { op: 'draw'; count: number; who: Side }
  /**
   * Draws up to a hand size rather than a fixed number — "each player draws
   * until they hold 6". Card of Sanctity, which is the card that makes Slifer
   * terrifying, and it refills the opponent just as generously.
   */
  | { op: 'drawTo'; count: number; who: Side }
  /** `all` discards the whole hand and ignores `count` — Manga Ryu-Ran wipes
   *  both hands, and a number would have to be a lie big enough to cover any. */
  | { op: 'discard'; count: number; who: Side; all?: boolean }
  | { op: 'mill'; count: number; who: Side }
  /**
   * Add a card from the Deck to the hand.
   *
   * `orGrave` adds a fallback: nothing matching in the Deck, look in the
   * controller's own Graveyard instead. One op rather than a `search` followed
   * by a `stealFromGrave`, because those two are independent and both fire —
   * fine for a card the deck holds one of, and wrong the moment it holds three.
   * Kaiser Sea Horse fetches a Blue-Eyes and Kaiba runs three, so "one from the
   * Deck or the Graveyard" has to be a single lookup that can only ever yield
   * one card.
   */
  | { op: 'search'; filter: CardFilter; count?: number; orGrave?: boolean }
  /** `from` may list several zones, searched in order — a Ritual Spell has to
   *  reach the monster whether it was drawn or is still in the Deck. */
  /**
   * `includeSelf` lets a card Special Summon *itself* back. The pool normally
   * excludes the effect's own source, because "when this card is destroyed:
   * Special Summon 1 monster" should never quietly mean "put me back" — but
   * Revival Jam's entire identity is that it will not stay dead, so it opts
   * in by name rather than the guard being loosened for everybody.
   */
  /**
   * `pick` is which monster the pool yields when the player named none. The
   * default is the strongest, because a revival is normally meant to be the
   * best thing available — Sangan is the exception that proves it: what it
   * fetches on the way out is the *smallest* body in the Deck, a wall rather
   * than a reward.
   */
  | { op: 'specialSummon'; from: SummonZone | SummonZone[]; side?: Side; filter?: CardFilter; count?: number; position?: Position; face?: Face; includeSelf?: boolean; pick?: 'strongest' | 'weakest' }
  /**
   * `position` defaults to Defence, which is what every token in the game was
   * before it existed — Kuriboh's, Multiply's, the Metal Reflect Slime's are
   * all walls and must stay walls. It is opt-in for the tokens that are meant
   * to fight, because the AI's `clock()` returns the maximum race penalty for
   * a player holding nothing in Attack Position: a deck whose whole board
   * arrives face-up in Defence reads to the pilot as one that cannot win.
   */
  /**
   * `deathDamage` is what the token's controller's opponent loses when the
   * token is sent to the Graveyard — the haunting that outlives the ghost.
   * A token fires no triggers and carries no effects, which is the whole
   * point of one, so the number rides on the instance instead.
   */
  | { op: 'summonToken'; name: string; atk: number; def: number; count: number; artSlug?: string; position?: 'atk' | 'def'; deathDamage?: number }
  | { op: 'transformInto'; slug: string }
  | { op: 'addCounter'; amount: number }
  | { op: 'negateAttack' }
  | { op: 'endBattlePhase' }
  | { op: 'extraAttacks'; count: number; duration?: Duration }
  | { op: 'attackAllMonsters' }
  | { op: 'directAttack'; duration: Duration }
  | { op: 'halvedBattleDamage'; duration: Duration }
  | { op: 'halvedDirectDamage'; duration: Duration }
  | { op: 'reflectBattleDamage'; duration: Duration }
  | { op: 'pierce'; duration: Duration }
  | { op: 'preventBattleDamage'; who: Side; duration: Duration }
  | { op: 'indestructibleByBattle'; duration: Duration }
  | { op: 'indestructibleByEffect'; duration: Duration }
  | { op: 'untargetable'; duration: Duration }
  | { op: 'skipDraw'; who: Side; turns: number }
  | { op: 'skipBattlePhase'; who: Side; turns: number }
  | { op: 'freezeMonsters'; who: Side; turns: number }
  | { op: 'negateEffects'; target: Selector }
  | { op: 'absorb'; target: Selector }
  /**
   * Attaches this card to a monster. Only the attachment is stored — the stats
   * and grants are read back out as an aura for as long as the card is on the
   * field, so destroying it restores the monster's printed values and the
   * monster leaving takes the equip to the Graveyard with it.
   *
   * `target` for the cards that choose their own host from the context rather
   * than from a prompt: Spellbinding Circle equips itself to the monster that
   * just declared the attack.
   */
  | { op: 'equipTo'; atk: number; def: number; grants?: EquipGrant[]; target?: Selector }
  | { op: 'revealHand'; who: Side }
  | { op: 'shuffleIntoDeck'; target: Selector }
  /**
   * Takes a card out of a Graveyard and into the controller's hand.
   *
   * `from` because the two cards that do this mean different things by it.
   * Graverobber is "from your opponent's Graveyard" and that is the whole card.
   * Magician of Faith is "from either Graveyard", and *either* has to start
   * with your own — searching theirs first is what handed a player the
   * opponent's Spell and made getting your own Monster Reborn back impossible
   * while they had anything at all.
   */
  /** `pick` decides which match comes back when the player named none. The
   *  default is the strongest; Lady of Faith's séance reaches in blind, so she
   *  says `random` and takes whichever Fiend answers. */
  | { op: 'stealFromGrave'; filter?: CardFilter; from?: 'opp' | 'either' | 'own'; pick?: 'strongest' | 'random' }
  | { op: 'coinFlip'; heads: Op[]; tails: Op[] }
  | { op: 'diceRoll'; perPip: Op[] }
  | { op: 'forceDefense'; target: Selector }
  | { op: 'forceAttackPosition'; target: Selector }
  | { op: 'flipFaceUp'; target: Selector }
  /**
   * Destroys any target left with no ATK at all. Slifer's second mouth drains
   * 2000 and then finishes whatever that emptied — the two halves of one
   * sentence, and the drain has to land first, so this reads the *effective*
   * stat rather than a filter (`matchesFilter` is deliberately blind to auras
   * to avoid recursion, so `maxAtk: 0` would look at the printed number and
   * destroy the wrong things).
   */
  | { op: 'destroyIfNoAtk'; target: Selector }
  | { op: 'win' };

export type EquipGrant =
  | 'pierce'
  | 'doubleAttack'
  | 'directAttack'
  | 'indestructibleByBattle'
  | 'indestructibleByEffect'
  | 'untargetable'
  /** Held down by an aura — lapses the moment the card holding it leaves. */
  | 'cannotAttack'
  /** Every attack against this monster's controller must be aimed at it.
   *  Thousand-Eyes Restrict stares the board down: the opponent may still
   *  attack, but it is the only thing they may attack. */
  | 'mustBeAttacked'
  /** Destruction is paid for out of what this monster has swallowed. While it
   *  holds anything, being destroyed sheds the lot instead and the monster
   *  stands there at its own printed stats; empty, it dies like anything. */
  | 'shedsAbsorbedInstead'
  /** Attacks every opposing monster once each Battle Phase. */
  | 'attackAll'
  /**
   * Battle damage this monster inflicts is halved.
   *
   * The price half a dozen real cards pay for attacking directly, and Sky Scout
   * is the one that says so here: "can attack your opponent directly, but its
   * battle damage is halved". Only the first clause existed, which made it an
   * unblockable 1800 every turn — comfortably the best body in the game for
   * what it costs.
   */
  | 'halvedBattleDamage'
  /**
   * The price of going *over* a guard: a direct swing made while the opponent
   * still controls a monster is halved. A monster this card runs into takes the
   * full number, and so does the player when there is nothing in the way at all
   * — with an empty board there is nobody to fly over, so it is an ordinary
   * direct attack.
   *
   * Deliberately not the same flag as `halvedBattleDamage`, which is the whole
   * of Sky Scout's sentence and applies wherever the monster deals battle
   * damage at all. Gaia the Dragon Champion is the other bargain — it may go
   * around the board for half, or through it for everything — and folding the
   * two together would quietly halve every attack the Champion makes.
   */
  | 'halvedDirectDamage'
  /**
   * Attacking directly costs this monster's controller 500 Life Points per
   * attack — the Toon toll. Toon World grants it beside `directAttack`, so
   * the cartoon mischief is paid for out of Pegasus's own Life Points, which
   * is both the printed rule and what keeps a board of direct attackers from
   * simply ending the game for free.
   */
  /**
   * Cannot attack the turn it was Summoned — the other printed Toon rule.
   * A Toon arrives for free under Toon World; the pause before it may swing
   * is the turn the opponent is given to answer it.
   */
  | 'summonSick'
  /**
   * Battle damage this monster's controller takes, in a battle this monster is
   * in, is dealt to the other player as well.
   *
   * Relinquished's mirror: the monster it swallowed is the shield, and what
   * gets through to you goes straight back across the table. It only ever
   * *adds* damage — it never spares its own controller — so it is a deterrent
   * against engaging, not another form of immunity.
   */
  | 'reflectBattleDamage';

export interface CardEffect {
  trigger: Trigger;
  /** For traps and hand-traps: the window in which this may fire. */
  window?: TrapWindow;
  /** Human-readable label shown on the activation button. */
  label?: string;
  /** Ops executed in order. */
  ops: Op[];
  /** Continuous auras: which cards receive the buff. */
  aura?: {
    target: Selector;
    atk?: number;
    def?: number;
    grants?: EquipGrant[];
    /**
     * A bonus that scales with a count, for "gains 200 ATK for each card in
     * your Graveyard".
     *
     * Five cards said that and were granting it *once, on summon* — when the
     * Graveyard is usually empty, so they gained nothing and then never grew.
     * The quantity keeps changing, so it has to be read live like any other
     * aura rather than baked into the monster at the moment it arrived.
     *
     * Counting only ever looks at printed card data, never effective stats, so
     * evaluating it from inside the stat calculation cannot recurse.
     */
    per?: {
      /**
       * Where to count: one side's Graveyard or both, one side's field or both,
       * or the controller's hand — which is Slifer, whose ATK is "1000 for each
       * card in your hand" and therefore falls the moment you spend one.
       */
      zone: 'ownGrave' | 'eitherGrave' | 'ownField' | 'field' | 'ownHand';
      /** Only count cards matching this. Omit to count everything there. */
      filter?: CardFilter;
      /**
       * Do not count the card whose effect this is — "for every *other* Warrior
       * you control". Masaki is himself a Warrior standing on his own field, so
       * without this he counts his own body and is never alone.
       *
       * Only meaningful on a field zone; a card cannot be in its own Graveyard
       * or hand while it is on the field granting an aura.
       */
      excludeSelf?: boolean;
      atk?: number;
      def?: number;
    };
  };
  /** Effect only usable once per turn (ignition effects default to true). */
  oncePerTurn?: boolean;
  /**
   * Continuous Trap that keeps working after it is face-up, firing again every
   * time its window opens. Without this a Continuous Trap resolves once and
   * then sits face-up forever, dead, holding the only Spell/Trap Zone hostage.
   * Only for cards whose text really is an ongoing effect.
   */
  reusable?: boolean;
  /** Condition gate. */
  condition?: EffectCondition;
  /**
   * Cost paid before resolution.
   *
   * `tributeSelf` pays with the card itself rather than with something beside
   * it — Valkyrion comes apart back into the three Magnet Warriors, which is
   * the one thing the printed card does that this engine had no way to say.
   * `tributeFilter` narrows what may be paid with.
   */
  cost?: { discard?: number; tribute?: number; lp?: number; tributeSelf?: boolean; tributeFilter?: CardFilter };
  /** How many targets the activating player must pick before sending the action. */
  targets?: number;
  /** Hand-trap: this effect may be activated straight from the hand, discarding the card. */
  fromHand?: boolean;
}

export interface EffectCondition {
  /** Controller's LP must be at or below this. */
  ownLpBelow?: number;
  /** Requires at least this many cards in own Graveyard. */
  graveAtLeast?: number;
  /**
   * Requires a named card in the controller's own Graveyard — the Ultimate
   * Dragon spends a Blue-Eyes to shatter a backrow, and an ignition offered
   * with nothing to spend resolves into nothing. A button that does nothing is
   * the "card looks inert" report this file keeps relearning, so the gate is
   * part of the condition rather than left to the ops to discover.
   */
  graveHasSlug?: string;
  /** Requires a face-up card with this slug on own field. */
  requiresOnField?: string;
  /**
   * Requires *all* of these slugs on own field at once — "while you control
   * Queen's Knight and King's Knight". The royal court assembled is a state
   * the cards can ask about; one slug was never enough to express it.
   */
  requiresOnFieldAll?: string[];
  /** Requires this many counters on the card. */
  countersAtLeast?: number;
  /** Requires opponent controls at least one monster. */
  opponentHasMonster?: boolean;
  /**
   * Requires the controller to have a monster on the field — any monster.
   *
   * `controlsOtherOfType` is the type-scoped version and reads "*another*",
   * which a Spell has no self to be other than. Phoenix Formation is flown by
   * whatever Mai has standing, so it wants this one.
   */
  controlsMonster?: boolean;
  /** True while the controller has another Toon monster on the field — Dark
   *  Rabbit's mischief needs company, and never counts itself. */
  controlsOtherToon?: boolean;
  /**
   * Requires the opponent to control a Spell, Trap or Field card.
   *
   * For an effect that pays a cost before it can point at one. The Ultimate
   * Dragon feeds a Blue-Eyes back into the Deck "then destroys 1 Spell or
   * Trap" — against an empty backrow that spent the dragon and destroyed
   * nothing. The board already refused it ("nothing it can legally point at"),
   * so this is the engine agreeing with the interface rather than a new rule.
   */
  opponentHasBackrow?: boolean;
  /** Requires the named field spell to be active for either player. */
  requiresField?: string;
  /** You control at least one *other* face-up monster of this type. */
  controlsOtherOfType?: string;
  /** This card is the only monster you control. */
  controlsNoOtherMonster?: boolean;
  /** Turn number must be at least this. */
  turnAtLeast?: number;
}

/* ------------------------------------------------------------------ */
/* Runtime state                                                       */
/* ------------------------------------------------------------------ */

export interface CardFlags {
  pierce?: boolean;
  directAttack?: boolean;
  indestructibleByBattle?: boolean;
  indestructibleByEffect?: boolean;
  untargetable?: boolean;
  negated?: boolean;
  extraAttacks?: number;
  attackAll?: boolean;
  /** Battle damage this monster inflicts is halved — see `EquipGrant`. */
  halvedBattleDamage?: boolean;
  /** Direct damage halved, but only over a guarded board — see `EquipGrant`. */
  halvedDirectDamage?: boolean;
  /** Attacking directly costs the controller 500 LP — see `EquipGrant`. */
  /** Cannot attack the turn it was Summoned — see `EquipGrant`. */
  summonSick?: boolean;
  /** See the `reflectBattleDamage` grant. */
  reflectBattleDamage?: boolean;
  noBattleDamage?: boolean;
  /** Pinned down by a card on the field, not by a timed lock. */
  cannotAttack?: boolean;
  mustBeAttacked?: boolean;
  shedsAbsorbedInstead?: boolean;
}

export interface CardInstance {
  uid: string;
  slug: string;
  owner: PlayerId;
  face: Face;
  position: Position;
  /** Permanent stat modifiers (equips, level-ups). */
  atkMod: number;
  defMod: number;
  /** Modifiers that expire at the end of the current turn. */
  turnAtkMod: number;
  turnDefMod: number;
  counters: number;
  /** Slugs of cards equipped to this monster, for display. */
  equips: string[];
  /**
   * Set on an Equip Spell: the uid of the monster it is attached to. The equip
   * stays face-up in its controller's Spell/Trap Zone while active, and its
   * bonus is an aura read from here — so destroying the equip takes the bonus
   * with it, and the monster leaving takes the equip with it.
   */
  equippedTo?: string;
  flags: CardFlags;
  /** Flags that expire at end of turn. */
  turnFlags: CardFlags;
  summonedOnTurn: number;
  /**
   * The turn this monster arrived by *Special* Summon, if it did.
   *
   * `summonedOnTurn` records when a monster arrived; this records that it did
   * not pay for it. A God is worth three bodies, and Monster Reborn reads
   * either Graveyard — so without this, Slifer dying once turned it into a
   * one-card play for any of the eleven decks, including handing your own God
   * to the other side of the field permanently.
   */
  specialSummonedOnTurn?: number;
  attacksUsed: number;
  /**
   * Monsters this card has declared an attack on this turn, for "attacks every
   * monster your opponent controls once each". Optional so hand-built test
   * instances stay valid; the engine always reads it through `?? []`.
   */
  attacked?: string[];
  effectUsedOnTurn: number;
  /**
   * Turn this monster last changed battle position. A monster may do so only
   * once per turn — without that limit it can be flipped between Attack and
   * Defence indefinitely, which is a legal move that changes nothing and lets
   * a turn never end.
   */
  positionChangedOnTurn?: number;
  /**
   * Monsters absorbed by Relinquished / Thousand-Eyes Restrict.
   *
   * The owner travels with the slug. While absorbed a monster is nowhere —
   * banished, in a game with no zone to show it in — and when the holder is
   * destroyed it goes to *its own* Graveyard, which is only knowable if the
   * absorb wrote down whose it was. Bare slugs guessed, and guessed by
   * assuming the victim was always the other seat.
   */
  absorbed: { slug: string; owner: PlayerId }[];
  /** Set when control was taken; control reverts at end of that turn. */
  controlRevertsOnTurn?: number;
  /** True for Scapegoat-style tokens (cannot be tributed for a Normal Summon). */
  isToken?: boolean;
  tokenName?: string;
  tokenAtk?: number;
  tokenDef?: number;
  /** See `summonToken`'s `deathDamage`. Carried on the token itself because
   *  the card that made it is long gone by the time the token dies. */
  tokenDeathDamage?: number;
}

export interface OngoingEffect {
  id: string;
  source: string; // card slug
  kind: 'skipDraw' | 'skipBattlePhase' | 'freezeMonsters' | 'preventBattleDamage';
  /** Player the effect is applied to. */
  target: PlayerId;
  /** Turns remaining; decremented at the end of the affected player's turn. */
  turns: number;
}

export interface PlayerState {
  id: PlayerId;
  duelistId: string;
  name: string;
  lp: number;
  deck: CardInstance[];
  hand: CardInstance[];
  monsters: (CardInstance | null)[];
  spellTrap: CardInstance | null;
  field: CardInstance | null;
  grave: CardInstance[];
  banished: CardInstance[];
  extra: CardInstance[];
  normalSummonUsed: boolean;
  /** True once this player has connected and locked in their duelist. */
  ready: boolean;
}

/** A decision the engine is waiting on before it can continue. */
export interface Pending {
  kind: 'trap';
  player: PlayerId;
  /** uids of cards that could be activated right now. */
  options: string[];
  /** What caused this window, for the prompt text. */
  reason: string;
  context: TriggerContext;
}

export interface TriggerContext {
  attackerUid?: string;
  targetUid?: string;
  sourceUid?: string;
  damage?: number;
}

export type AnimKind =
  | 'summon'
  | 'attack'
  | 'directAttack'
  | 'destroy'
  | 'damage'
  | 'heal'
  | 'activate'
  | 'draw'
  /**
   * A card leaving a hand for a Graveyard.
   *
   * `discard` logged and did not animate, so its line was picked up by whatever
   * beat happened to be on screen — the Spell that caused it — and the card
   * itself was never shown going anywhere. Reported of Giant Trunade as "the
   * discarded card did not go in the graveyard, it's gone". Nothing was lost;
   * the board simply never said it had happened.
   */
  | 'discard'
  | 'flip'
  | 'trap'
  | 'fusion'
  | 'win'
  | 'phase'
  /** A log line with no animation of its own, given its own beat on the field. */
  | 'note';

export interface AnimEvent {
  id: string;
  kind: AnimKind;
  player?: PlayerId;
  uid?: string;
  targetUid?: string;
  slug?: string;
  /** The cards this one was made from — the Fusion Materials, so the board can
      show them becoming the monster rather than just announcing the result. */
  from?: string[];
  /** The log line this beat is announcing. Every line the duel records gets one:
      the log is a memory aid, not somewhere to go and find out what happened. */
  note?: string;
  /** The log tone, so the board can colour the line the same way. */
  tone?: string;
  amount?: number;
  /** Life Points that actually moved, when `amount` is the headline figure and
      the total could not absorb all of it. A 1900 attack into 1200 Life Points
      is announced as 1900 and only ever moves the bar by 1200 — the board adds
      queued damage back to reconstruct what has not been said yet, and adding
      the headline number back put the total *above* where it started. */
  applied?: number;
  /** Display name when it is not the card's own — a Token's, whose art comes
      from the card that made it but which is not that card. */
  as?: string;
  text?: string;
  /** This effect fired *because the card arrived*, not because it was played.
      A card with several effects otherwise announces every one of them with
      the same bare "…'s effect activates", so a monster whose famous effect is
      something else entirely reads as that one going off: reported of Slifer,
      whose draw-on-summon rider looked exactly like the second mouth. The
      board says the card's cry instead, which belongs to the arrival. */
  arrival?: boolean;
}

export interface LogEntry {
  id: string;
  turn: number;
  player?: PlayerId;
  text: string;
  tone?: 'normal' | 'attack' | 'effect' | 'damage' | 'summon' | 'system';
  /**
   * The card this line is about, so the beat announcing it can show its face.
   *
   * A line with no beat of its own gets one — see `speakRemainingLog` — and
   * that beat had nothing to draw, so the board printed "Battle Ox gains 300
   * ATK" over empty space. Reported as art missing from some banners. The
   * writer of the line is the only thing that knows which card it means, so it
   * says so here rather than the board guessing from the words.
   */
  slug?: string;
}

export interface DuelState {
  players: Record<PlayerId, PlayerState>;
  turn: number;
  active: PlayerId;
  phase: Phase;
  ongoing: OngoingEffect[];
  log: LogEntry[];
  /** How much of the log has already been paired with an animation beat. */
  logShown?: number;
  anims: AnimEvent[];
  pending: Pending | null;
  winner: PlayerId | 'draw' | null;
  winReason?: string;
  /**
   * Triggered effects flagged `oncePerTurn` that have already fired this turn,
   * keyed `controller:slug:trigger`. Kept on the state rather than the card
   * because the case it exists for is a card that dies and comes back —
   * `resetInstance` wipes anything held on the instance itself.
   *
   * Optional so a duel already in flight through a deploy keeps working; every
   * read goes through `?? []`.
   */
  oncePerTurnUsed?: string[];
  seed: number;
  /**
   * Stable for the life of one duel, unlike `seed`, which advances every time
   * the engine rolls anything. The server keys the computer's per-turn plan on
   * it: keyed by turn number alone, a rematch's turn 3 collided with the
   * previous duel's turn 3 and the bookkeeping carried straight over.
   */
  duelId?: string;
  version: number;
  /** Monotonic counter for card instance ids; lives in state so duels stay reproducible. */
  uidSeq: number;
  /** Set while a battle is paused waiting on a trap response. */
  suspendedAttack?: { attackerUid: string; targetUid: string | null } | null;
}

/* ------------------------------------------------------------------ */
/* Player actions                                                      */
/* ------------------------------------------------------------------ */

export type DuelAction =
  | { type: 'normalSummon'; uid: string; zone: number; position: Position; face: Face; tributes?: string[]; targets?: string[] }
  /** `targets` for a Flip Summon: the monster is being turned face-up on
   *  purpose, in your own Main Phase, so its FLIP effect has somebody to ask.
   *  Man-Eater Bug flipped by an attack still has nobody, and the engine
   *  answers for it there. */
  | { type: 'changePosition'; uid: string; targets?: string[] }
  | { type: 'activateSpell'; uid: string; targets?: string[]; zone?: number }
  | { type: 'setSpellTrap'; uid: string }
  | { type: 'activateSetCard'; uid: string; targets?: string[] }
  | { type: 'ignition'; uid: string; targets?: string[] }
  /** Spend a card out of the hand for its `handDiscard` effect. */
  | { type: 'discardForEffect'; uid: string; targets?: string[] }
  | { type: 'fusionSummon'; extraUid: string; materials: string[]; zone: number; position: Position; targets?: string[] }
  | { type: 'attack'; uid: string; targetUid: string | null }
  | { type: 'respondTrap'; uid: string | null; targets?: string[] }
  | { type: 'toPhase'; phase: Phase }
  | { type: 'endTurn' }
  | { type: 'surrender' };
