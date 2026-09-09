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
  /**
   * The only effects that may put this monster on the field. Set it and the
   * card cannot be Normal Summoned or Set at all, and no Special Summon
   * reaches it either — not Monster Reborn, not a revival, not another card's
   * search-and-summon — except one of the named cards' own effects.
   *
   * The Perfectly Ultimate Great Moth is the reason: it is the top of a ladder
   * you climb, and a Monster Reborn that skipped every rung made the whole
   * climb pointless. Written as a list of slugs rather than a boolean because
   * the ladder has two legal roads to the top — the Great Moth that hands it
   * up, and the Cocoon of Evolution that has grown all the way.
   */
  summonOnlyBy?: string[];
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
  /**
   * The card left a Monster Zone — by ANY road: broken in battle, swept by an
   * effect, spent as a Tribute or a cost, shuffled away, banished, or simply
   * returned to a hand. `onAnyToGrave` is the narrower promise (it means the
   * Graveyard and only the Graveyard); this one means "however it went".
   *
   * Queued as it happens and resolved once the action that caused it has
   * finished, which is not tidiness: a trigger that summons cannot be allowed
   * to fill the very zone the Summon paying for it is headed to. That exact
   * fault refused a Tribute Summon outright — the tributes gone, the monster
   * they bought denied — and the deferral is what makes it land.
   */
  | 'onLeaveField'
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
  /**
   * This card reached a Graveyard from *anywhere* — the field, a hand, the top
   * of a Deck, spent as somebody's cost.
   *
   * `onSentToGrave` is the field-only version and stays that way: ten cards
   * read it and every one of them says "when this card is sent to the
   * Graveyard" about a card that was in play. Uraby is the first that means it
   * about a card that was never on the board at all, and widening the old
   * trigger to suit it would have handed a milled Sangan a free Special Summon.
   */
  | 'onAnyToGrave'
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
  /**
   * End of *any* turn, whoever is taking it.
   *
   * Cocoon of Evolution thickens on a clock rather than on a player: "gains 1
   * Evolution Counter at the end of each turn" is twice the rate of an
   * own-turn counter and is what the shell is priced at.
   */
  | 'onAnyTurnEnd'
  /** Spell activation. */
  | 'activate'
  /** Manual once-per-turn activation from the field during Main Phase. */
  | 'ignition'
  /**
   * Activated from the hand, paying the effect's cost, to put this very card
   * on the field. Not `handDiscard`, which spends the card itself and never
   * reaches the field — this is the opposite: something else is spent so that
   * *this* arrives. Megazowler and Sword Arm of Dragon both buy their way down
   * for a card off the top of your hand.
   */
  | 'handSummon'
  /**
   * *You* summoned a monster, and this card is watching from your hand or your
   * Graveyard rather than from the field.
   *
   * Every other trigger in this list fires on a card that is already in play.
   * Mad Sword Beast is the first one that answers from off the board: any
   * Dinosaur arriving calls it out of wherever it is waiting. Gate it with
   * `condition.summonedIs` — an unfiltered one would answer every summon in
   * the duel, including its own arrival.
   */
  | 'onAllySummon'
  /**
   * This Equip card's host was destroyed, and the equip has just followed it
   * into the Graveyard.
   *
   * Not `onSentToGrave` on the equip, which cannot tell a destruction from a
   * bounce, a banish or a Tribute, and which also fires when the equip itself
   * is the card that was shattered. Metalmorph means the monster.
   */
  | 'onHostDestroyed'
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
  /**
   * Everything *except* this kind, which is how "a magic card" is written: a
   * Spell or a Trap or a Field Spell, but not a monster. Two ops — one filtered
   * to Spells, one to Traps — is not the same sentence, because each carries
   * its own count and a card allowed four discards took four of each.
   */
  notKind?: CardKind;
  minLevel?: number;
  maxLevel?: number;
  minAtk?: number;
  maxAtk?: number;
  nameIncludes?: string;
  slugs?: string[];
  /** An Extra Deck Fusion. Sparkman is worth 1000 for each one in the pile, and
   *  "Fusion" is a thing about the card rather than about its type or name. */
  isFusion?: boolean;
  /** Pegasus's cartoon monsters — see `isToon`, which knows the ones the name
      does not give away. */
  toon?: boolean;
  /**
   * A monster that does something when it is turned face-up. Gravekeeper's Spy
   * digs out something worth setting, and "worth setting" is exactly this —
   * asked of the card's own effects rather than kept as a list that would
   * fall out of date the first time a FLIP card was added.
   */
  hasFlipEffect?: boolean;
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
   * "Up to." An unanswered pick takes nothing rather than the best thing going.
   *
   * Every other `chosen` selector falls back to the strongest legal card when
   * nobody named one, because the alternative is an effect that fizzles where
   * there was nobody to ask. An optional one is the opposite: declining is a
   * real answer, and Uraby lets you shatter two backrow cards, or one, or
   * neither — including your own, which is exactly the choice a fallback would
   * make for you and get wrong.
   */
  optional?: boolean;
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
  /** `plusPerCounter` is a base plus a rate, which is what a card that grows
   *  actually reads like: Red-Eyes blasts for 800 "plus 400 for each monster it
   *  has destroyed in battle". A `scale` alone could not say it — every scale
   *  here multiplies `amount`, so an unfed dragon would blast for nothing. */
  | {
      op: 'damage';
      amount?: number;
      /** `dicePips` reads the roll back after it, the way `gainAtk` does: a
       *  burn written inside `perPip` runs once a pip and announces itself
       *  every time, so a six was six banners for one die. */
      scale?: 'targetAtk' | 'selfAtk' | 'halfTargetAtk' | 'perOppMonster' | 'perOppHandCard' | 'tributedAtk' | 'perDestroyed' | 'destroyedAtk' | 'dicePips';
      plusPerCounter?: number;
      to: Side;
    }
  /** `scale` reads the same number `damage`'s does: what this effect's own
   *  destructions were worth, taken while they were still standing. Elemental
   *  HERO Steam Healer is paid exactly what it kills. */
  | { op: 'heal'; amount?: number; scale?: 'destroyedAtk'; to: Side }
  /** `perCardInGrave` and `dicePips` both multiply `amount`, so the rate is
   *  written on the card: Headless Knight counts 100 a corpse, the Magician of
   *  Black Chaos counts 200. `perMonsterOnField` still carries its own 300. */
  | {
      op: 'gainAtk';
      amount?: number;
      scale?:
        | 'targetAtk'
        | 'perCardInGrave'
        | 'perCardInEitherGrave'
        | 'perMonsterOnField'
        /**
         * `amount` for each of the controller's own monsters matching `filter`.
         *
         * `perMonsterOnField` above carries a hardcoded 300 and counts every
         * body — Hero Barrier takes a thousand out of the attacker for each
         * HERO standing behind it, which is that shape with the card's own
         * number and the card's own idea of who counts.
         */
        | 'perOwnMonster'
        | 'perCardInEitherHand'
        | 'dicePips';
      /**
       * Narrows what the Graveyard scales count. Sword Arm of Dragon is worth
       * 150 for each of *two named cards* in the pile, not for the pile — and
       * without this the scale could only ever say "every card down there".
       */
      filter?: CardFilter;
      /**
       * A flat bonus on top of whatever the scale came to.
       *
       * "1000 ATK, and 500 more for each HERO in your Graveyard" is one
       * sentence about one monster, and without this it took two ops — which
       * meant two `chosen` selectors and the player being asked twice which
       * monster they meant.
       */
      plus?: number;
      target: Selector;
      duration: Duration;
    }
  /** `scale` multiplies `amount` the same way `gainAtk`'s does — the Perfectly
   *  Ultimate Great Moth counts every card in both Graveyards, in both stats. */
  | { op: 'gainDef'; amount: number; scale?: 'perCardInGrave' | 'perCardInEitherGrave'; target: Selector; duration: Duration }
  /**
   * Everything you have left, poured into one body.
   *
   * The controller pays Life Points down to `leave`, and the target gains
   * exactly what was paid. One op rather than a cost beside a scaled `gainAtk`,
   * because the amount is only knowable at the moment it is spent and threading
   * it from a cost into an op that runs afterwards would be a second mechanism
   * for one sentence.
   *
   * The whole of it is the trade: Ra becomes the biggest thing on the table and
   * its owner becomes something any burn effect or unanswered swing can finish.
   * Nothing gives the Life Points back yet — the card that would is Diffusion,
   * and it is not in this game.
   */
  | { op: 'burnLifeForAtk'; leave: number; target: Selector; duration: Duration }
  | { op: 'setAtk'; value: number; target: Selector }
  | { op: 'halveAtk'; target: Selector }
  | { op: 'swapAtkDef'; target: Selector }
  | { op: 'destroy'; target: Selector }
  /**
   * Sent to the Graveyard without being destroyed.
   *
   * The moths climb this way: Petit Moth is not killed at the start of your
   * turn, it leaves and something bigger arrives. `onSentToGrave` fires and
   * `onDestroyed` does not, which is the whole difference — a card that
   * answers destruction should not answer a moult.
   */
  | { op: 'sendToGrave'; target: Selector }
  | { op: 'banish'; target: Selector }
  | { op: 'bounce'; target: Selector }
  /** `turns` is how many turns a non-permanent borrowing lasts; 1 by default,
   *  which is the end of the turn it was taken on. */
  /** `rent` is Life Points the taker pays the monster's owner at the start of
   *  each of their own turns, for as long as they keep it — Snatch Steal's
   *  price, and the only thing that makes a permanent theft answerable. */
  | { op: 'takeControl'; target: Selector; duration: Duration; turns?: number; rent?: number }
  | { op: 'draw'; count: number; who: Side }
  /**
   * Draws up to a hand size rather than a fixed number — "each player draws
   * until they hold 6". Card of Sanctity, which is the card that makes Slifer
   * terrifying, and it refills the opponent just as generously.
   */
  | { op: 'drawTo'; count: number; who: Side }
  /** `all` discards the whole hand and ignores `count` — Manga Ryu-Ran wipes
   *  both hands, and a number would have to be a lie big enough to cover any. */
  | {
      op: 'discard';
      count: number;
      who: Side;
      all?: boolean;
      /**
       * Multiplies `count` by something the board can count. Tribute to the
       * Doomed takes a card for each monster the discarding player is hiding
       * behind, so a wide board pays for its own width.
       */
      scale?: 'perTheirMonster';
      /**
       * Only cards like this. Blast Sphere reaches into the hand for Spells and
       * Traps alone, which is a different thing from a random discard: it is
       * removal that happens to land somewhere private.
       */
      filter?: CardFilter;
      /**
       * Take `count` *minus what this same effect already destroyed*.
       *
       * R - Righteous Justice is one number spent across two places: it breaks
       * what is on the table first and reaches into the hand for whatever is
       * left over. Written as one op rather than four branches, because the
       * arithmetic is the card.
       */
      minusDestroyed?: boolean;
    }
  /**
   * Roll `count` dice and ask whether any of them can be made to total seven —
   * two of them added, all three added, or all three with one subtracted. Slot
   * Machine's whole card, and 132 of the 216 ways three dice can fall.
   *
   * The dice and the verdict are both announced: a card that turns on a
   * calculation has to show its working, or it reads as the engine deciding.
   */
  | { op: 'diceMakeSeven'; count: number; onSuccess: Op[]; onFail?: Op[] }
  /**
   * The first branch whose condition holds, and only that one. Barrel Dragon
   * takes a monster if there is one, else a Spell or Trap, else a card out of
   * their hand — one shot that falls through until it finds something.
   */
  | { op: 'cascade'; branches: Array<{ condition?: EffectCondition; ops: Op[] }> }
  /** This monster rolls to shrug off destruction — see `CardFlags`. */
  | { op: 'rollsToSurvive'; duration: Duration }
  /** `scale` multiplies `count` by something on the board. Blast Held by a
   *  Tribute buries "one for each monster they control", so the price of
   *  answering a wide board is paid out of your own Deck. */
  | { op: 'mill'; count: number; scale?: 'perOppMonster'; who: Side }
  /**
   * Deck and Graveyard change places, for both players at once, and the new
   * Deck is shuffled.
   *
   * Exchange of the Spirit turns the whole game over: everything spent becomes
   * everything left, and the pile you have been feeding all duel is suddenly
   * what you draw from. Written as its own op rather than as a pile of moves
   * because the shuffle is part of the swap — a Graveyard is a *stack* whose
   * order both players have watched being built, and handing it back in that
   * order would be handing over a known Deck.
   */
  | { op: 'swapDeckAndGrave' }
  /** The Fist of Fate: this monster's ATK stops being a number. */
  | { op: 'infiniteAtk'; duration: Duration }
  /**
   * Dig down through your own Deck, burying everything, until you turn over a
   * monster the filter accepts — then Special Summon that one instead of
   * burying it. Trakodon's whole card: it pays for the summon in fossils, and
   * a bad dig is a real cost rather than a rounding error.
   *
   * Nothing found means the Deck is empty and everything went to the
   * Graveyard, which the log says out loud.
   */
  | { op: 'millUntilSummon'; filter?: CardFilter; position?: Position }
  /**
   * Keep drawing until a card the filter accepts arrives in hand. Sabersaurus
   * refills off its own funeral: "draw until you draw a monster", which is one
   * card on a healthy deck and a fistful on a deck full of Spells.
   */
  | { op: 'drawUntil'; filter?: CardFilter; who: Side }
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
  /**
   * `pick` is the card naming its own rule, and the difference between "add 1
   * monster from your Deck" and "add *the strongest* monster from your Deck".
   * The first is a decision and its owner is asked; the second is not a
   * decision at all, and a prompt there would be the game asking a question
   * the card has already answered. Left unset for every search that means "1
   * of these", which is nearly all of them.
   */
  | { op: 'search'; filter: CardFilter; count?: number; orGrave?: boolean; pick?: 'strongest' | 'weakest' }
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
  /**
   * `fleeting` tokens are swept at the end of the turn they arrived on. The
   * Millennium Ankh buys three bodies for a thousand Life Points and they are
   * gone by the End Phase — bought to be *spent*, on a Tribute or a cost,
   * rather than to hold a board.
   */
  /**
   * `scale` gives a Token stats that keep moving: "?/?" on the card, and a real
   * number read off the board every time anyone looks. The serpents are worth
   * what the Graveyards hold, so they grow through a duel without anything
   * having to remember to update them.
   */
  | {
      op: 'summonToken';
      name: string;
      atk: number;
      def: number;
      count: number;
      artSlug?: string;
      position?: 'atk' | 'def';
      deathDamage?: number;
      fleeting?: boolean;
      scale?: { zone: 'ownGrave' | 'eitherGrave'; filter?: CardFilter; atk: number; def: number };
    }
  /**
   * Hands the controller the right to Tribute monsters they do not own, for
   * this turn only. Soul Exchange lends you up to two of theirs: they stay on
   * their side of the field and cannot be attacked with — the only thing you
   * may do with them is spend them.
   */
  | { op: 'lendForTribute'; target: Selector }
  /**
   * Puts a Trap from your Deck or Graveyard straight into the Spell/Trap Zone,
   * face-down. `toHandIfOccupied` sends it to the hand instead when the zone is
   * already taken — Mask of Darkness would otherwise be a blank on exactly the
   * board a trap deck usually has.
   */
  | { op: 'setTrap'; from: 'deck' | 'grave'; toHandIfOccupied?: boolean }
  /**
   * Choose a card in your Deck now; your next draw is that card instead of
   * whatever is on top. The Temple decides what the future holds, which is the
   * one thing a Field Spell in this deck should be able to do.
   */
  | { op: 'destinyDraw' }
  /**
   * The scorpion's whole bargain, granted as one thing because it only makes
   * sense as one thing: it swallows what it kills in battle, counts each meal
   * at half ATK and DEF, attacks once more for each, and answers a card effect
   * that would destroy it by giving up everything it holds instead.
   */
  | { op: 'devourOnBattleDestroy'; duration: Duration }
  /**
   * Takes control of a monster and starts a clock on it. The possessed body
   * cannot attack, and after `endPhases` end phases *of the player who took
   * it* it is destroyed.
   */
  | { op: 'possess'; target: Selector; endPhases: number }
  /**
   * The attacker and the monster it is attacking change sides with each other.
   *
   * Mirror Gate, and only Mirror Gate: no selectors, because the two monsters
   * are the two the battle already names. A swap rather than a theft — nobody
   * ends up with a spare zone or a body short, so it works on a full board,
   * which a `takeControl` never could at the moment it matters most.
   *
   * The blow does not land: taking the attacker calls the attack off, which is
   * the engine's own rule and needs nothing said on the card. What is left is
   * the picture the card is famous for — their best monster standing on your
   * side of the field, looking back at them.
   */
  | { op: 'swapControl'; target?: Selector }
  /**
   * Fusion Material goes home rather than staying dead.
   *
   * A Fusion monster in a Graveyard is a card nothing can reach — it cannot be
   * searched, and reviving it is a different sentence. Fusion Recovery and
   * Wroughtweiler both put one back where it can be summoned again, which is
   * what makes a deck of fourteen fusions and one of each material playable.
   */
  | { op: 'returnToExtra'; target: Selector }
  /**
   * The card whose effect this is goes back to its owner's hand from wherever
   * it is. Winged Kuriboh is thrown away as a cost and comes straight back,
   * which is a thing no `bounce` can say: `bounce` reaches for a card on the
   * field, and this one is in the Graveyard by the time it speaks.
   */
  | { op: 'returnSelfToHand' }
  /**
   * This monster attacks every monster the opponent controls, once each, right
   * now — whichever way they are standing.
   *
   * Mirror Gate: the body you just took turns round and goes through the board
   * it was standing in. Resolved through the ordinary battle machinery, one
   * battle at a time, so piercing, protection, flip effects and everything a
   * kill pays out all behave exactly as they do on a declared attack.
   */
  | { op: 'onslaught'; target: Selector }
  | { op: 'transformInto'; slug: string }
  | {
      op: 'addCounter';
      amount: number;
      /** Ceiling. The Cocoon thickens to four and stops — past the top rung
       *  there is nothing further to hatch into, so the clock stops with it. */
      max?: number;
      /** What the counter is called on the board. The Cocoon's are Evolution
       *  Counters and were the only ones in the game, so the name was written
       *  into the log line — which would have had Red-Eyes evolving every time
       *  it burned something down. */
      label?: string;
    }
  | { op: 'negateAttack' }
  | { op: 'endBattlePhase' }
  | { op: 'extraAttacks'; count: number; duration?: Duration }
  | { op: 'attackAllMonsters' }
  | { op: 'directAttack'; duration: Duration }
  | { op: 'halvedBattleDamage'; duration: Duration }
  | { op: 'halvedDirectDamage'; duration: Duration }
  | { op: 'reflectBattleDamage'; duration: Duration }
  /** Swings at twice its ATK — Metalzoa going out, Metalmorph's host with it. */
  | { op: 'doublesWhenAttacking'; duration: Duration }
  /** Extra ATK that only counts against a Defence Position monster. */
  | { op: 'bonusVsDefense'; amount: number; duration: Duration }
  /** Whatever attacks this monster swings at half — Metalzoa coming in. */
  | { op: 'halvesAttacker'; duration: Duration }
  | { op: 'pierce'; duration: Duration }
  | { op: 'preventBattleDamage'; who: Side; duration: Duration }
  /**
   * Nothing that side controls can be destroyed in battle, including monsters
   * that arrive later.
   *
   * Its neighbour above stops the damage; this stops the dying. Tornado Wall
   * raises both, and it has to reach a side rather than a card, because the
   * waterspouts stand between the whole board and the attack — a grant written
   * onto the monsters present when it went up would leave the next one to walk
   * in unprotected.
   */
  | { op: 'preventBattleDestruction'; who: Side; duration: Duration }
  | { op: 'indestructibleByBattle'; duration: Duration }
  | { op: 'indestructibleByEffect'; duration: Duration }
  /** A card effect that would destroy this monster takes it out of play until
   *  the End Phase instead, and pays its controller `pays` Life Points for the
   *  attempt. Battle is untouched — see the `EquipGrant` of the same name. */
  | { op: 'banishesInsteadOfDying'; pays?: number; duration: Duration }
  /**
   * Destruction is paid for out of the Graveyard instead of being suffered.
   *
   * Relinquished's `shedsAbsorbedInstead` with a different purse: while your
   * Graveyard holds a monster of this card's own type, being destroyed banishes
   * one of them and this stays where it is. The Perfectly Ultimate Great Moth
   * feeds on its own hive, and when the hive is gone it dies like anything.
   */
  | { op: 'paysWithGraveInstead'; duration: Duration }
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
  | {
      op: 'equipTo';
      atk: number;
      def: number;
      grants?: EquipGrant[];
      target?: Selector;
      /** What it may be strapped to. 7 Completed bolts onto Machines alone. */
      filter?: CardFilter;
      /** Extra ATK that only counts against a monster in Defence Position. */
      bonusVsDefense?: number;
    }
  | { op: 'revealHand'; who: Side }
  | { op: 'shuffleIntoDeck'; target: Selector }
  /**
   * This card is owed back to the field at the start of its controller's next
   * turn, bigger than it left. Crawling Dragon only pays out when *battle*
   * kills it — a card effect puts it down for good — so the sentence is worth
   * something to play around rather than an unconditional second life.
   */
  | { op: 'reviveSelfNextTurn'; atk?: number; def?: number }
  /**
   * Put the card whose effect this is onto the field, from wherever it is
   * waiting — a hand or a Graveyard. The half of `handSummon` and
   * `onAllySummon` that does the arriving; both triggers fire on a card that
   * is nowhere near the board, so neither can use the ordinary `specialSummon`
   * that reaches into a zone and picks something out.
   */
  | { op: 'summonSelf'; position?: Position; face?: Face }
  /** Every swing this monster makes costs a card out of its controller's hand. */
  | { op: 'attackCostDiscard'; duration: Duration }
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
  | {
      op: 'coinFlip';
      heads: Op[];
      tails: Op[];
      /**
       * Flip this many, and run the branch once for each coin that came up
       * that way. Barrel Dragon's three barrels: three heads is three shots,
       * and the log says how many landed rather than narrating each flip.
       */
      count?: number;
    }
  /**
   * Runs one branch chosen by how many counters the source is carrying —
   * the highest tier it has reached, like `coinFlip` but decided by the board
   * rather than by chance. Cocoon of Evolution hatches whatever it has grown
   * far enough to hatch.
   */
  | { op: 'byCounters'; tiers: { at: number; ops: Op[] }[] }
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
  /** Every swing costs a card out of hand — Two-Headed King Rex feeds itself. */
  | 'attackCostDiscard'
  /** Attacks at twice its ATK. Metalmorph and Metalzoa both hit like this. */
  | 'doublesWhenAttacking'
  /** The first battle that would kill it turns it face-down instead — see `CardFlags`. */
  | 'flipsInsteadOfDying'
  /** A card EFFECT that would destroy it takes it out of play until the End
   *  Phase instead, and its controller is paid for the trouble. It comes back
   *  standing the way it left. Battle still kills it, which is what keeps it
   *  answerable: put something bigger in front of it. */
  | 'banishesInsteadOfDying'
  /** Anything that attacks it does so at half strength. */
  | 'halvesAttacker'
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
  /** Anything attacking this monster swings 1000 lighter, for that battle
   *  only — Insect Barrier stretched across the hive. */
  | 'sapsAttacker'
  /** See the `paysWithGraveInstead` op. */
  | 'paysWithGraveInstead'
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
  | 'reflectBattleDamage'
  /**
   * Swings 1000 heavier whenever it attacks — Skyscraper, which is the whole
   * of Jaden's field.
   *
   * It began as "only against a bigger monster", which is the printed card and
   * which the owner took the restriction off: the city rises behind a HERO
   * going forward, full stop. A flag rather than a number, the way
   * `sapsAttacker` is — the amount is the card's, the rule is the battle's.
   */
  | 'surgesOnAttack'
  /**
   * No Spell and no Trap can touch it. Elemental HERO Wildheart walks through
   * Mirror Force, through Trap Hole, through a Spellbinding Circle and through
   * a Dark Hole alike — an effect on either kind of card that would take him as
   * a target finds nothing there.
   *
   * Narrower than `untargetable` still: another monster's effect reaches him,
   * and so does a bigger body.
   */
  | 'unaffectedBySpellsAndTraps'
  /**
   * Nothing may declare an attack on it. Winged Kuriboh LV10 is not a wall you
   * break, it is a thing that is not there when the blow arrives.
   */
  | 'cannotBeAttacked'
  /**
   * Standing here does not stop a direct attack.
   *
   * The other half of the same card: the little one flies over the fight rather
   * than joining it, so with LV10 alone on your side the opponent may swing
   * straight past it at you. Separate from `cannotBeAttacked` because a card
   * could want either without the other.
   */
  | 'doesNotBlock';

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
    /** Stats per Evolution Counter on the card the aura is landing on. The
     *  moths are worth what they have grown, read live so a counter added this
     *  turn is worth its ATK this turn. */
    perCounter?: { atk?: number; def?: number };
    per?: {
      /**
       * Where to count: one side's Graveyard or both, one side's field or both,
       * or the controller's hand — which is Slifer, whose ATK is "1000 for each
       * card in your hand" and therefore falls the moment you spend one.
       */
      zone: 'ownGrave' | 'oppGrave' | 'eitherGrave' | 'ownField' | 'oppField' | 'field' | 'ownHand' | 'ownDeck';
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
    /**
     * This aura holds while its own card is face-down.
     *
     * Every other aura in the game is weather cast by a card that is showing —
     * a card back promises nothing, and that is the right default. Elemental
     * HERO Clayman is the exception the owner asked for: he is a wall whether
     * or not you have turned him over, so what he does he does from under the
     * card back too.
     */
    evenFaceDown?: boolean;
  };
  /** Effect only usable once per turn (ignition effects default to true). */
  oncePerTurn?: boolean;
  /**
   * `onAttacked` only: this waits for the damage step instead of replacing it.
   *
   * An `onAttacked` effect that removes the attacker calls the whole battle
   * off — which is exactly right for a card whose promise is that the attack
   * never lands, and exactly wrong for one whose text says it acts *after the
   * damage step*. Wall of Illusion says the latter and was doing the former:
   * a 1700 walked into it, was sent home, and the wall neither took the blow
   * nor fell to it. Reported from a real duel.
   *
   * Marked here rather than inferred from the ops, because which one a card
   * is, is a claim its own text makes. The engine reads the flag and nothing
   * else: any future "after damage" answer inherits the sequencing for free.
   */
  afterDamage?: boolean;
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
  cost?: {
    discard?: number;
    tribute?: number;
    lp?: number;
    /**
     * Multiplies `lp` by something the board can count. Tribute to the Doomed
     * is priced at what their hand is worth: a thousand a card, so it is cheap
     * against a player in topdeck mode and unaffordable against a full grip —
     * which is the whole card. Read as a cost rather than as damage so the
     * engine refuses an activation nobody can pay, instead of letting a player
     * (or the AI) spend their last Life Points on it.
     */
    lpScale?: 'perOppHandCard';
    /** Your whole hand, and there has to be one — Cannon Soldier's new price. */
    discardHand?: boolean;
    /** Removes a named card from your Graveyard from the game to pay for this. */
    banishFromGrave?: string;
    /** Cards off the top of your own Deck, into your own Graveyard. A price
     *  the Shining Dragon pays in the very thing it is made of. */
    mill?: number;
    tributeSelf?: boolean;
    tributeFilter?: CardFilter;
  };
  /** How many targets the activating player must pick before sending the action. */
  targets?: number;
  /** Hand-trap: this effect may be activated straight from the hand, discarding the card. */
  fromHand?: boolean;
}

