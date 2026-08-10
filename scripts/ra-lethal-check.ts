/**
 * Ra has lethal on the board and the computer passes the turn.
 *
 *   npx tsx scripts/ra-lethal-check.ts
 *
 * Reported from a real duel: "Yami Marik won't use Ra's effect, nor attack,
 * when clearly he has game if he does both." The line is two steps —
 * God Phoenix clears the blockers, then Ra swings into an open field — and
 * either step alone does nothing, so an AI that cannot see the pair will
 * take neither.
 *
 * Drives the real planner over the real position and asks what it does.
 */
import { chooseTrapResponse, planTurn } from '../src/game/ai';
import { applyAction, createDuel, effAtk } from '../src/game/engine';
import type { CardInstance, DuelState, PlayerId } from '../src/game/types';

const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';
let uid = 0;
function card(pid: PlayerId, slug: string): CardInstance {
  return {
    uid: `t${uid++}`, slug, owner: pid, face: 'up', position: 'atk',
    atkMod: 0, defMod: 0, turnAtkMod: 0, turnDefMod: 0, counters: 0,
    equips: [], equippedTo: undefined, flags: {}, turnFlags: {},
    summonedOnTurn: 0, attacksUsed: 0, effectUsedOnTurn: -1,
    absorbed: [], isToken: false,
  };
}

/** Ra out, rested, two blockers across the table, and the opponent inside range. */
function position(): DuelState {
  const s = createDuel({
    seed: 5,
    p1: { duelistId: 'yamimarik', name: 'Marik' },
    p2: { duelistId: 'yugi', name: 'Yugi' },
    firstPlayer: 'p1',
  });
  s.turn = 6;
  s.phase = 'main';
  s.active = ME;
  for (const pid of [ME, FOE] as PlayerId[]) {
    s.players[pid].monsters = [null, null, null];
    s.players[pid].spellTrap = null;
    s.players[pid].field = null;
    s.players[pid].hand = [];
  }
  const ra = card(ME, 'the-winged-dragon-of-ra');
  ra.summonedOnTurn = 1;          // rested, so it may attack
  ra.atkMod = 4000;               // the tributes it ate
  s.players[ME].monsters = [ra, null, null];
  s.players[ME].lp = 8000;
  s.players[ME].grave = [];

  /* Two walls. Neither can be attacked over for lethal, and while they stand
     Ra cannot reach the player at all — clearing them is the whole point. */
  const a = card(FOE, 'big-shield-gardna'); a.position = 'def';
  const b = card(FOE, 'mystical-elf');      b.position = 'def';
  s.players[FOE].monsters = [a, b, null];
  s.players[FOE].lp = 3000;       // inside a single 4000 swing
  s.players[FOE].hand = [];
  s.players[FOE].spellTrap = null;
  return s;
}

/** Run one variant and report whether the computer found the kill. */
function trial(name: string, tweak: (s: DuelState) => void, budgetMs = 2500): boolean {
  const s = position();
  tweak(s);
  const plan = planTurn(s, ME, 'champion', budgetMs);
  let end = s;
  for (const a of plan) {
    const r = applyAction(end, ME, a);
    if (r.error) break;
    end = r.state;
    /* An attack opens a response window and the duel *waits*. A replay that
       walks past it leaves the attack suspended and no damage dealt, which
       reads exactly like "the computer did not attack" — it cost me two false
       failures before I noticed. Answer the window the way the other seat
       would, then carry on. */
    while (end.pending && !end.winner) {
      const responder = end.pending.player;
      const reply = chooseTrapResponse(end, responder, 'champion');
      const rr = applyAction(end, responder, reply);
      if (rr.error) break;
      end = rr.state;
    }
  }
  const won = end.winner === ME;
  const used = plan.some((a) => a.type === 'ignition');
  const hit = plan.some((a) => a.type === 'attack');
  console.log(
    `  ${won ? '✅' : '❌'} ${name.padEnd(46)} phoenix:${used ? 'y' : 'n'} attack:${hit ? 'y' : 'n'} ` +
      `they end on ${end.players[FOE].lp}  [${plan.map((a) => a.type).join(' → ')}]`
  );
  return won;
}

const base = position();
console.log(`Ra is ${effAtk(base, base.players[ME].monsters[0]!, ME)} ATK, they are on ${base.players[FOE].lp} behind two walls.`);
console.log('Lethal: God Phoenix (pay 1000, clear both) → Battle Phase → attack directly.\n');

const results = [
  trial('clean board', () => {}),
  trial('they hold a face-down Spell/Trap', (s) => {
    const set = card(FOE, 'mirror-force');
    set.face = 'down';
    set.summonedOnTurn = s.turn - 1;
    s.players[FOE].spellTrap = set;
  }),
  trial('they hold a face-down + a card in hand', (s) => {
    const set = card(FOE, 'mirror-force');
    set.face = 'down';
    set.summonedOnTurn = s.turn - 1;
    s.players[FOE].spellTrap = set;
    s.players[FOE].hand = [card(FOE, 'kuriboh'), card(FOE, 'dark-hole')];
  }),
  trial('Ra landed this turn (Special Summoned)', (s) => {
    const ra = s.players[ME].monsters[0]!;
    ra.summonedOnTurn = s.turn;
    ra.specialSummonedOnTurn = s.turn;
  }),
  trial('three walls instead of two', (s) => {
    const c = card(FOE, 'hitotsu-me-giant');
    c.position = 'def';
    s.players[FOE].monsters[2] = c;
  }),
  trial('Marik also holds cards (wider search)', (s) => {
    s.players[ME].hand = [card(ME, 'bowganian'), card(ME, 'coffin-seller'), card(ME, 'viser-des'), card(ME, 'revival-jam')];
  }),
  trial('a tight time budget (300ms)', () => {}, 300),
  trial('a very tight time budget (100ms)', () => {}, 100),
];

console.log(`\n${results.filter(Boolean).length}/${results.length} variants found the kill.`);
process.exitCode = results.every(Boolean) ? 0 : 1;
