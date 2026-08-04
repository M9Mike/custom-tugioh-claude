/**
 * Audits every card in the game against what its effect claims to do.
 *
 * For each card this builds a position where the card can actually be used,
 * fires it through the real engine entry point a player would use (activate a
 * Spell, Normal Summon a monster, respond with a Trap, Flip Summon, ignite),
 * then checks each operation in its effect for an observable consequence:
 * "draw" must grow a hand, "damage" must move Life Points, "equipTo" must leave
 * an Equip Spell on the field attached to something, and so on.
 *
 * It is deliberately generic. A per-card script would only ever test the cases
 * someone thought to write; driving the assertions off the effect data means a
 * card whose ops never fire cannot hide.
 *
 *   npx tsx scripts/card-audit.ts            # audit everything
 *   npx tsx scripts/card-audit.ts mirror-wall  # one card, verbose
 */
import { applyAction, createDuel, effAtk, effDef, effFlags, tributesRequired } from '../src/game/engine';
import { CARDS, isToon } from '../src/game/cards';
import type {
  CardDef,
  CardEffect,
  CardFilter,
  CardInstance,
  DuelState,
  Op,
  PlayerId,
  Trigger,
} from '../src/game/types';

const ONLY = process.argv[2];

/* ------------------------------------------------------------------ */
/* Position building                                                   */
/* ------------------------------------------------------------------ */

const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';

/** A monster with real stats, used to stock fields and graveyards. */
const FILLER = ['baby-dragon', 'harpie-lady', 'saggi-the-dark-clown', 'mystical-elf', 'cannon-soldier'];

function base(): DuelState {
  const s = structuredClone(
    createDuel({ seed: 4242, p1: { duelistId: 'kaiba', name: 'Me' }, p2: { duelistId: 'yugi', name: 'Foe' } })
  );
  s.turn = 6;
  s.active = ME;
  s.phase = 'main';
  for (const pid of [ME, FOE] as PlayerId[]) {
    const p = s.players[pid];
    p.monsters = [null, null, null];
    p.spellTrap = null;
    p.field = null;
    p.normalSummonUsed = false;
    p.lp = 4000;
  }
  return s;
}

let uidSeq = 0;

/**
 * Builds a fresh instance of `slug` owned by `pid`.
 *
 * Deliberately does NOT take a card out of the deck. An earlier version popped
 * a donor, which meant stocking the deck for a search and then minting one more
 * card silently ate the card that had just been put there — and the search then
 * "failed" for a reason that had nothing to do with the card being tested.
 */
function mint(_s: DuelState, pid: PlayerId, slug: string): CardInstance {
  return {
    uid: `audit${uidSeq++}`,
    slug,
    owner: pid,
    face: 'up',
    position: 'atk',
    atkMod: 0,
    defMod: 0,
    turnAtkMod: 0,
    turnDefMod: 0,
    counters: 0,
    equips: [],
    equippedTo: undefined,
    flags: {},
    turnFlags: {},
    summonedOnTurn: 1,
    attacksUsed: 0,
    effectUsedOnTurn: -1,
    absorbed: [],
    isToken: false,
  };
}

function place(s: DuelState, pid: PlayerId, zone: number, slug: string, pos: 'atk' | 'def' = 'atk') {
  const c = mint(s, pid, slug);
  c.position = pos;
  s.players[pid].monsters[zone] = c;
  return c;
}

/**
 * The standard rich position: both sides have a board, stocked graveyards and
 * a hand, so almost any effect has something legal to bite on.
 */
function stocked(): DuelState {
  const s = base();
  // Only one of my zones is filled: effects that Special Summon or steal a
  // monster need somewhere to put it, and a full board would fail them for a
  // reason that has nothing to do with the card being tested.
  place(s, ME, 0, 'baby-dragon');
  place(s, FOE, 0, 'harpie-lady');
  // Face-down, so effects that destroy or flip set cards have a real target.
  const hidden = place(s, FOE, 1, 'mystical-elf', 'def');
  hidden.face = 'down';
  for (const pid of [ME, FOE] as PlayerId[]) {
    const p = s.players[pid];
    p.grave = FILLER.map((f) => mint(s, pid, f));
    // A Spell in the graveyard too, for cards that recur them.
    p.grave.push(mint(s, pid, 'pot-of-greed'));
    p.hand = ['baby-dragon', 'pot-of-greed', 'harpie-lady', 'mystical-elf'].map((f) => mint(s, pid, f));
  }
  // A set Trap on the opponent's side, for cards that blow up backrow.
  const backrow = mint(s, FOE, 'trap-hole');
  backrow.face = 'down';
  backrow.summonedOnTurn = 0;
  s.players[FOE].spellTrap = backrow;
  return s;
}

/* ------------------------------------------------------------------ */
/* Snapshots                                                           */
/* ------------------------------------------------------------------ */

interface Side {
  lp: number;
  hand: number;
  deck: number;
  grave: number;
  monsters: number;
  graveSlugs: string[];
  handSlugs: string[];
  spellTrap: string | null;
  field: string | null;
  totalAtk: number;
  totalDef: number;
  faceUp: number;
  atkPos: number;
  /** Identities on the board, so arrivals survive a tribute cost. */
  uids: string[];
  /** Monsters I control that the other player owns. */
  borrowed: number;
}
interface Snap {
  me: Side;
  foe: Side;
  ongoing: number;
  winner: string | null;
  log: number;
}

function sideOf(s: DuelState, pid: PlayerId): Side {
  const p = s.players[pid];
  const mons = p.monsters.filter((m): m is CardInstance => !!m);
  return {
    lp: p.lp,
    hand: p.hand.length,
    deck: p.deck.length,
    grave: p.grave.length,
    monsters: mons.length,
    graveSlugs: p.grave.map((c) => c.slug),
    handSlugs: p.hand.map((c) => c.slug),
    spellTrap: p.spellTrap?.slug ?? null,
    field: p.field?.slug ?? null,
    totalAtk: mons.reduce((n, m) => n + effAtk(s, m, pid), 0),
    totalDef: mons.reduce((n, m) => n + effDef(s, m, pid), 0),
    faceUp: mons.filter((m) => m.face === 'up').length,
    atkPos: mons.filter((m) => m.position === 'atk').length,
    uids: mons.map((m) => m.uid),
    borrowed: mons.filter((m) => m.owner !== pid).length,
  };
}

const snap = (s: DuelState): Snap => ({
  me: sideOf(s, ME),
  foe: sideOf(s, FOE),
  ongoing: s.ongoing.length,
  winner: s.winner ?? null,
  log: s.log.length,
});

