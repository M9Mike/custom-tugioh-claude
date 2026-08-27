/**
 * The decision surface: how the computer's appetite for the unknown actually
 * curves.
 *
 *   npx tsx scripts/ai-surface.ts            # the full table
 *   SURFACE_SEEDS=3 npx tsx scripts/ai-surface.ts   # quicker, noisier
 *
 * Born of a report — Lady of Faith standing beside a lone face-down monster,
 * 9000 Life Points behind her, and the computer ending the turn. The cause was
 * a hard filter (`UNKNOWN_DEF`) that deleted the attack before anything could
 * price it, and the lesson is the harness: an appetite is a CURVE, and a curve
 * cannot be seen from one position. This draws it — attack rate as a function
 * of attacker size, crossed with the contexts that should bend it — so any
 * change to the pricing is a diff between two tables rather than a feeling.
 *
 * A report, not a gate: the pass/fail thresholds live in `ai-check`, pinned at
 * tolerant frequencies. This is where those thresholds come from.
 */
import { writeFileSync } from 'node:fs';
import { createDuel } from '../src/game/engine';
import { planTurn, setPureClock } from '../src/game/ai';

setPureClock(true);
import { CARDS } from '../src/game/cards';
import type { CardInstance, DuelAction, DuelState, PlayerId } from '../src/game/types';

const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';
const SEEDS = Array.from({ length: Number(process.env.SURFACE_SEEDS ?? 5) }, (_, i) => [3, 41, 137, 511, 1234, 77, 900][i] ?? 7 + i * 31);
const BUDGET = Number(process.env.SURFACE_BUDGET ?? 700);

let uid = 0;
function card(pid: PlayerId, slug: string, face: 'up' | 'down' = 'up', pos: 'atk' | 'def' = 'atk'): CardInstance {
  if (!CARDS[slug]) throw new Error(`ai-surface: no such card "${slug}"`);
  return {
    uid: `sf${uid++}`,
    slug,
    owner: pid,
    face,
    position: pos,
    atkMod: 0,
    defMod: 0,
    turnAtkMod: 0,
    turnDefMod: 0,
    counters: 0,
    equips: [],
    equippedTo: undefined,
    flags: {},
    turnFlags: {},
    summonedOnTurn: 0,
    attacksUsed: 0,
    effectUsedOnTurn: -1,
    absorbed: [],
    isToken: false,
  } as unknown as CardInstance;
}

/**
 * The ATK ladder, named rather than derived: almost nothing in this game is
 * effectless (one monster in the whole database), so these are picked for
 * carrying no rider that fires on the way INTO an attack — their effects
 * happen at summon time or sit as auras, and the body on the ladder is
 * already standing.
 */
function ladder(): { slug: string; atk: number }[] {
  return ['kuriboh', 'mystical-elf', 'lady-of-faith', 'battle-ox', 'curse-of-dragon', 'summoned-skull'].map((slug) => ({
    slug,
    atk: CARDS[slug].atk ?? 0,
  }));
}

/**
 * A mid-duel board against a real deck: the face-down's possible identities
 * are the opponent's genuine unseen pool, which is what the sampled worlds
 * deal from and therefore what the decision is actually about.
 */
function board(seed: number, foeDeck = 'tony'): DuelState {
  const s = structuredClone(createDuel({ seed, p1: { duelistId: 'sarah', name: 'Me' }, p2: { duelistId: foeDeck, name: 'Foe' } }));
  s.turn = 4;
  s.active = ME;
  s.phase = 'main';
  for (const pid of [ME, FOE] as PlayerId[]) {
    const p = s.players[pid];
    p.monsters = [null, null, null];
    p.spellTrap = null;
    p.field = null;
    p.grave = [];
    p.lp = 8000;
  }
  s.players[ME].hand = [];
  s.players[ME].normalSummonUsed = true;
  return s;
}

const attacked = (plan: DuelAction[]) => plan.some((a) => a.type === 'attack');
const rate = (hits: number) => `${hits}/${SEEDS.length}`;

interface Row {
  section: string;
  label: string;
  hits: number;
  note?: string;
}
const rows: Row[] = [];

function measure(section: string, label: string, build: (s: DuelState) => void, want?: (plan: DuelAction[], s: DuelState) => boolean, note?: string) {
  let hits = 0;
  for (const seed of SEEDS) {
    const s = board(seed);
    build(s);
    const plan = planTurn(s, ME, 'champion', BUDGET);
    if (want ? want(plan, s) : attacked(plan)) hits += 1;
  }
  rows.push({ section, label, hits, note });
}

/* ---------------- 1. The face-down ladder ---------------- */
for (const { slug, atk } of ladder()) {
  measure('face-down, healthy (8000 LP)', `${String(atk).padStart(4)} ATK  ${CARDS[slug].name}`, (s) => {
    s.players[ME].monsters[0] = card(ME, slug);
    s.players[FOE].monsters[0] = card(FOE, 'mystical-elf', 'down', 'def');
  });
}

/* The same ladder with the cushion thin: 1500 Life Points changes what a
   bounce costs, and the curve should bend down. */
for (const { slug, atk } of ladder()) {
  measure('face-down, thin (1500 LP)', `${String(atk).padStart(4)} ATK`, (s) => {
    s.players[ME].lp = 1500;
    s.players[ME].monsters[0] = card(ME, slug);
    s.players[FOE].monsters[0] = card(FOE, 'mystical-elf', 'down', 'def');
  });
}

