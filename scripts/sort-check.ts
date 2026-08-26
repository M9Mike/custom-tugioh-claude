/**
 * The one order every deck is shown in, checked against its own rules.
 *
 * Sorting looks right in a screenshot and is wrong in the case nobody
 * photographed — a god whose ATK is counted at the table, two monsters that tie,
 * a Ritual that happens to cost two tributes, a search for a word that is a type
 * rather than a name. All of it is arithmetic over the card table, which is what
 * this file is for.
 *
 *   npm run sort
 */

import { CARDS, DUELIST_BY_ID } from '../src/game/cards';
import { STARTER_POOL } from '../src/story/roster';
import {
  TRUNK_FILTERS,
  TRUNK_SORTS,
  deckOrder,
  kindRank,
  menuDeckOrder,
  menuExtraOrder,
  searchCards,
  summonRank,
  trunkOrder,
} from '../src/story/deckSort';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

const nameOf = (s: string) => CARDS[s]?.name ?? s;
const atkOf = (s: string) => CARDS[s]?.atk ?? 0;
const defOf = (s: string) => CARDS[s]?.def ?? 0;
const everything = Object.keys(CARDS);

/** A pool with something on every rung of the ladder. */
const wide = [
  ...STARTER_POOL,
  'obelisk-the-tormentor',
  'slifer-the-sky-dragon',
  'the-winged-dragon-of-ra',
  'blue-eyes-white-dragon',
  'summoned-skull',
  'curse-of-dragon',
];

console.log('\nOne order, everywhere\n');

console.log('the ladder');
{
  /* Each of these sits on a different rung, and the rungs are the whole point. */
  const rungs: [string, number][] = [
    ['obelisk-the-tormentor', 0],   // a god
    ['blue-eyes-white-dragon', 2],  // level 8 -> two tributes
    ['summoned-skull', 3],          // level 6 -> one tribute
    ['feral-imp', 4],               // level 4 -> none
  ];
  for (const [slug, want] of rungs) {
    check(summonRank(slug) === want, `${nameOf(slug)} sits on rung ${want}`, `${summonRank(slug)}`);
  }
  check(summonRank('obelisk-the-tormentor') === 0, 'gods are always first');

  const ritual = everything.find((s) => CARDS[s]!.isRitual);
  if (ritual) {
    check(summonRank(ritual) === 5, `a Ritual (${nameOf(ritual)}) sits below the whole ladder`, `${summonRank(ritual)}`);
  }
  const fusion = everything.find((s) => CARDS[s]!.isFusion);
  if (fusion) {
    check(summonRank(fusion) === 6, `the Extra Deck (${nameOf(fusion)}) sits below that`, `${summonRank(fusion)}`);
  }
}

console.log('\nthe canonical order');
{
  const out = deckOrder(wide);
  check(out.length === wide.length, 'nothing is lost', `${out.length}`);

  const kinds = out.map(kindRank);
  check(
    kinds.every((k, i) => i === 0 || kinds[i - 1] <= k),
    'monsters, then spells, then traps'
  );

  const monsters = out.filter((s) => CARDS[s]!.kind === 'monster');
  const ranks = monsters.map(summonRank);
  check(
    ranks.every((r, i) => i === 0 || ranks[i - 1] <= r),
    'gods, 3 tributes, 2, 1, none, rituals, extra',
    ranks.join(' ')
  );

  /* Inside one rung: ATK down, then name. */
  let atkOk = true;
  let nameOk = true;
  for (let i = 1; i < monsters.length; i++) {
    const a = monsters[i - 1];
    const b = monsters[i];
    if (summonRank(a) !== summonRank(b)) continue;
    if (atkOf(a) < atkOf(b)) atkOk = false;
    if (atkOf(a) === atkOf(b) && nameOf(a).localeCompare(nameOf(b)) > 0) nameOk = false;
  }
  check(atkOk, 'and inside a rung, strongest first');
  check(nameOk, 'with names breaking the ties');

  for (const kind of ['spell', 'trap'] as const) {
    const names = out.filter((s) => CARDS[s]!.kind === kind).map(nameOf);
    check(
      names.every((n, i) => i === 0 || names[i - 1].localeCompare(n) <= 0),
      `${kind}s are by name, always`
    );
  }

  check(
    deckOrder([...wide].reverse()).join() === out.join(),
    'the order depends on the contents and nothing else'
  );
}

console.log('\nSlifer and Ra are not weak cards');
{
  check(CARDS['slifer-the-sky-dragon']?.atk === -1, "Slifer's printed ATK really is -1");
  const out = deckOrder(['kuriboh', 'slifer-the-sky-dragon', 'obelisk-the-tormentor']);
  check(out[out.length - 1] === 'kuriboh', 'and he still leads Kuriboh', out.join(' > '));
}

