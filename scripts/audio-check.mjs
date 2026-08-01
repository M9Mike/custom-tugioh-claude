/**
 * Does the site build its AudioContext inside a user gesture?
 *
 * iOS will not honour a later `resume()` on a context that was *constructed*
 * outside one — which is why sound was missing until the app had been
 * backgrounded and brought back, since `visibilitychange` recreates the
 * conditions that do work. That asymmetry is exactly what was reported.
 *
 * The path that actually breaks is landing straight on a duel URL — a shared
 * link, or the app restoring into a duel — because nothing has been tapped on
 * that page yet. Coming in through the home page happens to build the context
 * inside a click, which is why a probe that navigates normally passes on the
 * broken code too. So this seeds the stored identity and goes directly to the
 * duel, the way the phone does.
 *
 *   node scripts/audio-check.mjs https://custom-tugioh-claude.vercel.app
 */
import { webkit, devices } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3100').replace(/\/$/, '');

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

const created = await post('/api/room', { name: 'Mihail', vsAi: true });
const { code, token } = created;

const browser = await webkit.launch();
const ctx = await browser.newContext({ ...devices['iPhone 11'] });

/* Runs before any page script, so it sees every construction. `__gesture`
   records whether a real user gesture had happened *yet* — the rule iOS
   actually enforces — rather than a proxy for it. */
await ctx.addInitScript(
  ([storeKey, id]) => {
    try {
      window.localStorage.setItem(storeKey, JSON.stringify(id));
    } catch {
      /* the probe still runs, it just lands on the "duel is full" screen */
    }
    window.__built = [];
    window.__gesture = false;
    for (const ev of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']) {
      window.addEventListener(ev, () => { window.__gesture = true; }, { capture: true });
    }
    const wrap = (Ctor) =>
      Ctor &&
      new Proxy(Ctor, {
        construct(target, args) {
          window.__built.push(window.__gesture);
          return Reflect.construct(target, args);
        },
      });
    if (window.AudioContext) window.AudioContext = wrap(window.AudioContext);
    if (window.webkitAudioContext) window.webkitAudioContext = wrap(window.webkitAudioContext);
  },
  [`duel-identity:${code.toUpperCase()}`, { code, token }]
);

const page = await ctx.newPage();
await page.goto(`${BASE}/duel/${code}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);

const seat = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 56));
const before = await page.evaluate(() => window.__built.length);
console.log(`landed straight on /duel/${code} — "${seat}…"`);
console.log(`  contexts built before any tap: ${before}`);

// Now tap, and the context should appear — built inside the gesture.
await page.mouse.click(200, 500);
await page.waitForTimeout(1500);
const built = await page.evaluate(() => window.__built);

const outside = built.filter((g) => g === false).length;
const inside = built.filter((g) => g === true).length;
console.log(`after a tap — built outside a gesture: ${outside}, inside a gesture: ${inside}`);

await browser.close();

if (outside > 0) {
  console.log('\n❌ an AudioContext was constructed with no gesture behind it — iOS keeps that one muted');
  process.exitCode = 1;
} else if (inside === 0) {
  /* Saying so is the point. A probe that reaches neither state has proved
     nothing, and reporting that as a pass is how the first version of this
     check blessed the broken code. */
  console.log('\n⚠️  no AudioContext was built at all, so this proves nothing');
  process.exitCode = 1;
} else {
  console.log('\n✅ the context is only ever built inside a real tap');
}
