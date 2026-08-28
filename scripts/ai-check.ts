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
import { AI_LEVELS, chooseTrapResponse, commitsOf, evaluate, paranoiaPrior, planTurn, setPureClock } from '../src/game/ai';

/* Same node budget every run, whatever else the machine is doing — see
   `setPureClock`. Two pinned positions used to flip with load. */
setPureClock(true);
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
  /* Most positions are judged at the serving budget. A few are about the
     SHAPE of the budget curve — a plan that is right at 300ms and right at
     8000ms and wrong in between is a search pathology, and the only way to pin
     it is to ask at the budget where it bit. */
  budgetMs?: number;
  /* A probabilistic decision is pinned at a FREQUENCY, not a certainty.
     Probing a face-down with a small attacker is priced across sampled
     worlds, so the answer legitimately varies with the deck order — the pin
     asserts the appetite (at least this many of the ten), where every
     deterministic case keeps demanding all ten. Omitted = all ten. */
  minHits?: number;
}

const did = (plan: DuelAction[], type: string) => plan.some((a) => a.type === type);

/* Shared between a case's `build` and its `want`, for pins about a specific card. */
let elfUid = '';
let twUid = '';
let swordsUid = '';
let doomUid = '';
let redEyesUid = '';
let mofUid = '';
let goatUid = '';
let sdUid = '';
let kneelUid = '';
let raUid = '';
/* Which of Ra's two ignitions is the sun — read off the card rather than
   written as a number, because the day a third is added the number moves. */