console.log('\nthe builder and the menu agree');
{
  let same = true;
  let worst = '';
  for (const d of Object.values(DUELIST_BY_ID)) {
    const flat = d.deck.flatMap(([slug, n]) => Array.from({ length: n }, () => slug));
    const viaBuilder = deckOrder(flat);
    const viaMenu = menuDeckOrder(d.deck).flatMap(([slug, n]) => Array.from({ length: n }, () => slug));
    if (viaBuilder.join() !== viaMenu.join()) {
      same = false;
      worst = d.id;
    }
  }
  check(same, 'the same deck reads the same on both screens', worst);
}

console.log('\nthe trunk: sorting');
{
  for (const { key } of TRUNK_SORTS) {
    const out = trunkOrder(wide, key);
    check(out.length === wide.length, `sorting by ${key} keeps every card`, `${out.length}`);

    const kinds = out.map(kindRank);
    check(
      kinds.every((k, i) => i === 0 || kinds[i - 1] <= k),
      `and by ${key} still runs monsters, spells, traps`
    );

    const monsters = out.filter((s) => CARDS[s]!.kind === 'monster');
    if (key === 'curve') {
      const ranks = monsters.map(summonRank);
      check(ranks.every((r, i) => i === 0 || ranks[i - 1] <= r), 'curve follows the ladder');
    } else {
      const val = key === 'atk' ? atkOf : defOf;
      const vals = monsters.map(val);
      check(
        vals.every((v, i) => i === 0 || vals[i - 1] >= v),
        `${key} ignores the ladder and sorts on the number alone`,
        vals.slice(0, 8).join(' ')
      );
    }

    /* Spells and traps are by name whichever sort is chosen. */
    let byName = true;
    for (const kind of ['spell', 'trap'] as const) {
      const names = out.filter((s) => CARDS[s]!.kind === kind).map(nameOf);
      if (!names.every((n, i) => i === 0 || names[i - 1].localeCompare(n) <= 0)) byName = false;
    }
    check(byName, `and spells and traps stay by name under ${key}`);
  }
}

console.log('\nthe trunk: filtering');
{
  for (const { key } of TRUNK_FILTERS) {
    const out = trunkOrder(wide, 'curve', key);
    if (key === 'all') {
      check(out.length === wide.length, 'All shows everything', `${out.length}`);
    } else {
      check(
        out.length > 0 && out.every((s) => CARDS[s]!.kind === key),
        `${key}s shows only ${key}s`,
        `${out.length} cards`
      );
    }
  }
  const total =
    trunkOrder(wide, 'curve', 'monster').length +
    trunkOrder(wide, 'curve', 'spell').length +
    trunkOrder(wide, 'curve', 'trap').length;
  check(total === wide.length, 'and the three filters between them account for the whole Trunk', `${total}`);
}

console.log('\nsearch');
{
  check(searchCards(everything, '').length === everything.length, 'an empty query matches everything');
  const fiends = searchCards(everything, 'fiend');
  check(
    fiends.length > 0 && fiends.every((s) => (CARDS[s]!.type ?? '').toLowerCase().includes('fiend')),
    'a type finds cards of that type',
    `${fiends.length} fiends`
  );
  check(searchCards(everything, 'dark').length > 0, 'an attribute finds cards too');
  check(searchCards(everything, 'feral').includes('feral-imp'), 'and a name finds the card');
  check(searchCards(everything, 'zzzznothing').length === 0, 'nothing matches nothing');
}

console.log('\nevery duelist deck, and the extra');
{
  let ok = true;
  for (const d of Object.values(DUELIST_BY_ID)) {
    if (menuDeckOrder(d.deck).length !== d.deck.length) ok = false;
    if (menuExtraOrder(d.extra ?? []).length !== (d.extra ?? []).length) ok = false;
  }
  check(ok, 'sort without losing a card, duplicates and Extra Decks included');

  const withExtra = Object.values(DUELIST_BY_ID).find((d) => (d.extra ?? []).length > 1);
  if (withExtra) {
    const out = menuExtraOrder(withExtra.extra);
    const vals = out.map(atkOf);
    check(
      vals.every((v, i) => i === 0 || vals[i - 1] >= v),
      `${withExtra.id}'s Extra Deck runs strongest first`,
      vals.join(' ')
    );
  }
}

console.log(
  failures === 0 ? '\nEvery ordering rule holds. ✅\n' : `\n${failures} ordering rule(s) broken. ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
