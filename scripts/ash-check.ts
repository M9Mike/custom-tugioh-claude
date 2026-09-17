/**
 * Ash Ketchum, checked against his own rules.
 *
 *   npm run ash
 *
 * Four things, none of which a screenshot can tell you:
 *
 * 1. **The schedule.** Sixty days of it: every day visits both shops, no two
 *    visits overlap, every visit is inside opening hours and as long as it
 *    says, the day is a coin toss of presence, and the same day rolls the same
 *    visits twice — he must not vanish when you turn round.
 * 2. **The routes.** Every point he walks to, and forty samples along every
 *    leg, is somewhere a person can stand — not inside a shelf, a table, a
 *    rail or a wall — and the Crown route really does climb: the floor under
 *    his feet rises to the second gallery and comes back down.
 * 3. **The roster.** He is a duelist the engine knows and a duelist no screen
 *    lists; his deck is a pack pool of twenty-five like everybody's; a win
 *    pays three thousand and no cards.
 * 4. **The card on the table**, end to end through the real routes on the
 *    in-process store: a bet is refused from a collection of exactly a deck
 *    and for a card not owned; a seated bet leaves the collection and rides on
 *    the room; a win claimed once puts the card back (into the deck too, if it
 *    was sleeved) with the money and no pack, and claimed twice pays nothing
 *    more; a loss keeps the card gone, squares the deck to twenty-four, and the
 *    room refuses to seat a short deck until twenty-five are sleeved again.
 *
 * Local store only, like every check that writes a save: it snapshots the dev
 * profile first and puts it back after.
 */
import fs from 'node:fs/promises';
import { ASH_HAUNTS, ashVisits, ashWhereabouts, dayFrom } from '../src/story/ash';
import { WORLD_NPCS, whereabouts } from '../src/story/npcs';
import { areaById, groundAt, settle, standingOn, CS_G1, CS_G2 } from '../src/story/areas';
import { DUELISTS, DUELIST_BY_ID, ROSTER } from '../src/game/cards';
import { packPool } from '../src/story/packs';
import { DECK_SIZE, STARTER_POOL } from '../src/story/roster';
import { newProfile, type StoryProfile } from '../src/story/profile';
import {
  bountyFor,
  deckIsShort,
  escrowCard,
  givesAPack,
  mendDeck,
  refuseWager,
  returnCard,
  wagersACard,
} from '../src/story/shop';
import { durable } from '../src/server/store';
import { loadProfile, updateProfile } from '../src/server/story';
import { loadRoom } from '../src/server/rooms';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};
const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

const ash = WORLD_NPCS.find((n) => n.id === 'ash')!;

/* ------------------------------------------------------------------ */
console.log('\nAsh Ketchum\n');
console.log('the schedule');
{
  let both = 0;
  let overlaps = 0;
  let outside = 0;
  let lengths = 0;
  let present = 0;
  const DAYS = 60;
  const SAMPLES = 24 * 12;
  for (let day = 0; day < DAYS; day++) {
    const visits = ashVisits(day);
    const again = ashVisits(day);
    if (JSON.stringify(visits) !== JSON.stringify(again)) check(false, `day ${day} rolls the same visits twice`);
    const shops = new Set(visits.map((v) => v.haunt));
    if (shops.size === 2) both += 1;
    for (const v of visits) {
      if (v.from < 7 || v.to > 23.5) outside += 1;
      if (v.to - v.from < 2.5 - 1e-9 || v.to - v.from > 4 + 1e-9) lengths += 1;
      for (const w of visits) if (w !== v && v.from < w.to && w.from < v.to) overlaps += 1;
    }
    for (let i = 0; i < SAMPLES; i++) if (ashWhereabouts((i / SAMPLES) * 24, day)) present += 1;
  }
  check(both === DAYS, 'every day visits both shops', `${both}/${DAYS}`);
  check(overlaps === 0, 'no two visits overlap', `${overlaps}`);
  check(outside === 0, 'every visit is inside opening hours (07:00–23:30)', `${outside}`);
  check(lengths === 0, 'and every visit lasts between two and a half and four hours', `${lengths}`);
  const share = present / (DAYS * SAMPLES);
  check(share > 0.3 && share < 0.55, 'he is about somewhere between a third and half of the day', `${(share * 100).toFixed(1)}%`);
  check(ashWhereabouts(3, 0) === null, 'and never at three in the morning');
  check(dayFrom(Date.now(), 16) === 0 && dayFrom(Date.now(), 16, 5) === 5, 'a pinned hour pins the day; ?day= names one');
  check(dayFrom(10 * 72 * 60_000 + 1) === 10, 'the day counts seventy-two-minute days off the clock');
  const today = ashVisits(0).map((v) => `${hhmm(v.from)}–${hhmm(v.to)} ${ASH_HAUNTS[v.haunt].area}`);
  console.log(`     (day 0: ${today.join(', ')})`);
  check(!!ash.schedule && ash.haunts === ASH_HAUNTS, 'his record carries the haunts and the schedule');
  const placed = WORLD_NPCS.filter((n) => !n.schedule);
  check(
    placed.every((n) => {
      const w = whereabouts(n, 12, 3);
      return w && w.area === n.area && w.x === n.x && w.z === n.z && w.roam === n.roam;
    }),
    'and everybody without one is exactly where their record says, at any hour'
  );
}

