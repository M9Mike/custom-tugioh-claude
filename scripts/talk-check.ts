/**
 * Every conversation in the city, walked without a browser.
 *
 *   npm run talk
 *
 * A script is a map of nodes and every reply names the node it leads to, so a
 * mistyped name is a reply that logs an error and shuts the panel in the
 * player's face. Nothing caught that until now: `npm run story` taps *one* path
 * through *one* conversation, and the other sixty nodes were proved by reading
 * them. Nine characters in, that is not proof.
 *
 * So: every node a reply names exists, every node can be reached, every stake
 * is inside the range its owner will actually play for, and the one token a
 * line may carry is the one token `sayLine` fills. All of it is a walk over
 * data — it costs milliseconds, and it is the difference between knowing the
 * scripts are whole and having read them twice.
 *
 * An unreachable node is a failure and not a warning, because there are only
 * two ways to get one: a reply you meant to write and did not, or a node you
 * meant to delete and did not. Both are worth being told about.
 */
import { WORLD_NPCS, WAITING_CAST, type WorldNpc } from '../src/story/npcs';
import { ARRIVALS, CHIPS_TO_FINALS, ENTRANTS, FINALISTS_BESIDES_YOU, TOURNAMENT_CARDS, isEntrant } from '../src/story/tournament';
import { BROADCAST } from '../src/story/broadcast';
import { wagerFor } from '../src/story/shop';
import { DUELIST_BY_ID } from '../src/game/cards';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

/**
 * The tokens a line may carry, and nothing else in braces.
 *
 * `{name}` is the player's own duelist, filled for every line by the panel.
 * `{card}` is the one a duel was played for, filled by the world when there is
 * one (`OpenWorld`'s `fill`) — Ash's, and whoever plays for a card next. The
 * case matters because `sayLine` replaces the exact string: `{Name}` reaches
 * the player as `{Name}`.
 */
const TOKENS = /\{([a-zA-Z]+)\}/g;
const KNOWN = new Set(['name', 'card', 'cards', 'left', 'chips']);

/**
 * The nodes the tournament opens, rather than a reply — see `openingNode`,
 * and `chip`, which is where a first win over an entrant resumes.
 */
const TOURNAMENT_NODES = ['meet', 'ready', 'chip', 'chipped', 'finalist', 'out', 'finals'];

