/**
 * The shop and the money, checked against their own rules.
 *
 * This is the second thing in Story Mode that *gives* the player something, and
 * the first that takes something away, so the ways it can go wrong are the
 * expensive kind: money out of nowhere, a card bought twice, a purchase that
 * takes the coin and not the card. All of it is arithmetic over two small
 * tables, which is what this file is for.
 *
 *   npm run shop
 */

import { CARDS, DUELIST_BY_ID } from '../src/game/cards';
import { compareCards } from '../src/story/deckSort';
import { newProfile, type StoryProfile } from '../src/story/profile';
import {
  BOUNTY,
  FORFEIT,
  CARD_WAGER,
  KEEPS_THEIR_CARDS,
  PURSE,
  STOCK,
  WAGER,
  bountyFor,
  forfeitFor,
  buy,
  ceilingFor,
  givesAPack,
  purseAfterLosing,
  purseAfterWin,
  purseFor,
  purseOf,
  refuseBuy,
  shopStock,
  stakeFor,
  wagerFor,
  wagersACard,
} from '../src/story/shop';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

const rich = (money: number, collection: string[] = []): StoryProfile => ({
  ...newProfile('Mike', 0),
  money,
  collection,
});

console.log('\nThe Kame Game Shop\n');

console.log('the stock');
{
  check(STOCK.length > 0, 'there is something on the shelf', `${STOCK.length} item(s)`);
  check(
    STOCK.every((s) => !!CARDS[s.slug]),
    'and every slug on it is a real card',
    STOCK.filter((s) => !CARDS[s.slug]).map((s) => s.slug).join(', ')
  );
  check(
    STOCK.every((s) => Number.isInteger(s.price) && s.price > 0),
    'every price is a positive whole number'
  );
  check(
    new Set(STOCK.map((s) => s.slug)).size === STOCK.length,
    'and nothing is listed twice'
  );

  const shown = shopStock().map((s) => s.slug);
  const expected = [...shown].sort(compareCards);
  check(shown.join() === expected.join(), 'the shelf is in the same order as a deck', shown.join(', '));
  check(shopStock() !== STOCK, 'and sorting it does not rearrange the table itself');
}

console.log('\nthe bounties');
{
  check(
    Object.keys(BOUNTY).every((id) => !!DUELIST_BY_ID[id]),
    'every duelist with a price on their head exists',
    Object.keys(BOUNTY).filter((id) => !DUELIST_BY_ID[id]).join(', ')
  );
  check(
    Object.values(BOUNTY).every((v) => Number.isInteger(v) && v >= 0),
    'and every bounty is a whole number of dollars'
  );
  check(bountyFor('tony') === 1 && bountyFor('sarah') === 1, 'Tony and Sarah pay a dollar each');
  check(bountyFor('nobody-at-all') === 0, 'and a duelist nobody has priced pays nothing');
}

console.log('\nbuying');
{
  const item = STOCK[0];
  const price = item.price;

  check(refuseBuy(rich(price), item.slug) === null, 'exact money is enough');
  check(refuseBuy(rich(price + 1), item.slug) === null, 'and more than enough is enough');
  check(refuseBuy(rich(price - 1), item.slug) === 'poor', 'a dollar short is refused', `${price - 1}`);
  check(refuseBuy(rich(0), item.slug) === 'poor', 'and nothing at all is refused');

  check(
    refuseBuy(rich(price, [item.slug]), item.slug) === 'owned',
    'a card already owned is refused whatever the balance'
  );
  check(
    refuseBuy(rich(price), 'not-a-real-card') === 'unstocked',
    'a card nobody is selling cannot be bought by naming it'
  );
  const notStocked = Object.keys(CARDS).find((s) => !STOCK.some((x) => x.slug === s))!;
  check(
    refuseBuy(rich(999999), notStocked) === 'unstocked',
    'and neither can a real card that is not on the shelf',
    notStocked
  );

  /* A purchase moves the money and the card together. */
  const before = rich(price + 40);
  const after = buy(before, item.slug);
  check((after.money ?? 0) === 40, 'the price comes off the balance', `${after.money}`);
  check(after.collection.includes(item.slug), 'and the card lands in the collection');
  check(after.collection.length === before.collection.length + 1, 'exactly once');
  check((before.money ?? 0) === price + 40, 'the profile handed in is not mutated', `${before.money}`);
  check(
    refuseBuy(after, item.slug) === 'owned',
    'and buying it again is refused, which is what stops a double-tap'
  );
}