/* ------------------------------------------------------------------ */
console.log('\nthe routes');
{
  for (const haunt of ASH_HAUNTS) {
    const area = areaById(haunt.area);
    const path = haunt.roam?.path ?? [];
    check(path.length >= 2, `${haunt.area}: a route of at least two points`, `${path.length}`);
    let stuck: string[] = [];
    let y = standingOn(area, haunt.x, haunt.z);
    let top = y;
    const R = 0.4;
    /* Forty samples a leg, each settled from the floor he is on: a point that
       `settle` moves is a point inside something. */
    for (let i = 0; i + 1 < path.length; i++) {
      const a = path[i];
      const b = path[i + 1];
      for (let k = 0; k <= 40; k++) {
        const t = k / 40;
        const x = a.x + (b.x - a.x) * t;
        const z = a.z + (b.z - a.z) * t;
        y = groundAt(area, x, z, y);
        top = Math.max(top, y);
        const s = settle(area, x, z, R, y);
        if (Math.hypot(s.x - x, s.z - z) > 0.02) stuck.push(`(${x.toFixed(1)}, ${z.toFixed(1)}) at ${y.toFixed(1)} m`);
      }
    }
    stuck = [...new Set(stuck)];
    check(stuck.length === 0, `${haunt.area}: every step of the route is somewhere he can stand`, stuck.slice(0, 6).join(' · ') + (stuck.length > 6 ? ` … ${stuck.length}` : ''));
    if (haunt.area === 'crown-shop') {
      check(Math.abs(top - CS_G2) < 1e-6, 'the Crown route climbs to the second gallery', `${top.toFixed(2)} m of ${CS_G2}`);
      check(y < 1e-6 || Math.abs(y - CS_G1) < 1e-6 || Math.abs(y - CS_G2) < 1e-6, 'and ends on a floor', `${y.toFixed(2)} m`);
      /* The end of the route is on the top gallery; walking back is the same
         legs reversed, which the world does by construction. */
      check(Math.abs(y - CS_G2) < 1e-6, 'its last point is on the top gallery, so the way back walks all the way down', `${y.toFixed(2)} m`);
    } else {
      check(top === 0, `${haunt.area}: stays on the ground floor`, `${top}`);
    }
    /* Far from Grandpa: two prompts live at once is a choice of two
       conversations the world never offers. */
    if (haunt.area === 'grandpa-shop') {
      const grandpa = WORLD_NPCS.find((n) => n.id === 'grandpa')!;
      const apart = Math.min(...path.map((p) => Math.hypot(p.x - grandpa.x, p.z - grandpa.z)));
      check(apart > grandpa.range + ash.range, 'every point keeps him out of Grandpa\'s talk range and Grandpa out of his', `${apart.toFixed(2)} m against ${grandpa.range + ash.range}`);
    }
  }
}

