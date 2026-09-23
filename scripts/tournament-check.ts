/**
 * The tournament's rules, and the tournament through the real routes.
 *
 *   npm run chips
 *
 * Two halves, like `npm run ash`.
 *
 * **The rules**, on `settleDuel` alone: a win takes the loser's star chip and a
 * second win takes nothing; a loss hands the winner yours, once; everybody else
 * in the field plays a round nobody watches every time the player finishes a
 * duel, paired off with the odd one out sitting it; the same save always has
 * the same tournament behind it; a room settles once; ten chips sets the finals
 * with the three the table puts highest, and nothing moves after that. And a
 * whole tournament, played to the end a few hundred times over, ends where the
 * rules say it should: four finalists, the strong decks usually among them.
 *
 * **The routes**, on the in-process store: the broadcast cannot open the
 * tournament for somebody short of ninety-nine; a duel against an entrant,
 * surrendered by their seat, settles a chip when the conversation picks up and
 * not a second time; a loss hands them yours; a duel begun before the
 * tournament settles nothing; ten wins set the finals; and `seen` marks the
 * announcement read.
 *
 * Local store only, like every check that writes a save: it snapshots the dev
 * file and puts it back.
 */
import fs from 'node:fs/promises';
import {
  CHIPS_TO_FINALS,
  ENTRANTS,
  FINALISTS_BESIDES_YOU,
  YOU,
  chipsOf,
  phaseOf,
  settleDuel,
  standings,
  startTournament,
  type TournamentState,
} from '../src/story/tournament';
import { WORLD_NPCS, openingNode } from '../src/story/npcs';
import { STARTER_POOL } from '../src/story/roster';
import { durable } from '../src/server/store';
import { loadProfile, updateProfile } from '../src/server/story';
import { loadRoom } from '../src/server/rooms';
import type { StoryProfile } from '../src/story/profile';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

const settle = (t: TournamentState, npcId: string, won: boolean, code: string, username = 'Mike') =>
  settleDuel(t, { username, npcId, won, code, now: 1000 });

/* ------------------------------------------------------------------ */
console.log('\nThe rules');
{
  const t0 = startTournament(1);
  check(phaseOf(t0) === 'running' && phaseOf(null) === 'before', 'a new tournament is running, and none is before it');
  check(ENTRANTS.every((e) => Array.isArray(t0.board[e.id]) && t0.board[e.id].length === 0), 'every entrant starts with no chips');

  const t1 = settle(t0, 'tina', true, 'R1');
  check(t1.chips.join() === 'tina', 'beating an entrant takes their chip');
  check(t1.round === 1, 'and the field plays a round', `round ${t1.round}`);
  const others = ENTRANTS.length - 1;
  check(t1.latest?.length === Math.floor(others / 2), `everybody else is paired off, the odd one out sitting it — ${Math.floor(others / 2)} duels`, `${t1.latest?.length}`);
  const inRound = new Set((t1.latest ?? []).flatMap((d) => [d.a, d.b]));
  check(!inRound.has('tina'), 'and the duelist the player faced is not in it');
  check((t1.latest ?? []).every((d) => d.winner === d.a || d.winner === d.b), 'every duel off screen has one of its two as the winner');
  check((t1.latest ?? []).every((d) => t1.board[d.winner].includes(d.winner === d.a ? d.b : d.a)), 'and the winner holds the loser\'s chip');

  const t2 = settle(t1, 'tina', true, 'R2');
  check(t2.chips.length === 1, 'beating them again takes nothing more', t2.chips.join());
  check(settle(t2, 'tina', true, 'R2') === t2, 'a room already settled settles nothing');
  const again = settle(t0, 'tina', true, 'R1');
  check(JSON.stringify(again) === JSON.stringify(t1), 'the same save, the same duel, the same tournament behind it');
  check(JSON.stringify(settle(t0, 'tina', true, 'R1', 'Teddy')) !== JSON.stringify(t1), 'and another save has another one');

  const t3 = settle(t2, 'yami', false, 'R3');
  check(t3.board.yami.includes(YOU) && t3.chips.length === 1, 'losing hands the winner your chip, and costs you nothing of yours');
  const t4 = settle(t3, 'yami', false, 'R4');
  check(t4.board.yami.filter((x) => x === YOU).length === 1, 'and a second loss to them hands over nothing more');
  const t5 = settle(t4, 'grandpa', true, 'R5');
  check(t5.chips.length === 1 && t5.round === t4.round + 1 && t5.latest?.length === Math.floor(ENTRANTS.length / 2), 'a duel with somebody not entered is still a round for everybody else');
  check(chipsOf(t5, YOU) === t5.chips.length, 'and the player\'s count is their chips');

  /* Ten, and the finals. */
  let t = startTournament(1);
  const beat = ENTRANTS.map((e) => e.id).slice(0, CHIPS_TO_FINALS);
  beat.forEach((id, i) => {
    t = settle(t, id, true, `F${i}`);
  });
  check(t.chips.length === CHIPS_TO_FINALS && phaseOf(t) === 'finals', `${CHIPS_TO_FINALS} chips sets the finals`);
  const finalists = t.finals?.finalists ?? [];
  check(finalists.length === FINALISTS_BESIDES_YOU + 1 && finalists[0] === YOU, `four finalists, the player first`, finalists.join(', '));
  const top = standings(t).filter((r) => r.id !== YOU).slice(0, FINALISTS_BESIDES_YOU).map((r) => r.id);
  check(JSON.stringify(finalists.slice(1)) === JSON.stringify(top), 'and the other three are the top of the table', `${finalists.slice(1).join(', ')} against ${top.join(', ')}`);
  check(settle(t, 'yugi', true, 'after') === t, 'and nothing moves after that');
}