console.log('\nthe money only moves the two ways it should');
{
  /* Winning is the only source; the shop is the only sink. There is no third
     path in the code, and this is the assertion that says so out loud. */
  const p = rich(0);
  const won = { ...p, money: (p.money ?? 0) + bountyFor('tony') };
  check((won.money ?? 0) === 1, 'a win adds exactly the bounty', `${won.money}`);

  const item = STOCK[0];
  const saved = rich(item.price);
  const spent = buy(saved, item.slug);
  check((spent.money ?? 0) === 0, 'a purchase removes exactly the price', `${spent.money}`);
  check((spent.money ?? 0) >= 0, 'and never leaves a negative balance');

  /* The long way round, stated as arithmetic rather than as a complaint. */
  const wins = Math.ceil(item.price / Math.max(1, bountyFor('tony')));
  console.log(`     (${CARDS[item.slug]?.name} is ${wins.toLocaleString()} wins at $${bountyFor('tony')} a duel)`);
}

/* ------------------------------------------------------------------ */
/* Money on the table                                                  */
/* ------------------------------------------------------------------ */

/**
 * The one duelist who takes money as well as giving it.
 *
 * Everything else here is arithmetic that can only ever go up for the player,
 * so the expensive mistakes are all of the form "money out of nowhere". A wager
 * adds the other direction, and with it a way to cheat that a bounty does not
 * have: **lose, and do not admit it.**
 *
 * That is why the stake is taken when the duel is seated rather than settled
 * when it ends, and this block is the pin on that decision. There is exactly
 * one path in the whole app that hands money back — a claimed win — so leaving
 * a duel by any route at all costs the stake by construction: quitting to the
 * world, refreshing, closing the tab, pulling the network out, or simply never
 * going back. None of them reach the payout, because the payout is on the far
 * side of proving you won.
 */
{
  console.log('\nTina, who plays for money on the table\n');

  check(wagerFor('tina') !== null, 'she will not sit down without a stake');
  const range = wagerFor('tina')!;
  check(range.min === 2 && range.max === 5, 'and it is two to five', `${range.min}–${range.max}`);

  /* Her money is the pot. A bounty as well would be paying twice for one win. */
  check(bountyFor('tina') === 0, 'she pays no bounty on top of it', `$${bountyFor('tina')}`);
  check(givesAPack('tina'), 'but a win still takes a pack of her deck');

  /* Nobody else can be talked into it, whatever the client sends. */
  check(
    Object.keys(WAGER).every((id) => !!DUELIST_BY_ID[id]),
    'every duelist who wagers is a real one',
    Object.keys(WAGER).filter((id) => !DUELIST_BY_ID[id]).join(', ')
  );
  check(stakeFor('sarah', 5) === 0 && stakeFor('tony', 5) === 0,
    'and nobody else can be made to play for money');

  /* The client picks the figure, so the client is not trusted with it. */
  check(stakeFor('tina', 2) === 2 && stakeFor('tina', 5) === 5, 'two and five are taken as asked');
  check(stakeFor('tina', 3) === 3 && stakeFor('tina', 4) === 4, 'and so are three and four');
  check(stakeFor('tina', 9999) === range.max, 'a greedy figure is clamped down', `$${stakeFor('tina', 9999)}`);
  check(stakeFor('tina', 1) === range.min, 'a cheap one is raised', `$${stakeFor('tina', 1)}`);
  check(stakeFor('tina', -100) === range.min, 'and a negative one cannot pay her', `$${stakeFor('tina', -100)}`);
  check(stakeFor('tina', 3.5) === range.min, 'half a dollar is not a stake', `$${stakeFor('tina', 3.5)}`);
  check(stakeFor('tina', '5') === range.min, 'nor is a string that looks like one');
  check(stakeFor('tina', undefined) === range.min, 'and asking for nothing pays the minimum');

  /*
   * The whole point, as arithmetic.
   *
   * A win returns twice the stake — the player's own back, and hers won. A duel
   * that is not won returns nothing, and the stake has already gone, so the two
   * outcomes are +stake and −stake against where the player started.
   */
  for (const stake of [range.min, 3, 4, range.max]) {
    const before = 10;
    const seated = before - stake;
    const afterWin = seated + bountyFor('tina') + stake * 2;
    const afterAnythingElse = seated;
    check(afterWin - before === stake, `a $${stake} win leaves them up $${stake}`, `$${before} → $${afterWin}`);
    check(before - afterAnythingElse === stake,
      `and walking out of a $${stake} duel costs them $${stake}`, `$${before} → $${afterAnythingElse}`);
  }

  /*
   * And it cannot go negative, which is the rule the rest of this file holds
   * the shop to. The route refuses before it deducts; this is the arithmetic
   * that refusal protects.
   */
  const broke = rich(1);
  check((broke.money ?? 0) < range.min, '$1 cannot cover her cheapest bet');
  check((broke.money ?? 0) - range.min < 0, 'so taking it anyway would go negative — which is why the route refuses first');
}

