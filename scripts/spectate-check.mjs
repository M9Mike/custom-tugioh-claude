/**
 * Can you watch the computers duel — and stop them mid-swing?
 *
 *   node scripts/spectate-check.mjs [baseUrl]
 *
 * Walks the real path: home page → "Watch the computers duel" → pick both
 * seats → the exhibition board. Then it asserts the four things that make the
 * mode the mode, from the outside, the way a person would see them:
 *
 *   1. The duel advances with no interaction at all — the audience nudges,
 *      the computers play, the board narrates.
 *   2. Pause freezes it. On a serverless room nothing moves unless a client
 *      asks, so the whole check is that the page's text stops changing —
 *      including the declaration band, which never stays still on a live
 *      board. An in-flight think can land after the tap, so the freeze is
 *      only measured after a settling wait.
 *   3. Resume picks the duel straight back up.
 *   4. The audience is never a player: no End Turn button ever exists, a
 *      trap window is never offered to the room ("Do nothing" showing to a
 *      spectator means the response gate is broken), and tapping a hand card
 *      reads it instead of opening an action sheet.
 *
 * Plus the front-row privileges: the top hand is face-up (tapping one shows a
 * real card, not a card back), and the end names the winner — "Kaiba wins",
 * never "Defeat", because the audience has no side to lose. "Run it back"
 * must then start a second duel that narrates.
 */
import { webkit, devices } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');

const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 11'] });
const page = await ctx.newPage();
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 300)));