/* ------------------------------------------------------------------ */
console.log('\nA whole tournament, many times over');
{
  const made = new Map<string, number>();
  const rounds: number[] = [];
  const tops: number[] = [];
  const RUNS = 400;
  for (let run = 0; run < RUNS; run++) {
    let t = startTournament(1);
    /* A player who wins seven in ten, against whoever they meet next. */
    let n = 0;
    let rng = run * 7919 + 13;
    const next = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);
    while (!t.finals && n < 200) {
      const foe = ENTRANTS[Math.floor(next() * ENTRANTS.length)].id;
      t = settleDuel(t, { username: `run${run}`, npcId: foe, won: next() < 0.7, code: `C${n}`, now: n });
      n++;
    }
    rounds.push(t.round);
    for (const id of t.finals?.finalists.slice(1) ?? []) made.set(id, (made.get(id) ?? 0) + 1);
    tops.push(Math.max(...ENTRANTS.map((e) => chipsOf(t, e.id))));
  }
  const avg = rounds.reduce((a, b) => a + b, 0) / RUNS;
  check(rounds.every((r) => r < 200), 'every one of them reaches the finals');
  console.log(`  ·  ${avg.toFixed(1)} duels to the finals on average; the leading entrant holds ${Math.min(...tops)}–${Math.max(...tops)} chips when they are set`);
  const ranked = [...made.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`  ·  finalists: ${ranked.map(([id, k]) => `${id} ${Math.round((k / RUNS) * 100)}%`).join(', ')}`);
  const strongest = [...ENTRANTS].sort((a, b) => b.rating - a.rating).slice(0, 3).map((e) => e.id);
  check(strongest.every((id) => (made.get(id) ?? 0) / RUNS > 0.3), 'the three strongest decks usually make it', strongest.map((id) => `${id} ${(((made.get(id) ?? 0) / RUNS) * 100).toFixed(0)}%`).join(', '));
  check(ranked.length > 4, 'but not always the same three', `${ranked.length} different entrants reached a final`);
}

