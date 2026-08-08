/**
 * A duel must survive losing a request.
 *
 *   npm run nudge [http://localhost:3100]
 *
 * Nothing moves on a serverless room unless a client asks it to. The computer's
 * turn is driven by the board: it POSTs `/ai`, the server plays one action and
 * hands back a new view, and it is that new view — a new object in React state —
 * which re-runs the effect and asks for the next one. The whole turn is a chain
 * of requests, each link forged by the reply to the one before it.
 *
 * So a single lost reply broke the chain for good. The board did not apply a
 * view it had not received, the room's revision therefore never moved, the poll
 * loop saw `unchanged` and returned no view of its own, and with no new view
 * nothing re-ran the effect. The duel stopped exactly where it stood — with the
 * poll loop still succeeding, so the connection went on reporting itself live
 * while the Life Points sat still. Reported as an exhibition frozen for ten
 * minutes on production, and it would have been frozen for ever.
 *
 * It never reproduced locally because a fetch to your own machine does not fail.
 * This drops the requests on purpose, which is the only honest way to test a
 * recovery path: break the thing that breaks in the wild, then insist the duel
 * still finishes.
 */
import { webkit } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const DROPS = Number(process.argv[3] ?? 3);
const PATIENCE = 60_000;

let bad = 0;
const ok = (cond, what, detail = '') => {
  if (!cond) bad += 1;
  console.log(`  ${cond ? '✅' : '❌'} ${what}${cond || !detail ? '' : ` — ${detail}`}`);
};

/* A dead renderer is not a failed assertion. */
const isDead = (e) => /crash|Target (page|closed)|has been closed|Execution context/i.test(String(e?.message ?? e));

/* The menu button is disabled until the page has hydrated and the name is in.
   Clicking a disabled button is a harness failure that reads like a product
   one, so wait for it to actually be live — same helper as winscreen-check. */
async function clickWhenAwake(page, name) {
  const b = page.getByRole('button', { name });
  await b.waitFor({ state: 'visible', timeout: PATIENCE });
  await page.waitForFunction(
    (n) => [...document.querySelectorAll('button')].some((el) => new RegExp(n, 'i').test(el.textContent ?? '') && !el.disabled),
    typeof name === 'string' ? name : name.source,
    { timeout: PATIENCE }
  );
  await b.click({ timeout: PATIENCE });
}

const run = async () => {
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 414, height: 896 } });
  let dropped = 0;
  let allowed = 0;

  try {
    /* Drop the first few nudges outright, the way a flaky network does: the
       request never reaches the server, so nothing moves and no reply comes
       back. Everything after is let through, so a board that recovers finishes
       the duel and a board that does not sits still for ever. */
    await page.route('**/api/room/**/ai', async (route) => {
      if (dropped < DROPS) {
        dropped += 1;
        await route.abort('connectionfailed');
        return;
      }
      allowed += 1;
      await route.continue();
    });

    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: PATIENCE });
    await page.fill('input', 'Prober');
    await clickWhenAwake(page, 'Watch the computers duel');
    await page.getByText('Choose the first duelist').waitFor({ timeout: PATIENCE });
    await page.getByRole('button', { name: /Yugi Muto/ }).first().click({ timeout: PATIENCE });
    await page.getByRole('button', { name: /takes the field/i }).first().click({ timeout: PATIENCE });
    await page.getByText('Choose the challenger').waitFor({ timeout: PATIENCE });
    await page.getByRole('button', { name: /Seto Kaiba/ }).first().click({ timeout: PATIENCE });
    await page.getByRole('button', { name: /^Watch / }).first().click({ timeout: PATIENCE });
    await page.waitForURL(/\/duel\//, { timeout: PATIENCE });
    await page.waitForSelector('[data-testid="hand-strip"]', { timeout: PATIENCE });

    /* Watching the turn counter rather than the result, so a freeze is reported
       as a freeze — "stopped on turn 3 for 90s" — rather than as a timeout with
       nothing to say about where it stopped. */
    const readTurn = () =>
      page.evaluate(() => {
        /* Off the banner the player reads, rather than a testid added only for
           this probe — the board already prints "Turn 4 · Battle". */
        const m = /Turn (\d+) ·/.exec(document.body.textContent ?? '');
        return {
          turn: m ? Number(m[1]) : -1,
          won: !!document.querySelector('[data-testid=win-screen]'),
          lps: [...document.querySelectorAll('[data-testid=lp]')].map((n) => Number(n.textContent)),
        };
      });

    const deadline = Date.now() + 5 * 60_000;
    let last = await readTurn();
    let lastMovedAt = Date.now();
    let stalledFor = 0;
    let now = last;

    while (Date.now() < deadline) {
      await page.waitForTimeout(1000);
      now = await readTurn();
      if (now.won) break;
      const moved = now.turn !== last.turn || now.lps.join() !== last.lps.join();
      if (moved) {
        lastMovedAt = Date.now();
        last = now;
      }
      stalledFor = Date.now() - lastMovedAt;
      /* 45s with nothing moving is not slow, it is stopped: the computer takes
         one action every 750ms plus its think, and the longest search is 4s. */
      if (stalledFor > 45_000) break;
    }

    console.log(`\n  ${dropped} nudge(s) dropped, ${allowed} let through`);
    ok(dropped === DROPS, `all ${DROPS} nudges were actually dropped`, `dropped ${dropped}`);
    ok(
      stalledFor <= 45_000,
      'the duel kept moving after the dropped nudges',
      `frozen ${Math.round(stalledFor / 1000)}s on turn ${now.turn}, LP ${now.lps.join(' / ')}`
    );
    ok(now.won, 'and played through to a result', now.won ? '' : `stopped on turn ${now.turn}`);
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

  console.log(bad ? `\n${bad} problem(s)` : '\nA dropped nudge does not freeze the duel. ✅');
  process.exitCode = bad ? 1 : 0;
};

run().catch((e) => {
  console.log(`\n❌ the probe never got far enough to look — this proves nothing\n${e.stack}`);
  process.exit(2);
});