/* The last blocker: their 2400 stands over the board, and my attacker is the
   only thing between it and my Life Points. Trading it into a flip effect is
   how duels are lost, and the curve should bend hard. */
for (const { slug, atk } of [ladder()[2], ladder()[3], ladder()[5]]) {
  measure('face-down, last blocker vs their 2400', `${String(atk).padStart(4)} ATK`, (s) => {
    s.players[ME].monsters[0] = card(ME, slug);
    s.players[FOE].monsters[0] = card(FOE, 'mystical-elf', 'down', 'def');
    s.players[FOE].monsters[1] = card(FOE, 'rude-kaiser'); // 2400, standing
  });
}

/* A Set that visibly cost a Tribute skews huge — the tributes were paid in
   public. (Before the engine records that fact, this row reads the same as
   the healthy ladder; after, it should bend to nearly never.) */
for (const { slug, atk } of [ladder()[2], ladder()[3], ladder()[5]]) {
  measure('face-down that cost a Tribute', `${String(atk).padStart(4)} ATK`, (s) => {
    s.players[ME].monsters[0] = card(ME, slug);
    const set = card(FOE, 'summoned-skull', 'down', 'def');
    (set as unknown as { setTributes?: number }).setTributes = 1;
    s.players[FOE].monsters[0] = set;
  });
}

/* CONTROL: an empty board. Anything but 5/5 here is the computer forgetting
   how to win, and every loosening above must leave this untouched. */
for (const { slug, atk } of ladder()) {
  measure('CONTROL: empty board', `${String(atk).padStart(4)} ATK`, (s) => {
    s.players[ME].monsters[0] = card(ME, slug);
  });
}

/* ---------------- 2. The backrow, and following through ---------------- */

/* Tiger Axe: summon it, its effect forces their board into face-up Defence,
   and the attack it just created must be taken — Set card or no Set card. */
measure(
  'backrow fear',
  'Tiger Axe follows through (their Set card watching)',
  (s) => {
    s.players[ME].normalSummonUsed = false;
    s.players[ME].hand = [card(ME, 'tiger-axe')];
    /* 1800/800, standing: Tiger Axe loses to it face-on and kills it the
       moment its own effect forces it to kneel — which is the whole card. */
    s.players[FOE].monsters[0] = card(FOE, '7-colored-fish');
    s.players[FOE].spellTrap = card(FOE, 'mirror-force', 'down');
    s.players[FOE].hand = [card(FOE, 'kuriboh')];
  },
  (plan) => plan.some((a) => a.type === 'normalSummon') && attacked(plan)
);

/* The same swing with every answer accounted for: their Graveyard holds both
   Mirror Forces and the unseen pool holds no trap at all. Fear of nothing is
   not caution, and the whole board should commit. */
measure(
  'backrow fear',
  'no possible trap left → all three attack',
  (s) => {
    s.players[ME].monsters[0] = card(ME, 'battle-ox');
    s.players[ME].monsters[1] = card(ME, 'rude-kaiser');
    s.players[ME].monsters[2] = card(ME, 'judge-man');
    s.players[FOE].spellTrap = card(FOE, 'de-spell', 'down');
    s.players[FOE].grave = [card(FOE, 'mirror-force'), card(FOE, 'mirror-force')];
    /* Not Kuriboh — its hand-negate is a trap-window effect, an answer. */
    s.players[FOE].hand = [card(FOE, 'pot-of-greed')];
    s.players[FOE].deck = s.players[FOE].deck.filter((c) => !(CARDS[c.slug]?.effects ?? []).some((e) => e.trigger === 'trap'));
  },
  (plan) => plan.filter((a) => a.type === 'attack').length >= 3
);

/* Two attackers, one Set card. What doctrine promises is that the whole
   board is never fed to one unknown — and what the priced answer turns out
   to be is one better than the policy first guessed at: the strong body
   lands the profitable blow (the first is always fear-free), and the cheap
   one either leads the way in as the expendable probe or stays out of the
   line of fire entirely. What it must never do is march in behind the
   strong one, or be the only one to swing. */
let strongUid = '';
let weakUid = '';
measure(
  'backrow fear',
  'one blow tests the water, the cheap body stays safe or leads',
  (s) => {
    const strong = card(ME, 'summoned-skull');
    const weak = card(ME, 'kuriboh');
    strongUid = strong.uid;
    weakUid = weak.uid;
    s.players[ME].monsters[0] = strong;
    s.players[ME].monsters[1] = weak;
    s.players[FOE].spellTrap = card(FOE, 'mirror-force', 'down');
    s.players[FOE].hand = [card(FOE, 'kuriboh')];
  },
  (plan) => {
    const swings = plan.filter((a) => a.type === 'attack') as { uid: string }[];
    if (!swings.length) return false;
    if (swings.length === 1) return swings[0].uid === strongUid;
    return swings[0].uid === weakUid;
  }
);

/* ---------------- the table ---------------- */
let section = '';
for (const r of rows) {
  if (r.section !== section) {
    section = r.section;
    console.log(`\n${section}`);
  }
  console.log(`  ${rate(r.hits).padStart(5)}  ${r.label}${r.note ? `   — ${r.note}` : ''}`);
}

const json = process.env.SURFACE_JSON;
if (json) {
  writeFileSync(json, JSON.stringify(rows, null, 1));
  console.log(`\nwritten to ${json}`);
}