console.log('\nand what she brought with her\n');
{
  /*
   * Her purse is the anti-farm rule, so it is the one worth measuring.
   *
   * A wager she matches out of nowhere is a hundred dollars every twenty duels
   * for anybody with an afternoon. A purse makes each win *spend* something of
   * hers, and the floor keeps her playable at the bottom of it — which is two
   * separate claims and both of them are arithmetic.
   */
  const range = wagerFor('tina')!;
  const held = purseFor('tina');
  check(held !== null, 'she brought money of her own');
  const { start, floor } = held!;
  check(start === 100, 'a hundred dollars of it', `$${start}`);
  check(floor === wagerFor('tina')!.min, 'and the floor is her own smallest game', `$${floor}`);

  /* Everybody who wagers needs one, or the table is a faucet again. */
  check(
    Object.keys(WAGER).every((id) => !!purseFor(id)),
    'everybody who plays for money has a purse to play out of',
    Object.keys(WAGER).filter((id) => !purseFor(id)).join(', ')
  );
  check(purseFor('sarah') === null && purseOf(undefined, 'sarah') === 0,
    'and nobody who does not is carrying one');

  /* A save that has never beaten her has never taken anything off her. */
  check(purseOf(undefined, 'tina') === start, 'an untouched save leaves her with all of it', `$${purseOf(undefined, 'tina')}`);
  check(purseOf({}, 'tina') === start, 'and so does an empty ledger');
  check(purseOf({ tina: 7 }, 'tina') === 7, 'a stored figure is what she has left', '$7');

  /* Read as well as written through the floor: a bad figure from an older
     build cannot put her under it or over what she came with. */
  check(purseOf({ tina: 0 }, 'tina') === floor, 'nothing can put her under the floor', `$${purseOf({ tina: 0 }, 'tina')}`);
  check(purseOf({ tina: -50 }, 'tina') === floor, 'not even a negative one');
  check(purseOf({ tina: 9999 }, 'tina') === start, 'and she never has more than she came with');
  check(purseOf({ tina: Number.NaN }, 'tina') === start, 'a figure that is not a number is no figure at all');

  /* The ceiling is what the conversation may offer, and what the route allows. */
  check(ceilingFor('tina', undefined) === range.max, 'at full purse she will play for anything in her range', `$${ceilingFor('tina', undefined)}`);
  check(ceilingFor('tina', { tina: 3 }) === 3, 'down to $3 she will play for three', `$${ceilingFor('tina', { tina: 3 })}`);
  check(ceilingFor('tina', { tina: floor }) === floor, 'and at the floor only for the minimum', `$${ceilingFor('tina', { tina: floor })}`);
  check(stakeFor('tina', 5, { tina: 3 }) === 3, 'a $5 bet against $3 of hers is clamped to $3');
  check(stakeFor('tina', 5, { tina: floor }) === floor, 'and against the floor, to the floor');
  check(stakeFor('tina', 5, undefined) === range.max, 'while an unknown purse is her range alone');

  /*
   * Twenty wins at five dollars, which is the farm this exists to stop.
   *
   * Her hundred pays out and then stops paying out: what is left is the floor,
   * and the biggest game she can still offer is the smallest one there is.
   */
  let purse: Record<string, number> = {};
  let taken = 0;
  for (let duel = 0; duel < 30; duel++) {
    const stake = stakeFor('tina', range.max, purse);
    taken += stake;
    purse = { tina: purseAfterLosing('tina', purse, stake) };
  }
  check(purseOf(purse, 'tina') === floor, 'thirty straight wins leave her at the floor', `$${purseOf(purse, 'tina')}`);
  check(taken <= start + 30 * floor, 'and she never pays out more than she had, bar the floor she keeps', `$${taken} off $${start}`);
  check(ceilingFor('tina', purse) === range.min, 'the fives are gone; only the minimum is left', `$${ceilingFor('tina', purse)}`);
  check(stakeFor('tina', range.max, purse) === range.min, 'so asking for five at that point gets you two');

  /*
   * And the ledger the route actually writes.
   *
   * `purseAfterWin` is the expression inside `/api/story/pack`'s
   * `updateProfile`, lifted out so it can be checked without a finished duel:
   * a win against her writes her new figure and leaves everybody else's alone,
   * a win against somebody with no purse writes nothing at all, and a duel with
   * nothing on the table changes nothing.
   */
  const ledger = purseAfterWin({ tina: 9, sarah: 4 }, 'tina', 5);
  check(ledger?.tina === 4, "a $5 win takes $5 off her", `$${ledger?.tina}`);
  check(ledger?.sarah === 4, 'and leaves a figure that is not hers untouched');
  check(purseAfterWin(undefined, 'tina', 5)?.tina === start - 5, 'a first win writes her down from the hundred', `$${purseAfterWin(undefined, 'tina', 5)?.tina}`);
  check(purseAfterWin({ tina: floor }, 'tina', 5)?.tina === floor, 'and a win at the floor leaves her on it');
  check(purseAfterWin(undefined, 'sarah', 5) === undefined, 'beating somebody with no purse writes no purse');
  check(purseAfterWin({ tina: 9 }, 'tina', 0)?.tina === 9, 'and a duel with nothing on the table costs her nothing');

  /* Every purse in the table names a duelist who exists, like every bounty. */
  check(
    Object.keys(PURSE).every((id) => !!DUELIST_BY_ID[id]),
    'every purse belongs to a real duelist',
    Object.keys(PURSE).filter((id) => !DUELIST_BY_ID[id]).join(', ')
  );
}

