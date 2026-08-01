/**
 * Is the board in the same place in every mode?
 *
 *   node scripts/layout-check.mjs [baseUrl]
 *
 * Reported as "position the opponent's cards in hand (and the field) in the
 * tournament (and in vs ai) the same as in vs opponent — the pvp field is
 * perfect". Two-player is the reference; the other two must match it.
 *
 * The cause was one button. The control column beside the opponent's Life Point
 * bar is taller than the bar, so it is what sets the height of the top strip —
 * and a bracket match adds a fourth button (🏆) to that column, pushing the
 * opponent's hand and both halves of the field down by a row. Nothing else
 * about the board differs between the modes, which is why this measures
 * positions rather than looking for mode-specific markup: the next thing to
 * shift the board will not be a button either.
 */
import { webkit, devices } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');
/* Rounded to whole pixels: sub-pixel layout differs by a hair between runs and
   is not what anybody is looking at. */
const TOLERANCE = 1;

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

/** Opens a duel and reads where the board's parts sit. */
async function measure(ctx, code, token, label) {
  await ctx.addInitScript(
    ([k, id]) => {
      try {
        localStorage.setItem(k, JSON.stringify(id));
      } catch {
        /* reported as "proved nothing" below if it lands on the wrong screen */
      }
    },
    [`duel-identity:${code.toUpperCase()}`, { code, token }]
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}/duel/${code}`, { waitUntil: 'domcontentloaded' });
  /* A bracket match opens on the standings, not on the board — the player walks
     into their own duel from there. */
  /* The button only appears once the server has the round set up, which takes a
     couple of polls — the bracket shows "resolving" until then. */
  const toDuel = page.getByRole('button', { name: /to the duel/i }).first();
  for (let i = 0; i < 40; i++) {
    if (await toDuel.isVisible({ timeout: 500 }).catch(() => false)) {
      await toDuel.click().catch(() => {});
      break;
    }
    if (await page.locator('[data-testid="hand-strip"]').isVisible({ timeout: 200 }).catch(() => false)) break;
    await page.waitForTimeout(500);
  }
  await page.waitForSelector('[data-testid="hand-strip"]', { timeout: 20000 }).catch(async () => {
    // Saying which screen it landed on beats a bare timeout naming a selector.
    const seen = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 200));
    throw new Error(`${label}: never reached the board. On screen: ${seen}`);
  });
  await page.waitForTimeout(1500);

  const seen = await page.evaluate(() => {
    const top = (sel, nth = 0) => {
      const el = document.querySelectorAll(sel)[nth];
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    };
    return {
      foeHand: top('[data-testid="foe-hand"]'),
      foeZone: top('[data-testid="foe-monster-zone"]'),
      myZone: top('[data-testid="my-monster-zone"]'),
      hand: top('[data-testid="hand-strip"]'),
    };
  });
  await page.close();
  return { label, ...seen };
}

const browser = await webkit.launch();
const rows = [];

/* Two players — the reference. */
{
  const a = await post('/api/room', { name: 'Mihail' });
  await post(`/api/room/${a.code}/act`, { kind: 'chooseDuelist', token: a.token, duelistId: 'yugi' });
  const b = await post(`/api/room/${a.code}/join`, { name: 'Sister' });
  await post(`/api/room/${a.code}/act`, { kind: 'chooseDuelist', token: b.token, duelistId: 'kaiba' });
  const ctx = await browser.newContext({ ...devices['iPhone 11'] });
  rows.push(await measure(ctx, a.code, a.token, 'two players'));
  await ctx.close();
}

/* Against the computer. */
{
  const r = await post('/api/room', { name: 'Mihail', vsAi: true });
  await post(`/api/room/${r.code}/act`, { kind: 'chooseDuelist', token: r.token, duelistId: 'yugi' });
  const ctx = await browser.newContext({ ...devices['iPhone 11'] });
  rows.push(await measure(ctx, r.code, r.token, 'vs computer'));
  await ctx.close();
}

/* A bracket match. */
{
  const r = await post('/api/room', { name: 'Mihail', tournament: true });
  await post(`/api/room/${r.code}/act`, { kind: 'chooseDuelist', token: r.token, duelistId: 'yugi' });
  const ctx = await browser.newContext({ ...devices['iPhone 11'] });
  rows.push(await measure(ctx, r.code, r.token, 'tournament'));
  await ctx.close();
}

await browser.close();

const keys = ['foeHand', 'foeZone', 'myZone', 'hand'];
console.log('  mode           ' + keys.map((k) => k.padStart(9)).join(''));
for (const r of rows) {
  console.log(`  ${r.label.padEnd(15)}` + keys.map((k) => String(r[k] ?? '—').padStart(9)).join(''));
}

const ref = rows[0];
const missing = keys.filter((k) => ref[k] == null);
if (missing.length) {
  console.log(`\n⚠️  never found ${missing.join(', ')} on the reference board — this proves nothing`);
  process.exitCode = 1;
} else {
  const off = [];
  for (const r of rows.slice(1)) {
    for (const k of keys) {
      if (r[k] == null) off.push(`${r.label}: no ${k}`);
      else if (Math.abs(r[k] - ref[k]) > TOLERANCE) off.push(`${r.label}: ${k} at ${r[k]}, two-player has it at ${ref[k]}`);
    }
  }
  if (off.length) {
    console.log(`\n❌ the board sits somewhere else:`);
    for (const line of off) console.log(`     ${line}`);
    process.exitCode = 1;
  } else {
    console.log('\n✅ the board is in the same place in all three modes.');
  }
}