/* ------------------------------------------------------------------ */
console.log('\nWho says what');
{
  const tina = WORLD_NPCS.find((n) => n.id === 'tina')!;
  const kaiba = WORLD_NPCS.find((n) => n.id === 'kaiba')!;
  let t = startTournament(1);
  check(openingNode(tina, false, 120, null) === tina.start, 'somebody never met introduces themselves');
  const meeting = WORLD_NPCS.filter((n) => n.script.meet);
  check(
    meeting.length > 0 && meeting.every((n) => openingNode(n, false, 120, t) === 'meet'),
    'and during the tournament, with the line for meeting somebody in the middle of it',
    meeting.filter((n) => openingNode(n, false, 120, t) !== 'meet').map((n) => n.id).join(', ')
  );
  check(openingNode(tina, true, 50, null) === 'again', 'before the tournament, the short version');
  check(openingNode(tina, true, 50, t) === 'ready', 'during it, the line about the tournament — even a card short of the door, once it has begun');
  t = settle(t, 'tina', true, 'O1');
  check(openingNode(tina, true, 120, t) === 'chipped', 'once her chip is yours, the line that knows it');
  for (const [i, id] of ENTRANTS.map((e) => e.id).filter((id) => id !== 'tina').slice(0, CHIPS_TO_FINALS - 1).entries()) t = settle(t, id, true, `O${i + 2}`);
  const tinaThrough = t.finals?.finalists.includes('tina');
  check(openingNode(tina, true, 120, t) === (tinaThrough ? 'finalist' : 'out'), 'and once the finals are set, the line for making it or not');
  check(openingNode(kaiba, true, 120, t) === 'finals', 'and Kaiba\'s, for the finals');
  check(
    openingNode(tina, false, 120, t) === (tinaThrough ? 'finalist' : 'out') && openingNode(kaiba, false, 120, t) === 'finals',
    'met or not — nobody offers a chip once they have stopped changing hands'
  );
}

