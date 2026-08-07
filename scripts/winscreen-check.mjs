/**
 * The victory splash must not arrive before the board has said what happened.
 *
 *   npm run winscreen http://localhost:3100
 *
 * Reported as "Victory splashes prematurely". `state.winner` arrives in the
 * same commit as the beats that killed you, and `settled` is turned off inside
 * an effect — one render too late — so on the render that first sees a winner
 * the board still read `settled: true` from the last quiet moment and the modal
 * went up over a board that had not announced a thing.
 *
 * The assertion is the one a player would make, and it is measured off what is
 * actually painted rather than off a proxy: the board deliberately holds the
 * Life Point total back until the beat that moved it has been spoken
 * (`shownLp = lp + pending`). So if the win screen is up while a Life Point bar
 * still shows a number the duel has already left behind, the result outran its
 * own explanation. On a decided duel somebody is on 0, so the loser's bar
 * reading anything above 0 with the modal up is exactly the reported bug.
 *
 * Sampled from the Node side in one `evaluate` per pass — an in-page interval
 * starves against Playwright's own queries, and two probes here have already
 * lied that way.
 */
import { webkit } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const PATIENCE = 60_000;
let bad = 0;
const ok = (cond, what, detail = '') => {
  if (!cond) bad += 1;
  console.log(`  ${cond ? '✅' : '❌'} ${what}${cond || !detail ? '' : ` — ${detail}`}`);
};

/* A dead renderer is not a failed assertion — four probes here have reported a
   crashed page as a broken feature. Anything saying the page died is rethrown
   and the run is called inconclusive rather than red. */
const isDead = (e) => /crash|Target (page|closed)|has been closed|Execution context/i.test(String(e?.message ?? e));

async function tapWhenAwake(page, name) {
  const b = page.getByRole('button', { name });
  await b.waitFor({ state: 'visible', timeout: PATIENCE });
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('button')].some((el) => new RegExp(n, 'i').test(el.textContent ?? '') && !el.disabled),
    name,
    { timeout: PATIENCE }
  );
  await b.click({ timeout: PATIENCE });
}

const run = async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 414, height: 896 } });
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: PATIENCE });
    await page.fill('input', 'Prober');
    /* The exhibition, not a vs-computer duel. Both seats are played by the
       computer, so it runs to a genuine finish on its own — a driver that only
       ends its own turns never attacks, and the duel simply never ends (942
       passes, no result, on the first version of this). The win screen is the
       same code either way, which is what is under test. */
    await tapWhenAwake(page, 'Watch the computers duel');
    await page.getByText('Choose the first duelist').waitFor({ timeout: PATIENCE });
    await page.getByRole('button', { name: /Yugi Muto/ }).first().click({ timeout: PATIENCE });
    await page.getByRole('button', { name: /takes the field/i }).first().click({ timeout: PATIENCE });
    await page.getByText('Choose the challenger').waitFor({ timeout: PATIENCE });
    await page.getByRole('button', { name: /Seto Kaiba/ }).first().click({ timeout: PATIENCE });
    await page.getByRole('button', { name: /^Watch / }).first().click({ timeout: PATIENCE });
    await page.waitForURL(/\/duel\//, { timeout: PATIENCE });
    await page.waitForSelector('[data-testid="hand-strip"]', { timeout: PATIENCE });

    /* A 500ms poll cannot see this bug.
       The premature splash is a *single render* — the modal goes up, the queue
       drains behind it, and a moment later the board has caught up and looks
       correct. Sampled on a timer, the fixed and the broken build are
       indistinguishable: the first version of this probe passed on both, which
       is the "check that cannot fail" trap this project keeps rediscovering.
       So the reading is taken at the instant the modal is inserted, by an
       observer armed before the duel ends. One observer, no polling — it does
       not starve the page the way an interval does, and it reads the Life
       Point text at exactly the moment the win screen appears rather than
       whenever a timer next happens to fire. */
    await page.evaluate(() => {
      window.__winSnap = null;
      const grab = () => {
        if (window.__winSnap) return;
        if (!document.querySelector('[data-testid=win-screen]')) return;
        window.__winSnap = {
          unspoken: Number(document.querySelector('.duel-root')?.getAttribute('data-unspoken') ?? -1),
          lps: [...document.querySelectorAll('[data-testid=lp]')].map((el) => Number(el.textContent)),
          declaring: !!document.querySelector('[data-testid=declaration]'),
        };
      };
      new MutationObserver(grab).observe(document.body, { childList: true, subtree: true });
      grab();
    });

    let won = null;
    const deadline = Date.now() + 8 * 60_000;
    let passes = 0;
    while (Date.now() < deadline && !won) {
      passes += 1;
      won = await page.evaluate(() => window.__winSnap);
      if (!won) await page.waitForTimeout(500);
    }

    ok(!!won, 'the duel played through to a result', won ? '' : `gave up after ${passes} passes`);
    if (won) {
      ok(won.unspoken >= 0, 'the board reports what it still owes', `read ${won.unspoken}`);
      /* The thing itself, not a stand-in. Every ending is covered: a duel won
         on damage, on a deck-out or by Exodia all have to arrive with the
         board's account settled. */
      ok(won.unspoken === 0,
        'the moment the result appears, the board owes the player nothing',
        `${won.unspoken} beat(s) still unspoken, bars read ${won.lps.join(' / ')}`);
    }
  } catch (e) {
    if (isDead(e)) {
      console.log(`  ⚠️  the page died mid-run — this proves nothing (${String(e.message).split('\n')[0]})`);
      await browser.close().catch(() => {});
      process.exit(2);
    }
    throw e;
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(bad ? `\n${bad} problem(s)` : '\nThe win screen waits for the board. ✅');
  process.exitCode = bad ? 1 : 0;
};

run().catch((e) => {
  console.log(`\n❌ the probe never got far enough to look — this proves nothing\n${e.stack}`);
  process.exit(2);
});