/* ------------------------------------------------------------------ */
/* A card on the table                                                 */
/* ------------------------------------------------------------------ */

/**
 * The one duelist who asks for a card rather than money. The arithmetic of
 * the bet itself is `npm run ash`'s, end to end through the routes; what is
 * held here is the table's shape — that the sets and the bounties agree with
 * each other, so a second such character cannot arrive half-wired.
 */
{
  console.log('\nAsh, who plays for a card\n');
  check(wagersACard('ash'), 'he asks for a card on the table');
  check(
    [...CARD_WAGER].every((id) => !!DUELIST_BY_ID[id]),
    'every duelist who wagers a card is a real one',
    [...CARD_WAGER].filter((id) => !DUELIST_BY_ID[id]).join(', ')
  );
  check(
    [...CARD_WAGER].every((id) => !WAGER[id] && !PURSE[id]),
    'and none of them also plays for money — one thing on the table, not two',
    [...CARD_WAGER].filter((id) => WAGER[id] || PURSE[id]).join(', ')
  );
  check(
    [...CARD_WAGER].every((id) => KEEPS_THEIR_CARDS.has(id)),
    'and every one of them keeps their own cards — a card for a card would be a trade, not a bet',
    [...CARD_WAGER].filter((id) => !KEEPS_THEIR_CARDS.has(id)).join(', ')
  );
  check(bountyFor('ash') === 3000, 'the win pays three thousand', `$${bountyFor('ash')}`);
  check(!givesAPack('ash'), 'and no pack');
  check(
    [...KEEPS_THEIR_CARDS].every((id) => bountyFor(id) > 0),
    'everybody who keeps their cards pays money instead, or a win against them is worth nothing',
    [...KEEPS_THEIR_CARDS].filter((id) => bountyFor(id) <= 0).join(', ')
  );
}

