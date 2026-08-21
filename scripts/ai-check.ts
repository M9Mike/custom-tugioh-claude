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
import { applyAction, cloneState, createDuel } from '../src/game/engine';
import { AI_LEVELS, chooseTrapResponse, evaluate, planTurn } from '../src/game/ai';
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

/* Shared between a case's `build` and its `want`, for pins about a specific card. */
let elfUid = '';
let twUid = '';
let swordsUid = '';
let doomUid = '';
let redEyesUid = '';
let mofUid = '';

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
    /* Shadow Spell became a one-shot in the balance pass, so a face-up copy
       is a SPENT one — `activatableTraps` only offers a face-up trap that is
       `reusable`. The meaningful pin flipped direction with it: an empty
       threat must not scare the AI off a clean kill. */
    name: 'attacks past a spent face-up Shadow Spell',
    because: 'a face-up one-shot trap cannot fire again; refusing the kill would be fearing a ghost',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'megazowler');
      s.players[FOE].monsters[0] = card(FOE, 'hitotsu-me-giant');
      s.players[FOE].spellTrap = card(FOE, 'shadow-spell');
    },
    want: (plan) => did(plan, 'attack'),
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
    /* A God costs the whole board — three bodies for one — and the search has
       to be able to see that it is worth it. The user's requirement was exactly
       this: "ai should play gods properly". */
    name: 'spends three bodies on the God when its hand makes it worth it',
    duelist: 'yami',
    because: 'three Kuriboh are 900 ATK between them; Slifer with five cards in hand is 5000 and cannot be targeted',
    build: (s) => {
      for (let i = 0; i < 3; i++) s.players[ME].monsters[i] = card(ME, 'kuriboh');
      s.players[ME].hand = [
        card(ME, 'slifer-the-sky-dragon'),
        card(ME, 'kuriboh'),
        card(ME, 'big-shield-gardna'),
        card(ME, 'mirror-force'),
        card(ME, 'magical-hats'),
      ];
      s.players[FOE].monsters[0] = card(FOE, 'summoned-skull');
    },
    want: (_plan, end) => end.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
  },
  {
    /* And the other half of "properly": it must not throw the board away for a
       God that would arrive with nothing behind it. An empty hand is a 0 ATK
       God, which is strictly worse than the three bodies it ate. */
    name: 'CONTROL: will not trade three bodies for a God with an empty hand',
    duelist: 'yami',
    because: 'Slifer is 1000 per card in hand — summoned off the last card in hand it is a 0 ATK body that cost three monsters',
    build: (s) => {
      for (let i = 0; i < 3; i++) s.players[ME].monsters[i] = card(ME, 'beta-the-magnet-warrior');
      s.players[ME].hand = [card(ME, 'slifer-the-sky-dragon')];
      s.players[FOE].monsters[0] = card(FOE, 'summoned-skull');
    },
    want: (_plan, end) => !end.players[ME].monsters.some((m) => m?.slug === 'slifer-the-sky-dragon'),
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
    because: 'Two-Headed King Rex prints 1600 and is 2500 with three Dinosaurs in the Graveyard',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'two-headed-king-rex');
      for (const slug of ['uraby', 'trakodon', 'megazowler']) s.players[ME].grave.push(card(ME, slug));
      s.players[FOE].monsters[0] = card(FOE, 'garoozis');
    },
    want: (plan) => did(plan, 'attack'),
  },
  {
    /* The assignment problem every pro solves without noticing: the big body
       breaks the wall, the small one goes to the face. Backwards, Battle Ox
       bounces off the 2000-DEF Elf and the lethal is gone. */
    name: 'sends the big attacker into the wall and the small one to the face',
    because: 'Dark Magician must break the 2000-DEF Elf so Battle Ox can land exactly 1700 on their 1700',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'dark-magician');
      s.players[ME].monsters[1] = card(ME, 'battle-ox');
      s.players[FOE].monsters[0] = card(FOE, 'mystical-elf', 'def');
      s.players[FOE].lp = 1700;
    },
    want: (_plan, end) => end.winner === ME,
  },
  {
    /* Standing in front of lethal, the only move that lives is a wall. A
       Sonic Maid summoned to attack hands them the duel; the Elf in Defence
       takes the piercing 500 and holds. */
    name: 'walls up in front of lethal instead of feeding it',
    because: 'at 1200 Life Points under a piercing 2500, only the 2000-DEF Elf in Defence (or face-down) survives the turn',
    build: (s) => {
      s.players[ME].lp = 1200;
      elfUid = '';
      const elf = card(ME, 'mystical-elf');
      elfUid = elf.uid;
      s.players[ME].hand = [elf, card(ME, 'sonic-maid')];
      s.players[FOE].monsters[0] = card(FOE, 'summoned-skull');
    },
    want: (plan) =>
      plan.some(
        (a) => a.type === 'normalSummon' && a.uid === elfUid && (a.face === 'down' || a.position === 'def')
      ),
  },
  {
    /* Two bodies already add up past their Life Points; a Blue-Eyes needs both
       of them as Tribute and arrives short of the kill. Greed loses the win. */
    name: 'takes lethal with the board rather than tributing it away for a dragon',
    because: 'Summoned Skull and Garoozis together land 4300 on 4000; a tributed Blue-Eyes lands 3000 and the duel goes on',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'summoned-skull');
      s.players[ME].monsters[1] = card(ME, 'garoozis');
      s.players[ME].hand = [card(ME, 'blue-eyes-white-dragon')];
      s.players[FOE].lp = 4000;
    },
    want: (_plan, end) => end.winner === ME,
  },
  {
    name: 'CONTROL: pays two useless bodies for the dragon that breaks the wall',
    because: 'two aura-drained Kuriboh cannot touch a 2000-DEF Aqua Madoor; Blue-Eyes clears it on arrival and swings 2600',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'kuriboh');
      s.players[ME].monsters[1] = card(ME, 'kuriboh');
      s.players[ME].hand = [card(ME, 'blue-eyes-white-dragon')];
      s.players[FOE].monsters[0] = card(FOE, 'aqua-madoor', 'def');
    },
    want: (plan) => plan.some((a) => a.type === 'normalSummon' && (a.tributes?.length ?? 0) === 2),
  },
  {
    /* Gamble arithmetic: with the duel already won on the board, the coin can
       only give back what is taken. Tails destroys the whole board, and with
       it the win. */
    name: 'takes the certain win instead of spinning Time Wizard first',
    because: 'Red-Eyes wins the duel outright; Time Wizard on tails destroys it and the win with it',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'red-eyes-black-dragon');
      const tw = card(ME, 'time-wizard');
      twUid = tw.uid;
      s.players[ME].monsters[1] = tw;
      s.players[FOE].monsters[0] = card(FOE, 'battle-ox');
      s.players[FOE].lp = 700;
    },
    want: (plan, end) => end.winner === ME && !plan.some((a) => a.type === 'ignition' && a.uid === twUid),
  },
  {
    /* Straight out of the disagreement probe, refereed 4/4 against 0/4: at
       2900 Life Points against three bodies and a seven-card hand, the lock
       is the whole turn. The evaluation used to be blind to freezeMonsters —
       the engine refused the frozen attacks, but the threat model kept
       counting them, so Swords read as a card spent on nothing and the beam
       pruned it before the lookahead could ever say otherwise. */
    name: 'casts Swords of Revealing Light with the duel on the line',
    duelist: 'yami',
    because: 'three turns of their board standing still is worth more than any card in hand — the eval must see a frozen board as toothless',
    build: (s) => {
      s.players[ME].lp = 2900;
      s.players[ME].monsters[0] = card(ME, 'buster-blader');
      const swords = card(ME, 'swords-of-revealing-light');
      swordsUid = swords.uid;
      s.players[ME].hand = [card(ME, 'catapult-turtle'), swords, card(ME, 'dark-magician')];
      s.players[FOE].lp = 1300;
      s.players[FOE].monsters[0] = card(FOE, 'guardian-sphinx', 'def');
      s.players[FOE].monsters[1] = card(FOE, 'wall-of-illusion');
      s.players[FOE].monsters[2] = card(FOE, 'beta-the-magnet-warrior');
      s.players[FOE].hand = [
        'wall-of-illusion', 'mask-of-darkness', 'ra-s-disciple', 'mystical-beast-of-serket',
        'pot-of-greed', 'judgment-of-anubis', 'embodiment-of-apophis',
      ].map((slug) => card(FOE, slug));
      const set = card(FOE, 'fake-trap');
      set.face = 'down';
      s.players[FOE].spellTrap = set;
    },
    want: (plan) => plan.some((a) => a.type === 'activateSpell' && a.uid === swordsUid),
  },
  {
    /* The owner's exploit, reported as "I win 100% of the games": set a wipe
       behind a weak monster, and the computer commits every attacker it has.
       The fix is the paranoid branch with commitment scaling — the first
       attack is never feared (the doctrine controls above insist), but the
       whole board is never bet on one face-down card either. */
    name: 'attacks in waves through an unread Set card, never all-in',
    duelist: 'kaiba',
    because: 'one card back can be a board wipe; a professional probes with one or two attackers and keeps the rest',
    build: (s) => {
      s.players[ME].lp = 6000;
      s.players[FOE].lp = 6000;
      s.players[ME].monsters[0] = card(ME, 'summoned-skull');
      s.players[ME].monsters[1] = card(ME, 'garoozis');
      s.players[ME].monsters[2] = card(ME, 'battle-ox');
      s.players[FOE].monsters[0] = card(FOE, 'kuriboh');
      const set = card(FOE, 'mirror-force');
      set.face = 'down';
      s.players[FOE].spellTrap = set;
      s.players[FOE].hand = [card(FOE, 'dark-magician'), card(FOE, 'curse-of-dragon'), card(FOE, 'mystical-elf')];
    },
    want: (plan) => {
      const attackers = new Set(plan.filter((a) => a.type === 'attack').map((a) => (a as { uid: string }).uid));
      return attackers.size >= 1 && attackers.size <= 2;
    },
  },
  {
    /* "It has no idea to go for their boss monsters" — the owner, correctly.
       By printed numbers the plain 2500 outranks the 2400 Red-Eyes, and the
       removal always took the bigger number while the dragon burned 800 a
       turn and grew with every kill. Menace, derived from the card's own
       ops, is what flips this: the monster that threatens the most goes
       down first. */
    name: 'spends its removal on the boss, not the biggest number',
    duelist: 'yami',
    because: 'the 2600 Zoa dies into a 3000 Metalzoa if destroyed by effect; the Red-Eyes burns and grows every turn it lives — the removal belongs on the boss',
    build: (s) => {
      const doom = card(ME, 'tribute-to-the-doomed');
      doomUid = doom.uid;
      s.players[ME].hand = [doom, card(ME, 'kuriboh'), card(ME, 'big-shield-gardna')];
      s.players[ME].monsters[0] = card(ME, 'battle-ox'); // beats neither by battle
      redEyesUid = '';
      const boss = card(FOE, 'red-eyes-black-dragon');
      redEyesUid = boss.uid;
      s.players[FOE].monsters[0] = boss;
      s.players[FOE].monsters[1] = card(FOE, 'zoa');
      // The trap inside the pin: Zoa's replacement is really in their deck,
      // so the search can SEE that dooming it hands them a 3000 Metalzoa.
      s.players[FOE].deck.push(card(FOE, 'metalzoa'));
      s.players[FOE].lp = 8000;
      s.players[ME].lp = 8000;
    },
    want: (plan) =>
      plan.some((a) => a.type === 'activateSpell' && a.uid === doomUid && (a.targets ?? []).includes(redEyesUid)),
  },
  {
    /* "How can it be a strategical benefit to summon Magician of Faith,
       ever" — the owner. It cannot: her card IS the flip, and face-up she is
       a 300 ATK body that hands the opponent free damage. Set, she is a
       spell recovered, a card drawn, and a surprise. */
    name: 'sets Magician of Faith instead of summoning her face-up',
    duelist: 'yami',
    because: 'her effect only exists on the way from face-down to face-up; summoning her face-up throws the card away',
    build: (s) => {
      mofUid = '';
      const mof = card(ME, 'magician-of-faith');
      mofUid = mof.uid;
      s.players[ME].hand = [mof, card(ME, 'mirror-force')];
      s.players[ME].grave.push(card(ME, 'pot-of-greed'));
      s.players[ME].monsters[0] = card(ME, 'summoned-skull');
      s.players[FOE].monsters[0] = card(FOE, 'curse-of-dragon');
    },
    want: (plan) => {
      for (const a of plan) {
        if (a.type === 'normalSummon' && a.uid === mofUid) return a.face === 'down';
      }
      return true;
    },
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

/* --- Trap windows: the fire/hold discipline --------------------------- */
/* The window responder is its own decision path, so the suite pins it too:
   a one-shot answer is held through a probe and spent on the real threat. */
const windowCase = (name: string, because: string, attackerSlug: string, wantFire: boolean, myLp = 4000) => {
  const bad: string[] = [];
  for (const seed of SEEDS) {
    const s = fresh(seed, 'kaiba');
    s.active = FOE;
    s.phase = 'battle';
    s.players[ME].lp = myLp;
    s.players[ME].monsters[0] = card(ME, 'battle-ox');
    const trap = card(ME, 'spellbinding-circle');
    trap.face = 'down';
    s.players[ME].spellTrap = trap;
    const attacker = card(FOE, attackerSlug);
    s.players[FOE].monsters[0] = attacker;
    if (attackerSlug === 'kuriboh') s.players[FOE].monsters[1] = card(FOE, 'dark-magician');
    s.pending = {
      kind: 'trap',
      player: ME,
      options: [trap.uid],
      reason: 'Foe attacks!',
      context: { attackerUid: attacker.uid },
    } as DuelState['pending'];
    const answer = chooseTrapResponse(cloneState(s), ME, 'champion', 2000) as { type: string; uid?: string | null };
    const fired = answer.type === 'respondTrap' && !!answer.uid;
    if (fired !== wantFire) bad.push(`seed ${seed}: ${fired ? 'fired' : 'held'}`);
  }
  const pass = bad.length === 0;
  if (!pass) failures += 1;
  console.log(`  ${pass ? '✅' : '❌'} ${name}  ${SEEDS.length - bad.length}/${SEEDS.length}`);
  if (!pass) {
    console.log(`       expected: ${because}`);
    for (const line of bad.slice(0, 4)) console.log(`       ${line}`);
  }
};
windowCase(
  'holds Spellbinding Circle against a 300 ATK probe',
  'the Circle spent on a Kuriboh is gone when the Dark Magician behind it swings',
  'kuriboh',
  false
);
windowCase(
  'CONTROL: fires the Circle when the attack on the board is lethal',
  'at 800 Life Points, the Magician killing Battle Ox is the duel — the negate is survival, not value',
  'dark-magician',
  true,
  800
);

/* --- The evaluation must see what the engine enforces ------------------ */
/* `canAttackWith` refuses every frozen attack, so a threat model that keeps
   counting them prices Swords of Revealing Light as a card spent on nothing.
   This is the mechanism behind the Swords position above, pinned at the level
   where it cannot be rescued by a lucky rollout: freezing their board must
   move the score by more than a rounding nudge. */
{
  const s = fresh(3, 'kaiba');
  s.players[ME].lp = 2000;
  s.players[FOE].monsters[0] = card(FOE, 'summoned-skull');
  s.players[FOE].monsters[1] = card(FOE, 'garoozis');
  const before = evaluate(s, ME);
  s.ongoing.push({ id: 'oT', source: 'swords-of-revealing-light', kind: 'freezeMonsters', target: FOE, turns: 3 } as DuelState['ongoing'][number]);
  const after = evaluate(s, ME);
  const pass = after - before > 2000;
  if (!pass) failures += 1;
  console.log(`  ${pass ? '✅' : '❌'} the evaluation reads a frozen board as toothless  (${Math.round(before)} → ${Math.round(after)})`);
  if (!pass) console.log('       expected: with their attacks refused by the engine, the threat and the race must both swing hard');
}

const TOTAL = CASES.length + 3;
console.log(
  failures
    ? `\n❌ ${failures} of ${TOTAL} positions played wrong.`
    : `\n✅ all ${TOTAL} positions played correctly, on every deck order.`
);
process.exitCode = failures ? 1 : 0;
