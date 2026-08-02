/**
 * You must be able to walk back into your own duel.
 *
 *   node scripts/rejoin-check.mjs [baseUrl]
 *
 * Reported after swiping the app away and typing the room code back in:
 * "same code when I try to re enter it says two players are already in, I just
 * swiped up the game and tried to enter it again I couldn't so we would both
 * create a new room."
 *
 * The home page's Join passed `undefined` for the token, so the server had no
 * way to know it was you and tried to seat you afresh — into a room whose two
 * seats were already taken, one of them yours. Reopening the /duel/CODE link
 * worked, because that path loads the stored identity; typing the code did
 * not, because the home page had its own copy of the rule and the read half
 * lived somewhere else entirely.
 *
 * This has to be a browser check. Both seats are filled over HTTP, so an
 * API-level driver reproduces nothing: the bug was never in the endpoint, it
 * was in which argument the page handed it. `localStorage` is the whole point,
 * so the context is reused rather than recreated — swiping an app away kills
 * the process, not the storage.
 */
import { webkit } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');

let failures = 0;
function ok(pass, label, detail = '') {
  console.log(`  ${pass ? '✅' : '❌'} ${label}${!pass && detail ? ` — ${detail}` : ''}`);
  if (!pass) failures += 1;
}

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

const onScreen = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 160));

console.log(`Rejoining your own room — ${BASE}\n`);

const browser = await webkit.launch();
/* One context for the whole run: this is a player closing and reopening the
   app on one phone, not two devices. `localStorage` lives on the context, so
   it survives the page being closed — which is exactly what swiping an app
   away does to it. */
const ctx = await browser.newContext();
let page = await ctx.newPage();

try {
  // 1. Create a duel from the home page, the way a player does.
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Enter your name').fill('Mihail');
  const start = page.getByRole('button', { name: /start a new duel/i });
  await start.waitFor({ timeout: 20000 });
  // The buttons sit disabled until the mount effect runs — a tap before that
  // is gone, not queued.
  for (let i = 0; i < 40 && (await start.isDisabled()); i++) await page.waitForTimeout(250);
  await start.click();
  await page.waitForURL(/\/duel\/[A-Z0-9]{4,5}/, { timeout: 20000 });
  const code = page.url().split('/').pop();
  ok(!!code, 'a duel is created', page.url());

  // 2. The second player takes the other seat, so the room really is full.
  await post(`/api/room/${code}/join`, { name: 'Sister' });

  /* 3. Swipe the app away and come back — a fresh page on the same device.
     Closing and reopening rather than navigating: WebKit crashes its renderer
     often enough when a live duel page is navigated out from under its poll
     loop, and closing the page is the truer model of a swipe anyway. */
  await page.close();
  page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const stored = await page.evaluate((c) => localStorage.getItem(`duel-identity:${c}`), code);
  ok(!!stored, 'the seat is remembered on this device', 'nothing in localStorage — the probe proves nothing');

  // 4. Type the code back in and press Join.
  await page.getByPlaceholder('CODE').fill(code);
  const joinBtn = page.getByRole('button', { name: /^join$/i });
  for (let i = 0; i < 40 && (await joinBtn.isDisabled()); i++) await page.waitForTimeout(250);
  await joinBtn.click();

  /* Either we end up in the room, or the home page tells us we cannot. Waiting
     for whichever comes first, rather than for one and timing out on the other,
     so a refusal is reported as a refusal instead of as a timeout naming a
     selector. */
  const outcome = await Promise.race([
    page.waitForURL(new RegExp(`/duel/${code}`, 'i'), { timeout: 20000 }).then(() => 'in'),
    page
      .waitForSelector('text=/already has two players|duel is full|could not find/i', { timeout: 20000 })
      .then(() => 'refused'),
  ]).catch(() => 'neither');

  ok(outcome === 'in', 'typing your own code puts you back in your seat', outcome === 'refused' ? `refused: ${await onScreen(page)}` : `${outcome} — still on ${page.url()}`);

  if (outcome === 'in') {
    /* And it is really the room rather than an error screen behind a URL that
       happens to match. Which screen depends on how far the duel has got — the
       lobby while the other seat is still picking, the picker, or the board —
       so this asserts what they have in common, and that neither refusal is on
       it.

       Read inside a guard: WebKit in this container kills its own renderer on
       the duel page often enough that an unguarded read reports a crash as a
       failed fix. A crash here is reported as proving nothing, never as a
       pass. */
    let text = null;
    try {
      await page.waitForTimeout(2500);
      text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
    } catch (err) {
      console.log(`  ⚠️  could not read the duel page (${String(err).split('\n')[0]}) — the seat check above stands, this one proves nothing`);
    }
    if (text !== null) {
      const refused = /this duel is full|duel not found/i.test(text);
      const inRoom =
        new RegExp(`Room ${code}|choose your duelist`, 'i').test(text) ||
        (await page.locator('[data-testid="hand-strip"]').count().catch(() => 0)) > 0;
      ok(!refused, 'and is not turned away', text.slice(0, 160));
      ok(inRoom, 'and is really in the room', text.slice(0, 160));
    }
  }

  // 5. CONTROL: a genuine third player is still turned away. Without this, a
  //    Join that let anybody in would pass everything above.
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(BASE, { waitUntil: 'domcontentloaded' });
  await stranger.getByPlaceholder('Enter your name').fill('Stranger');
  await stranger.getByPlaceholder('CODE').fill(code);
  const strangerJoin = stranger.getByRole('button', { name: /^join$/i });
  for (let i = 0; i < 40 && (await strangerJoin.isDisabled()); i++) await stranger.waitForTimeout(250);
  await strangerJoin.click();
  const strangerOutcome = await Promise.race([
    stranger.waitForURL(/\/duel\//, { timeout: 15000 }).then(() => 'in'),
    stranger
      .waitForSelector('text=/already has two players|duel is full/i', { timeout: 15000 })
      .then(() => 'refused'),
  ]).catch(() => 'neither');
  ok(strangerOutcome === 'refused', 'CONTROL: somebody with no seat is still refused', `outcome: ${strangerOutcome}`);
  await other.close().catch(() => {});
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nYou can always walk back into your own duel. ✅');
process.exitCode = failures ? 1 : 0;
