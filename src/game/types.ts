/**
 * Core type definitions for the duel engine.
 *
 * House rules for this game (deliberately different from the real TCG):
 *  - 4000 Life Points, 25-card decks, 5-card opening hand.
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
export const STARTING_LP = 4000;
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
  /** Stat overrides so our custom versions can differ from the printed card. */
  atkOverride?: number;
  defOverride?: number;
  /**
   * A card that must be face-up on your side before this monster can be
   * Summoned — the Toon monsters and their Toon World. The requirement is in
   * their rules text either way; this is what makes the engine agree.
   */
  summonRequires?: string;
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
  /** Monster was flipped face-up (from a face-down defence position). */
  | 'onFlip'
  /** This monster was destroyed in battle. */
  | 'onDestroyedByBattle'
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
  | 'opponentSummon'
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
  | 'attackTarget'; // context: the monster being attacked

export interface CardFilter {
  type?: string; // monster type (Dragon, Insect, ...)
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
  zone?: 'monster' | 'spellTrap' | 'field' | 'hand' | 'grave' | 'deck' | 'extra' | 'banished';
  pick: Pick;
  count?: number;
  filter?: CardFilter;
}

export type Duration = 'permanent' | 'turn' | 'opponentTurn';

/** A single atomic action an effect can perform. */
export type Op =
  | { op: 'damage'; amount?: number; scale?: 'targetAtk' | 'selfAtk' | 'halfTargetAtk' | 'perOppMonster'; to: Side }
  | { op: 'heal'; amount: number; to: Side }
  | { op: 'gainAtk'; amount?: number; scale?: 'targetAtk' | 'perCardInGrave' | 'perMonsterOnField'; target: Selector; duration: Duration }
  | { op: 'gainDef'; amount: number; target: Selector; duration: Duration }
  | { op: 'setAtk'; value: number; target: Selector }
  | { op: 'halveAtk'; target: Selector }
  | { op: 'swapAtkDef'; target: Selector }
  | { op: 'destroy'; target: Selector }
  | { op: 'banish'; target: Selector }
  | { op: 'bounce'; target: Selector }
  | { op: 'takeControl'; target: Selector; duration: Duration }
  | { op: 'draw'; count: number; who: Side }
  | { op: 'discard'; count: number; who: Side }
  | { op: 'mill'; count: number; who: Side }
  | { op: 'search'; filter: CardFilter; count?: number }
  /** `from` may list several zones, searched in order — a Ritual Spell has to
   *  reach the monster whether it was drawn or is still in the Deck. */
  | { op: 'specialSummon'; from: SummonZone | SummonZone[]; side?: Side; filter?: CardFilter; count?: number; position?: Position; face?: Face }
  | { op: 'summonToken'; name: string; atk: number; def: number; count: number; artSlug?: string }
  | { op: 'transformInto'; slug: string }
  | { op: 'addCounter'; amount: number }
  | { op: 'negateAttack' }
  | { op: 'endBattlePhase' }
  | { op: 'extraAttacks'; count: number }
  | { op: 'attackAllMonsters' }
  | { op: 'directAttack'; duration: Duration }
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
  | { op: 'equipTo'; atk: number; def: number; grants?: EquipGrant[] }
  | { op: 'revealHand'; who: Side }
  | { op: 'shuffleIntoDeck'; target: Selector }
  | { op: 'stealFromGrave'; filter?: CardFilter }
  | { op: 'coinFlip'; heads: Op[]; tails: Op[] }
  | { op: 'diceRoll'; perPip: Op[] }
  | { op: 'forceDefense'; target: Selector }
  | { op: 'forceAttackPosition'; target: Selector }
  | { op: 'flipFaceUp'; target: Selector }
  | { op: 'win' };

export type EquipGrant = 'pierce' | 'doubleAttack' | 'directAttack' | 'indestructibleByBattle' | 'untargetable';

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
  /** Cost paid before resolution. */
  cost?: { discard?: number; tribute?: number; lp?: number };
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
  /** Requires a face-up card with this slug on own field. */
  requiresOnField?: string;
  /** Requires this many counters on the card. */
  countersAtLeast?: number;
  /** Requires opponent controls at least one monster. */
  opponentHasMonster?: boolean;
  /** Requires the named field spell to be active for either player. */
  requiresField?: string;
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
  noBattleDamage?: boolean;
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
  attacksUsed: number;
  effectUsedOnTurn: number;
  /**
   * Turn this monster last changed battle position. A monster may do so only
   * once per turn — without that limit it can be flipped between Attack and
   * Defence indefinitely, which is a legal move that changes nothing and lets
   * a turn never end.
   */
  positionChangedOnTurn?: number;
  /** Monsters absorbed by Relinquished / Thousand-Eyes Restrict. */
  absorbed: string[];
  /** Set when control was taken; control reverts at end of that turn. */
  controlRevertsOnTurn?: number;
  /** True for Scapegoat-style tokens (cannot be tributed for a Normal Summon). */
  isToken?: boolean;
  tokenName?: string;
  tokenAtk?: number;
  tokenDef?: number;
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
  | 'flip'
  | 'trap'
  | 'fusion'
  | 'win'
  | 'phase';

export interface AnimEvent {
  id: string;
  kind: AnimKind;
  player?: PlayerId;
  uid?: string;
  targetUid?: string;
  slug?: string;
  amount?: number;
  text?: string;
}

export interface LogEntry {
  id: string;
  turn: number;
  player?: PlayerId;
  text: string;
  tone?: 'normal' | 'attack' | 'effect' | 'damage' | 'summon' | 'system';
}

export interface DuelState {
  players: Record<PlayerId, PlayerState>;
  turn: number;
  active: PlayerId;
  phase: Phase;
  ongoing: OngoingEffect[];
  log: LogEntry[];
  anims: AnimEvent[];
  pending: Pending | null;
  winner: PlayerId | 'draw' | null;
  winReason?: string;
  seed: number;
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
  | { type: 'changePosition'; uid: string }
  | { type: 'activateSpell'; uid: string; targets?: string[]; zone?: number }
  | { type: 'setSpellTrap'; uid: string }
  | { type: 'activateSetCard'; uid: string; targets?: string[] }
  | { type: 'ignition'; uid: string; targets?: string[] }
  | { type: 'fusionSummon'; extraUid: string; materials: string[]; zone: number; position: Position; targets?: string[] }
  | { type: 'attack'; uid: string; targetUid: string | null }
  | { type: 'respondTrap'; uid: string | null; targets?: string[] }
  | { type: 'toPhase'; phase: Phase }
  | { type: 'endTurn' }
  | { type: 'surrender' };
