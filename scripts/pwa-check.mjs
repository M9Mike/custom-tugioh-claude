/**
 * Proves the standalone detection and safe-area plumbing without a real iPhone.
 *
 * The chrome has run under the notch twice now. The first fix keyed the insets
 * off `@media (display-mode: standalone)`, which an iOS home-screen app does not
 * reliably match, so it silently did nothing — and nothing here could catch it,
 * because a desktop WebKit build reports every inset as 0 and is never
 * standalone. So this fakes the one signal iOS really does expose,
 * `navigator.standalone`, and checks the floor lands only then.
 *
 * What it cannot check is the *top* inset, which is now iOS's job: the status
 * bar is `black` rather than `black-translucent`, so the web view starts below
 * the clock and no inset is wanted. `/diag` reads the real numbers off the
 * device if that ever needs confirming.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=... node scripts/pwa-check.mjs [baseUrl]
 */
import { webkit } from 'playwright';

const BASE = process.argv[2] ?? 'http://localhost:3100';

const read = (page) =>
  page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;padding-top:var(--safe-top);padding-bottom:var(--safe-bottom)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    const out = {
      dataStandalone: document.documentElement.dataset.standalone ?? '(unset)',
      safeTopVar: root.getPropertyValue('--safe-top').trim(),
      safeBottomVar: root.getPropertyValue('--safe-bottom').trim(),
      resolvedTop: cs.paddingTop,
      resolvedBottom: cs.paddingBottom,
    };
    probe.remove();
    const main = document.querySelector('main.safe-page');
    if (main) {
      const m = getComputedStyle(main);
      out.mainPadTop = m.paddingTop;
      out.mainPadBottom = m.paddingBottom;
    }
    return out;
  });

const main = async () => {
  const browser = await webkit.launch();
  let bad = 0;

  for (const standalone of [false, true]) {
    const ctx = await browser.newContext({
      viewport: { width: 414, height: 896 },
      isMobile: true,
      hasTouch: true,
    });
    if (standalone) {
      // What an iOS home-screen app exposes and a browser tab does not.
      await ctx.addInitScript(() => {
        Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
      });
    }
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(700);
    const r = await read(page);
    console.log(`\nnavigator.standalone = ${standalone}`);
    for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${v}`);

    const want = standalone ? '1' : '(unset)';
    if (r.dataStandalone !== want) {
      console.log(`  ❌ data-standalone should be ${want}`);
      bad += 1;
    }
    // WebKit off-device reports every inset as 0, so the floor is the only
    // thing that can move the bottom. That is exactly what is being checked.
    const bottom = parseFloat(r.mainPadBottom ?? r.resolvedBottom);
    if (standalone && bottom < 16) {
      console.log(`  ❌ standalone bottom inset is ${bottom}px, expected the 16px floor`);
      bad += 1;
    }
    if (!standalone && bottom !== 0) {
      console.log(`  ❌ a browser tab should get no floor, got ${bottom}px`);
      bad += 1;
    }
    await ctx.close();
  }

  await browser.close();
  console.log(bad ? `\n${bad} problem(s)` : '\nStandalone detection and insets behave. ✅');
  if (bad) process.exitCode = 1;
};

main().catch((e) => { console.error(e); process.exit(1); });