const RA_SUN = CARDS['the-winged-dragon-of-ra'].effects.findIndex(
  (e) => e.trigger === 'ignition' && e.ops.some((o) => o.op === 'burnLifeForAtk')
);

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
    /* "How can the AI not account for defense position if the enemy has
       stronger monsters" — the owner. Two outgunned bodies standing in
       Attack Position are a Life-Point leak; kneeling costs nothing here
       (no piercers on their side) and saves a thousand points a turn. The
       fix underneath was the clock term: it claimed a two-turn win for an
       army that could never break a single blocker, and that fiction
       out-voted every defensive truth on the table. */
    name: 'kneels its outgunned board instead of standing in the line of fire',
    duelist: 'joey',
    because: 'against a 2500 and a 2000 with no piercing, two weaker monsters in Attack Position donate Life Points every turn for nothing',
    build: (s) => {
      s.players[ME].lp = 2000;
      s.players[ME].monsters[0] = card(ME, 'battle-ox');
      s.players[ME].monsters[1] = card(ME, 'garoozis');
      s.players[FOE].monsters[0] = card(FOE, 'curse-of-dragon');
      s.players[FOE].monsters[1] = card(FOE, 'dark-magician');
    },
    /* At least one body kneels and nothing attacks. The second switch is a
       ~250-point margin the sampling can defensibly read either way; the
       behaviour this pins is the one the owner named — being outgunned
       REGISTERS, and no Life Points are donated. */
    want: (plan) => plan.filter((a) => a.type === 'changePosition').length >= 1 && !did(plan, 'attack'),
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
  {
    name: 'does not spend Scapegoat with no room for a single Sheep',
    duelist: 'joey',
    because: 'three Sheep Tokens over three occupied zones is three Tokens that never arrive, and the card is gone',
    /* The position is not invented: a sweep of full-board Joey boards found
       the search throwing the card away in hundreds of them, and this is one
       of the ones it threw. Reported from a real duel first — "Joey ai
       activated scape gotes when he had full monster field already". */
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'flame-swordsman');
      s.players[ME].monsters[1] = card(ME, 'baby-dragon');
      s.players[ME].monsters[2] = card(ME, 'axe-raider', 'def');
      goatUid = (s.players[ME].hand = [card(ME, 'scapegoat'), card(ME, 'shield-sword')])[0].uid;
      s.players[ME].normalSummonUsed = true;
      s.players[FOE].monsters[0] = card(FOE, 'dark-magician');
    },
    /* Setting it is not the misplay — a Set Quick-Play is a wall held for
       their turn, and it is what the AI does here now. Only spending it into
       three occupied zones is forbidden, and the card must still be somewhere
       it can be spent later. */
    want: (plan, end) =>
      !plan.some((a) => a.type === 'activateSpell' && (a as { uid?: string }).uid === goatUid) &&
      (end.players[ME].hand.some((h) => h.uid === goatUid) || end.players[ME].spellTrap?.uid === goatUid),
  },
  {
    name: 'swings at a weaker monster with nothing lurking, at the budget the brackets run on',
    because: 'Axe Raider 1700 over Feral Imp 1300 with an empty backrow kills a body and cannot lose one',
    /* Reported: "the ai had a clear attack on a weaker monster with no trap
       card of the opponent and it did not attack." The board rated the swing
       1267 points above passing; a 550-node playout — the floor this search
       calls noise — was allowed to move a line by the full ±3600 and talked it
       out of the attack. It attacked at 300ms and at 8000ms and passed at 900,
       which is the tell. Pinned at 900 because that is what the bracket's side
       duels are given per action. */
    budgetMs: 900,
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'axe-raider');
      s.players[ME].normalSummonUsed = true;
      s.players[FOE].monsters[0] = card(FOE, 'feral-imp');
      s.players[FOE].hand = Array.from({ length: 4 }, () => card(FOE, 'kuriboh'));
    },
    want: (plan) => did(plan, 'attack'),
  },
  {
    name: 'points Stop Defense at the monster that is actually kneeling',
    duelist: 'keith',
    because: 'dragging a monster into Attack Position that is standing there already spends the card and changes nothing',
    /* Watched in a real duel: the search ranked the pool by ATK, so with a
       kneeling 800 beside a standing 1300 it aimed at the 1300. The card was
       legal — there WAS a defender — which is why the activation gate alone
       could not catch it. */
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'mechanicalchaser');
      s.players[ME].monsters[1] = card(ME, 'robotic-knight');
      s.players[ME].normalSummonUsed = true;
      sdUid = (s.players[ME].hand = [card(ME, 'stop-defense')])[0].uid;
      kneelUid = (s.players[FOE].monsters[0] = card(FOE, 'happy-lover', 'def')).uid;
      s.players[FOE].monsters[1] = card(FOE, 'harpie-lady'); // stronger, and already attacking
    },
    want: (plan) => {
      const cast = plan.find((a) => a.type === 'activateSpell' && (a as { uid?: string }).uid === sdUid) as
        | { targets?: string[] }
        | undefined;
      // Playing it at all is optional; aiming it at the standing monster is not.
      return !cast || cast.targets?.includes(kneelUid) === true;
    },
  },
  {
    name: 'pours everything into Ra when the swing that follows is lethal',
    duelist: 'yamimarik',
    because: 'a God at 10,000 ATK swinging into an empty board ends the duel this turn, and Life Points you keep after losing are worth nothing',
    build: (s) => {
      raUid = (s.players[ME].monsters[0] = card(ME, 'the-winged-dragon-of-ra')).uid;
      s.players[ME].monsters[0]!.atkMod = 2400; // as if paid for with three ordinary bodies
      s.players[ME].monsters[0]!.summonedOnTurn = 0;
      s.players[ME].normalSummonUsed = true;
      s.players[ME].hand = [];
      s.players[FOE].monsters = [null, null, null];
      s.players[FOE].hand = [];
      s.players[FOE].spellTrap = null;
      s.players[FOE].lp = 8000;
    },
    want: (plan, end) => end.winner === ME || did(plan, 'ignition'),
  },
  {
    name: 'CONTROL: does not burn itself to one Life Point with nothing to show for it',
    duelist: 'yamimarik',
    because: 'a 3000 DEF wall means the swing lands on nothing, so the only thing the effect buys is a duel the next attack ends',
    /* The card is enormously strong and enormously stupid to press at the wrong
       moment, which is exactly the shape the search has to get right on its
       own — there is no gate on it beyond having the Life Points. */
    build: (s) => {
      raUid = (s.players[ME].monsters[0] = card(ME, 'the-winged-dragon-of-ra')).uid;
      s.players[ME].monsters[0]!.atkMod = 2400;
      s.players[ME].monsters[0]!.summonedOnTurn = 0;
      s.players[ME].normalSummonUsed = true;
      s.players[ME].hand = [];
      // 2600 DEF, and no pierce on a God: the swing that follows lands on nothing.
      s.players[FOE].monsters[0] = card(FOE, 'big-shield-gardna', 'def');
      s.players[FOE].lp = 8000;
    },
    want: (plan, end) => {
      const burned = plan.some(
        (a) => a.type === 'ignition' && (a as { uid?: string }).uid === raUid && (a as { effectIndex?: number }).effectIndex === RA_SUN
      );
      // Either it left the Life Points alone, or it found a win anyway.
      return !burned || end.winner === ME || end.players[ME].lp > 1;
    },
  },
  {
    name: 'probes a lone face-down with an 1100 attacker at healthy Life Points',
    duelist: 'sarah',
    because: 'the swing kills most of what can be under there, a bounce costs about a hundred, and the probe buys the whole board back its information',
    /* The owner's report, as a pin: Lady of Faith beside one Set monster,
       nothing else on the table, 8000 Life Points behind her. The attack used
       to be DELETED before pricing — a hard filter on move generation — so
       the appetite was 0/10 by construction. It is a priced gamble now, so
       the pin is a frequency, not a certainty. */
    minHits: 6,
    build: (s) => {
      s.players[ME].lp = 8000;
      s.players[ME].monsters[0] = card(ME, 'lady-of-faith');
      s.players[ME].normalSummonUsed = true;
      const hidden = card(FOE, 'mystical-elf', 'def');
      hidden.face = 'down';
      s.players[FOE].monsters[0] = hidden;
      s.players[FOE].lp = 8000;
    },
    want: (plan) => did(plan, 'attack'),
  },
  {
    name: 'GUARD: will not trade its last blocker into the unknown under a standing 2400',
    duelist: 'sarah',
    because: 'a flip effect that eats the attacker leaves the board empty with their 2400 already standing — the probe is not worth the wall',
    build: (s) => {
      s.players[ME].lp = 8000;
      s.players[ME].monsters[0] = card(ME, 'lady-of-faith');
      s.players[ME].normalSummonUsed = true;
      const hidden = card(FOE, 'mystical-elf', 'def');
      hidden.face = 'down';
      s.players[FOE].monsters[0] = hidden;
      s.players[FOE].monsters[1] = card(FOE, 'rude-kaiser');
      s.players[FOE].lp = 8000;
    },
    want: (plan) => {
      const swing = plan.find((a) => a.type === 'attack');
      // Attacking the face-down risks the blocker; attacking nothing is the play.
      return !swing;
    },
  },
  {
    name: 'Tiger Axe follows through on the attack its own effect created',
    duelist: 'joey',
    because: 'a card spent to force their board into Defence and then not attacking it is a card spent on nothing — Set card or no Set card',
    build: (s) => {
      s.players[ME].hand = [card(ME, 'tiger-axe')];
      s.players[FOE].monsters[0] = card(FOE, '7-colored-fish'); // 1800/800: unbeatable standing, dead the moment it kneels
      s.players[FOE].spellTrap = (() => {
        const t = card(FOE, 'mirror-force');
        t.face = 'down';
        return t;
      })();
      s.players[FOE].hand = [card(FOE, 'kuriboh')];
      s.players[FOE].lp = 8000;
    },
    want: (plan) => did(plan, 'normalSummon') && did(plan, 'attack'),
  },
  {
    name: 'fears nothing when no answer can exist behind their Set card',
    duelist: 'keith',
    because: 'every trap the deck runs is visible in the Graveyard, so the Set card is a bluff by arithmetic and the whole board commits',
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'battle-ox');
      s.players[ME].monsters[1] = card(ME, 'rude-kaiser');
      s.players[ME].monsters[2] = card(ME, 'judge-man');
      s.players[ME].normalSummonUsed = true;
      const bluff = card(FOE, 'de-spell');
      bluff.face = 'down';
      s.players[FOE].spellTrap = bluff;
      s.players[FOE].grave = [card(FOE, 'mirror-force'), card(FOE, 'mirror-force')];
      /* Not Kuriboh: its hand-negate is itself a trap-window effect, so a
         Kuriboh in hand IS an unaccounted answer and the fear is honest. */
      s.players[FOE].hand = [card(FOE, 'pot-of-greed')];
      s.players[FOE].deck = s.players[FOE].deck.filter((c) => !(CARDS[c.slug]?.effects ?? []).some((e) => e.trigger === 'trap'));
      s.players[FOE].lp = 8000;
    },
    want: (plan) => plan.filter((a) => a.type === 'attack').length >= 3,
  },
  {
    name: 'Sets the flip engine instead of throwing it away face-up',
    duelist: 'bakura',
    because: "a FLIP effect only exists on the way out of face-down — Morphing Jar summoned face-up is the whole card thrown away, the owner's report verbatim",
    /* The reported turn: Morphing Jar alone in hand, an empty own board,
       their three Sheep Tokens, not a Set card anywhere. The wrong turn was
       "summon it face-up, attack nothing". Both halves pinned: the Jar is
       NEVER summoned face-up here, and it usually gets Set — tolerant,
       because with the whole deck behind it the search sometimes finds a
       different legitimate first play. */
    minHits: 8,
    build: (s) => {
      s.players[ME].lp = 8500;
      s.players[ME].monsters = [null, null, null];
      const jar = card(ME, 'morphing-jar');
      s.players[ME].hand = [jar];
      for (const t of [0, 1, 2]) {
        const sheep = card(FOE, 'scapegoat', 'def');
        (sheep as CardInstance & { isToken: boolean }).isToken = true;
        (sheep as CardInstance & { tokenName?: string }).tokenName = 'Sheep Token';
        (sheep as CardInstance & { tokenAtk?: number }).tokenAtk = 0;
        (sheep as CardInstance & { tokenDef?: number }).tokenDef = 500;
        s.players[FOE].monsters[t] = sheep;
      }
      s.players[FOE].lp = 8200;
      s.players[FOE].spellTrap = null;
    },
    want: (plan) =>
      plan.every((a) => !(a.type === 'normalSummon' && a.face === 'up')) &&
      plan.some((a) => a.type === 'normalSummon' && a.face === 'down'),
  },
  {
    name: 'spends the spare attack on the free kill',
    duelist: 'bakura',
    because: 'a 700 body over three 0-ATK tokens with no Set card anywhere risks exactly nothing — an attack left unused is a card spent on nothing',
    /* The same reported board one decision later: the Jar already stands
       face-up. Killing a Sheep is worth little and costs less; declining it
       was the judge letting one noisy playout outvote a strict, fully
       visible gain. The dominance lift closes that door. */
    minHits: 8,
    build: (s) => {
      s.players[ME].lp = 8500;
      const jar = card(ME, 'morphing-jar');
      jar.summonedOnTurn = s.turn;
      s.players[ME].monsters[0] = jar;
      s.players[ME].normalSummonUsed = true;
      s.players[ME].hand = [];
      for (const t of [0, 1, 2]) {
        const sheep = card(FOE, 'scapegoat', 'def');
        (sheep as CardInstance & { isToken: boolean }).isToken = true;
        (sheep as CardInstance & { tokenName?: string }).tokenName = 'Sheep Token';
        (sheep as CardInstance & { tokenAtk?: number }).tokenAtk = 0;
        (sheep as CardInstance & { tokenDef?: number }).tokenDef = 500;
        s.players[FOE].monsters[t] = sheep;
      }
      s.players[FOE].lp = 8200;
      s.players[FOE].spellTrap = null;
    },
    want: (plan) => did(plan, 'attack'),
  },
  {
    name: 'Lady of Faith takes the Leghul she beats dry',
    duelist: 'sarah',
    because: 'an 1100 over a face-up 300 with no Set card is eight hundred Life Points for free — kneeling to "save" a hypothetical four hundred was the tiebreak reading only its own side of the table',
    minHits: 8,
    build: (s) => {
      s.players[ME].lp = 7000;
      s.players[ME].monsters[0] = card(ME, 'lady-of-faith');
      s.players[ME].normalSummonUsed = true;
      s.players[ME].hand = [];
      s.players[FOE].monsters[0] = card(FOE, 'sonic-maid');
      s.players[FOE].monsters[1] = card(FOE, 'ground-attacker-bugroth');
      s.players[FOE].monsters[2] = card(FOE, 'leghul');
      s.players[FOE].spellTrap = null;
      s.players[FOE].lp = 8000;
    },
    want: (plan, end) => plan.some((a) => a.type === 'attack') && end.players[FOE].lp <= 7200,
  },
  {
    name: 'GUARD: still does not feed the whole board to a live Set card',
    duelist: 'keith',
    because: 'with real answers unaccounted for, at least one body stays out of the all-in — the tax on stacking everything behind one card',
    minHits: 8,
    build: (s) => {
      s.players[ME].monsters[0] = card(ME, 'battle-ox');
      s.players[ME].monsters[1] = card(ME, 'rude-kaiser');
      s.players[ME].monsters[2] = card(ME, 'judge-man');
      s.players[ME].normalSummonUsed = true;
      const live = card(FOE, 'mirror-force');
      live.face = 'down';
      s.players[FOE].spellTrap = live;
      s.players[FOE].hand = [card(FOE, 'kuriboh')];
      s.players[FOE].lp = 8000; // nowhere near lethal, so the all-in buys nothing
    },
    want: (plan) => {
      const swingers = new Set(plan.filter((a) => a.type === 'attack').map((a) => (a as { uid: string }).uid));
      return swingers.size < 3;
    },
  },
];