function walk(npc: WorldNpc) {
  const nodes = Object.keys(npc.script);
  console.log(`\n${npc.character.name} — ${nodes.length} nodes`);

  check(!!npc.script[npc.start], `opens on "${npc.start}"`, npc.start);

  /* Every reply leads somewhere that exists, and so does every duel outcome. */
  const dangling: string[] = [];
  for (const [id, node] of Object.entries(npc.script)) {
    check(node.lines.length > 0 && node.lines.every((l) => l.trim().length > 0), `"${id}" has something to say`, `${node.lines.length} line(s)`);
    for (const choice of node.choices) {
      if (choice.to !== null && !npc.script[choice.to]) dangling.push(`${id} → ${choice.to}`);
    }
    for (const line of node.lines) {
      for (const [, token] of line.matchAll(TOKENS)) {
        if (!KNOWN.has(token.toLowerCase()) || token !== token.toLowerCase()) {
          dangling.push(`${id} says {${token}}`);
        }
      }
    }
  }
  if (npc.duel) {
    for (const [which, to] of [['won', npc.duel.won], ['lost', npc.duel.lost]] as const) {
      if (!npc.script[to]) dangling.push(`duel ${which} → ${to}`);
    }
  }
  check(dangling.length === 0, 'every reply and every outcome names a node that exists', dangling.join(' · '));

  /* Reachable from the start, or from wherever a duel drops you afterwards. */
  const seen = new Set<string>();
  /* Three ways in, not one: `again` and `ready` are opened by `openingNode`
     rather than by a reply, so a reachability walk that starts only at `start`
     calls both of them orphans. See `WorldNpc.start`. */
  const queue = [npc.start, 'again', ...TOURNAMENT_NODES, ...(npc.duel ? [npc.duel.won, npc.duel.lost] : [])].filter(
    (id) => npc.script[id]
  );
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const choice of npc.script[id].choices) {
      if (choice.to && npc.script[choice.to]) queue.push(choice.to);
    }
  }
  const orphans = nodes.filter((id) => !seen.has(id));
  check(orphans.length === 0, 'and every node can be reached', orphans.join(', '));

  /*
   * A conversation you cannot walk out of.
   *
   * Not "every node offers a goodbye" — the panel's own ✕ is always there and
   * a node three replies deep into a rumour has no business ending it. The
   * property that matters is that from *anywhere* in the script there is still
   * a path to a reply that leaves: a ring of nodes that only point at each
   * other is a conversation the script cannot end, whatever the panel does.
   */
  const leaves = new Set<string>();
  for (let again = true; again; ) {
    again = false;
    for (const [id, node] of Object.entries(npc.script)) {
      if (leaves.has(id)) continue;
      const out = node.choices.some((c) => c.to === null || c.duel || c.shop || (c.to && leaves.has(c.to)));
      if (out || node.choices.length === 0) {
        leaves.add(id);
        again = true;
      }
    }
  }
  const ringed = nodes.filter((id) => !leaves.has(id));
  check(ringed.length === 0, 'and every node has a way out of the conversation ahead of it', ringed.join(', '));

  /*
   * Money on the table, if there is any.
   *
   * A stake outside the range its owner plays for is not a bug the player ever
   * sees — `stakeFor` clamps it on the server — but it is a reply that says one
   * figure and charges another, which is the same class of lie as a card whose
   * text does not match its effect.
   */
  const staked = Object.entries(npc.script).flatMap(([id, node]) =>
    node.choices.filter((c) => c.stake !== undefined).map((c) => ({ id, stake: c.stake!, duel: !!c.duel }))
  );
  if (staked.length) {
    const range = npc.duel ? wagerFor(npc.duel.opponentId) : null;
    check(!!range, `${npc.character.name} plays for money at all`, range ? '' : 'a stake named by somebody with no wager range');
    if (range) {
      const outside = staked.filter((s) => s.stake < range.min || s.stake > range.max || !Number.isInteger(s.stake));
      check(outside.length === 0, `and every figure offered is between $${range.min} and $${range.max}`, outside.map((s) => `${s.id}: $${s.stake}`).join(', '));
      const offered = [...new Set(staked.map((s) => s.stake))].sort((a, b) => a - b);
      check(
        offered.length === range.max - range.min + 1,
        'and every figure in the range is offered',
        `$${offered.join(' $')} of $${range.min}–$${range.max}`
      );
    }
    check(staked.every((s) => s.duel), 'and a figure is only ever named by a reply that starts the duel');
  }

  /* And whoever they say plays their side has a deck. */
  if (npc.duel) {
    check(!!DUELIST_BY_ID[npc.duel.opponentId], `duels as "${npc.duel.opponentId}", who has a deck`);
  }

  /*
   * The tournament, and the one token that can lie.
   *
   * `{left}` is how many cards short of the hall the player is, so it reads
   * "0 to go" anywhere it can be shown to somebody who is already in — which
   * is every node but `again`, because `openingNode` sends a player at the
   * threshold to `ready` instead. `{cards}` is safe everywhere: it is a count
   * of what they are holding and it is true at any number.
   */
  const leftOutside = Object.entries(npc.script)
    .filter(([id, node]) => id !== 'again' && node.lines.some((l) => l.includes('{left}')))
    .map(([id]) => id);
  check(leftOutside.length === 0, 'and {left} is only counted where it can still be counting', leftOutside.join(', '));

  /*
   * And `{chips}` only where there are chips.
   *
   * The player's star chips are a number once the tournament has begun and
   * nothing before it, so for anybody who was in the city first it may only
   * be said in the nodes the tournament opens. The four who arrive with it,
   * and Kaiba, only ever meet a player who is already in — every line of
   * theirs is tournament-time.
   */
  if (!npc.arrives) {
    const early = Object.entries(npc.script)
      .filter(([id, node]) => !TOURNAMENT_NODES.includes(id) && node.lines.some((l) => l.includes('{chips}')))
      .map(([id]) => id);
    check(early.length === 0, 'and {chips} is only counted once there are chips to count', early.join(', '));
  }
}

console.log('\nEvery conversation in the city');
for (const npc of WORLD_NPCS) walk(npc);

