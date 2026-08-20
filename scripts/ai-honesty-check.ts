/**
 * Does the computer opponent cheat?
 *
 *   npx tsx scripts/ai-honesty-check.ts
 *
 * "It cannot see hidden information" is the first paragraph of ai.ts, and for
 * most of this AI's life it was not true. The search simulated actions through
 * the real engine on the real state, which meant three leaks, none visible in
 * any win rate:
 *
 *  - `state.seed` holds the RNG. Simulating a coin flip consumed the same
 *    stream the real flip would, so the search KNEW how every gamble lands.
 *  - Attacking a face-down monster in simulation resolved the battle against
 *    the real card behind it.
 *  - The lookahead modelled the opponent's reply turn with their real hand.
 *
 * The fix is structural — the AI plans inside worlds keyed off a hash of what
 * it can legitimately see — and this check pins the structure with the only
 * test that cannot rot: INVARIANCE. Take one position; permute something the
 * AI must not know; the plan must not move. Then, as the control, change
 * something it CAN see and insist the plan (or at least its evaluation path)
 * is capable of moving at all. Each invariance case is the direct negation of
 * one of the three leaks, so reintroducing any of them turns this red.
 *
 * The permutations preserve everything visible: hand/deck/zone COUNTS, every
 * face-up card, the multiset of unseen cards. Only arrangement and hidden
 * identity move — precisely the things a player across the table could not
 * distinguish either.
 */
import { createDuel, cloneState } from '../src/game/engine';
import { planTurn, chooseTrapResponse, AI_LEVELS } from '../src/game/ai';
import { CARDS } from '../src/game/cards';
import type { CardInstance, DuelAction, DuelState, PlayerId } from '../src/game/types';

const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';

let uid = 0;
let failures = 0;

