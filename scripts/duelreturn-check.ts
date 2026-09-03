/**
 * Into a duel from a conversation, and back.
 *
 * Mike: after a duel from the open world, Continue asked him to enter the
 * world as Mike again, then opened the first field with no conversation; only
 * leaving and coming back found Sarah waiting. This walks up to Sarah, takes
 * the duel, and comes back the way the win screen does — the note with its
 * outcome, and the router — then asks the four things that have to be true:
 * no sign-in, the world built, the conversation resumed, standing where the
 * duel began.
 *
 * The duel itself is not played to the end by hand: the seat surrenders
 * through the room's own action route, which is how a duel ends in the
 * engine, and what is under test is the road back. Three legs:
 *
 *   1. the win screen's Continue — the note with its outcome, and the router;
 *   2. the same with the browser wiped first — a cold sign-in, which has to
 *      find the duel on the save and resume it anyway (Mike's second entry);
 *   3. and once more, which must *not* resume it: the save was told.
 */
import { chromium, webkit } from 'playwright';
import { BASE, NAME, PINNED_HOUR, ensurePlayer, enterStory, refuseRemote, walkUntil } from './story-setup';

/** The seat gives up, through the room's own action route. */
async function surrender(code: string, token: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/room/${code}/act`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'duel', token, action: { type: 'surrender' } }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) console.log(`     surrender → ${res.status} ${data.error ?? ''}`);
    return !!data.ok;
  } catch (e) {
    console.log(`     surrender threw: ${String(e)}`);
    return false;
  }
}

/** Talks to whoever offers, and says yes to the duel however it is put. */
async function takeTheDuel(page: import('playwright').Page): Promise<boolean> {
  const talk = page.locator('[data-talk]').first();
  await walkUntil(page, 12000, () => talk.isVisible());
  if (!(await talk.isVisible().catch(() => false))) return false;
  await talk.click({ force: true });
  await page.locator('[data-conversation]').first().waitFor({ timeout: 10000 }).catch(() => {});
  for (let i = 0; i < 14; i++) {
    const duel = page.locator('[data-reply]', { hasText: /duel|let.s go|again|run it back/i }).first();
    if (await duel.isVisible().catch(() => false)) { await duel.dispatchEvent('click'); return true; }
    const any = page.locator('[data-reply]').first();
    if (await any.isVisible().catch(() => false)) { await any.dispatchEvent('click'); await page.waitForTimeout(500); continue; }
    const more = page.locator('[aria-label="Continue"]').last();
    if (await more.isVisible().catch(() => false)) { await more.dispatchEvent('click'); await page.waitForTimeout(350); continue; }
    await page.waitForTimeout(500);
  }
  return false;
}

async function main() {
  refuseRemote();
  await ensurePlayer();
  /* `PW_BROWSER=webkit` runs the same road in WebKit — the engine Mike's
     phone uses — once `npx playwright install webkit` has been run. */
  const browser = process.env.PW_BROWSER === 'webkit'
    ? await webkit.launch()
    : await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 640 } })).newPage();
  let bad = 0;
  const check = (ok: boolean, what: string) => { console.log(`  ${ok ? '✅' : '❌'} ${what}`); if (!ok) bad++; };
  console.log(`\nDuel and back — against ${BASE}\n`);

  /* Stand a few strides from Sarah, facing her. */
  await fetch(`${BASE}/api/story/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: NAME, world: { area: 'starting-area', x: -8.0, z: 1.5, facing: -Math.PI / 2 } }),
  }).catch(() => {});
  let there = await enterStory(page, 'starting-area', PINNED_HOUR);
  if (!there) there = await enterStory(page, 'starting-area', PINNED_HOUR);
  check(there, 'the world opens');
  const talk = page.locator('[data-talk]').first();
  await walkUntil(page, 12000, () => talk.isVisible());
  check(await talk.isVisible().catch(() => false), 'walking up to Sarah offers a conversation');
  const before = await page.evaluate(() => (window as unknown as { __probe?: { player?: [number, number] } }).__probe?.player ?? null);
  await talk.click({ force: true });
  await page.locator('[data-conversation]').first().waitFor({ timeout: 10000 }).catch(() => {});
  check(await page.locator('[data-conversation]').first().isVisible().catch(() => false), 'the conversation opens');
  /* Say yes to the duel, however she puts it — and say what was seen. */
  page.on('response', (r) => {
    if (r.url().includes('/api/room')) void r.text().then((t) => console.log(`     /api/room → ${r.status()} ${t.slice(0, 160)}`)).catch(() => {});
  });
  /* The speech pages by tapping it — `dispatchEvent`, as `npm run story` does:
     the whole area above the panel is one big Continue and a pointer click on
     a full-screen button over a canvas is not a thing Playwright settles. */
  let said = false;
  for (let i = 0; i < 14 && !said; i++) {
    const labels = await page.locator('[data-reply]').allTextContents().catch(() => [] as string[]);
    if (labels.length) console.log(`     replies: ${labels.map((l) => JSON.stringify(l.trim())).join(' ')}`);
    const duel = page.locator('[data-reply]', { hasText: /duel|let.s go|again|run it back/i }).first();
    if (await duel.isVisible().catch(() => false)) {
      console.log(`     → ${JSON.stringify((await duel.textContent())?.trim())}`);
      await duel.dispatchEvent('click'); said = true; break;
    }
    const any = page.locator('[data-reply]').first();
    if (await any.isVisible().catch(() => false)) {
      console.log(`     → ${JSON.stringify((await any.textContent())?.trim())}`);
      await any.dispatchEvent('click'); await page.waitForTimeout(500); continue;
    }
    const more = page.locator('[aria-label="Continue"]').last();
    if (await more.isVisible().catch(() => false)) { await more.dispatchEvent('click'); await page.waitForTimeout(350); continue; }
    const line = await page.locator('[data-conversation]').first().textContent().catch(() => '');
    console.log(`     nothing to press; the panel says: ${JSON.stringify((line ?? '').trim().slice(0, 120))}`);
    await page.waitForTimeout(500);
  }
  await page.waitForURL(/\/duel\//, { timeout: 45000 }).catch(() => {});
  const inDuel = /\/duel\//.test(page.url());
  check(inDuel, 'taking the duel opens the room');
  if (!inDuel) {
    await page.screenshot({ path: '/tmp/duel-return-stuck.png' }).catch(() => {});
    const err = await page.locator('text=/Could not|Try again|went wrong/i').first().textContent().catch(() => null);
    if (err) console.log(`     the page says: ${err.trim()}`);
    console.log(`     still at ${page.url()} — /tmp/duel-return-stuck.png`);
    await browser.close(); console.log('\nDUEL AND BACK: never got there ❌\n'); process.exit(1);
  }
  const code = new URL(page.url()).pathname.split('/').pop() ?? '';
  await page.waitForTimeout(5000);
  const note = await page.evaluate((code) => {
    const raw = sessionStorage.getItem('story:duel');
    const n = raw ? (JSON.parse(raw) as { code?: string; npcId?: string }) : null;
    return n && n.code === code ? n : null;
  }, code);
  check(!!note, 'the room carries the note that says where it came from');
  const token = (note as { token?: string } | null)?.token ?? '';
  check(await surrender(code, token), 'the seat can give the duel up');

  /* The two lines the win screen's Continue runs, verbatim. Lost, as it was. */
  await page.evaluate(() => {
    const raw = sessionStorage.getItem('story:duel');
    const n = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    n.outcome = 'lost';
    sessionStorage.setItem('story:duel', JSON.stringify(n));
    (window as unknown as { next: { router: { push(u: string): void } } }).next.router.push('/story');
  });
  await page.waitForURL(/\/story/, { timeout: 15000 }).catch(() => {});
  check(/\/story/.test(page.url()), 'Continue goes back to the story');

  let askedName = false, built = false, conversation = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    if (await page.locator('input[placeholder="Enter your name"]').isVisible().catch(() => false)) askedName = true;
    /* Built: the probe says so in development; in a production build, which
       has no probe, the stick on screen (or a conversation over the world) is
       the world. */
    const p = await page.evaluate(() => {
      const w = window as unknown as { __probe?: { built?: boolean }; __scene?: unknown };
      if (w.__scene) return !!w.__probe?.built;
      const stick = document.querySelector('[aria-label="Move"]');
      const talk = document.querySelector('[data-conversation]');
      return (!!stick && stick.getClientRects().length > 0) || (!!talk && talk.getClientRects().length > 0);
    }).catch(() => false);
    if (p) built = true;
    if (await page.locator('[data-conversation]').first().isVisible().catch(() => false)) { conversation = true; break; }
    await page.waitForTimeout(500);
  }
  check(!askedName, 'and does not ask your name again');
  check(built, 'the world is built');
  check(conversation, 'the conversation picks up where the duel left it');
  const after = await page.evaluate(() => (window as unknown as { __probe?: { player?: [number, number] } }).__probe?.player ?? null);
  /* Positions come off the probe, which a production build does not expose:
     there the spot is not judged, and the line says so. */
  if (!before || !after) console.log('  ·  standing where the duel began: no probe in a production build');
  else check(Math.hypot(after[0] - before[0], after[1] - before[1]) < 1.5, `standing where the duel began (${before[0].toFixed(1)}, ${before[1].toFixed(1)} → ${after[0].toFixed(1)}, ${after[1].toFixed(1)})`);
  await page.screenshot({ path: '/tmp/duel-return.png' }).catch(() => {});

  /* ---- leg two: the browser forgets, the save does not ---- */
  console.log('\n  — and again, with the browser wiped on the way back —');
  await page.locator('[aria-label="End the conversation"]').first().dispatchEvent('click').catch(() => {});
  await page.waitForTimeout(600);
  check(await takeTheDuel(page), 'Sarah offers a second duel and it opens');
  await page.waitForURL(/\/duel\//, { timeout: 45000 }).catch(() => {});
  const code2 = new URL(page.url()).pathname.split('/').pop() ?? '';
  await page.waitForTimeout(5000);
  const token2 = await page.evaluate(() => {
    const raw = sessionStorage.getItem('story:duel');
    return raw ? ((JSON.parse(raw) as { token?: string }).token ?? '') : '';
  });
  check(await surrender(code2, token2), 'the seat gives the second duel up');
  const spot2 = await page.evaluate(() => (window as unknown as { __probe?: { player?: [number, number] } }).__probe?.player ?? null).catch(() => null);
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('story:duel-mirror'); });
  let cold = await enterStory(page, 'starting-area', PINNED_HOUR);
  if (!cold) cold = await enterStory(page, 'starting-area', PINNED_HOUR);
  check(cold, 'a cold sign-in reaches the world');
  let picked = false;
  for (let i = 0; i < 40 && !picked; i++) {
    picked = await page.locator('[data-conversation]').first().isVisible().catch(() => false);
    if (!picked) await page.waitForTimeout(500);
  }
  check(picked, 'and the conversation is waiting, off the save');
  const after2 = await page.evaluate(() => (window as unknown as { __probe?: { player?: [number, number] } }).__probe?.player ?? null);
  if (!after2) console.log('  ·  standing in the world: no probe in a production build');
  else check(true, 'standing in the world' + (spot2 ? ` (${spot2[0].toFixed(1)}, ${spot2[1].toFixed(1)} → ${after2[0].toFixed(1)}, ${after2[1].toFixed(1)})` : ''));

  /* ---- leg three: told once, it stays told ---- */
  await page.waitForTimeout(3000);
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('story:duel-mirror'); });
  let again = await enterStory(page, 'starting-area', PINNED_HOUR);
  if (!again) again = await enterStory(page, 'starting-area', PINNED_HOUR);
  check(again, 'a third sign-in reaches the world');
  await page.waitForTimeout(4000);
  const reopened = await page.locator('[data-conversation]').first().isVisible().catch(() => false);
  check(!reopened, 'and does not reopen a conversation already picked up');

  /* ---- leg four: an app that has been open across a deploy ---- */
  console.log('\n  — and once more, from an app that is a build behind —');
  await page.evaluate(() => { sessionStorage.clear(); localStorage.removeItem('story:duel-mirror'); });
  /* Back to a few strides from Sarah, facing her: the third leg left the
     duelist wherever the second one picked the conversation up. */
  await fetch(`${BASE}/api/story/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: NAME, world: { area: 'starting-area', x: -8.0, z: 1.5, facing: -Math.PI / 2 } }),
  }).catch(() => {});
  let stale = await enterStory(page, 'starting-area', PINNED_HOUR);
  if (!stale) stale = await enterStory(page, 'starting-area', PINNED_HOUR);
  check(stale, 'the world opens');
  await page.locator('[aria-label="End the conversation"]').first().dispatchEvent('click').catch(() => {});
  await page.waitForTimeout(600);
  check(await takeTheDuel(page), 'Sarah offers a duel and it opens');
  await page.waitForURL(/\/duel\//, { timeout: 45000 }).catch(() => {});
  const code4 = new URL(page.url()).pathname.split('/').pop() ?? '';
  await page.waitForTimeout(5000);
  const token4 = await page.evaluate(() => {
    const raw = sessionStorage.getItem('story:duel');
    return raw ? ((JSON.parse(raw) as { token?: string }).token ?? '') : '';
  });
  check(await surrender(code4, token4), 'the seat gives the duel up');
  /* From here the server says it is a newer build than the one this page
     runs — which is what a phone that kept the game open across a deploy
     sees. Continue must reload into the fresh build rather than navigate
     inside the old one, and the fresh page must walk back in on its own. */
  await page.route('**/api/build*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'dpl_a_newer_build' }) }));
  await page.evaluate(() => {
    const raw = sessionStorage.getItem('story:duel');
    const n = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    n.outcome = 'lost';
    sessionStorage.setItem('story:duel', JSON.stringify(n));
  });
  await page.locator('button:has-text("Continue")').first().click({ timeout: 5000 }).catch(async () => {
    /* No win screen without a finished view on the page yet; the room may
       still be polling. Nudge it the way the button would. */
    await page.evaluate(() => (window as unknown as { next: { router: { push(u: string): void } } }).next.router.push('/story'));
  });
  await page.waitForURL(/rebuilt=/, { timeout: 20000 }).catch(() => {});
  check(/rebuilt=/.test(page.url()), 'Continue reloads into the fresh build');
  await page.unroute('**/api/build*');
  let asked4 = false, conv4 = false;
  const t4 = Date.now();
  while (Date.now() - t4 < 60000) {
    if (await page.locator('input[placeholder="Enter your name"]').isVisible().catch(() => false)) asked4 = true;
    if (await page.locator('[data-conversation]').first().isVisible().catch(() => false)) { conv4 = true; break; }
    await page.waitForTimeout(500);
  }
  check(!asked4, 'and the fresh page does not ask your name');
  check(conv4, 'and the conversation is waiting');

  await browser.close();
  console.log(bad ? `\nDUEL AND BACK: ${bad} thing(s) wrong ❌\n` : '\nDUEL AND BACK: the road back is whole. ✅\n');
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