/* ------------------------------------------------------------------ */
console.log('\nthe roster');
{
  check(!!DUELIST_BY_ID.ash, 'the engine knows him');
  check(DUELISTS.some((d) => d.id === 'ash'), 'he is in the full list');
  check(!ROSTER.some((d) => d.id === 'ash'), 'and on no list a player is shown');
  check(ROSTER.length === DUELISTS.length - 1, 'he is the only secret', `${DUELISTS.length - ROSTER.length}`);
  check(packPool('ash').length === 25, 'his deck is twenty-five entries like everybody\'s', `${packPool('ash').length}`);
  check(DUELIST_BY_ID.ash.extra.length === 21, 'and twenty-one wait in the Extra Deck', `${DUELIST_BY_ID.ash.extra.length}`);
  check(bountyFor('ash') === 3000, 'a win pays three thousand', `$${bountyFor('ash')}`);
  check(!givesAPack('ash'), 'and never a card of his');
  check(wagersACard('ash') && !wagersACard('tina') && !wagersACard('solomon'), 'he is the one who asks for a card on the table');
  check(ash.duel?.wager === 'card' && !!ash.duel.few, 'his offer says so, and has a line for a player with nothing to spare');
}

/* ------------------------------------------------------------------ */
console.log('\nthe card on the table, as arithmetic');
{
  const twentyFive: StoryProfile = { ...newProfile('Mike', 0), collection: STARTER_POOL.slice(0, 25), deck: STARTER_POOL.slice(0, 25) };
  const twentySix: StoryProfile = { ...twentyFive, collection: STARTER_POOL.slice(0, 26) };
  check(refuseWager(twentyFive, STARTER_POOL[0]) === 'few', 'a collection of exactly a deck may not bet from it');
  check(refuseWager(twentySix, STARTER_POOL[0]) === null, 'one spare card is enough');
  check(refuseWager(twentySix, 'blue-eyes-white-dragon') === 'unowned', 'and a card not owned cannot be put up');
  const held = escrowCard(twentySix, STARTER_POOL[0]);
  check(held.collection.length === 25 && !held.collection.includes(STARTER_POOL[0]), 'escrow takes the card out of the collection');
  check(held.deck?.length === 25 && held.deck.includes(STARTER_POOL[0]), 'and leaves the deck alone while the duel is on');
  check(deckIsShort(held) === false, 'so the deck is not short during the duel');
  const back = returnCard(held, STARTER_POOL[0]);
  check(back.collection.length === 26 && back.collection.includes(STARTER_POOL[0]), 'a win puts it back');
  const lost = mendDeck(held);
  check(lost.deck?.length === 24 && !lost.deck.includes(STARTER_POOL[0]), 'a loss squares the deck to twenty-four');
  check(deckIsShort(lost), 'which is short');
  check(mendDeck(back) === back, 'and mending a whole deck changes nothing');
  const trunkBet = escrowCard(twentySix, STARTER_POOL[25]);
  check(mendDeck(trunkBet).deck?.length === 25, 'losing a Trunk card leaves the deck whole');
}

/* ------------------------------------------------------------------ */
/* Through the routes                                                  */
/* ------------------------------------------------------------------ */

