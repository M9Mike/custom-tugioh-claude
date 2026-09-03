/**
 * The five things reported from a real duel, driven through the real engine.
 *
 *   npx tsx scripts/gods-check.ts
 *
 * Four of them are engine rules and are played out here as actual actions —
 * a Dark Hole really activated, an attack really declared, a trap window
 * really opened. The fifth (the victory splash) is in `Duel.tsx` and is
 * covered by `npm run e2e` in a browser; its condition is asserted here as
 * far as pure code can reach.
 *
 * Every assertion below was run against the unfixed engine first and every one
 * of them was red there. A regression written after a fix, green against the
 * fix, has proven nothing yet.
 */
import { applyAction, canAttackWith, createDuel } from '../src/game/engine';
import type { CardInstance, DuelState, PlayerId } from '../src/game/types';

const ME: PlayerId = 'p1';
const FOE: PlayerId = 'p2';
let checks = 0;
let bad = 0;

function ok(cond: boolean, what: string, detail = '') {
  checks += 1;
  if (!cond) bad += 1;
  console.log(`  ${cond ? '✅' : '❌'} ${what}${cond || !detail ? '' : ` — ${detail}`}`);
}

function fresh(phase: 'main' | 'battle' = 'main'): DuelState {
  const s = createDuel({
    seed: 11,
    p1: { duelistId: 'yami', name: 'Yami' },
    p2: { duelistId: 'kaiba', name: 'Kaiba' },
    firstPlayer: 'p1',
  });
  s.turn = 4;
  s.phase = phase;
  s.active = ME;
  for (const pid of [ME, FOE] as PlayerId[]) {
    s.players[pid].monsters = [null, null, null];
    s.players[pid].spellTrap = null;
    s.players[pid].field = null;
    s.players[pid].hand = [];
  }
  return s;
}

let n = 0;
function card(owner: PlayerId, slug: string): CardInstance {
  n += 1;
  return {
    uid: `c${n}`, slug, owner, face: 'up', position: 'atk',
    atkMod: 0, defMod: 0, turnAtkMod: 0, turnDefMod: 0, counters: 0,
    equips: [], equippedTo: undefined, flags: {}, turnFlags: {},
    summonedOnTurn: 0, attacksUsed: 0, effectUsedOnTurn: -1,
    absorbed: [], isToken: false,
  };
}

/* A rejected action returns the state untouched, so a check driven through one
   passes by never happening — the "Tornado Wall is not offered" assertion did
   exactly that on its first run, because the attack behind it was illegal and
   no window opened at all. Nothing here may fail quietly. */
function act(s: DuelState, pid: PlayerId, a: Parameters<typeof applyAction>[2]): DuelState {
  const r = applyAction(s, pid, a);
  if (r.error) throw new Error(`${a.type} rejected: ${r.error}`);
  return r.state;
}
const on = (s: DuelState, pid: PlayerId) => s.players[pid].monsters.filter((m): m is CardInstance => !!m);