export interface EffectCondition {
  /**
   * For `onAllySummon`: what the monster that just arrived has to be. Without
   * it the trigger answers every summon there is, its own included.
   */
  summonedIs?: CardFilter;
  /** Controller's LP must be at or below this. */
  ownLpBelow?: number;
  /**
   * Controller's LP must be at or above this — the mirror of `ownLpBelow`, and
   * the gate on an effect whose price is the Life Points themselves.
   *
   * Ra pours everything it has into its own ATK and leaves 1, so at 1 there is
   * nothing left to pour: without this the button was still offered, spent the
   * once-per-turn, and announced that nothing had happened. A card is never
   * spent on nothing — see `activationIsDead`, which is the same rule asked
   * about targets rather than about Life Points.
   */
  ownLpAtLeast?: number;
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
  /** The same gate by kind rather than by name — "1 Dragon in your Graveyard"
   *  is a cost a card can name without naming a card. */
  graveHas?: CardFilter;
  /** A Spell or Trap stands SOMEWHERE — either side of the table. The
   *  opponent-only gate is the common one, and it is wrong for a card whose
   *  text does not name a side: Luster Dragon shatters "1 Spell or Trap", and
   *  gating it on the opponent's backrow left it inert while its owner's own
   *  Set card sat there waiting to be cleared. Reported. */
  anyBackrow?: boolean;
  /** The opponent is holding at least one card. */
  opponentHasHand?: boolean;
  /**
   * This monster was Special Summoned by one of these cards' effects.
   *
   * Metalzoa is what Zoa becomes, and only that: summoned any other way — off
   * the top of a hand for two Tributes, dragged back by Time Machine, revived
   * by Monster Reborn — it is the same 3000 body with none of the text. The
   * transformation is the card, so the route it arrived by is the condition.
   *
   * Not `summonOnlyBy`, which forbids every other route outright. Those summons
   * are all perfectly legal; they just do not wake anything up.
   */
  summonedBy?: string[];
  /**
   * This many copies of a named card, face-up on your own field. Ra's Disciples
   * stand together or not at all — two of them are ordinary 1100 bodies and the
   * third is what makes the set unbreakable.
   */
  controlsCopies?: { slug: string; atLeast: number };
  /** Requires a face-up card with this slug on own field. */
  requiresOnField?: string;
  /**
   * "While you control **another** Bowganian" — the card asking must not count
   * as its own company.
   *
   * Bowganian was the one card whose condition named its own slug, and without
   * this the condition could never be false: a lone crossbow saw a Bowganian on
   * the field, namely itself, and helped itself to +800 ATK and immunity to
   * battle it was never meant to have alone. The same word, "other", is why
   * `Selector.excludeSelf` and `controlsOtherToon` exist.
   */
  excludeSelf?: boolean;
  /**
   * Requires *all* of these slugs on own field at once — "while you control
   * Queen's Knight and King's Knight". The royal court assembled is a state
   * the cards can ask about; one slug was never enough to express it.
   */
  requiresOnFieldAll?: string[];
  /** Requires this many counters on the card. */
  countersAtLeast?: number;
  /**
   * This card was lying face-down. Only `onDestroyed` can usefully ask — every
   * standing-on-the-field trigger is already gated on face-up — and Statue of
   * the Wicked is the card that needed it: destroying it under its own card
   * back is answered differently from destroying it after it has resolved.
   */
  faceDown?: boolean;
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
  /**
   * You control a face-up monster whose printed name contains this.
   *
   * An archetype is a name, not a type. Righteous Justice reads "if you control
   * an 'Elemental HERO' monster" and was gated on controlling a Warrior, which
   * is the same set only for as long as this one deck is the only place the
   * card is played — a borrowed Gaia would have opened it. A card should be
   * gated on the sentence it prints.
   */
  controlsNameIncludes?: string;
  /**
   * A face-up monster of this type is on the field — *either* side of it.
   *
   * Eradicating Aerosol needs a bug to spray, and does not care whose bug it
   * is. Face-up deliberately: a card back is not known to be an Insect, and an
   * activation the board allowed because of what was hiding under one would be
   * telling you what it is.
   */
  typeOnField?: string;
  /** This card is the only monster you control. */
  controlsNoOtherMonster?: boolean;
  /**
   * This card is the only monster in its controller's hand.
   *
   * Bladedge comes down free when there is nothing else to play — the price is
   * an empty grip rather than two Tributes, which is what makes a 2600 the top
   * of a deck whose next-biggest body is 1600.
   */
  onlyMonsterInHand?: boolean;
  /** Turn number must be at least this. */
  turnAtLeast?: number;
}