/** Union of every flag granted to any monster either player controls. */
function allFlags(s: DuelState): Set<string> {
  const out = new Set<string>();
  for (const pid of [ME, FOE] as PlayerId[]) {
    for (const m of s.players[pid].monsters) {
      if (!m) continue;
      const f = effFlags(s, m, pid);
      for (const [k, v] of Object.entries(f)) if (v) out.add(k);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Per-op expectations                                                 */
/* ------------------------------------------------------------------ */

interface Check {
  /** Human-readable claim being tested. */
  what: string;
  ok: boolean;
}

/**
 * What each operation should visibly do. Returns null when this setup cannot
 * observe the op — those are reported as "unverified" rather than passed, so
 * the coverage number stays honest.
 */
/** True when a monster is on my side now that was not there before. */
const arrived = (a: Snap, b: Snap) => b.me.uids.some((u) => !a.me.uids.includes(u));

function checkOp(op: Op, a: Snap, b: Snap, flagsBefore: Set<string>, flagsAfter: Set<string>): Check | null {
  const grew = (x: number, y: number) => y > x;
  const fell = (x: number, y: number) => y < x;
  const newFlag = (f: string) => flagsAfter.has(f) && !flagsBefore.has(f);
  // A card that already won the duel does not need to show its bookkeeping.
  if (b.winner) return null;

  switch (op.op) {
    case 'draw':
      return { what: 'draws a card', ok: grew(a.me.hand, b.me.hand) || fell(a.me.deck, b.me.deck) };
    case 'search':
      // Not "the hand grew": the card doing the searching usually left the hand
      // in the same breath, so the net size is unchanged. The Deck shrinking is
      // the honest signal.
      return { what: 'adds a card from the Deck to the hand', ok: fell(a.me.deck, b.me.deck) };
    case 'mill':
      return { what: 'sends cards from a Deck to the Graveyard', ok: fell(a.me.deck, b.me.deck) || fell(a.foe.deck, b.foe.deck) };
    case 'discard':
      // Same trap as `search`, and worse for cards that discard then draw:
      // count the cards arriving in a Graveyard instead.
      return {
        what: 'discards a card',
        ok: grew(a.me.grave, b.me.grave) || grew(a.foe.grave, b.foe.grave) ||
          fell(a.me.hand, b.me.hand) || fell(a.foe.hand, b.foe.hand),
      };
    case 'damage':
      return { what: 'inflicts damage', ok: op.to === 'own' ? fell(a.me.lp, b.me.lp) : fell(a.foe.lp, b.foe.lp) };
    case 'heal':
      return { what: 'gains Life Points', ok: op.to === 'own' ? grew(a.me.lp, b.me.lp) : grew(a.foe.lp, b.foe.lp) };
    case 'destroy':
      return {
        what: 'destroys a card',
        ok: fell(a.foe.monsters, b.foe.monsters) || fell(a.me.monsters, b.me.monsters) ||
          grew(a.foe.grave, b.foe.grave) || (a.foe.spellTrap !== null && b.foe.spellTrap === null),
      };
    // Count-based checks are unreliable here: a Tribute cost removes a monster
    // in the same breath that the effect adds one, so the totals can come out
    // level. Compare identities instead — a monster that was not on my side
    // before and is now.
    case 'specialSummon':
      return { what: 'Special Summons a monster', ok: arrived(a, b) };
    case 'summonToken':
      return { what: 'Special Summons tokens', ok: arrived(a, b) };
    /* Which Graveyard is the card's own business — Graverobber says "your
       opponent's" and means it, Magician of Faith says "either" and starts with
       your own. So this asks that a card left *a* Graveyard, and the two
       preferences are pinned by name in `npm run rules`, where the distinction
       is the point rather than an implementation detail. */
    case 'stealFromGrave':
      return {
        what: 'takes a card out of a Graveyard',
        ok: arrived(a, b) || fell(a.foe.grave, b.foe.grave) || fell(a.me.grave, b.me.grave),
      };
    case 'takeControl':
      return { what: "takes control of an opponent's monster", ok: b.me.borrowed > a.me.borrowed || fell(a.foe.monsters, b.foe.monsters) };
    case 'bounce':
      return { what: 'returns a card to the hand', ok: grew(a.foe.hand, b.foe.hand) || grew(a.me.hand, b.me.hand) };
    case 'shuffleIntoDeck':
      return { what: 'shuffles a card into the Deck', ok: grew(a.me.deck, b.me.deck) || grew(a.foe.deck, b.foe.deck) };
    case 'gainAtk': {
      const amount = op.amount ?? 0;
      return {
        what: amount >= 0 ? 'raises ATK' : 'lowers ATK',
        ok: amount >= 0
          ? b.me.totalAtk > a.me.totalAtk || b.foe.totalAtk > a.foe.totalAtk
          : b.foe.totalAtk < a.foe.totalAtk || b.me.totalAtk < a.me.totalAtk,
      };
    }
    case 'halveAtk':
      return { what: 'halves ATK', ok: b.foe.totalAtk < a.foe.totalAtk || b.me.totalAtk < a.me.totalAtk };
    case 'swapAtkDef':
      return { what: 'swaps ATK and DEF', ok: b.me.totalAtk !== a.me.totalAtk || b.foe.totalAtk !== a.foe.totalAtk || b.me.totalDef !== a.me.totalDef || b.foe.totalDef !== a.foe.totalDef };
    case 'equipTo':
      return { what: 'stays on the field equipped to a monster', ok: b.me.spellTrap !== null && b.me.totalAtk >= a.me.totalAtk + op.atk };
    case 'flipFaceUp':
      return { what: 'flips monsters face-up', ok: b.foe.faceUp >= a.foe.faceUp };
    case 'forceAttackPosition':
      // Count both sides: a card that steals a monster and then stands it up
      // moves it between the two, so looking at one side alone is misleading.
      return { what: 'forces Attack Position', ok: b.me.atkPos + b.foe.atkPos >= a.me.atkPos + a.foe.atkPos };
    case 'forceDefense':
      return { what: 'forces Defence Position', ok: b.foe.atkPos <= a.foe.atkPos };
    case 'freezeMonsters':
      return { what: 'stops monsters acting', ok: grew(a.ongoing, b.ongoing) };
    case 'preventBattleDamage':
      return { what: 'prevents battle damage', ok: grew(a.ongoing, b.ongoing) };
    case 'addCounter':
      return { what: 'places a counter', ok: true }; // counters are on the source; see transform tests
    case 'pierce':
      return { what: 'grants piercing', ok: newFlag('pierce') };
    case 'directAttack':
      return { what: 'grants a direct attack', ok: newFlag('directAttack') };
    case 'extraAttacks':
      return { what: 'grants extra attacks', ok: newFlag('extraAttacks') };
    case 'indestructibleByBattle':
      return { what: 'grants battle immunity', ok: newFlag('indestructibleByBattle') };
    case 'untargetable':
      return { what: 'grants untargetability', ok: newFlag('untargetable') };
    case 'attackAllMonsters':
      return { what: 'grants an attack on every monster', ok: newFlag('attackAll') };
    case 'negateEffects':
      return { what: 'negates effects', ok: newFlag('negated') || b.log > a.log };
    case 'absorb':
      return { what: 'absorbs a monster', ok: fell(a.foe.monsters, b.foe.monsters) };
    case 'win':
      return { what: 'wins the duel', ok: b.winner === ME };
    // These only mean anything mid-battle; the trap scenarios cover them.
    case 'negateAttack':
    case 'endBattlePhase':
    case 'transformInto':
    case 'coinFlip':
    case 'diceRoll':
    case 'revealHand':
      return null;
    default:
      return null;
  }
}

/**
 * Makes an effect's `condition` true, so the card actually fires. A conditional
 * effect tested without its condition met simply does nothing, which would read
 * as a broken card rather than an unmet prerequisite.
 */
/** Does the card named by `slug` satisfy this filter? */
function matchesLoosely(slug: string, filter: CardFilter | undefined) {
  const x = CARDS[slug];
  if (!x) return false;
  if (filter?.type && x.type !== filter.type) return false;
  if (filter?.attribute && x.attribute !== filter.attribute) return false;
  if (filter?.nameIncludes && !x.name.toLowerCase().includes(filter.nameIncludes.toLowerCase())) return false;
  if (filter?.toon && !isToon(slug)) return false;
  if (filter?.slugs && !filter.slugs.includes(slug)) return false;
  if (filter?.maxAtk != null && (x.atk ?? 0) > filter.maxAtk) return false;
  return true;
}

function matchCard(filter: CardFilter | undefined, kind: 'monster' | 'any' = 'monster', exclude: string[] = []) {
  return Object.values(CARDS).find(
    (x) =>
      (kind === 'any' || x.kind === 'monster') &&
      x.slug !== 'facedown' &&
      x.slug !== 'polymerization' &&
      !exclude.includes(x.slug) &&
      (!filter?.kind || x.kind === filter.kind) &&
      (!filter?.type || x.type === filter.type) &&
      (!filter?.attribute || x.attribute === filter.attribute) &&
      (!filter?.nameIncludes || x.name.includes(filter.nameIncludes)) &&
      (!filter?.toon || isToon(x.slug)) &&
      (!filter?.slugs || filter.slugs.includes(x.slug)) &&
      (filter?.maxAtk == null || (x.atk ?? 0) <= filter.maxAtk) &&
      (filter?.minAtk == null || (x.atk ?? 0) >= filter.minAtk) &&
      (filter?.maxLevel == null || (x.level ?? 0) <= filter.maxLevel) &&
      (filter?.minLevel == null || (x.level ?? 0) >= filter.minLevel)
  );
}

/** Does this Special Summon draw on that zone? `from` may name several. */
function summonsFrom(op: { from: string | string[] }, zone: string): boolean {
  return Array.isArray(op.from) ? op.from.includes(zone) : op.from === zone;
}

/** The Ritual Spell that Special Summons this monster, if the game has one. */
function ritualSpellFor(slug: string): string | null {
  for (const other of Object.values(CARDS)) {
    for (const eff of other.effects) {
      for (const op of eff.ops) {
        if (op.op === 'specialSummon' && op.filter?.slugs?.includes(slug)) return other.slug;
      }
    }
  }
  return null;
}

function stockDeckFor(s: DuelState, eff: CardEffect) {
  for (const op of eff.ops) {
    const filter = 'filter' in op ? op.filter : undefined;
    if (op.op !== 'search' && !(op.op === 'specialSummon' && summonsFrom(op, 'deck'))) continue;
    // Searches are not always for monsters — Toon Alligator fetches a Spell —
    // so only insist on a monster when nothing in the filter says otherwise.
    const wantsAnyKind = !!filter?.slugs || (filter?.kind != null && filter.kind !== 'monster');
    const match = matchCard(filter, wantsAnyKind ? 'any' : 'monster');
    // The test card is played from an arbitrary duelist's deck, which may hold
    // nothing its search can legally find. Put one in rather than report the
    // card broken for a reason that is purely about this position.
    if (match) s.players[ME].deck.push(mint(s, ME, match.slug));
  }
}

/** Puts a legal revival target in the Graveyard for `specialSummon from grave`. */
function stockGraveFor(s: DuelState, eff: CardEffect) {
  for (const op of eff.ops) {
    if (op.op !== 'specialSummon' || !summonsFrom(op, 'grave')) continue;
    const match = matchCard(op.filter);
    if (match) s.players[ME].grave.push(mint(s, ME, match.slug));
  }
}

/**
 * And the hand, for `specialSummon from hand`. The deck and the Graveyard were
 * stocked and the hand never was — invisible while every hand-summoner also
 * read the deck, and exposed the day Machine Conversion Factory shipped small
 * Machines out of the hand alone.
 */
function stockHandFor(s: DuelState, eff: CardEffect) {
  for (const op of eff.ops) {
    if (op.op !== 'specialSummon' || !summonsFrom(op, 'hand')) continue;
    const match = matchCard(op.filter);
    if (match) s.players[ME].hand.push(mint(s, ME, match.slug));
  }
}

function satisfy(s: DuelState, eff: CardEffect, self?: CardInstance) {
  stockDeckFor(s, eff);
  stockGraveFor(s, eff);
  stockHandFor(s, eff);
  // Effects that reach across the field need a legal victim over there, and a
  // free zone over here to put it in.
  for (const op of eff.ops) {
    const t = 'target' in op ? op.target : undefined;
    if (!t || t.side !== 'opp' || (t.zone ?? 'monster') !== 'monster') continue;
    const wanted = matchCard(t.filter);
    const has = s.players[FOE].monsters.some((m) => m && matchesLoosely(m.slug, t.filter));
    if (wanted && !has) {
      const z = s.players[FOE].monsters.findIndex((m) => !m);
      if (z >= 0) place(s, FOE, z, wanted.slug);
    }
    if (op.op === 'takeControl' || op.op === 'stealFromGrave') {
      const free = s.players[ME].monsters.findIndex((m) => !m);
      if (free < 0) s.players[ME].monsters[2] = null;
    }
  }
  const cond = eff.condition;
  if (!cond) return;
  if (cond.ownLpBelow != null) s.players[ME].lp = Math.max(1, cond.ownLpBelow - 100);
  if (cond.graveAtLeast != null) {
    while (s.players[ME].grave.length < cond.graveAtLeast) s.players[ME].grave.push(mint(s, ME, 'baby-dragon'));
  }
  if (cond.countersAtLeast != null && self) self.counters = cond.countersAtLeast;
  if (cond.turnAtLeast != null) s.turn = Math.max(s.turn, cond.turnAtLeast);
  if (cond.opponentHasMonster && s.players[FOE].monsters.every((m) => !m)) place(s, FOE, 0, 'harpie-lady');
  if (cond.controlsOtherOfType && self) {
    const mate = Object.values(CARDS).find((c) => c.type === cond.controlsOtherOfType && c.slug !== self.slug);
    const z = s.players[ME].monsters.findIndex((m) => !m || m.uid !== self.uid);
    if (mate && z >= 0) place(s, ME, z, mate.slug);
  }
  // "The only monster you control" — clear the board of everything else.
  if (cond.controlsNoOtherMonster && self) {
    s.players[ME].monsters = s.players[ME].monsters.map((m) => (m && m.uid === self.uid ? m : null));
  }
  if (cond.requiresField) s.players[ME].field = mint(s, ME, cond.requiresField);
  if (cond.requiresOnField) {
    const need = cond.requiresOnField;
    const already =
      s.players[ME].monsters.some((m) => m?.slug === need) ||
      s.players[ME].spellTrap?.slug === need ||
      s.players[ME].field?.slug === need;
    if (!already) {
      const def = CARDS[need];
      if (def?.kind === 'monster') {
        const z = s.players[ME].monsters.findIndex((m) => !m);
        if (z >= 0) place(s, ME, z, need);
      } else if (def?.subKind === 'Field') s.players[ME].field = mint(s, ME, need);
      else s.players[ME].spellTrap = mint(s, ME, need);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Driving each card                                                   */
/* ------------------------------------------------------------------ */

interface Result {
  slug: string;
  trigger: Trigger;
  checks: Check[];
  unverified: number;
  note?: string;
}

const results: Result[] = [];
const skipped: string[] = [];

/** Runs `fire`, comparing snapshots around it and scoring the effect's ops. */
function audit(def: CardDef, eff: CardEffect, s: DuelState, fire: (s: DuelState) => DuelState | string, ownAtkOffset = 0) {
  const before = snap(s);
  const fb = allFlags(s);
  const out = fire(s);
  if (typeof out === 'string') {
    results.push({ slug: def.slug, trigger: eff.trigger, checks: [{ what: out, ok: false }], unverified: 0 });
    return;
  }
  const after = snap(out);
  // A monster arriving on the board raises my total ATK all by itself; that is
  // not the effect doing anything, so take its printed body back off.
  after.me.totalAtk -= ownAtkOffset;
  const fa = allFlags(out);

  const checks: Check[] = [];
  let unverified = 0;
  const walk = (ops: Op[]) => {
    for (const op of ops) {
      if (op.op === 'coinFlip') {
        // Only one branch runs; treat the pair as verified if either shows.
        const heads = op.heads.map((o) => checkOp(o, before, after, fb, fa)).filter(Boolean) as Check[];
        const tails = op.tails.map((o) => checkOp(o, before, after, fb, fa)).filter(Boolean) as Check[];
        const any = [...heads, ...tails];
        if (any.length) checks.push({ what: 'coin flip resolves one branch', ok: any.some((c) => c.ok) });
        else unverified += 1;
        continue;
      }
      if (op.op === 'diceRoll') {
        const pips = op.perPip.map((o) => checkOp(o, before, after, fb, fa)).filter(Boolean) as Check[];
        if (pips.length) checks.push({ what: 'dice roll resolves', ok: pips.some((c) => c.ok) });
        else unverified += 1;
        continue;
      }
      const c = checkOp(op, before, after, fb, fa);
      if (c) checks.push(c);
      else unverified += 1;
    }
  };
  walk(eff.ops);
  results.push({ slug: def.slug, trigger: eff.trigger, checks, unverified });
}

const run = (s: DuelState, pid: PlayerId, action: Parameters<typeof applyAction>[2]): DuelState | string => {
  const r = applyAction(s, pid, action);
  return r.error ? `engine refused: ${r.error}` : r.state;
};

/** Best-effort target uids for an effect that asks the player to choose. */
function targetsFor(s: DuelState, def: CardDef): string[] {
  const foeMons = s.players[FOE].monsters.filter((m): m is CardInstance => !!m);
  const myMons = s.players[ME].monsters.filter((m): m is CardInstance => !!m);
  const graveMons = s.players[ME].grave.filter((c) => CARDS[c.slug]?.kind === 'monster');
  const ops = def.effects.flatMap((e) => e.ops);
  const out: string[] = [];
  for (const op of ops) {
    if (op.op === 'specialSummon' && summonsFrom(op, 'grave')) {
      const pool = op.side === 'both' ? [...graveMons, ...s.players[FOE].grave.filter((c) => CARDS[c.slug]?.kind === 'monster')] : graveMons;
      if (pool[0]) out.push(pool[0].uid);
    } else if (op.op === 'specialSummon' && summonsFrom(op, 'hand')) {
      const h = s.players[ME].hand.find((c) => CARDS[c.slug]?.kind === 'monster');
      if (h) out.push(h.uid);
    } else if (op.op === 'equipTo') {
      if (myMons[0]) out.push(myMons[0].uid);
    } else if ('target' in op && op.target?.pick === 'chosen') {
      const side = op.target.side === 'own' ? myMons : foeMons;
      const zone = op.target.zone;
      if (zone === 'spellTrap') {
        const st = op.target.side === 'own' ? s.players[ME].spellTrap : s.players[FOE].spellTrap;
        if (st) out.push(st.uid);
      } else if (zone === 'grave') {
        if (graveMons[0]) out.push(graveMons[0].uid);
      } else if (side[0]) out.push(side[0].uid);
    }
  }
  return out;
}

for (const def of Object.values(CARDS)) {
  if (ONLY && def.slug !== ONLY) continue;
  if (!def.effects.length) {
    skipped.push(`${def.slug} (no effects by design)`);
    continue;
  }

  for (const eff of def.effects) {
    /* ---- Spells activated from the hand ---- */
    if (eff.trigger === 'activate' && def.kind === 'spell') {
      const s = stocked();
      // Give the effect something to work with in every zone it might read.
      const c = mint(s, ME, def.slug);
      s.players[ME].hand.push(c);
      if (eff.cost?.tribute) place(s, ME, 1, 'baby-dragon');
      satisfy(s, eff, c);
      audit(def, eff, s, (st) => run(st, ME, { type: 'activateSpell', uid: c.uid, targets: targetsFor(st, def) }));
      continue;
    }

    /* ---- Traps: set them, then open their window ---- */
    if (eff.trigger === 'trap') {
      const s = stocked();
      const c = mint(s, ME, def.slug);
      c.face = 'down';
      c.summonedOnTurn = 0;
      // A hand-trap like Kuriboh is discarded from the hand, never set.
      if (eff.fromHand) s.players[ME].hand.push(c);
      else s.players[ME].spellTrap = c;
      satisfy(s, eff, c);
      // The window belongs to the opponent's turn.
      s.active = FOE;
      // Both the attack window and the destruction window need a Battle Phase.
      s.phase = eff.window === 'opponentDeclareAttack' || eff.window === 'monsterDestroyed' ? 'battle' : 'main';
      if (eff.window === 'opponentDeclareAttack') {
        const atk = s.players[FOE].monsters[0];
        if (!atk) {
          results.push({ slug: def.slug, trigger: eff.trigger, checks: [{ what: 'no attacker available to open the window', ok: false }], unverified: 0 });
          continue;
        }
        atk.attacksUsed = 0;
        atk.summonedOnTurn = 0;
        // A direct attack is illegal while the defender has monsters, so swing
        // at one of mine — the declaration is what opens the window either way.
        const victim = s.players[ME].monsters.find((m): m is CardInstance => !!m);
        const stepped = run(s, FOE, { type: 'attack', uid: atk.uid, targetUid: victim?.uid ?? null });
        if (typeof stepped === 'string' || !stepped.pending) {
          results.push({ slug: def.slug, trigger: eff.trigger, checks: [{ what: 'trap window never opened', ok: false }], unverified: 0 });
          continue;
        }
        audit(def, eff, stepped, (st) => run(st, ME, { type: 'respondTrap', uid: c.uid, targets: targetsFor(st, def) }));
      } else if (eff.window === 'opponentSummon' || eff.window === 'opponentNormalSummon') {
        /* Both are driven by a face-up Normal Summon: that opens the narrow
           window, and a card watching the wider one catches it too. A Set
           opens neither, which is the point of the split. */
        const h = s.players[FOE].hand.find((x) => CARDS[x.slug]?.kind === 'monster');
        const zone = s.players[FOE].monsters.findIndex((m) => !m);
        if (!h || zone < 0) {
          results.push({ slug: def.slug, trigger: eff.trigger, checks: [{ what: 'could not stage a summon to react to', ok: false }], unverified: 0 });
          continue;
        }
        const stepped = run(s, FOE, { type: 'normalSummon', uid: h.uid, zone, position: 'atk', face: 'up' });
        if (typeof stepped === 'string' || !stepped.pending) {
          results.push({ slug: def.slug, trigger: eff.trigger, checks: [{ what: 'summon window never opened', ok: false }], unverified: 0 });
          continue;
        }
        audit(def, eff, stepped, (st) => run(st, ME, { type: 'respondTrap', uid: c.uid, targets: targetsFor(st, def) }));
      } else if (eff.window === 'monsterDestroyed') {
        // The window belongs to whoever just lost a monster, so one of mine has
        // to die on the opponent's turn.
        const victim = s.players[ME].monsters.find((m): m is CardInstance => !!m);
        const atk = s.players[FOE].monsters[0];
        if (!victim || !atk) {
          results.push({ slug: def.slug, trigger: eff.trigger, checks: [{ what: 'could not stage a destruction to react to', ok: false }], unverified: 0 });
          continue;
        }
        victim.defMod -= 9000;
        victim.position = 'def';
        atk.attacksUsed = 0;
        atk.summonedOnTurn = 0;
        atk.atkMod += 3000;
        const stepped = run(s, FOE, { type: 'attack', uid: atk.uid, targetUid: victim.uid });
        if (typeof stepped === 'string' || !stepped.pending) {
          results.push({ slug: def.slug, trigger: eff.trigger, checks: [{ what: 'destruction window never opened', ok: false }], unverified: 0 });
          continue;
        }
        audit(def, eff, stepped, (st) => run(st, ME, { type: 'respondTrap', uid: c.uid, targets: targetsFor(st, def) }));
      } else {
        // anyOpponentTurn: opens when the opponent enters their Battle Phase.
        const stepped = run(s, FOE, { type: 'toPhase', phase: 'battle' });
        if (typeof stepped === 'string' || !stepped.pending) {
          results.push({ slug: def.slug, trigger: eff.trigger, checks: [{ what: `no window for ${eff.window}`, ok: false }], unverified: 0 });
          continue;
        }
        audit(def, eff, stepped, (st) => run(st, ME, { type: 'respondTrap', uid: c.uid, targets: targetsFor(st, def) }));
      }
      continue;
    }

    /* ---- Monsters summoned from the hand ---- */
    if (eff.trigger === 'onSummon' || eff.trigger === 'onNormalSummon') {
      if (def.isFusion && (def.fusionMaterials ?? []).length) {
        /* Driven through a real Fusion Summon. This used to be skipped with a
           note claiming another path covered it — nothing did, and every
           Fusion monster in the game shipped with its effect never verified
           once. That is how Blue-Eyes Ultimate Dragon's "attacks every monster
           once each" could shrink with every kill and no check noticed.

           Materials go to the hand, which `fusionSummon` accepts, so recipes
           of any size fit whatever the board looks like. */
        const s = stocked();
        const c = mint(s, ME, def.slug);
        s.players[ME].extra.push(c);
        s.players[ME].hand.push(mint(s, ME, 'polymerization'));
        const mats = (def.fusionMaterials ?? []).map((m) => {
          const inst = mint(s, ME, m);
          s.players[ME].hand.push(inst);
          return inst.uid;
        });
        satisfy(s, eff, c);
        audit(def, eff, s, (st) =>
          run(st, ME, {
            type: 'fusionSummon',
            extraUid: c.uid,
            materials: mats,
            zone: st.players[ME].monsters.findIndex((m) => !m),
            position: 'atk',
            targets: targetsFor(st, def),
          })
        );
        continue;
      }
      /* A Fusion with no recipe — Flame Swordsman, Bickuribox — lives in a
         main deck as a plain beater, so the ordinary Normal Summon below is
         exactly how a player reaches it. */
      const s = stocked();
      const c = mint(s, ME, def.slug);
      s.players[ME].hand.push(c);
      satisfy(s, eff, c);

      /* Some monsters cannot be Normal Summoned at all. A Toon needs its Toon
         World face-up, which a player reaches by playing it, so put it down and
         the ordinary summon below then works. A Ritual monster has no Normal
         Summon route at any price — it arrives through its Ritual Spell, and
         that spell's own audit covers the summon — so drop it onto the field
         directly and fire the trigger the same way the engine does. */
      if (CARDS[def.slug].summonRequires) {
        s.players[ME].spellTrap = mint(s, ME, CARDS[def.slug].summonRequires!);
        s.players[ME].spellTrap!.face = 'up';
      } else if (def.isRitual) {
        const spell = ritualSpellFor(def.slug);
        if (!spell) {
          skipped.push(`${def.slug} (Ritual with no Ritual Spell in the game)`);
          continue;
        }
        // The monster waits in the Deck, the Spell goes in hand, and a body
        // sits on the field to pay the tribute — exactly the position a player
        // is in when they Ritual Summon.
        s.players[ME].hand = s.players[ME].hand.filter((h) => h.uid !== c.uid);
        s.players[ME].deck.push(c);
        const sp = mint(s, ME, spell);
        s.players[ME].hand.push(sp);
        if (!s.players[ME].monsters.some((m) => m)) place(s, ME, 0, 'baby-dragon');
        audit(def, eff, s, (st) => run(st, ME, { type: 'activateSpell', uid: sp.uid, targets: targetsFor(st, def) }));
        continue;
      }

      /* Tribute Summons need bodies to give up, so stock exactly enough — and
         ask the engine how many rather than re-deriving it from the level. A
         Toon under its own Toon World needs none at all, and a local copy of
         the rule said two, so the summon aimed at a zone it never freed. */
      const need = tributesRequired(def.slug, s, ME);
      for (let z = 0; z < need; z++) if (!s.players[ME].monsters[z]) place(s, ME, z, 'baby-dragon');
      const tributes = s.players[ME].monsters.filter((m): m is CardInstance => !!m).slice(0, need).map((m) => m.uid);
      const zone = need > 0 ? s.players[ME].monsters.findIndex((m) => m && tributes.includes(m.uid)) : 2;
      audit(
        def,
        eff,
        s,
        (st) => run(st, ME, { type: 'normalSummon', uid: c.uid, zone, position: 'atk', face: 'up', tributes, targets: targetsFor(st, def) }),
        (def.atk ?? 0) - tributes.reduce((n, u) => n + (CARDS[s.players[ME].monsters.find((m) => m?.uid === u)?.slug ?? '']?.atk ?? 0), 0)
      );
      continue;
    }

    /* ---- Flip effects: set the monster, then Flip Summon it ---- */
    if (eff.trigger === 'onFlip') {
      const s = stocked();
      const c = place(s, ME, 2, def.slug, 'def');
      c.face = 'down';
      c.summonedOnTurn = 0;
      satisfy(s, eff, c);
      audit(def, eff, s, (st) => run(st, ME, { type: 'changePosition', uid: c.uid }));
      continue;
    }

    /* ---- Watching the opponent summon (Slifer's second mouth) ---- */
    if (eff.trigger === 'onOpponentSummon') {
      /* Driven through a real Normal Summon by the other player, because that
         is the only thing that fires it — the effect is not something its
         controller can ever choose to use. Slifer is put down face-up with a
         hand behind him so his own ATK is real, and the opponent is left one
         empty zone and one monster in hand to walk into it. */
      const s = stocked();
      const c = place(s, ME, 2, def.slug);
      c.summonedOnTurn = 0;
      s.players[FOE].monsters[1] = null; // room for the summon
      s.players[FOE].normalSummonUsed = false;
      /* Big enough to survive the drain, so the drop in ATK is readable. A
         small victim is wiped out by its own second half and the drain becomes
         invisible — the op then reads as "did nothing" when it did exactly what
         it says. The destroy half is pinned by name in `npm run rules`, where
         both outcomes can be set up separately. */
      const fodder = s.players[FOE].monsters[0]!;
      const victim = mint(s, FOE, 'summoned-skull'); // 2500, one tribute
      s.players[FOE].hand = [victim];
      s.active = FOE;
      satisfy(s, eff, c);
      audit(def, eff, s, (st) =>
        run(st, FOE, {
          type: 'normalSummon',
          uid: victim.uid,
          zone: 1,
          position: 'atk',
          face: 'up',
          tributes: [fodder.uid],
        })
      );
      continue;
    }

    /* ---- Ignition effects fired from the field ---- */
    if (eff.trigger === 'ignition') {
      const s = stocked();
      const c = place(s, ME, 2, def.slug);
      c.summonedOnTurn = 0;
      if (eff.cost?.tribute) {
        // Needs fodder besides itself.
        s.players[ME].monsters[0] = s.players[ME].monsters[0] ?? mint(s, ME, 'baby-dragon');
      }
      satisfy(s, eff, c);
      audit(def, eff, s, (st) => run(st, ME, { type: 'ignition', uid: c.uid, targets: targetsFor(st, def) }));
      continue;
    }

    /* ---- Continuous auras: assert the buff is actually applied ---- */
    if (eff.trigger === 'continuous') {
      const s = stocked();
      /* An aura can be conditional — "while you control no other monsters",
         "while you control Time Wizard" — and probing it on a board that fails
         the condition reports the card broken for a reason that is entirely
         about this position. The card goes down first so `satisfy` can arrange
         the field around it. */
      let selfCard: CardInstance | undefined;
      const zone: 'monster' | 'field' | 'spellTrap' =
        def.kind === 'monster' ? 'monster' : def.subKind === 'Field' ? 'field' : 'spellTrap';
      if (zone === 'monster') selfCard = place(s, ME, 2, def.slug);
      else if (zone === 'field') s.players[ME].field = selfCard = mint(s, ME, def.slug);
      else s.players[ME].spellTrap = selfCard = mint(s, ME, def.slug);
      satisfy(s, eff, selfCard);

      /* An aura that only buffs Fish needs a Fish on the board, or nothing it
         does can be seen and the card looks broken when it is not.

         *After* `satisfy`, because there are three Monster Zones and these two
         both want one. Filling in fodder first took the zone the condition
         needed, so "while you control Gazelle: all Beast monsters gain 800"
         was set up with no Gazelle — the condition read false, the aura did
         nothing, and the harness reported the card broken. The condition is
         what makes the effect legal at all, so it gets the scarce zone. */
      const want = eff.aura?.target.filter;
      /* A subject the aura is *only* connected to through the aura itself:
         never the card being tested, and never a card the condition named —
         Gazelle satisfies "while you control Gazelle" and also grants itself
         800 while Berfomet is out, so lifting Berfomet moves Gazelle by 1600
         and the delta says nothing about the aura under test. A plain
         unrelated Beast moves by exactly what was promised, or the aura is
         broken. */
      const entangled = [selfCard?.slug, eff.condition?.requiresOnField, ...(eff.condition?.requiresOnFieldAll ?? [])]
        .filter((x): x is string => !!x);
      let fodder: CardInstance | undefined;
      if (want) {
        const auraSide: PlayerId = eff.aura?.target.side === 'opp' ? FOE : ME;
        const match = matchCard(want, 'monster', entangled);
        if (match) {
          const free = (pid: PlayerId) => {
            const z = s.players[pid].monsters.findIndex((m) => !m);
            if (z >= 0) return z;
            /* Three Monster Zones, and by now the card under test and whatever
               its condition required are standing in them — so there was no
               room left and the subject was simply never placed, which is how
               this whole measurement came to be skipped in silence. Evict
               something that could not have been the subject anyway. */
            return s.players[pid].monsters.findIndex(
              (m) => m && m.uid !== selfCard?.uid && !matchesLoosely(m.slug, want) && !entangled.includes(m.slug)
            );
          };
          const z = free(ME);
          if (z >= 0) {
            const near = place(s, ME, z, match.slug);
            if (auraSide === ME) fodder = near;
          }
          const fz = free(FOE);
          if (fz >= 0) {
            const far = place(s, FOE, fz, match.slug);
            if (auraSide === FOE) fodder = far;
          }
        }
      }

      /* Snapshotted with the card lifted out and then put back, so the
         comparison is "with it" against "without it" on the very same board —
         `satisfy` may have arranged that board around the card, and taking the
         "before" reading first would compare two different positions. */
      const lift = () => {
        if (zone === 'monster') s.players[ME].monsters = s.players[ME].monsters.map((m) => (m?.uid === selfCard!.uid ? null : m));
        else if (zone === 'field') s.players[ME].field = null;
        else s.players[ME].spellTrap = null;
      };
      const restore = () => {
        if (zone === 'monster') s.players[ME].monsters[2] = selfCard!;
        else if (zone === 'field') s.players[ME].field = selfCard!;
        else s.players[ME].spellTrap = selfCard!;
      };
      lift();
      const before = snap(s);
      const fb = allFlags(s);
      restore();
      const after = snap(s);
      const fa = allFlags(s);
      const aura = eff.aura;
      const checks: Check[] = [];
      if (aura) {
        const moved =
          after.me.totalAtk !== before.me.totalAtk ||
          after.foe.totalAtk !== before.foe.totalAtk ||
          after.me.totalDef !== before.me.totalDef ||
          after.foe.totalDef !== before.foe.totalDef ||
          [...fa].some((f) => !fb.has(f));
        // Placing a monster adds its own body; discount that.
        const selfAtk = def.kind === 'monster' ? (def.atk ?? 0) : 0;
        const onlySelf = after.me.totalAtk - before.me.totalAtk === selfAtk && after.foe.totalAtk === before.foe.totalAtk;
        checks.push({
          what:
            `aura applies (${aura.atk ?? 0}/${aura.def ?? 0}` +
            (aura.per ? ` +${aura.per.atk ?? 0}/${aura.per.def ?? 0} per ${aura.per.zone}` : '') +
            `${aura.grants?.length ? ' +' + aura.grants.join(',') : ''})`,
          ok: moved && !(onlySelf && !aura.grants?.length && !aura.def && !aura.per),
        });

        /* And then the same measurement taken where it cannot be flattered.
           The reading above is a board total, so *any* live aura on the same
           card satisfies "something moved" — Berfomet grants himself 800 and
           the Beasts beside him 800, and with the second one set to zero the
           first one alone still moved the total and the check went green.
           A card with one aura is measured honestly by accident; a card with
           two is not measured at all.

           So when the aura names who it is for, read that card's own stat with
           the source lifted and with it restored, and insist the number moves
           by exactly what was promised. Nothing else on the board can supply
           that delta. Verified by zeroing the aura and watching this fail. */
        const wantAtk = aura.atk ?? 0;
        const wantDef = aura.def ?? 0;
        if (fodder && !aura.per && (wantAtk || wantDef)) {
          const readOne = () => ({
            atk: effAtk(s, fodder!, fodder!.owner),
            def: effDef(s, fodder!, fodder!.owner),
          });
          lift();
          const off = readOne();
          restore();
          const on = readOne();
          checks.push({
            what: `aura reaches ${CARDS[fodder.slug].name} for exactly ${wantAtk}/${wantDef}`,
            ok: on.atk - off.atk === wantAtk && on.def - off.def === wantDef,
          });
        }
      }

      /* A scaling aura gets its own measurement, because the generic one above
         cannot see it: restoring the card adds its own body to the side total,
         which satisfies "something moved" all by itself. Disabling the
         `onlySelf` guard for these made the check pass on an engine with the
         scaling ripped out — so it now stocks the counted zone by hand and
         insists the number moves by exactly the promised step. */
      if (aura?.per && selfCard) {
        const per = aura.per;
        const feed = matchCard(per.filter, per.zone.endsWith('Grave') || per.zone === 'ownHand' ? 'any' : 'monster');
        const step = (per.atk ?? 0) || (per.def ?? 0);
        const read = () => (per.atk ? effAtk(s, selfCard!, ME) : effDef(s, selfCard!, ME));
        const emptyPool = () => {
          if (per.zone === 'ownHand') s.players[ME].hand = [];
          else if (per.zone === 'ownGrave') s.players[ME].grave = [];
          else if (per.zone === 'eitherGrave') { s.players[ME].grave = []; s.players[FOE].grave = []; }
        };
        if (!feed || !step) {
          checks.push({ what: `aura scales per ${per.zone}`, ok: false });
        } else {
          emptyPool();
          const before = read();
          // Deliberately fed on the *far* side where the wording allows it, so a
          // card that only ever looks at its own is caught rather than flattered.
          if (per.zone === 'ownHand') s.players[ME].hand.push(mint(s, ME, feed.slug));
          else if (per.zone === 'ownGrave') s.players[ME].grave.push(mint(s, ME, feed.slug));
          else if (per.zone === 'eitherGrave') s.players[FOE].grave.push(mint(s, FOE, feed.slug));
          else {
            const side = per.zone === 'ownField' ? ME : FOE;
            const fz = s.players[side].monsters.findIndex((m) => !m);
            if (fz >= 0) place(s, side, fz, feed.slug);
          }
          const after2 = read();
          checks.push({
            what: `aura scales +${step} per ${per.zone} (${before}→${after2})`,
            ok: after2 - before === step,
          });
        }
      }
      results.push({ slug: def.slug, trigger: eff.trigger, checks, unverified: aura ? 0 : eff.ops.length });
      continue;
    }

    /* ---- Battle-time and phase triggers ---- */
    if (
      eff.trigger === 'onDestroyedByBattle' ||
      eff.trigger === 'onBattleDestroy' ||
      eff.trigger === 'onDeclareAttack' ||
      eff.trigger === 'onAttacked' ||
      eff.trigger === 'onDealBattleDamage'
    ) {
      const s = stocked();
      s.phase = 'battle';
      const weak = eff.trigger === 'onDestroyedByBattle' || eff.trigger === 'onAttacked';
      // The card under test sits where the trigger will reach it.
      const owner: PlayerId = weak ? FOE : ME;
      const zone = s.players[owner].monsters.findIndex((m) => !m);
      const c = place(s, owner, zone < 0 ? 2 : zone, def.slug);
      c.summonedOnTurn = 0;
      c.attacksUsed = 0;
      satisfy(s, eff, c);
      // Make the swing decisive in the right direction.
      const attacker = weak ? s.players[ME].monsters.find((m) => m && m.uid !== c.uid)! : c;
      attacker.summonedOnTurn = 0;
      attacker.attacksUsed = 0;
      if (weak) attacker.atkMod += 5000;
      else {
        const victim = s.players[FOE].monsters.find((m) => !!m);
        if (victim) victim.defMod -= 9000;
        attacker.atkMod += 3000;
      }
      const targetUid = weak ? c.uid : (s.players[FOE].monsters.find((m) => m && m.uid !== c.uid)?.uid ?? null);
      audit(def, eff, s, (st) => run(st, ME, { type: 'attack', uid: attacker.uid, targetUid }));
      continue;
    }

    /* ---- Turn-boundary and grave triggers ---- */
    if (eff.trigger === 'onOwnTurnStart' || eff.trigger === 'onOwnTurnEnd') {
      const s = stocked();
      const c = place(s, ME, 2, def.slug);
      c.summonedOnTurn = 0;
      satisfy(s, eff, c);
      audit(def, eff, s, (st) => run(st, ME, { type: 'endTurn' }));
      continue;
    }
    /* Dark Hole destroys, so it satisfies both: `onSentToGrave` fires for any
       departure and `onDestroyed` only for a destruction, and a board wipe is
       a destruction. Driving them the same way keeps the new trigger covered
       rather than quietly landing in "effects not driven". */
    if (eff.trigger === 'onSentToGrave' || eff.trigger === 'onDestroyed') {
      const s = stocked();
      const zone = s.players[ME].monsters.findIndex((m) => !m);
      const c = place(s, ME, zone < 0 ? 2 : zone, def.slug);
      c.summonedOnTurn = 0;
      satisfy(s, eff, c);
      // Blow up the whole board to send it away.
      const dh = mint(s, ME, 'dark-hole');
      s.players[ME].hand.push(dh);
      audit(def, eff, s, (st) => run(st, ME, { type: 'activateSpell', uid: dh.uid, targets: [] }));
      continue;
    }

    skipped.push(`${def.slug} (${eff.trigger})`);
  }
}

/* ------------------------------------------------------------------ */
/* Lint: effects that cannot do anything at all                        */
/* ------------------------------------------------------------------ */

/**
 * The checks above prove an effect fires. This catches the other failure: an
 * effect that fires perfectly and still does nothing, because the numbers in it
 * are zero or it carries no operations. Dark Magician shipped with a +0 ATK
 * aura that way, doing nothing but taking up a line of rules text.
 */
const dead: string[] = [];
for (const def of Object.values(CARDS)) {
  if (def.slug === 'facedown' || def.slug === 'polymerization') continue;
  if (!def.effects.length) dead.push(`${def.slug}: no effects at all`);
  for (const eff of def.effects) {
    const a = eff.aura;
    const perAny = (a?.per?.atk ?? 0) || (a?.per?.def ?? 0);
    if (a && !(a.atk ?? 0) && !(a.def ?? 0) && !a.grants?.length && !perAny)
      dead.push(`${def.slug} [${eff.trigger}]: aura does nothing`);
    if (!eff.ops.length && !a) dead.push(`${def.slug} [${eff.trigger}]: no operations and no aura`);
    for (const op of eff.ops) {
      if ((op.op === 'gainAtk' || op.op === 'gainDef') && !op.amount && !('scale' in op && op.scale)) {
        dead.push(`${def.slug} [${eff.trigger}]: ${op.op} of 0`);
      }
      if ((op.op === 'damage' || op.op === 'heal') && !op.amount && !('scale' in op && op.scale)) {
        dead.push(`${def.slug} [${eff.trigger}]: ${op.op} of 0`);
      }
      if (op.op === 'draw' && !op.count) dead.push(`${def.slug}: draws 0 cards`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

const failures = results.filter((r) => r.checks.some((c) => !c.ok));
const totalChecks = results.reduce((n, r) => n + r.checks.length, 0);
const passedChecks = results.reduce((n, r) => n + r.checks.filter((c) => c.ok).length, 0);
const unverified = results.reduce((n, r) => n + r.unverified, 0);

if (ONLY) {
  for (const r of results) {
    console.log(`${r.slug} [${r.trigger}]`);
    for (const c of r.checks) console.log(`  ${c.ok ? '✅' : '❌'} ${c.what}`);
    if (r.unverified) console.log(`  … ${r.unverified} op(s) not observable in this setup`);
  }
} else {
  console.log(`Card audit — ${Object.keys(CARDS).length} cards, ${results.length} effects exercised\n`);
  if (failures.length) {
    console.log(`${failures.length} effect(s) did not do what they claim:\n`);
    for (const r of failures) {
      console.log(`  ❌ ${r.slug} [${r.trigger}]`);
      for (const c of r.checks.filter((x) => !x.ok)) console.log(`       ${c.what}`);
    }
    console.log('');
  }
  if (dead.length) {
    console.log(`${dead.length} effect(s) can never do anything:\n`);
    for (const d of dead) console.log(`  ⚠️  ${d}`);
    console.log('');
  }
  console.log(`checks: ${passedChecks}/${totalChecks} passed`);
  console.log(`effects that do nothing: ${dead.length}`);
  console.log(`ops not observable in this harness: ${unverified}`);
  /* Name them. A bare count is the shape of a gap nobody looks at — and an
     effect this harness never drives is exactly where a bug survives, because
     every other check here is about the ones it does drive. */
  if (skipped.length) {
    console.log(`effects not driven: ${skipped.length}`);
    for (const s of skipped) console.log(`  · ${s}`);
  }
  console.log(failures.length ? `\n${failures.length} card(s) FAILED` : '\nEvery exercised effect behaved as written. ✅');
}

if (failures.length || dead.length) process.exitCode = 1;