/*
 * Everybody has a second conversation, and something to say about the hall.
 *
 * The whole cast talks about the tournament, so the whole cast has the two
 * nodes that carry it: the short version once you have been introduced, and
 * the line for the day the player can walk in. Ash is the exception and it is
 * the same exception as everywhere else — he is not from here, the tournament
 * is not his, and he pays in his own currency (`KEEPS_THEIR_CARDS`).
 */
const OUTSIDER = new Set(['ash']);
console.log('\nSecond meetings');
for (const npc of [...WORLD_NPCS, ...WAITING_CAST]) {
  if (OUTSIDER.has(npc.id)) continue;
  /* Anybody the player can have met before the tournament has a short
     version for the second time. The four who arrive with it, and Kaiba,
     cannot be met before it — their second meeting is already `ready`. */
  if (!npc.arrives) {
    check(!!npc.script.again, `${npc.character.name} has a short greeting`, 'no again');
  }
  check(!!npc.script.ready, `${npc.character.name} has a word for the tournament`, 'no ready');
}

/*
 * And every entrant has the whole of the tournament to say: a line for their
 * chip changing hands, a line for once it has, and one each for making the
 * finals and for not. Kaiba has his for the finals. Anybody else — Grandpa,
 * Ash — is not in it and needs none.
 */
console.log('\nThe tournament, in everybody\'s words');
check(ENTRANTS.every((e) => WORLD_NPCS.some((n) => n.id === e.id)), 'every entrant is somebody in the city', ENTRANTS.filter((e) => !WORLD_NPCS.some((n) => n.id === e.id)).map((e) => e.id).join(', '));
for (const npc of WORLD_NPCS) {
  if (!isEntrant(npc.id)) continue;
  const missing = ['chip', 'chipped', 'finalist', 'out'].filter((n) => !npc.script[n]);
  /* Anybody who was in the city before the tournament greets a stranger as
     somebody waiting on it — so a first meeting once it has begun needs its
     own line, and for the ones who travel, a line that is not tied to the
     spot they used to stand on. */
  if (!npc.arrives && !npc.script.meet) missing.push('meet');
  check(missing.length === 0, `${npc.character.name} can hand over a chip, keep count, and make the finals or miss them`, missing.join(', '));
  check(!!npc.duel, `and ${npc.character.name} duels`);
  check(ARRIVALS.has(npc.id) === (npc.arrives === 'tournament'), `and ${npc.character.name} is in the city when the tournament says so`);
}
const kaiba = WORLD_NPCS.find((n) => n.id === 'kaiba');
check(!!kaiba && !!kaiba.script.finals && !kaiba.duel && kaiba.arrives === 'tournament', 'Kaiba runs it, says so at the finals, and does not duel');

/*
 * The broadcast says the rules the code runs.
 *
 * Not the wording — the numbers. Ninety-nine at the door, ten chips, three
 * who go through with the player, four finalists. A rule changed in
 * `tournament.ts` and not in Kaiba's mouth is a broadcast telling the player
 * something the game will not do.
 */
console.log('\nThe broadcast');
const said = BROADCAST.map((l) => l.text.toLowerCase()).join(' ');
const WORDS: Record<number, string> = { 3: 'three', 4: 'four', 10: 'ten', 99: 'ninety-nine' };
for (const [what, n] of [['the door', TOURNAMENT_CARDS], ['chips to the finals', CHIPS_TO_FINALS], ['who go through with you', FINALISTS_BESIDES_YOU], ['finalists', FINALISTS_BESIDES_YOU + 1]] as const) {
  check(said.includes(WORDS[n] ?? String(n)), `it names ${what}: ${WORDS[n] ?? n}`);
}
check(BROADCAST.every((l, i) => i === 0 || l.at > BROADCAST[i - 1].at), 'and its lines are in the order they are spoken');

/* The bench is cast too: `WAITING_CAST` stands in the duel lobby and its
   records carry the same shape. A dangling reply there is the same fault. */
for (const npc of WAITING_CAST) {
  if (WORLD_NPCS.some((n) => n.id === npc.id)) continue;
  walk(npc);
}

console.log(
  failures === 0
    ? `\nTALK: every conversation is whole. ✅\n`
    : `\n${failures} thing(s) wrong in the scripts. ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