/* ------------------------------------------------------------------ */
/* Runtime state                                                       */
/* ------------------------------------------------------------------ */

/**
 * What "infinite ATK" is worth in a game made of numbers.
 *
 * Large enough that nothing on the roster can stand in front of it and the
 * battle damage ends the duel outright, which is exactly what the Fist of Fate
 * is for — and a named constant rather than a magic number sprinkled about, so
 * the board can recognise it and print ∞ instead of seven digits.
 */
export const INFINITE_ATK = 9_999_999;

export interface CardFlags {
  /** ATK is not a number this turn — see `INFINITE_ATK`. */
  infiniteAtk?: boolean;
  /** AI only, never set by the engine: this card was drawn inside a
   *  simulated world, so its identity is imagined — a plan may count it,
   *  never spend it. */
  worldBlind?: boolean;
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
  /** See the `sapsAttacker` grant. */
  sapsAttacker?: boolean;
  /** See the `surgesOnAttack` grant — Skyscraper's 1000. */
  surgesOnAttack?: boolean;
  /** See the `unaffectedBySpellsAndTraps` grant — Wildheart reads neither. */
  unaffectedBySpellsAndTraps?: boolean;
  /** See the `cannotBeAttacked` grant. */
  cannotBeAttacked?: boolean;
  /**
   * True for exactly the length of this card's own arrival in the Graveyard,
   * and only when it got there off the field.
   *
   * `onAnyToGrave` fires for every road down — discarded out of a hand, milled
   * off a Deck, destroyed on the board — and one card needs to tell those
   * apart: Winged Kuriboh comes back when it is *discarded* and stays down when
   * it dies in battle, because dying is what its other half is for. Set and
   * cleared around the trigger rather than kept, so nothing can read it later
   * and think the card is still falling.
   */
  justLeftTheField?: boolean;
  /** See the `doesNotBlock` grant. */
  doesNotBlock?: boolean;
  /** See the `paysWithGraveInstead` op. */
  paysWithGraveInstead?: boolean;
  /** Every swing costs a card out of hand — see the `attackCostDiscard` op. */
  attackCostDiscard?: boolean;
  /** Swings at twice its ATK — see the `doublesWhenAttacking` grant. */
  doublesWhenAttacking?: boolean;
  /** Whatever attacks it swings at half — see the `halvesAttacker` grant. */
  halvesAttacker?: boolean;
  /** Extra ATK, but only against a monster lying in Defence Position. */
  bonusVsDefense?: number;
  /** Rolls to shrug off a destruction — see the `rollsToSurvive` op. */
  rollsToSurvive?: boolean;
  /**
   * The first battle that would destroy this monster turns it face-down
   * instead. Once, and then it is spent: the Sphinx buys one life, and the
   * second blow lands. Being flipped face-up again re-fires its FLIP effect,
   * which is the consolation — not another life.
   */
  flipsInsteadOfDying?: boolean;
  /** Set once `flipsInsteadOfDying` has been cashed. */
  usedFlipEscape?: boolean;
  /** A card effect that would destroy it takes it out of play until the End
   *  Phase instead — see the `EquipGrant` of the same name. Unlimited, on
   *  purpose: battle is the answer to this monster, not attrition. */
  banishesInsteadOfDying?: boolean;
  /** Life Points its controller is paid each time that dodge is taken. */
  banishDodgePays?: number;
  /**
   * What this monster has swallowed counts for half its printed ATK and DEF
   * rather than all of it. Serket grows on what it kills, and at full rate a
   * scorpion that ate a Blue-Eyes would simply be a Blue-Eyes with extra steps.
   */
  absorbHalved?: boolean;
  /** One attack for each monster swallowed, plus its own. */
  attacksPerAbsorbed?: boolean;
  /** Swallows whatever it destroys in battle — see the `devourOnBattleDestroy` op. */
  devoursOnBattleDestroy?: boolean;
  /**
   * A card effect that would destroy this monster takes everything it has
   * swallowed instead. Empty-handed, it dies like anything else.
   *
   * `shedsAbsorbedInstead` is the older, wider version and answers battle too;
   * this one is the narrower bargain Serket names.
   */
  shedsAbsorbedOnEffect?: boolean;
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
  /**
   * The slug of the card whose effect Special Summoned this one, if any.
   *
   * How a monster arrived can be worth more than the monster: Metalzoa is the
   * thing Zoa turns into, and one that was Normal Summoned off the top of a
   * hand or dragged back by Time Machine is the same body without the story.
   * Cleared by `resetInstance` on every arrival, so a previous life's route
   * cannot carry over — see `condition.summonedBy`.
   */
  summonedBy?: string;
  /**
   * How many Tributes were paid to Set this monster face-down.
   *
   * Public information, recorded rather than remembered: the tributes were
   * paid in the open, and any player watching knows a face-down that cost one
   * is Level 5 or higher while one that cost nothing can only be Level 4 or
   * lower. The AI's world-building conditions its guesses on exactly this —
   * which is reading the table, not the card. Unset for the ordinary Set.
   * Cleared by `resetInstance`; meaningless once the card is face-up, where
   * the real Level is showing.
   */
  setTributes?: number;
  /**
   * How many times this card has clawed its own way back out of the Graveyard.
   *
   * Crawling Dragon returns 200 heavier EVERY time battle kills it, so the
   * bonus is a running total rather than a flat one — and it is a count rather
   * than an amount so the card's own numbers stay the card's business.
   *
   * Cleared by `resetInstance`, which every road off a zone performs, so the
   * count cannot outlive the body that earned it: leave the field any way but
   * battle and the dragon is its printed self again. `destroyCard` lends it
   * back across the one beat that reads it — the battle death that buys the
   * next return — and `startTurn` writes it on the dragon that lands.
   */
  revivals?: number;
  /**
   * A token that is swept at the end of the turn it arrived on — see
   * `summonToken.fleeting`. Bought to be spent, not to hold a board.
   */
  fleeting?: boolean;
  /**
   * Out of play until the End Phase of this turn, and the zone and posture it
   * left standing in. A dodge, not a removal: `endOfTurnCleanup` puts it back
   * exactly as it was, which is what "returns same position" means.
   */
  returnsAtEndPhase?: { turn: number; to: PlayerId; zone: number; position: Position; face: Face };
  /**
   * Whose Tributes this monster may pay for, besides its controller's, and
   * until when. Soul Exchange lends the opponent's bodies for one turn without
   * moving them: they stay on their own side, and the only thing the borrower
   * may do is spend them.
   */
  lentTo?: PlayerId;
  lentUntilTurn?: number;
  /**
   * End Phases left before a possessed monster crumbles — counted on the turns
   * of the player who took it, not the one it was stolen from. See the
   * `possess` op.
   */
  possessedEndPhases?: number;
  /** A Token whose stats are counted off the board — see `summonToken.scale`. */
  tokenScale?: { zone: 'ownGrave' | 'eitherGrave'; filter?: CardFilter; atk: number; def: number };
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
  /**
   * `ghost` marks a body this monster is merely *counting*, not holding — Serket
   * grows on what it kills, and what it killed is already lying in a Graveyard.
   * A ghost is worth stats and an extra attack; it is never sent home again,
   * because sending it home would put a second copy of a card that already
   * died into the pile.
   */
  absorbed: { slug: string; owner: PlayerId; ghost?: boolean }[];
  /** Set when control was taken; control reverts at end of that turn. */
  controlRevertsOnTurn?: number;
  /**
   * Life Points its owner is paid at the start of each of its captor's turns,
   * for as long as they keep it.
   *
   * Snatch Steal's text has always promised this and the card never paid a
   * point: a permanent theft with no price at all, and a clause on the card
   * that did nothing. Carried on the stolen body rather than on the Spell,
   * because the Spell is in the Graveyard by the time the first rent is due.
   */
  rentPerTurn?: number;
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
  kind:
    | 'skipDraw'
    | 'skipBattlePhase'
    | 'freezeMonsters'
    | 'preventBattleDamage'
    | 'preventBattleDestruction'
    /** A monster owed back to the field at the start of its controller's turn. */
    | 'pendingRevival';
  /** Player the effect is applied to. */
  target: PlayerId;
  /** Turns remaining; decremented at the end of the affected player's turn. */
  turns: number;
  /** `pendingRevival`: what it comes back with on top of its printed stats. */
  atkBonus?: number;
  defBonus?: number;
  /** `pendingRevival`: which return this is, so the next one is heavier still. */
  revivals?: number;
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
  /**
   * A card in this player's Deck that their next draw will take instead of
   * whatever is on top — the Temple of the Kings choosing what tomorrow holds.
   * Cleared the moment it is drawn.
   */
  destinyDrawUid?: string;
  extra: CardInstance[];
  normalSummonUsed: boolean;
  /** True once this player has connected and locked in their duelist. */
  ready: boolean;
}