function card(pid: PlayerId, slug: string, position: 'atk' | 'def' = 'atk'): CardInstance {
  if (!CARDS[slug]) throw new Error(`ai-honesty-check: no such card "${slug}"`);
  return {
    uid: `h${uid++}`,
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

function fresh(seed: number, me = 'kaiba', foe = 'yugi'): DuelState {
  const s = structuredClone(createDuel({ seed, p1: { duelistId: me, name: 'Me' }, p2: { duelistId: foe, name: 'Foe' } }));
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
    p.lp = 6000;
    p.normalSummonUsed = false;
  }
  return s;
}

const sig = (plan: DuelAction[]) => JSON.stringify(plan);

function ok(pass: boolean, label: string, detail = '') {
  console.log(`  ${pass ? '✅' : '❌'} ${label}${!pass && detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
}

/**
 * A position rich enough that a leak would change the answer: the AI holds a
 * gamble card and real choices, the opponent has a face-down monster, a Set
 * backrow, a hand and a deck.
 */
function richPosition(seed: number): DuelState {
  const s = fresh(seed, 'keith', 'yugi');
  s.players[ME].hand = [card(ME, 'barrel-dragon'), card(ME, 'slot-machine'), card(ME, 'battle-ox')];
  s.players[ME].monsters[0] = card(ME, 'garoozis');
  const fd = card(FOE, 'mystical-elf', 'def');
  fd.face = 'down';
  s.players[FOE].monsters[0] = fd;
  s.players[FOE].monsters[1] = card(FOE, 'summoned-skull');
  const set = card(FOE, 'mirror-force');
  set.face = 'down';
  set.summonedOnTurn = 0;
  s.players[FOE].spellTrap = set;
  s.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'dark-magician')];
  return s;
}

const plans = (s: DuelState) => sig(planTurn(cloneState(s), ME, AI_LEVELS.champion, 1500));

console.log('AI honesty — hidden information must not move the plan\n');

/* --- 1. The RNG seed: gambles may not be foreseen ------------------- */
{
  const a = richPosition(41);
  const b = cloneState(a);
  b.seed = (b.seed ^ 0xdeadbeef) >>> 0; // a different future for every coin
  const c = cloneState(a);
  c.seed = 12345;
  const pa = plans(a);
  ok(pa === plans(b) && pa === plans(c),
    'the plan is identical whatever the hidden RNG seed holds',
    'the search is reading the seed — it can foresee every coin, die and shuffle');
}

/* --- 2. Hidden deck arrangement: the draw may not be foreseen ------- */
{
  /* Several positions and several permutations, because a single pair can
     agree by coincidence: the sampled worlds differ but land on the same best
     plan, and the leak hides. Ten comparisons make a coincidence a streak. */
  let same = true;
  for (const seed of [99, 137, 412, 777, 1024]) {
    const a = richPosition(seed);
    const pa = plans(a);
    const b = cloneState(a);
    b.players[FOE].deck.reverse();
    b.players[ME].deck.push(b.players[ME].deck.shift()!);
    const c = cloneState(a);
    for (let i = 0; i < 7; i++) c.players[FOE].deck.push(c.players[FOE].deck.shift()!);
    c.players[ME].deck.reverse();
    if (pa !== plans(b) || pa !== plans(c)) same = false;
  }
  ok(same,
    'the plan is identical whatever order the hidden decks are in',
    'the search is reading deck order — it knows the next draw');
}

/* --- 3. A face-down monster: the card may not be read --------------- */
{
  const a = richPosition(137);
  const b = cloneState(a);
  // Swap the face-down monster's identity with a deck card. Visible state is
  // untouched; the pool of unseen cards is the same multiset.
  const fd = b.players[FOE].monsters[0]!;
  const deckIdx = b.players[FOE].deck.findIndex((c) => c.slug !== fd.slug);
  const swap = b.players[FOE].deck[deckIdx];
  const was = fd.slug;
  fd.slug = swap.slug;
  swap.slug = was;
  ok(plans(a) === plans(b),
    'the plan is identical whichever unseen card is under the face-down',
    'the search is reading face-down monsters');
}

/* --- 4. The opponent's hand: it may not be read ---------------------- */
{
  const a = richPosition(256);
  const b = cloneState(a);
  const hand = b.players[FOE].hand[0];
  const deckIdx = b.players[FOE].deck.findIndex((c) => c.slug !== hand.slug);
  const swap = b.players[FOE].deck[deckIdx];
  const was = hand.slug;
  hand.slug = swap.slug;
  swap.slug = was;
  ok(plans(a) === plans(b),
    'the plan is identical whichever unseen cards are in their hand',
    'the search is reading the hand');
}

/* --- 5. Their Set backrow: it may not be read ------------------------ */
{
  const a = richPosition(511);
  const b = cloneState(a);
  b.players[FOE].spellTrap!.slug = 'trap-hole'; // a different card under the same back
  ok(plans(a) === plans(b),
    'the plan is identical whichever card their Set backrow really is',
    'the search is reading the Set card');
}

/* --- CONTROL: visible changes must be able to move the plan ---------- */
{
  /* Without this, an AI that ignored the board entirely — or a `plans` helper
     that always returned the same string — would pass everything above. */
  const a = richPosition(900);
  const b = cloneState(a);
  // Their board swept and 500 Life Points left: the plan must become lethal
  // attacks, which the cautious plan against the full board cannot have been.
  b.players[FOE].monsters = [null, null, null];
  b.players[FOE].spellTrap = null;
  b.players[FOE].lp = 500;
  const moved = plans(a) !== plans(b);
  ok(moved, 'CONTROL: a visible change to the board does move the plan',
    'both positions produced the same plan — the invariance cases above prove nothing');
}

/* --- Trap answers under the same discipline --------------------------- */
{
  /* The window responder decides with the same world machinery, so the same
     invariance must hold: how it answers an attack may not depend on the seed
     or on what is hidden in its opponent's deck. */
  const s = fresh(4242, 'kaiba', 'yugi');
  s.active = FOE;
  s.phase = 'battle';
  const mine = card(ME, 'mirror-force');
  mine.face = 'down';
  mine.summonedOnTurn = 0;
  s.players[ME].spellTrap = mine;
  s.players[ME].monsters[0] = card(ME, 'battle-ox');
  const beater = card(FOE, 'summoned-skull');
  beater.summonedOnTurn = 0;
  s.players[FOE].monsters = [beater, card(FOE, 'garoozis'), null];
  s.players[FOE].hand = [card(FOE, 'dark-magician')];
  s.pending = {
    kind: 'trap',
    player: ME,
    options: [mine.uid],
    reason: 'Foe attacks!',
    context: { attackerUid: beater.uid },
  };
  const answer = (st: DuelState) => JSON.stringify(chooseTrapResponse(cloneState(st), ME, 'champion', 500));
  const b = cloneState(s);
  b.seed = 777;
  b.players[FOE].deck.reverse();
  ok(answer(s) === answer(b),
    'a trap answer is identical whatever the seed and hidden deck order',
    'the responder is reading hidden information');
}

console.log(
  failures
    ? `\n❌ ${failures} honesty invariant(s) broken.`
    : '\n✅ the AI plans from what it can see, and nothing else.'
);
process.exitCode = failures ? 1 : 0;