/* ------------------------------------------------------------------ */
console.log('\nA God is destroyed by a bigger body and by nothing else');
{
  /* The report, verbatim: "WTF SLIFER GOT DESTROYED BY BLACK HOLE". Dark Hole
     names no target, so it never went near `isProtectedTarget` — it arrives
     straight at `destroyCard`, which is why the God's untargetable aura did
     not save it. */
  const s = fresh();
  const slifer = card(ME, 'slifer-the-sky-dragon');
  s.players[ME].monsters = [slifer, card(ME, 'kuriboh'), null];
  s.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const hole = card(FOE, 'dark-hole');
  s.players[FOE].hand = [hole];
  s.active = FOE;
  const swept = act(s, FOE, { type: 'activateSpell', uid: hole.uid, targets: [] });
  ok(on(swept, ME).some((m) => m.slug === 'slifer-the-sky-dragon'),
    "their Dark Hole does not touch Slifer",
    on(swept, ME).map((m) => m.slug).join(',') || 'the God is gone');
  ok(!on(swept, ME).some((m) => m.slug === 'kuriboh') && on(swept, FOE).length === 0,
    'CONTROL: it still sweeps every mortal on both sides',
    `mine ${on(swept, ME).length}, theirs ${on(swept, FOE).length}`);

  /* And your own sweep is no different. `isProtectedTarget` exempts the
     actor's own side so a protection cannot stop its owner using their own
     card — which is the exact hole a two-sided sweep fell through. */
  const mine = fresh();
  const god2 = card(ME, 'slifer-the-sky-dragon');
  mine.players[ME].monsters = [god2, null, null];
  mine.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const ownHole = card(ME, 'dark-hole');
  mine.players[ME].hand = [ownHole];
  const own = act(mine, ME, { type: 'activateSpell', uid: ownHole.uid, targets: [] });
  ok(on(own, ME).some((m) => m.slug === 'slifer-the-sky-dragon'),
    'and neither does your own',
    on(own, ME).map((m) => m.slug).join(',') || 'the God is gone');

  /* A targeted removal was already refused, and stays refused. */
  const ring = fresh();
  const god3 = card(ME, 'obelisk-the-tormentor');
  ring.players[ME].monsters = [god3, null, null];
  ring.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const fissure = card(FOE, 'fissure');
  ring.players[FOE].hand = [fissure];
  ring.active = FOE;
  const after = applyAction(ring, FOE, { type: 'activateSpell', uid: fissure.uid, targets: [god3.uid] });
  ok(on(after.state, ME).some((m) => m.slug === 'obelisk-the-tormentor'),
    'a targeted removal cannot reach Obelisk either',
    after.error ?? on(after.state, ME).map((m) => m.slug).join(','));

  /* The one thing that does work: a bigger body. */
  const war = fresh('battle');
  const god4 = card(FOE, 'slifer-the-sky-dragon');
  god4.atkMod = -8000; // a thin hand, so a mortal can out-fight it
  war.players[FOE].monsters = [god4, null, null];
  const killer = card(ME, 'blue-eyes-white-dragon');
  war.players[ME].monsters = [killer, null, null];
  const fought = act(war, ME, { type: 'attack', uid: killer.uid, targetUid: god4.uid });
  ok(!on(fought, FOE).some((m) => m.slug === 'slifer-the-sky-dragon'),
    'CONTROL: a bigger ATK in battle still kills it — that is the only answer',
    on(fought, FOE).map((m) => m.slug).join(',') || 'gone');
}

/* ------------------------------------------------------------------ */
console.log('\nA God attacks through Swords, the Cage and everything else');
{
  /* Swords of Revealing Light freezes the monsters; the Steelcage takes the
     Battle Phase itself away, one level higher, so both doors need the
     exemption or the God never reaches the one it has. */
  const s = fresh('battle');
  const god = card(ME, 'slifer-the-sky-dragon');
  const mortal = card(ME, 'kuriboh');
  s.players[ME].monsters = [god, mortal, null];
  s.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  s.ongoing.push({ id: 'f1', source: 'swords-of-revealing-light', kind: 'freezeMonsters', target: ME, turns: 3 });
  ok(canAttackWith(s, ME, god), 'Swords of Revealing Light does not hold a God down');
  ok(!canAttackWith(s, ME, mortal), 'CONTROL: it still holds every mortal beside it');

  const caged = fresh();
  const god2 = card(ME, 'slifer-the-sky-dragon');
  caged.players[ME].monsters = [god2, null, null];
  caged.ongoing.push({ id: 'f2', source: 'nightmare-s-steelcage', kind: 'skipBattlePhase', target: ME, turns: 2 });
  const entered = applyAction(caged, ME, { type: 'toPhase', phase: 'battle' });
  ok(entered.state.phase === 'battle', 'the Steelcage does not keep a God out of the Battle Phase', entered.error ?? '');

  const noGod = fresh();
  noGod.players[ME].monsters = [card(ME, 'kuriboh'), null, null];
  noGod.ongoing.push({ id: 'f3', source: 'nightmare-s-steelcage', kind: 'skipBattlePhase', target: ME, turns: 2 });
  const blocked = applyAction(noGod, ME, { type: 'toPhase', phase: 'battle' });
  ok(blocked.state.phase !== 'battle', 'CONTROL: without one, the Cage still shuts the Battle Phase');

  /* A face-down God is a card lying face-down, and does nothing — including
     this. */
  const hidden = fresh();
  const asleep = card(ME, 'slifer-the-sky-dragon');
  asleep.face = 'down';
  hidden.players[ME].monsters = [asleep, null, null];
  hidden.ongoing.push({ id: 'f4', source: 'nightmare-s-steelcage', kind: 'skipBattlePhase', target: ME, turns: 2 });
  ok(applyAction(hidden, ME, { type: 'toPhase', phase: 'battle' }).state.phase !== 'battle',
    'CONTROL: a face-down God opens nothing — it is not on the field yet');
}

