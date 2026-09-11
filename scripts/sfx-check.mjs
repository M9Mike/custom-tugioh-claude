/**
 * The sound plumbing, watched from outside the page.
 *
 * Nothing here can be heard in a headless browser, so the probe watches what
 * the page *does* with the audio engine instead — the things that decided
 * whether an iPhone made a noise:
 *
 *   - the audio session is claimed as `playback` when the first tap builds
 *     the context (that is what plays through the ringer switch), never by a
 *     page that is merely open, and handed back as `auto` when sound is
 *     turned off, with the context parked so a muted duel takes nothing from
 *     whatever else the phone is playing;
 *   - no AudioContext exists before a tap, one tap builds exactly one, and a
 *     tap while muted builds and wakes nothing;
 *   - a sound asked for while the clock is stopped — the tap that turns sound
 *     on, the first tap back into the app — plays once the clock runs, and one
 *     whose clock came back too late (a phone call ending) is dropped rather
 *     than played in a burst.
 *
 * `navigator.audioSession` is faked so the claim can be read; the AudioContext
 * is wrapped so its state and every scheduled oscillator can be. Chromium,
 * because none of this is WebKit-specific once the session is faked, and
 * Chromium is the engine this container has.
 *
 *   node scripts/sfx-check.mjs [baseUrl]
 */
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');
async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}
const { code, token } = await post('/api/room', { name: 'Mihail', vsAi: true });
await post(`/api/room/${code}/act`, { kind: 'chooseDuelist', token, duelistId: 'yugi' });

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await ctx.addInitScript(([storeKey, id]) => {
  try { window.localStorage.setItem(storeKey, JSON.stringify(id)); localStorage.removeItem('duel-sfx'); } catch {}
  // A fake Safari 17 audio session, so the claim can be watched from outside.
  Object.defineProperty(navigator, 'audioSession', { value: { type: 'auto' }, configurable: true });
  window.__acs = []; window.__osc = 0; window.__errors = [];
  window.addEventListener('error', (e) => window.__errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));
  const Orig = window.AudioContext;
  window.AudioContext = new Proxy(Orig, {
    construct(target, args) {
      const c = Reflect.construct(target, args);
      window.__acs.push(c);
      const mk = c.createOscillator.bind(c);
      c.createOscillator = () => { window.__osc += 1; return mk(); };
      return c;
    },
  });
}, [`duel-identity:${code.toUpperCase()}`, { code, token }]);

const page = await ctx.newPage();
page.on('pageerror', (err) => console.log('[pageerror]', String(err).slice(0, 300)));
const fails = [];
const check = (ok, what) => { console.log(`  ${ok ? '✅' : '❌'} ${what}`); if (!ok) fails.push(what); };
const snap = () => page.evaluate(() => ({ type: navigator.audioSession.type, n: window.__acs.length, state: window.__acs[0]?.state, osc: window.__osc, setting: localStorage.getItem('duel-sfx') }));
const toggle = page.getByTitle('Toggle sound');

await page.goto(`${BASE}/duel/${code}`, { waitUntil: 'domcontentloaded' });
await toggle.waitFor({ timeout: 20000 });
await page.waitForTimeout(1500);
let s = await snap();
check(s.type === 'auto' && s.n === 0, `a page that has only been opened touches nothing: no context, session left at auto (${s.n}, ${s.type})`);

// A bare tap on the board: the context is built inside it, the session is claimed for it, and it runs.
await page.mouse.click(200, 420);
await page.waitForTimeout(800);
s = await snap();
check(s.n === 1 && s.state === 'running', `the first tap builds one context and it runs (${s.n}, ${s.state})`);
check(s.type === 'playback', `and claims the session as playback, which plays through the ringer switch (${s.type})`);

// The sound toggle: off releases the session and parks the context; on takes both back.
await toggle.tap();
await page.waitForTimeout(600);
s = await snap();
check(s.type === 'auto' && s.state === 'suspended' && s.setting === '0', `sound off → session auto, context parked, remembered (${s.type}, ${s.state}, ${s.setting})`);
await page.evaluate(() => { window.__osc = 0; });
await page.mouse.click(200, 420); // a tap while muted must not wake the context
await page.waitForTimeout(600);
s = await snap();
check(s.state === 'suspended' && s.osc === 0 && s.n === 1, `a tap while muted wakes nothing and plays nothing (${s.state}, ${s.osc} oscillators, ${s.n} contexts)`);
await toggle.tap();
await page.waitForTimeout(800);
s = await snap();
check(s.type === 'playback' && s.state === 'running' && s.n === 1, `sound on → session playback, the same context running (${s.type}, ${s.state}, ${s.n} contexts)`);
// That tap's own click sound was asked for while the clock was still stopped — it must have waited for it, not been dropped.
check(s.osc > 0, `the tap that turned sound on was heard: ${s.osc} oscillator(s) scheduled after the resume`);

// A clock that comes back too late — a phone call ending — is past the moment: the sound is dropped, not played in a burst.
await page.evaluate(async () => {
  const c = window.__acs[0];
  const real = c.resume.bind(c);
  c.resume = () => new Promise((r) => setTimeout(() => real().then(r), 700));
});
await toggle.tap(); // off: parks the context
await page.waitForTimeout(400);
await page.evaluate(() => { window.__osc = 0; });
await toggle.tap(); // on: the click sound is asked for; the resume takes 700 ms
await page.waitForTimeout(1600);
s = await snap();
check(s.state === 'running' && s.osc === 0, `a sound whose clock came back 700 ms late is dropped (${s.state}, ${s.osc} oscillators)`);

const errors = await page.evaluate(() => window.__errors);
check(errors.length === 0, `no page errors (${errors.join(' | ') || 'none'})`);
await browser.close();
if (fails.length) { console.log(`\n❌ ${fails.length} failed`); process.exit(1); }
console.log('\n✅ the sound plumbing behaves');
