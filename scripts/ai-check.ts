/**
 * Does the computer play the board in front of it?
 *
 *   npx tsx scripts/ai-check.ts
 *
 * The arena measures whether one AI beats another; it cannot say *why*, and a
 * win rate hides a specific blunder inside a hundred games. This is the other
 * half: positions with one obviously right answer, checked directly. It exists
 * because of a report — "the AI is not trained to play against Mirror Wall and
 * other cards we actually fixed" — which turned out to be three separate
 * defects in how the search read a position:
 *
 *  - Declaring an attack opens a response window, and a line was scored with
 *    the attack still hanging in the air, neither landed nor answered. Swinging
 *    into a face-up Mirror Wall therefore looked like a clean kill.
 *  - The lookahead played out the *real* deck, so it could discover that
 *    passing "wins" two turns later because the winning card was on top. That
 *    is how the AI came to pass its turn holding the only blocker it had, with
 *    the board saying summon by nearly 6000 points.
 * The last case here guards an invariant rather than replaying a known bug: a
 * plan must run the turn out, end the duel, or hand a decision to the other
 * seat. The search could once return a half-played turn — it compared those
 * against complete ones, where they flatter themselves by not having paid for
 * handing the turn over — but over eight full duels the old code never actually
 * did, so this case does not discriminate against it. It is a guard, not
 * evidence.
 *
 * Two things this check learned the hard way, both of which made an earlier
 * version of it useless:
 *
 * Every "must not" case is paired with a control that must still act. A check
 * that only ever asks the AI to decline passes perfectly on an AI that has
 * forgotten how to attack.
 *
 * And every position is played across ten deck orders, not one. Two of these
 * three defects only bite when the deck falls a particular way, so a single
 * board proves nothing: run against the code that had all three bugs, one board
 * passed every case. Ten boards separate them cleanly — the buggy AI scores
 * 7/10 and 9/10 where this insists on 10/10.
 */
import { applyAction, createDuel } from '../src/game/engine';
import { AI_LEVELS, planTurn } from '../src/game/ai';
import { CARDS } from '../src/game/cards';
import type { CardInstance, DuelAction, DuelState, PlayerId } from '../src/game/types';

const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';

/** Ten arbitrary deck orders. The bugs this guards are order-dependent. */
const SEEDS = [3, 12, 41, 99, 137, 256, 511, 900, 1234, 4242];

let uid = 0;
let failures = 0;