let failures = 0;
const ok = (pass, label, detail = '') => {
  console.log(`  ${pass ? '✅' : '❌'} ${label}${!pass && detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
};

/* ---- through the front door ---- */
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
const watchBtn = page.getByRole('button', { name: /watch the computers duel/i }).first();
await watchBtn.waitFor({ timeout: 20000 });
/* The home page's buttons stay disabled until hydration has landed — by
   design, because a tap before then is gone rather than queued. Ten seconds
   of that is plenty against localhost and has not been enough against a cold
   production start: the click then times out after thirty seconds on a
   disabled button, and the probe dies on a stack trace that reads as the
   exhibition being broken when the page had simply not woken up yet. Wait
   longer, and if it never wakes say *that* instead of asserting anything. */
let awake = false;
for (let i = 0; i < 160 && !awake; i++) {
  awake = await watchBtn.isEnabled().catch(() => false);
  if (!awake) await page.waitForTimeout(250);
}
if (!awake) {
  console.log('⚠️  the home page never finished hydrating — this proves nothing about spectating');
  await browser.close();
  process.exit(1);
}
await watchBtn.click();

await page.getByText('Choose the first duelist').waitFor({ timeout: 10000 });
await page.getByRole('button', { name: /Yugi Muto/ }).first().click();
await page.getByRole('button', { name: /takes the field/i }).first().click();

await page.getByText('Choose the challenger').waitFor({ timeout: 10000 });
await page.getByRole('button', { name: /Seto Kaiba/ }).first().click();
await page.getByRole('button', { name: /^Watch / }).first().click();

await page.waitForURL(/\/duel\//, { timeout: 20000 });
await page.waitForSelector('[data-testid="hand-strip"]', { timeout: 30000 }).catch(async () => {
  const seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200));
  throw new Error(`never reached the exhibition board. On screen: ${seen}`);
});
console.log('• watching from the front row');

/** Everything a frozen board cannot change: the page's own words. */
const fingerprint = () =>
  page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim()).catch(() => null);

const winHeading = () =>
  page
    .getByText(/^(.+ wins|Draw)$/)
    .first()
    .isVisible({ timeout: 300 })
    .catch(() => false);

/** Collects declarations while insisting the audience is never asked to play. */
const bag = new Set();
let offeredATurn = false;
let offeredAWindow = false;
async function sample() {
  const t = await page
    .evaluate(() => document.querySelector('[data-testid="declaration"]')?.innerText ?? null)
    .catch(() => null);
  if (t) bag.add(t.replace(/\s+/g, ' ').trim());
  if ((await page.getByRole('button', { name: /^end turn$/i }).count().catch(() => 0)) > 0) offeredATurn = true;
  if (await page.getByRole('button', { name: /^do nothing$/i }).isVisible({ timeout: 50 }).catch(() => false))
    offeredAWindow = true;
}

/* ---- 1. it plays itself ---- */
for (let i = 0; i < 240 && bag.size < 6; i++) {
  await sample();
  await page.waitForTimeout(400);
}
ok(bag.size >= 6, `the duel narrates with nobody playing (${bag.size} declarations)`);

/* ---- 4a. the audience reads cards rather than playing them ---- */
{
  const hand = page.locator('[data-testid="hand-card"]').first();
  if (await hand.isVisible({ timeout: 2000 }).catch(() => false)) {
    await hand.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
    const sheet = await page.getByRole('button', { name: /summon|set/i }).first().isVisible({ timeout: 300 }).catch(() => false);
    ok(!sheet, 'tapping a hand card opens no action sheet');
    // Whatever opened, close it by tapping the scrim.
    await page.mouse.click(10, 300);
    await page.waitForTimeout(300);
  } else {
    ok(true, 'hand empty when sampled — sheet check skipped');
  }
}

/* ---- 4b. the top hand is face-up for the audience ---- */
{
  const foeCard = page.locator('[data-testid="foe-hand"] > div').first();
  if (await foeCard.isVisible({ timeout: 2000 }).catch(() => false)) {
    await foeCard.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(500);
    const modal = await page.evaluate(() => document.body.innerText);
    ok(!/face-?down card/i.test(modal), "the opponent's hand is open to the audience");
    await page.mouse.click(10, 300);
    await page.waitForTimeout(300);
  } else {
    ok(true, 'their hand empty when sampled — face-up check skipped');
  }
}

/* ---- 2. pause freezes the board ---- */
const pauseBtn = page.locator('[data-testid="pause-toggle"]');
ok(await pauseBtn.isVisible({ timeout: 2000 }).catch(() => false), 'the pause button is there');
await pauseBtn.click().catch(() => {});
/* Settle: one think may already be in flight, and its beat still narrates. */
await page.waitForTimeout(9000);
const before = await fingerprint();
await page.waitForTimeout(8000);
const after = await fingerprint();
const frozen = !!before && before === after;
ok(frozen, 'paused: eight seconds pass and not a word on the board changes');
if (!frozen && before && after) {
  const at = [...before].findIndex((ch, i) => after[i] !== ch);
  console.log(`     differs near: "…${(after ?? '').slice(Math.max(0, at - 40), at + 40)}…"`);
}

/* ---- 3. resume picks it back up ---- */
await pauseBtn.click().catch(() => {});
let moved = false;
for (let i = 0; i < 120 && !moved; i++) {
  await page.waitForTimeout(500);
  const now = await fingerprint();
  moved = !!now && now !== after;
}
ok(moved, 'resumed: the duel carries on');

/* ---- to the death, then run it back ---- */
/* Sized for 8000 Life Points on production: a narrated AI-vs-AI exhibition
   over Paris latency runs well past the ~6 minutes that fit a 4000-LP duel —
   this window failed on production the day the pool doubled, with the duel
   alive and narrating at the cutoff. Watching longer is half the fix; the
   other half is telling a SLOW duel apart from a STALLED one, because "the
   duel never ends" is the win-screen-stall class of bug and must stay red.
   Beats still arriving near the cutoff mean the probe ran out of patience,
   not that the game ran out of duel — inconclusive, said out loud. */
let ended = false;
let lastBeatAt = Date.now();
let lastBagSize = bag.size;
for (let i = 0; i < 1600 && !ended; i++) {
  await sample();
  if (bag.size > lastBagSize) {
    lastBagSize = bag.size;
    lastBeatAt = Date.now();
  }
  ended = await winHeading();
  if (!ended) await page.waitForTimeout(500);
}
const aliveAtCutoff = Date.now() - lastBeatAt < 90_000;
if (!ended && aliveAtCutoff) {
  console.log('  ⚠️  the duel was still narrating when the watch window closed — this proves nothing about the ending');
  await browser.close();
  process.exit(1);
}
ok(ended, 'the duel ends while the audience only watches');
ok(!offeredATurn, 'no End Turn button ever existed for the audience');
ok(!offeredAWindow, 'no trap window was ever offered to the audience');
if (ended) {
  const heading = await page.getByText(/^(.+ wins|Draw)$/).first().innerText().catch(() => '');
  ok(!/victory|defeat/i.test(heading), `the end names the duelist, not a side ("${heading}")`);
  const runBack = page.getByRole('button', { name: /run it back/i }).first();
  ok(await runBack.isVisible({ timeout: 2000 }).catch(() => false), 'the audience is offered "Run it back"');
  await runBack.click().catch(() => {});
  await page.waitForTimeout(2500);
  const again = new Set();
  for (let i = 0; i < 150 && again.size < 3; i++) {
    const t = await page
      .evaluate(() => document.querySelector('[data-testid="declaration"]')?.innerText ?? null)
      .catch(() => null);
    if (t) again.add(t.replace(/\s+/g, ' ').trim());
    await page.waitForTimeout(400);
  }
  ok(again.size >= 3, `the second showing narrates too (${again.size} declarations)`);
}

await browser.close();
if (failures) {
  console.log(`\n❌ ${failures} spectate check(s) failed`);
  process.exit(1);
}
console.log('\n✅ the exhibition plays, pauses, resumes and runs back.');