async function throughTheRoutes() {
  console.log('\nthe card on the table, through the routes');
  if (durable) {
    console.log('  · a durable store is configured; the route leg only runs against the in-process one');
    return;
  }
  const { POST: room } = await import('../src/app/api/room/route');
  const { POST: pack } = await import('../src/app/api/story/pack/route');
  const { POST: save } = await import('../src/app/api/story/save/route');
  const { POST: deckRoute } = await import('../src/app/api/story/deck/route');
  const { POST: act } = await import('../src/app/api/room/[code]/act/route');
  const post = async (fn: (req: Request, ctx?: never) => Promise<Response>, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fn(new Request('http://local/x', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
    return (await res.json()) as Record<string, unknown>;
  };
  const actAs = async (code: string, token: string, action: unknown) => {
    const res = await act(
      new Request('http://local/x', { method: 'POST', body: JSON.stringify({ kind: 'duel', token, action }), headers: { 'Content-Type': 'application/json' } }),
      { params: Promise.resolve({ code }) }
    );
    return (await res.json()) as Record<string, unknown>;
  };

  const DEV_FILE = '.cache/story-profiles.json';
  const before = await fs.readFile(DEV_FILE, 'utf8').catch(() => null);
  try {
    const cards = STARTER_POOL.slice(0, 26);
    const deck = cards.slice(0, 25);
    const spare = cards[25];
    const sleeved = deck[3];
    const seeded = await updateProfile('Mike', (p) => ({
      ok: true,
      profile: { ...p, character: p.character ?? { name: 'Mike', model: 'sandra-afrika', tints: [], stature: 0.5 }, collection: cards, deck, money: 0, packs: [], pendingDuel: null },
    }));
    check(seeded.ok, 'a save with twenty-six cards and a sleeved deck is set up');

    /* Refusals first. */
    const noCard = await post(room, { storyUser: 'Mike', opponentId: 'ash', npcId: 'ash', won: 'beaten', lost: 'won' });
    check(noCard.ok === false, 'the room refuses a duel with Ash that names no card', String(noCard.error ?? ''));
    const notMine = await post(room, { storyUser: 'Mike', opponentId: 'ash', wager: 'blue-eyes-white-dragon', npcId: 'ash', won: 'beaten', lost: 'won' });
    check(notMine.ok === false, 'and one that names a card the save does not hold', String(notMine.error ?? ''));
    await updateProfile('Mike', (p) => ({ ok: true, profile: { ...p, collection: deck } }));
    const few = await post(room, { storyUser: 'Mike', opponentId: 'ash', wager: sleeved, npcId: 'ash', won: 'beaten', lost: 'won' });
    check(few.ok === false, 'and any bet from a collection of exactly a deck', String(few.error ?? ''));
    await updateProfile('Mike', (p) => ({ ok: true, profile: { ...p, collection: cards } }));
    const untouched = await loadProfile('Mike');
    check(untouched?.collection.length === 26, 'a refused bet takes nothing', `${untouched?.collection.length}`);

    /* A win, claimed once. */
    const seatedWin = await post(room, { storyUser: 'Mike', opponentId: 'ash', wager: spare, npcId: 'ash', won: 'beaten', lost: 'won' });
    check(seatedWin.ok === true, 'a bet on the spare card seats a duel', String(seatedWin.error ?? ''));
    const afterSeat = await loadProfile('Mike');
    check(afterSeat?.collection.length === 25 && !afterSeat.collection.includes(spare), 'the card has left the collection', `${afterSeat?.collection.length}`);
    check(afterSeat?.pendingDuel?.wagered === spare, 'and the save\'s note names it');
    const won = await loadRoom(String(seatedWin.code));
    check(won?.wagerCard === spare && won?.seats.p2?.duelistId === 'ash', 'the room carries the card and seats Ash');
    const foeToken = won?.seats.p2?.token ?? '';
    const surrendered = await actAs(String(seatedWin.code), foeToken, { type: 'surrender' });
    check(surrendered.ok === true, 'Ash\'s seat surrenders through the room\'s own route', String(surrendered.error ?? ''));
    const claim = await post(pack, { action: 'claim', username: 'Mike', code: seatedWin.code, token: seatedWin.token });
    check(claim.ok === true && claim.awarded === true && claim.paid === 3000 && claim.pack === false, 'the win pays three thousand and no pack', JSON.stringify({ paid: claim.paid, pack: claim.pack }));
    const afterWin = await loadProfile('Mike');
    check(afterWin?.collection.length === 26 && afterWin.collection.includes(spare), 'and the card is back');
    check((afterWin?.money ?? 0) === 3000 && afterWin?.packs.length === 0, 'with the money and nothing to open', `$${afterWin?.money}, ${afterWin?.packs.length} pack(s)`);
    const again = await post(pack, { action: 'claim', username: 'Mike', code: seatedWin.code, token: seatedWin.token });
    check(again.ok === true && again.awarded === false, 'claimed twice pays nothing more');
    const settledWin = await post(save, { username: 'Mike', duelDone: true });
    check(settledWin.ok === true && (settledWin.profile as StoryProfile).deck?.length === 25, 'settling the note leaves a whole deck');

    /* A win on a sleeved card, with the note settled BEFORE the claim — the
       order that races in the real screen. */
    const seatedWin2 = await post(room, { storyUser: 'Mike', opponentId: 'ash', wager: sleeved, npcId: 'ash', won: 'beaten', lost: 'won' });
    check(seatedWin2.ok === true, 'a bet on a sleeved card seats a duel', String(seatedWin2.error ?? ''));
    const won2 = await loadRoom(String(seatedWin2.code));
    await actAs(String(seatedWin2.code), won2?.seats.p2?.token ?? '', { type: 'surrender' });
    const settledFirst = await post(save, { username: 'Mike', duelDone: true });
    check((settledFirst.profile as StoryProfile).deck?.length === 24, 'settling first squares the deck to twenty-four, since the card is still on the table');
    const claim2 = await post(pack, { action: 'claim', username: 'Mike', code: seatedWin2.code, token: seatedWin2.token });
    const afterWin2 = await loadProfile('Mike');
    check(claim2.ok === true && afterWin2?.deck?.length === 25 && afterWin2.deck.includes(sleeved), 'and the claim puts the won card back into the deck as well', `${afterWin2?.deck?.length}`);
    check(afterWin2?.collection.length === 26, 'and into the collection', `${afterWin2?.collection.length}`);

    /* A loss on a sleeved card. */
    const seatedLoss = await post(room, { storyUser: 'Mike', opponentId: 'ash', wager: sleeved, npcId: 'ash', won: 'beaten', lost: 'won' });
    check(seatedLoss.ok === true, 'a bet on a sleeved card seats a duel', String(seatedLoss.error ?? ''));
    const gaveUp = await actAs(String(seatedLoss.code), String(seatedLoss.token), { type: 'surrender' });
    check(gaveUp.ok === true, 'the player surrenders');
    const lostClaim = await post(pack, { action: 'claim', username: 'Mike', code: seatedLoss.code, token: seatedLoss.token });
    check(lostClaim.ok === true && lostClaim.lost === true, 'a loss has nothing to claim');
    const stillPending = await loadProfile('Mike');
    check(stillPending?.deck?.length === 25 && stillPending.collection.length === 25, 'until the note is settled the deck still names the card', `${stillPending?.deck?.length}/${stillPending?.collection.length}`);
    const settledLoss = await post(save, { username: 'Mike', duelDone: true });
    const afterLoss = settledLoss.profile as StoryProfile;
    check(afterLoss.deck?.length === 24 && !afterLoss.deck.includes(sleeved), 'settling the loss squares the deck to twenty-four', `${afterLoss.deck?.length}`);
    check(afterLoss.collection.length === 25 && !afterLoss.collection.includes(sleeved), 'and the card is gone', `${afterLoss.collection.length}`);
    check(deckIsShort(afterLoss), 'so the deck is short');
    const refused = await post(room, { storyUser: 'Mike', opponentId: 'sarah', npcId: 'sarah', won: 'beaten', lost: 'won' });
    check(refused.ok === false && /24 cards/.test(String(refused.error)), 'and nobody will seat a short deck', String(refused.error ?? ''));
    const resleeved = await post(deckRoute, { username: 'Mike', deck: afterLoss.collection.slice(0, 25) });
    check(resleeved.ok === true, 'twenty-five sleeved from what is left is accepted', String(resleeved.error ?? ''));
    const seatedAgain = await post(room, { storyUser: 'Mike', opponentId: 'sarah', npcId: 'sarah', won: 'beaten', lost: 'won' });
    check(seatedAgain.ok === true, 'and the next duel seats', String(seatedAgain.error ?? ''));
    await post(save, { username: 'Mike', duelDone: true });

    /* A bet from the Trunk that is lost leaves the deck whole. */
    await updateProfile('Mike', (p) => ({ ok: true, profile: { ...p, collection: cards, deck } }));
    const seatedTrunk = await post(room, { storyUser: 'Mike', opponentId: 'ash', wager: spare, npcId: 'ash', won: 'beaten', lost: 'won' });
    await actAs(String(seatedTrunk.code), String(seatedTrunk.token), { type: 'surrender' });
    const settledTrunk = (await post(save, { username: 'Mike', duelDone: true })).profile as StoryProfile;
    check(settledTrunk.deck?.length === 25 && settledTrunk.collection.length === 25, 'losing a Trunk card leaves the deck whole and the Trunk one lighter');
  } finally {
    /* Put the dev save back the way it was. */
    if (before !== null) await fs.writeFile(DEV_FILE, before);
  }
}

void throughTheRoutes().then(() => {
  console.log(failures === 0 ? '\nAsh is where he should be, and the bet holds. ✅\n' : `\n${failures} rule(s) broken. ❌\n`);
  process.exit(failures === 0 ? 0 : 1);
});