/** A decision the engine is waiting on before it can continue. */
/**
 * A decision the engine is waiting on. Both shapes carry `player`, `options`
 * and `reason`, so everything that only needs "who is being asked, about what"
 * — the board's overlay, the AI's turn loop, the room's stall detector — reads
 * either without caring which it got.
 */
export type Pending = PendingTrap | PendingChoice;

export interface PendingTrap {
  kind: 'trap';
  player: PlayerId;
  /** uids of cards that could be activated right now. */
  options: string[];
  /** What caused this window, for the prompt text. */
  reason: string;
  context: TriggerContext;
}

/**
 * A card asking its own controller which card it should take — on a turn that
 * is not theirs.
 *
 * Every effect with a choice used to fall into two camps: activated by a player
 * who is standing right there and can be asked, or fired mid-resolution where
 * the engine picked for you. Sangan, Witch of the Black Forest, Newdoria and a
 * dozen more sit in the second camp only because their trigger happens to land
 * on the opponent's turn — not because the choice is any less theirs.
 *
 * The whole effect is parked, not half of it: the window opens before the first
 * op runs, and the answer arrives as the effect's target list, which is exactly
 * the shape an effect activated on your own turn already has. So resuming is
 * running the effect, once, with the answer in hand — no continuation to
 * reconstruct, and nothing that half-happened while we waited.
 */