/* ------------------------------------------------------------------ */
async function throughTheRoutes() {
  console.log('\nThrough the routes');
  if (durable) {
    console.log('  · a durable store is configured; the route leg only runs against the in-process one');
    return;
  }
  const { POST: room } = await import('../src/app/api/room/route');
  const { POST: save } = await import('../src/app/api/story/save/route');
  const { POST: tournament } = await import('../src/app/api/story/tournament/route');
  const { POST: act } = await import('../src/app/api/room/[code]/act/route');
  const post = async (fn: (req: Request, ctx?: never) => Promise<Response>, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fn(new Request('http://local/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
    return (await res.json()) as Record<string, unknown>;
  };
  const surrender = async (code: string, token: string) => {
    const res = await act(
      new Request('http://local/x', { method: 'POST', body: JSON.stringify({ kind: 'duel', token, action: { type: 'surrender' } }), headers: { 'Content-Type': 'application/json' } }),
      { params: Promise.resolve({ code }) }
    );
    return (await res.json()) as Record<string, unknown>;
  };
  /** A duel with one of them, won or lost by a surrender on the right seat, and the conversation picked up. */
  const duel = async (npcId: string, opponentId: string, win: boolean) => {
    const seated = await post(room, { storyUser: 'Mike', opponentId, npcId, won: 'chip', lost: 'won' });
    if (seated.ok !== true) return { seated, done: null as Record<string, unknown> | null };
    const r = await loadRoom(String(seated.code));
    const foe = r?.seats.p2?.token ?? '';
    await surrender(String(seated.code), win ? foe : String(seated.token));
    const done = await post(save, { username: 'Mike', duelDone: true });
    return { seated, done };
  };

  const DEV_FILE = '.cache/story-profiles.json';
  const before = await fs.readFile(DEV_FILE, 'utf8').catch(() => null);
  try {
    const deck = STARTER_POOL.slice(0, 25);
    await updateProfile('Mike', (p) => ({
      ok: true,
      profile: {
        ...p,
        character: p.character ?? { name: 'Mike', model: 'sandra-afrika', tints: [], stature: 0.5 },
        collection: deck,
        deck,
        money: 500,
        packs: [],
        pendingDuel: null,
        tournament: undefined,
      },
    }));
    const early = await post(tournament, { username: 'Mike', step: 'start' });
    check(early.ok === false, 'the broadcast cannot open the tournament for twenty-five cards', String(early.error ?? ''));

    /* A duel begun before it opens settles nothing, even if it ends after. */
    const pre = await post(room, { storyUser: 'Mike', opponentId: 'tina', npcId: 'tina', won: 'beaten', lost: 'won', stake: 2 });
    check(pre.ok === true, 'a duel with Tina seats before the tournament', String(pre.error ?? ''));

    /* Ninety-nine cards: a collection made of every card the decks name. */
    const { CARDS } = await import('../src/game/cards');
    const many = Object.keys(CARDS).slice(0, 120);
    await updateProfile('Mike', (p) => ({ ok: true, profile: { ...p, collection: [...new Set([...deck, ...many])].slice(0, 110) } }));
    const opened = await post(tournament, { username: 'Mike', step: 'start' });
    const started = (opened.profile as StoryProfile | undefined)?.tournament;
    check(opened.ok === true && !!started && started.chips.length === 0, 'with ninety-nine it opens', String(opened.error ?? ''));
    const twice = await post(tournament, { username: 'Mike', step: 'start' });
    check((twice.profile as StoryProfile).tournament?.startedAt === started?.startedAt, 'and a second start is the first one, handed back');

    const preRoom = await loadRoom(String(pre.code));
    await surrender(String(pre.code), preRoom?.seats.p2?.token ?? '');
    const preDone = await post(save, { username: 'Mike', duelDone: true });
    check(((preDone.profile as StoryProfile).tournament?.chips.length ?? -1) === 0 && ((preDone.profile as StoryProfile).tournament?.round ?? -1) === 0, 'a duel begun before the tournament settles nothing when it ends');

    const first = await duel('sarah', 'sarah', true);
    check(first.seated.ok === true, 'a duel with Sarah seats', String(first.seated.error ?? ''));
    const afterFirst = (first.done?.profile as StoryProfile).tournament;
    check(afterFirst?.chips.join() === 'sarah', 'beating her, and picking the conversation up, takes her chip', afterFirst?.chips.join());
    check(afterFirst?.round === 1 && (afterFirst.latest?.length ?? 0) > 0, 'and the field plays its round', `round ${afterFirst?.round}`);
    const replay = await post(save, { username: 'Mike', duelDone: true });
    check((replay.profile as StoryProfile).tournament?.round === 1, 'picking it up twice settles it once');

    const lost = await duel('tony', 'tony', false);
    const afterLoss = (lost.done?.profile as StoryProfile).tournament;
    check(afterLoss?.board.tony.includes(YOU) === true && afterLoss.chips.length === 1, 'losing to Tony hands him your chip and keeps yours', JSON.stringify(afterLoss?.board.tony));
    check(afterLoss?.round === 2, 'and is a round as well');

    /* Nine more, and the finals. */
    const rest = ['isha', 'antiope', 'panthesilea', 'hippolyta', 'kaela', 'seraphina', 'yugi', 'joey', 'mai'];
    for (const id of rest) await duel(id, id, true);
    const done = await loadProfile('Mike');
    const t = done?.tournament;
    check(t?.chips.length === CHIPS_TO_FINALS, `${CHIPS_TO_FINALS} wins are ${CHIPS_TO_FINALS} chips`, `${t?.chips.length}`);
    check(!!t?.finals && t.finals.finalists.length === 4 && t.finals.finalists[0] === YOU, 'and the finals are set, four finalists', t?.finals?.finalists.join(', '));
    const seen = await post(tournament, { username: 'Mike', step: 'seen' });
    check((seen.profile as StoryProfile).tournament?.finals?.seen === true, 'and the announcement, once read, is marked read');
    const oneMore = await duel('yami', 'yami', true);
    check((oneMore.done?.profile as StoryProfile).tournament?.chips.length === CHIPS_TO_FINALS, 'and a duel after the finals are set changes nothing');
  } finally {
    if (before !== null) await fs.writeFile(DEV_FILE, before);
    else await fs.rm(DEV_FILE, { force: true });
  }
}

void throughTheRoutes().then(() => {
  console.log(failures === 0 ? '\nCHIPS: the tournament keeps its rules. ✅\n' : `\n${failures} rule(s) broken. ❌\n`);
  process.exit(failures === 0 ? 0 : 1);
});