function card(pid: PlayerId, slug: string, position: 'atk' | 'def' = 'atk'): CardInstance {
  if (!CARDS[slug]) throw new Error(`ai-check: no such card "${slug}"`);
  return {
    uid: `a${uid++}`,
    slug,
    owner: pid,
    face: 'up',
    position,
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

/** An empty board mid-duel, so nothing but what a case sets up is in play. */
function fresh(seed: number, me: string): DuelState {
  const s = structuredClone(createDuel({ seed, p1: { duelistId: me, name: 'Me' }, p2: { duelistId: 'yugi', name: 'Foe' } }));
  s.turn = 6;
  s.active = ME;
  s.phase = 'main';
  for (const pid of [ME, FOE] as PlayerId[]) {
    const p = s.players[pid];
    p.monsters = [null, null, null];
    p.spellTrap = null;
    p.field = null;
    p.hand = [];
    p.grave = [];
    p.lp = 4000;
    p.normalSummonUsed = false;
  }
  return s;
}

interface Case {
  name: string;
  /** Whose deck sits behind the position — it decides what the AI draws. */
  duelist?: string;
  build: (s: DuelState) => void;
  want: (plan: DuelAction[], end: DuelState) => boolean;
  because: string;
}

const did = (plan: DuelAction[], type: string) => plan.some((a) => a.type === type);

const CASES: Case[] = [
  {
    name: 'summons a blocker rather than passing into a 2500 attacker',
    duelist: 'rex',
    because: 'the board rates summoning nearly 6000 points above passing; the blocker saves 2200 Life Points',
    build: (s) => {
      s.players[ME].hand = [card(ME, 'two-headed-king-rex')];
      for (const slug of ['uraby', 'trakodon', 'megazowler']) s.players[ME].grave.push(card(ME, slug));
      s.players[FOE].monsters[0] = card(FOE, 'summoned-skull');
    },
    want: (plan) => did(plan, 'normalSummon'),
  },
  {
    name: 'will not attack into a face-up Mirror Wall',
    because: 'the attack is negated, the attacker halved for good, and they gain 300 Life Points',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'megazowler');
      s.players[FOE].monsters[0] = card(FOE, 'aqua-madoor');
      s.players[FOE].spellTrap = card(FOE, 'mirror-wall');
    },
    want: (plan) => !did(plan, 'attack'),
  },
  {
    name: 'will not attack into a face-up Shadow Spell',
    because: 'same shape as Mirror Wall — negated, and the attacker loses 800 ATK for good',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'megazowler');
      s.players[FOE].monsters[0] = card(FOE, 'aqua-madoor');
      s.players[FOE].spellTrap = card(FOE, 'shadow-spell');
    },
    want: (plan) => !did(plan, 'attack'),
  },
  {
    /* Straight off a duel log the owner sent: Mai at 2350 Life Points swung a
       1400 into a 3100 Dark Magician for 1700, then a 1200 into the same
       monster for 1900, and killed herself. The cause was not the evaluation —
       it was that Mike had a card Set, so declaring an attack opened a window
       the AI could not read, and a window it cannot read is left exactly where
       it is. The line was then scored with the blow hanging in the air: no
       damage, no loss, nothing having happened. Blindness to what an attack
       *costs* it, dressed up as caution. */
    name: 'will not swing into a monster that kills it, Set card or no Set card',
    because: 'the attack is refused whatever the Set card turns out to be — it loses 1700 Life Points even if nobody responds',
    build: (s) => {
      s.players[ME].lp = 2350;
      s.players[ME].monsters[0] = card(ME, 'winged-dragon-guardian-of-the-fortress-1');
      s.players[ME].monsters[1] = card(ME, 'sonic-maid');
      const magician = card(FOE, 'dark-magician');
      magician.atkMod = 600; // as it stood in the log, at 3100
      s.players[FOE].monsters[0] = magician;
      const set = card(FOE, 'mirror-force');
      set.face = 'down';
      set.summonedOnTurn = 0;
      s.players[FOE].spellTrap = set;
    },
    want: (plan) => !did(plan, 'attack'),
  },
  {
    name: 'CONTROL: swings when the same unread Set card sits behind a monster it beats',
    because: 'without this, an AI that had stopped attacking whenever anything was Set would pass the case above',
    build: (s) => {
      s.players[ME].lp = 2350;
      s.players[ME].monsters[0] = card(ME, 'summoned-skull');
      s.players[FOE].monsters[0] = card(FOE, 'aqua-madoor');
      const set = card(FOE, 'mirror-force');
      set.face = 'down';
      set.summonedOnTurn = 0;
      s.players[FOE].spellTrap = set;
    },
    want: (plan) => did(plan, 'attack'),
  },
  {
    name: 'CONTROL: attacks the same board with no wall on it',
    because: 'without this, an AI that had simply forgotten how to attack would pass the two above',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'megazowler');
      s.players[FOE].monsters[0] = card(FOE, 'aqua-madoor');
    },
    want: (plan) => did(plan, 'attack'),
  },
  {
    name: 'CONTROL: attacks into a face-DOWN Mirror Wall',
    because: 'the same card it must respect face-up, it has not been shown — sidestepping it would be reading the card',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'megazowler');
      s.players[FOE].monsters[0] = card(FOE, 'aqua-madoor');
      const trap = card(FOE, 'mirror-wall');
      trap.face = 'down';
      s.players[FOE].spellTrap = trap;
    },
    want: (plan) => did(plan, 'attack'),
  },
  {
    name: 'CONTROL: still attacks through Tornado Wall',
    because: 'it stops battle damage, not the kill — declining hands over a card for nothing',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'megazowler');
      s.players[FOE].monsters[0] = card(FOE, 'aqua-madoor');
      s.players[FOE].spellTrap = card(FOE, 'tornado-wall');
    },
    want: (plan) => did(plan, 'attack'),
  },
  {
    name: 'takes lethal when it is there',
    because: 'an empty board and 1000 Life Points across the table is the whole duel',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'megazowler');
      s.players[FOE].lp = 1000;
    },
    want: (_plan, end) => end.winner === ME,
  },
  {
    name: 'reads the effective stat, not the printed one',
    duelist: 'rex',
    because: 'Two-Headed King Rex prints 1600 and is 2200 with three Dinosaurs in the Graveyard',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'two-headed-king-rex');
      for (const slug of ['uraby', 'trakodon', 'megazowler']) s.players[ME].grave.push(card(ME, slug));
      s.players[FOE].monsters[0] = card(FOE, 'la-jinn-the-mystical-genie-of-the-lamp');
    },
    want: (plan) => did(plan, 'attack'),
  },
  {
    name: 'never leaves a turn half-played',
    because: 'a plan must run the turn out, end the duel, or hand a decision to the other seat',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'megazowler');
      s.players[ME].monsters[1] = card(ME, 'battle-ox');
      s.players[FOE].monsters[0] = card(FOE, 'mystical-elf', 'def');
      s.players[FOE].spellTrap = card(FOE, 'mirror-wall');
    },
    // A pending window counts: the AI hands over, the responder answers, and
    // `aiNext` searches again from what is left. Only stopping with the turn
    // still ours and nothing owed is a plan that gave up.
    want: (_plan, end) => end.active !== ME || !!end.winner || !!end.pending,
  },
];

console.log(`AI play checks — every position over ${SEEDS.length} deck orders\n`);

for (const c of CASES) {
  const bad: string[] = [];
  for (const seed of SEEDS) {
    const start = fresh(seed, c.duelist ?? 'kaiba');
    c.build(start);
    const plan = planTurn(start, ME, AI_LEVELS.champion, 2500);
    let end = start;
    const shown: string[] = [];
    for (const a of plan) {
      const res = applyAction(end, ME, a);
      if (res.error) {
        shown.push(`${a.type}✗`);
        break;
      }
      end = res.state;
      shown.push(a.type);
    }
    if (!c.want(plan, end)) bad.push(`seed ${seed}: ${shown.join(' → ') || '(nothing)'}`);
  }
  const pass = bad.length === 0;
  if (!pass) failures += 1;
  console.log(`  ${pass ? '✅' : '❌'} ${c.name}  ${SEEDS.length - bad.length}/${SEEDS.length}`);
  if (!pass) {
    console.log(`       expected: ${c.because}`);
    for (const line of bad.slice(0, 4)) console.log(`       ${line}`);
  }
}

console.log(
  failures
    ? `\n❌ ${failures} of ${CASES.length} positions played wrong.`
    : `\n✅ all ${CASES.length} positions played correctly, on every deck order.`
);
process.exitCode = failures ? 1 : 0;