/* ------------------------------------------------------------------ */
console.log('\nRevival Jam comes back lying down, and brings company');
{
  const s = fresh();
  const jam = card(ME, 'revival-jam');
  s.players[ME].monsters = [jam, null, null];
  s.players[ME].grave = [card(ME, 'magician-of-faith'), card(ME, 'battle-ox')];
  s.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  const hole = card(FOE, 'dark-hole');
  s.players[FOE].hand = [hole];
  s.active = FOE;
  const after = act(s, FOE, { type: 'activateSpell', uid: hole.uid, targets: [] });
  const back = on(after, ME);
  ok(back.length === 2, 'it revives itself and one other body', `${back.length} on the board`);
  ok(back.every((m) => m.position === 'def'), 'both arrive in Defense Position',
    back.map((m) => `${m.slug}:${m.position}`).join(' '));
  ok(back.every((m) => m.face === 'up'), 'and both arrive face-up',
    back.map((m) => `${m.slug}:${m.face}`).join(' '));
}

/* ------------------------------------------------------------------ */
console.log('\nTornado Wall is not offered without Umi');
{
  /* Reported as "Tornado Wall activated without Umi". It was: the offer asked
     whether the cost was payable and never whether the condition was met, so
     the card was announced, its one condition-gated effect skipped, and the
     card spent for nothing. */
  /* `anyOpponentTurn` opens when the opponent *enters the Battle Phase*, not
     when they declare an attack — so the window has to be opened the way the
     card really sees it. */
  const dry = fresh();
  const wall = card(ME, 'tornado-wall');
  wall.face = 'down';
  wall.summonedOnTurn = 0;
  dry.players[ME].spellTrap = wall;
  dry.players[ME].monsters = [card(ME, 'kuriboh'), null, null];
  dry.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  dry.active = FOE;
  const swung = act(dry, FOE, { type: 'toPhase', phase: 'battle' });
  ok(!swung.pending || !swung.pending.options.includes(wall.uid),
    'with no Umi anywhere it is never offered',
    swung.pending ? `offered: ${swung.pending.options.length}` : 'no window');
  ok(swung.players[ME].spellTrap?.uid === wall.uid,
    'CONTROL: so the card is still in the zone, unspent');

  const sea = fresh();
  const wall2 = card(ME, 'tornado-wall');
  wall2.face = 'down';
  wall2.summonedOnTurn = 0;
  sea.players[ME].spellTrap = wall2;
  sea.players[ME].field = { ...card(ME, 'umi'), face: 'up' as const };
  sea.players[ME].monsters = [card(ME, 'kuriboh'), null, null];
  sea.players[FOE].monsters = [card(FOE, 'battle-ox'), null, null];
  sea.active = FOE;
  const wet = act(sea, FOE, { type: 'toPhase', phase: 'battle' });
  ok(!!wet.pending && wet.pending.options.includes(wall2.uid),
    'CONTROL: with Umi down it is offered exactly as it should be',
    wet.pending ? `offered: ${wet.pending.options.length}` : 'no window at all');
}

/* ------------------------------------------------------------------ */
console.log('\nThe duel is over before the board has said so');
{
  /* The board's half of this lives in `Duel.tsx` and is checked in a browser
     by `npm run e2e`. What is checkable here is the thing the fix depends on:
     the killing blow really is still sitting unplayed in `state.anims` on the
     same commit that carries the winner, so a win screen that waits on
     `unspoken` has something to wait for. If this ever came back empty the
     client-side guard would be waiting on nothing. */
  const s = fresh('battle');
  s.players[FOE].lp = 100;
  const killer = card(ME, 'blue-eyes-white-dragon');
  s.players[ME].monsters = [killer, null, null];
  const over = act(s, ME, { type: 'attack', uid: killer.uid, targetUid: null });
  ok(over.winner === ME, 'the duel really ends on that swing', String(over.winner));
  ok(over.anims.length > 0,
    'and the blow that ended it arrives in the same commit, still unplayed',
    `${over.anims.length} beats`);
}

console.log(`\n${bad ? `${bad} of ${checks} FAILED` : `All ${checks} checks pass. ✅`}`);
process.exitCode = bad ? 1 : 0;
