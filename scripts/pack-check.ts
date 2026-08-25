/**
 * The Thrill of the Pull, checked against its own rules.
 *
 * Packs are the first thing in Story Mode that *gives* the player something, so
 * the ways it can go wrong are the expensive kind: a card minted twice, an
 * entry that never leaves the pool, a duelist who can never be finished. None
 * of those show up in a screenshot, and all of them are arithmetic — which is
 * what this file is for.
 *
 *   npm run packs
 */

import { DUELISTS, DUELIST_BY_ID } from '../src/game/cards';
import { newProfile, type StoryProfile } from '../src/story/profile';
import { PACK_SIZE, isExhausted, openPack, packPool, remainingPool, slugOf, trunkOf } from '../src/story/packs';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

/** A seeded generator, so a failure can be reproduced from its seed. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const blank = (): StoryProfile => newProfile('Mike', 0);

console.log('\nThe Thrill of the Pull\n');

/* ---------------------------------------------------------------- */
console.log('the pool');

for (const d of DUELISTS) {
  const pool = packPool(d.id);
  if (pool.length !== 25) check(false, `${d.id} has a pool of 25`, `${pool.length}`);
}
check(
  DUELISTS.every((d) => packPool(d.id).length === 25),
  'every duelist has exactly 25 pullable entries'
);
check(
  DUELISTS.every((d) => new Set(packPool(d.id)).size === 25),
  'and every entry is distinct, so no copy can be pulled twice'
);
check(packPool('nobody-at-all').length === 0, 'an unknown duelist has an empty pool rather than throwing');

/* A duelist with real duplicates, to prove copies are separate entries. */
const tony = DUELIST_BY_ID['tony'];
const imps = packPool('tony').filter((k) => slugOf(k) === 'feral-imp');
check(
  tony?.deck.some(([s, c]) => s === 'feral-imp' && c === 3) === true && imps.length === 3,
  "Tony's three Feral Imps are three entries",
  `${imps.length}`
);

/* ---------------------------------------------------------------- */
console.log('\none pack');

{
  const p = blank();
  const { result } = openPack(p, 'tony', seeded(1));
  check(result.pulls.length === PACK_SIZE, `a full pool yields ${PACK_SIZE} cards`, `${result.pulls.length}`);
  const names = result.pulls.map((x) => x.slug);
  check(new Set(names).size === names.length, 'and never the same card twice in one pack', names.join(', '));
  check(result.pulls.every((x) => x.outcome === 'kept'), 'an empty collection keeps all of them');
}

{
  /* Everything already owned: three duplicates, and nothing added. */
  const p = { ...blank(), collection: packPool('tony').map(slugOf) };
  const before = p.collection.length;
  const { profile, result } = openPack(p, 'tony', seeded(7));
  check(result.pulls.every((x) => x.outcome === 'duplicate'), 'a full collection pulls only duplicates');
  check(profile.collection.length === before, 'and the collection does not grow', `${profile.collection.length}`);
  check(
    (profile.pulled?.['tony'] ?? []).length === result.pulls.length,
    'but the entries still leave the pool, or it could never empty'
  );
}

/* ---------------------------------------------------------------- */
console.log('\nopening every pack a duelist has');

for (const id of ['tony', 'sarah', 'mai']) {
  let p = blank();
  let packs = 0;
  const seenKeys = new Set<string>();
  let kept = 0;
  let dup = 0;

  while (!isExhausted(p, id) && packs < 100) {
    const { profile, result } = openPack(p, id, seeded(1000 + packs));
    for (const pull of result.pulls) {
      if (seenKeys.has(pull.key)) check(false, `${id}: entry ${pull.key} pulled twice`);
      seenKeys.add(pull.key);
      if (pull.outcome === 'kept') kept++;
      else dup++;
    }
    p = profile;
    packs++;
  }

  const pool = packPool(id);
  const names = new Set(pool.map(slugOf));
  check(isExhausted(p, id), `${id}: the pool empties`, `after ${packs} packs`);
  check(seenKeys.size === 25, `${id}: all 25 entries were pulled exactly once`, `${seenKeys.size}`);
  check(kept === names.size, `${id}: kept one of each distinct card`, `${kept} kept vs ${names.size} names`);
  check(kept + dup === 25, `${id}: every entry is accounted for`, `${kept}+${dup}`);
  check(
    new Set(p.collection).size === p.collection.length,
    `${id}: the collection never holds a duplicate`
  );
  /* And once empty it stays empty rather than yielding phantom cards. */
  const after = openPack(p, id, seeded(3));
  check(after.result.pulls.length === 0, `${id}: an empty pool yields nothing`);
  check(after.result.exhausted, `${id}: and still reports itself finished`);
}

/* ---------------------------------------------------------------- */
console.log('\nthe trunk');

{
  const p: StoryProfile = {
    ...blank(),
    collection: ['a', 'b', 'c', 'd'],
    deck: ['a', 'c'],
  };
  const trunk = trunkOf(p);
  check(trunk.join(',') === 'b,d', 'the trunk is what you own and are not duelling with', trunk.join(','));
  check(
    trunkOf({ ...p, deck: null }).length === 4,
    'and is the whole collection before a deck is cut'
  );
}

/* ---------------------------------------------------------------- */
console.log('\nkeys survive a deck being rebalanced');

{
  /* A key names the card and the copy, so reordering a deck cannot move it. */
  const p = blank();
  const { profile } = openPack(p, 'tony', seeded(11));
  const keys = profile.pulled?.['tony'] ?? [];
  check(keys.length > 0 && keys.every((k) => k.includes('#')), 'pulled entries are name-keyed, not indexed', keys.join(' '));
  check(
    keys.every((k) => packPool('tony').includes(k)),
    'and every stored key still names a real entry'
  );
  /* A key for a copy that no longer exists simply never matches. */
  const stale = { ...profile, pulled: { tony: [...keys, 'feral-imp#9'] } };
  check(
    remainingPool(stale, 'tony').length === 25 - keys.length,
    'a stale key from an older deck costs the player nothing',
    `${remainingPool(stale, 'tony').length}`
  );
}

console.log(
  failures === 0
    ? '\nEvery pull rule holds. ✅\n'
    : `\n${failures} pull rule(s) broken. ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