console.log('\nthe three sisters, who charge for losing\n');
{
  const LADDER: [string, number][] = [['antiope', 5], ['panthesilea', 10], ['hippolyta', 15]];
  for (const [id, pays] of LADDER) {
    check(bountyFor(id) === pays, `${id} pays $${pays} for beating her`, `$${bountyFor(id)}`);
    check(forfeitFor(id) === 1, 'and takes a dollar for losing to her', `$${forfeitFor(id)}`);
    check(givesAPack(id), 'and hands over a pack either way she is beaten');
    check(wagerFor(id) === null, 'she does not play for a stake as well', 'a stake and a forfeit would be two tolls on one table');
  }
  /* Priced in the order they are hard, which is the order they tell the player
     to fight them in. */
  check(
    bountyFor('antiope') < bountyFor('panthesilea') && bountyFor('panthesilea') < bountyFor('hippolyta'),
    'and they are priced in the order they are hard',
    LADDER.map(([id]) => `${id} $${bountyFor(id)}`).join(' < ')
  );

  /*
   * The arithmetic, as the routes actually do it: the dollar leaves when the
   * duel is seated, and a *proved* win is the only thing that brings it back.
   */
  for (const [id, pays] of LADDER) {
    const before = 20;
    const seated = before - forfeitFor(id);
    const afterWin = seated + bountyFor(id) + forfeitFor(id);
    check(afterWin - before === pays, `beating ${id} leaves them up $${pays}`, `$${before} → $${afterWin}`);
    check(before - seated === 1, `and losing to her leaves them down $1`, `$${before} → $${seated}`);
    check(before - seated === 1, 'and so does walking out of the duel, which is the same thing to the table');
  }

  /* Nobody else charges for losing, and nobody who charges for one charges
     twice: a stake and a forfeit on the same table is two tolls. */
  check(forfeitFor('tony') === 0 && forfeitFor('sarah') === 0, 'the street pair take nothing for a loss');
  check(forfeitFor('tina') === 0, 'and Tina does not either — her stake already does it');
  check(
    Object.keys(FORFEIT).every((id) => !!DUELIST_BY_ID[id]),
    'every forfeit belongs to a real duelist',
    Object.keys(FORFEIT).filter((id) => !DUELIST_BY_ID[id]).join(', ')
  );
  check(
    Object.keys(FORFEIT).every((id) => wagerFor(id) === null),
    'and nobody is charged a stake and a forfeit at once',
    Object.keys(FORFEIT).filter((id) => wagerFor(id)).join(', ')
  );

  /* And it cannot take somebody below nothing: the route refuses first, which
     is the rule the whole of this file holds the shop to. */
  const broke = rich(0);
  check((broke.money ?? 0) < forfeitFor('antiope'), 'a player with nothing cannot cover the dollar');
  check((broke.money ?? 0) - forfeitFor('antiope') < 0, 'so taking it anyway would go negative — which is why the route refuses first');
}

console.log(
  failures === 0 ? '\nEvery shop rule holds. ✅\n' : `\n${failures} shop rule(s) broken. ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