console.log(`AI play checks — every position over ${SEEDS.length} deck orders\n`);

for (const c of CASES) {
  const bad: string[] = [];
  for (const seed of SEEDS) {
    const start = fresh(seed, c.duelist ?? 'kaiba');
    c.build(start);
    const plan = planTurn(start, ME, AI_LEVELS.champion, c.budgetMs ?? 2500);
    let end = start;
    const shown: string[] = [];
    for (const a of plan) {
      const res = applyAction(end, ME, a);
      if (res.error) {
        shown.push(`${a.type}✗`);
        break;
      }
      end = res.state;
      /* Summons carry their face and posture in the trace: "normalSummon"
         alone cannot tell a Set from the face-up summon a pin forbids, and a
         stream-sensitive miss was undiagnosable without rebuilding the whole
         battery context by hand. */
      shown.push(a.type === 'normalSummon' ? `${a.type}:${a.face}/${a.position}` : a.type);
    }
    if (!c.want(plan, end)) bad.push(`seed ${seed}: ${shown.join(' → ') || '(nothing)'}`);
  }
  const need = c.minHits ?? SEEDS.length;
  const hits = SEEDS.length - bad.length;
  const pass = hits >= need;
  if (!pass) failures += 1;
  const bar = c.minHits ? ` (≥${need})` : '';
  console.log(`  ${pass ? '✅' : '❌'} ${c.name}  ${hits}/${SEEDS.length}${bar}`);
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

/* The fear machinery, pinned at the unit — these mechanisms only BITE in
   narrow all-in-versus-wipe margins, so a scenario that discriminates them
   resists construction, and an unpinned rule is the kind that quietly
   un-fixes itself. Direct questions, deterministic answers. */
{
  const s = fresh(3, 'kaiba');
  const setCard = card(FOE, 'de-spell');
  setCard.face = 'down';
  s.players[FOE].spellTrap = setCard;
  s.players[FOE].grave = [card(FOE, 'mirror-force'), card(FOE, 'mirror-force')];
  // Not Kuriboh — its hand-negate is a trap-window effect, an answer.
  s.players[FOE].hand = [card(FOE, 'pot-of-greed')];
  s.players[FOE].deck = s.players[FOE].deck.filter((c) => !(CARDS[c.slug]?.effects ?? []).some((e) => e.trigger === 'trap'));
  const zero = paranoiaPrior(s, ME);
  const pass1 = zero === 0;
  if (!pass1) failures += 1;
  console.log(`  ${pass1 ? '✅' : '❌'} fear is zero when zero answers remain unaccounted for  (${zero.toFixed(2)})`);

  /* The last trap the deck runs IS the Set card: hand and deck hold none,
     and the pool must still fear it — the card itself is unseen. */
  const t = fresh(3, 'kaiba');
  const lastTrap = card(FOE, 'mirror-force');
  lastTrap.face = 'down';
  t.players[FOE].spellTrap = lastTrap;
  t.players[FOE].hand = [card(FOE, 'pot-of-greed')];
  t.players[FOE].deck = t.players[FOE].deck.filter((c) => !(CARDS[c.slug]?.effects ?? []).some((e) => e.trigger === 'trap'));
  const live = paranoiaPrior(t, ME);
  const pass2 = live > 0;
  if (!pass2) failures += 1;
  console.log(`  ${pass2 ? '✅' : '❌'} and alive while the Set card itself could be the last answer  (${live.toFixed(2)})`);

  /* One body, however many things it did on the way in. */
  const one = commitsOf([
    { type: 'normalSummon', uid: 'x1', zone: 0, position: 'atk', face: 'up' },
    { type: 'attack', uid: 'x1', targetUid: 'y1' },
  ] as DuelAction[]);
  const two = commitsOf([
    { type: 'normalSummon', uid: 'x1', zone: 0, position: 'atk', face: 'up' },
    { type: 'attack', uid: 'x2', targetUid: 'y1' },
  ] as DuelAction[]);
  const pass3 = one === 1 && two === 2;
  if (!pass3) failures += 1;
  console.log(`  ${pass3 ? '✅' : '❌'} commitment counts bodies risked, not actions taken  (summon+swing=${one}, summon+other=${two})`);
}

/* Plans that outlive the turn, pinned the same direct way. */
{
  /* The Tribute ladder: a body on the board is worth MORE while a boss waits
     in hand — the price of Summoning it, half-paid. Measured as the delta of
     adding one body, with and without the boss watching. */
  const bare = fresh(3, 'kaiba');
  bare.players[ME].hand = [card(ME, 'kuriboh')]; // no boss
  const bareEmpty = evaluate(bare, ME);
  bare.players[ME].monsters[0] = card(ME, 'battle-ox');
  const bareBody = evaluate(bare, ME);

  const laddered = fresh(3, 'kaiba');
  laddered.players[ME].hand = [card(ME, 'blue-eyes-white-dragon')]; // Level 8 — two Tributes
  const bossEmpty = evaluate(laddered, ME);
  laddered.players[ME].monsters[0] = card(ME, 'battle-ox');
  const bossBody = evaluate(laddered, ME);

  const plainDelta = bareBody - bareEmpty;
  const ladderDelta = bossBody - bossEmpty;
  const pass4 = ladderDelta >= plainDelta + 100;
  if (!pass4) failures += 1;
  console.log(`  ${pass4 ? '✅' : '❌'} a body is worth more while a boss waits in hand  (+${Math.round(plainDelta)} plain, +${Math.round(ladderDelta)} laddered)`);

  /* The enables-graph: a searcher whose target is still in the Deck promises
     more than a vanilla of the same size — and promises NOTHING once every
     target is spent. Witch of the Black Forest fetches Sangan. */
  const promise = fresh(3, 'yami');
  promise.players[ME].hand = [card(ME, 'witch-of-the-black-forest')];
  promise.players[ME].deck = [card(ME, 'sangan'), card(ME, 'kuriboh')];
  const withTarget = evaluate(promise, ME);
  promise.players[ME].deck = [card(ME, 'kuriboh')];
  const spent = evaluate(promise, ME);
  const pass5 = withTarget > spent + 30;
  if (!pass5) failures += 1;
  console.log(`  ${pass5 ? '✅' : '❌'} a searcher promises its target only while the Deck still holds one  (${Math.round(withTarget)} vs ${Math.round(spent)})`);
}

const TOTAL = CASES.length + 8;
console.log(
  failures
    ? `\n❌ ${failures} of ${TOTAL} positions played wrong.`
    : `\n✅ all ${TOTAL} positions played correctly, on every deck order.`
);
process.exitCode = failures ? 1 : 0;