export interface PendingChoice {
  kind: 'choose';
  /** Who must answer — the effect's controller, whoever's turn it is. */
  player: PlayerId;
  /** uids that may be chosen, settled when the window opened. */
  options: string[];
  reason: string;
  context: TriggerContext;
  /** The effect to run once the answer lands, named rather than captured. */
  sourceUid: string;
  sourceSlug: string;
  trigger: Trigger;
  /** How many cards the effect wants. */
  want: number;
  /** "Up to": fewer is allowed, and so is none — the board offers a way out. */
  optional?: boolean;
  /** Answers collected so far. */
  picked: string[];
  /** Where the source was standing, so the resumed effect can find it. */
  from: 'field' | 'grave' | 'hand';
}

export interface TriggerContext {
  /** For `onAllySummon`: the monster that just arrived — see `summonedIs`. */
  summonedUid?: string;
  attackerUid?: string;
  targetUid?: string;
  sourceUid?: string;
  damage?: number;
  /**
   * What the monster this battle just killed was standing at.
   *
   * `destroyedAtk` on a `damage` or `heal` op has always read the kills that
   * effect made *itself* — Cannon Soldier fires the monster it destroyed. A
   * battle kill is nobody's op, so an `onBattleDestroy` effect scaled that way
   * read zero: Elemental HERO Flame Wingman, whose entire card is "inflict
   * damage equal to the ATK of the monster it just destroyed", would have
   * inflicted nothing at all. Carried on the trigger because by the time the
   * effect runs the body is in the Graveyard and there is no stat left to read.
   */
  destroyedAtk?: number;
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
  /**
   * This beat reports an *outcome*, not an activation — the coins landing, the
   * dice making seven, a card leaving the Graveyard to pay for something.
   *
   * The board's default voice for an `activate` beat carrying a slug is
   * "…'s effect activates", which is right for the beat that announces a card
   * going off and wrong for every beat after it: Barrel Dragon flipped three
   * coins and the board said "Barrel Dragon's effect activates" a second time
   * instead of the result, which was in the log and nowhere else. Reported.
   *
   * A reporting beat says the log line the engine paired with it, and never
   * claims the signature flourish — Barrel Dragon is Keith's emblem, so the
   * coin toss was also playing his whole cutscene over again.
   */
  reports?: boolean;
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
  /** Monsters that have left a Monster Zone during the action being applied,
   *  waiting for it to finish so their `onLeaveField` effects can resolve
   *  without standing in their own summon's way. Drained by `applyAction`. */
  leftField?: { uid: string; controller: PlayerId }[];
  /** Set while a battle is paused waiting on a trap response.
   *
   *  `controller` is who declared it, read back when the battle resumes: a
   *  window is long enough for the attack to stop being the attack that was
   *  declared. See `resolveBattle`. */
  suspendedAttack?: { attackerUid: string; targetUid: string | null; controller: PlayerId } | null;
  /**
   * Choices raised while another was already open. One Dark Hole can destroy
   * two Sangans; there is one `pending` slot and two questions, and the second
   * used to be answered by the engine helping itself. They queue instead, and
   * drain as each is answered.
   */
  pendingChoices?: PendingChoice[];
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
  /**
   * `effectIndex` names *which* ignition, for a card that carries more than
   * one. Obelisk is the first: the Fist of Fate eats two bodies to clear the
   * field, and the second button spends one body to swing four times. Omitted
   * means the first one the card can currently afford, which is what every
   * single-ignition card has always meant.
   */
  | { type: 'ignition'; uid: string; targets?: string[]; effectIndex?: number }
  /** Spend a card out of the hand for its `handDiscard` effect. */
  | { type: 'discardForEffect'; uid: string; targets?: string[] }
  | { type: 'fusionSummon'; extraUid: string; materials: string[]; zone: number; position: Position; targets?: string[] }
  | {
      type: 'attack';
      uid: string;
      targetUid: string | null;
      /** The card thrown away to make the swing — see `attackCostDiscard`. */
      discardUid?: string;
    }
  /** Pay a card out of hand to Special Summon another card in that hand. */
  | { type: 'handSummon'; uid: string; discardUid?: string; targets?: string[] }
  /** The answer to a `PendingChoice` — which card the parked effect should take. */
  | { type: 'chooseCard'; uids: string[] }
  | { type: 'respondTrap'; uid: string | null; targets?: string[] }
  | { type: 'toPhase'; phase: Phase }
  | { type: 'endTurn' }
  | { type: 'surrender' };
