/**
 * Plays a full duel on the real Safari engine (WebKit) at both phones' sizes,
 * driving the UI with taps exactly as the players will.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=... node scripts/iphone.mjs [baseUrl] [outDir]
 */
import { webkit } from 'playwright';
import fs from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = process.argv[3] ?? '/tmp/iphone';

// iPhone 11 is 414x896 CSS px; iPhone 17 Pro Max is 440x956.
const PHONES = {
  'iphone11': { viewport: { width: 414, height: 896 }, deviceScaleFactor: 2 },
  'iphone17promax': { viewport: { width: 440, height: 956 }, deviceScaleFactor: 3 },
};


/**
 * Opens the home page, patiently.
 *
 * Playwright's default navigation timeout is 30 seconds, which is generous
 * against localhost and not always enough against production: Paris plus a
 * cold serverless start has taken longer than that, and the check then exits
 * on a stack trace naming `page.goto` — which reads as the app being broken
 * when nothing was ever asserted. `npm run pwa` was fixed exactly this way and
 * this probe kept the bare goto; it duly failed the same afternoon, on the
 * *second* phone, after the first had already loaded and opened a room.
 *
 * Widened rather than loosened: a page that genuinely never loads still throws
 * after two attempts.
 */
async function goHome(page) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
      return;
    } catch (err) {
      if (attempt >= 1) throw err;
      await page.waitForTimeout(2000);
    }
  }
}

/**
 * The card inspector is a modal on phones; dismiss it before driving the board.
 *
 * If it will not go, say so here rather than leaving the next tap to time out
 * thirty seconds later against "scrim intercepts pointer events" — that message
 * names the symptom and hides the cause, which cost an afternoon once. A modal
 * a player cannot close is a real bug, so it is worth reporting precisely.
 */
const dismissInspector = async (page, errors) => {
  const scrim = page.locator('[data-testid="inspector-scrim"]');
  if (!(await scrim.count())) return true;
  try {
    await scrim.tap({ position: { x: 5, y: 5 }, timeout: 5000 });
  } catch {
    const on = await page.evaluate(() => {
      const s = document.querySelector('[data-testid="inspector-scrim"]');
      if (!s) return 'gone by the time it was read';
      const r = s.getBoundingClientRect();
      const el = document.elementFromPoint(r.x + 5, r.y + 5);
      return el ? `${el.tagName.toLowerCase()} ${(el.className || '').toString().slice(0, 90)}` : 'nothing';
    });
    errors?.push(`the card inspector could not be tapped shut — on top of it: ${on}`);
    return false;
  }
  await page.waitForTimeout(220);
  if (!(await scrim.count())) return true;
  errors?.push('the card inspector stayed open after being tapped');
  return false;
};

/**
 * Holds the client bundle back so hydration is guaranteed to land *after* the
 * name is typed. Off a local server it arrives almost instantly and the race
 * below could never happen — which is exactly how the bug reached production
 * unnoticed.
 */
const CHUNKS = '**/_next/static/**';
const slowHydration = (page) =>
  page.route(CHUNKS, async (route) => {
    await new Promise((r) => setTimeout(r, 1400));
    await route.continue();
  });

/**
 * Types the player's name straight after the document loads — ahead of
 * hydration, on purpose.
 *
 * The field is a controlled input whose state starts empty and is filled from
 * localStorage by a mount effect. Type before that lands and the typed text
 * survives in the DOM but never reaches React, so it looks fine right up until
 * the next render throws it away — and the room opens for "Player 1". Checking
 * the field here would therefore prove nothing; `seatedAs` below checks the
 * only thing that matters, which is the name the room was actually created
 * with.
 */
const enterName = async (page, value) => {
  await page.locator('input[placeholder="Enter your name"]').fill(value);
  await page.waitForTimeout(2600);
};

/** The name the room really opened with, as shown on the player's own seat. */
const seatedAs = async (page, value) => {
  if (!(await page.locator(`text=${value}`).count())) {
    throw new Error(`the room did not open for "${value}" — the typed name was lost before it was sent`);
  }
};

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  📸 ${name}`);
};

const main = async () => {
  await fs.mkdir(OUT, { recursive: true });
  const browser = await webkit.launch();
  const errors = [];
  try {
    const mk = async (spec, tag) => {
      const ctx = await browser.newContext({
        ...spec,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      });
      const page = await ctx.newPage();
      page.on('console', (m) => m.type() === 'error' && errors.push(`[${tag}] ${m.text()}`));
      page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
      return page;
    };

    const a = await mk(PHONES.iphone17promax, 'mine');
    const b = await mk(PHONES.iphone11, 'hers');

    console.log('• home (iPhone 17 Pro Max)');
    await slowHydration(a);
    await goHome(a);
    await enterName(a, 'Mihail');
    await a.unroute(CHUNKS);
    await shot(a, '01-home-17promax');

    await a.tap('text=Start a new duel');
    await a.waitForURL(/\/duel\//, { timeout: 25000 });
    await a.waitForTimeout(1600);
    const code = a.url().split('/').pop();
    console.log(`  room ${code}`);
    await seatedAs(a, 'Mihail');
    await shot(a, '02-lobby-17promax');

    console.log('• join (iPhone 11)');
    await goHome(b);
    await enterName(b, 'Sis');
    await b.fill('input[placeholder="CODE"]', code);
    await b.tap('button:has-text("Join")');
    await b.waitForURL(/\/duel\//, { timeout: 25000 });
    await b.waitForTimeout(1600);
    await seatedAs(b, 'Sis');
    await shot(b, '03-lobby-iphone11');

    // Tapping a card only selects it now; the panel's own button commits.
    await a.tap('button:has-text("Seto Kaiba")');
    await a.waitForTimeout(500);
    await a.tap('button:has-text("Duel as Seto")');
    await a.waitForTimeout(800);
    await b.tap('button:has-text("Mai Valentine")');
    await b.waitForTimeout(500);
    await b.tap('button:has-text("Duel as Mai")');
    await a.waitForTimeout(2600);
    await shot(a, '04-duel-17promax');
    await shot(b, '05-duel-iphone11');

    /* An opening hand is five cards and every one of them has to be reachable
       without scrolling — the cards are sized against the width the strip
       actually gets, which is the whole screen minus the turn controls. */
    for (const [tag, page] of [['mine', a], ['hers', b]]) {
      const strip = await page.locator('[data-testid="hand-strip"]').evaluate((el) => ({
        cards: el.querySelectorAll('[data-testid="hand-card"]').length,
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
      }));
      console.log(`  ${tag}: hand ${strip.cards} cards, ${strip.scrollW}/${strip.clientW}px`);
      if (strip.cards === 5 && strip.scrollW > strip.clientW + 1) {
        errors.push(`[${tag}] opening hand does not fit: ${strip.scrollW} > ${strip.clientW}`);
      }
    }

    console.log('• playing turns by tapping');
    let summonShot = false;
    let attackShot = false;
    let sheetShot = false;
    for (let round = 0; round < 14; round++) {
      for (const [tag, page] of [['mine', a], ['hers', b]]) {
        if (!(await page.locator('button:has-text("End Turn")').count())) continue;

        await dismissInspector(page, errors);
        const hand = page.locator('[data-testid="hand-card"]');
        const n = await hand.count();
        for (let h = 0; h < n; h++) {
          // The inspector can open from a previous tap; it is a modal, so it
          // has to go before the next one lands. If it will not go, stop rather
          // than tapping into it and timing out on a message about the symptom.
          if (!(await dismissInspector(page, errors))) break;
          try {
            await hand.nth(h).tap({ timeout: 8000 });
          } catch {
            /* Something is over the hand. Say what, and at which point — a bare
               "intercepts pointer events" after thirty seconds names only the
               symptom. */
            const on = await page.evaluate(() => {
              const card = document.querySelectorAll('[data-testid="hand-card"]')[0];
              if (!card) return 'the hand is empty';
              const r = card.getBoundingClientRect();
              const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
              return `${el?.tagName.toLowerCase()} ${(el?.className || '').toString().slice(0, 110)}`;
            });
            errors.push(`[${tag}] a hand card could not be tapped — over it: ${on}`);
            await shot(page, `xx-hand-blocked-${tag}`);
            break;
          }
          await page.waitForTimeout(320);
          const summon = page.locator('button:has-text("Normal Summon")');
          if ((await summon.count()) && (await summon.first().isEnabled())) {
            await summon.first().tap();
            await page.waitForTimeout(1000);
            const pick = page.locator('[data-testid="foe-monster-zone"] .targetable');
            if (await pick.count()) { await pick.first().tap(); await page.waitForTimeout(800); }
            if (!summonShot) { await shot(page, `06-summoned-${tag}`); summonShot = true; }
            break;
          }
          const cancel = page.locator('button:has-text("Cancel")').last();
          if (await cancel.count()) await cancel.tap();
          await page.waitForTimeout(140);
        }

        await dismissInspector(page, errors);
        const battle = page.locator('button:has-text("Battle")');
        if ((await battle.count()) && (await battle.first().isEnabled())) {
          await battle.first().tap();
          await page.waitForTimeout(600);
          const mine = page.locator('[data-testid="my-monster-zone"] .selectable');
          if (await mine.count()) {
            await mine.first().tap();
            await page.waitForTimeout(420);
            // The monster action sheet opens first: attack, effect, or position.
            const attackBtn = page.locator('button:has-text("Attack with")');
            if (await attackBtn.count()) {
              if (!sheetShot) { await shot(page, `06b-monster-sheet-${tag}`); sheetShot = true; }
              await attackBtn.first().tap();
              await page.waitForTimeout(420);
            }
            const foe = page.locator('[data-testid="foe-monster-zone"] .targetable');
            const direct = page.locator('button:has-text("Direct Attack")');
            if (await foe.count()) await foe.first().tap();
            else if (await direct.count()) await direct.first().tap();
            await page.waitForTimeout(1200);
            if (!attackShot) { await shot(page, `07-attack-${tag}`); attackShot = true; }
          }
        }

        for (const p of [a, b]) {
          const nothing = p.locator('button:has-text("Do nothing")');
          if (await nothing.count()) { await shot(p, '08-trap-window'); await nothing.tap(); await p.waitForTimeout(500); }
        }
        await dismissInspector(page, errors);
        const et = page.locator('button:has-text("End Turn")');
        if (await et.count()) { await et.first().tap(); await page.waitForTimeout(800); }
        for (const p of [a, b]) {
          const nothing = p.locator('button:has-text("Do nothing")');
          if (await nothing.count()) { await nothing.tap(); await p.waitForTimeout(400); }
        }
      }
      if (await a.locator('text=Rematch').count()) { console.log(`  duel finished in round ${round + 1}`); break; }
    }

    await shot(a, '09-final-17promax');
    await shot(b, '10-final-iphone11');

    /* Tournament mode on the smaller phone: eight names, three rounds and a
       bracket that has to stack rather than push the page sideways. */
    console.log('• tournament (iPhone 11)');
    const c = await mk(PHONES.iphone11, 'cup');
    await goHome(c);
    await enterName(c, 'Mihail');
    await c.tap('button:has-text("Enter the tournament")');
    await c.waitForSelector('text=Choose your duelist', { timeout: 15000 });
    await shot(c, '11-tournament-pick');
    // Choosing a duelist no longer commits — the panel's button does, so a
    // three-duel run can be entered on purpose rather than by a stray tap.
    await c.tap('button:has-text("Yugi Muto")');
    await c.waitForTimeout(500);
    await c.tap('button:has-text("Enter as Yugi")');
    await c.waitForURL(/\/duel\//, { timeout: 25000 });
    await c.waitForSelector('text=Round of', { timeout: 25000 });
    await c.waitForTimeout(1200);
    await shot(c, '12-bracket');
    const toDuel = c.locator('button:has-text("To the duel")');
    await toDuel.first().waitFor({ timeout: 25000 });
    await toDuel.first().tap();
    await c.waitForSelector('button:has-text("End Turn"), [data-testid="hand-card"]', { timeout: 25000 });
    await c.waitForTimeout(900);
    // Tapping a card inspects it, and the inspector is a modal on a phone. It
    // is dismissed before each tap below rather than assumed away.
    await dismissInspector(c, errors);
    await shot(c, '13-tournament-duel');
    // Mid-duel, the 🏆 button must go back to the standings and the "To the
    // duel" button must bring the same duel back, untouched.
    const peek = c.locator('button[title="Bracket"]');
    if (!(await peek.count())) {
      errors.push('[cup] no way back to the bracket from a tournament duel');
    } else {
      // A synthetic pointer coming to rest over a hand card opens the inspector,
      // whose scrim then swallows the tap. A finger does the same thing.
      await dismissInspector(c, errors);
      await peek.first().tap();
      await c.waitForSelector('text=Round of', { timeout: 15000 });
      await dismissInspector(c, errors);
      await c.tap('button:has-text("To the duel")');
      await c.waitForSelector('[data-testid="hand-card"]', { timeout: 15000 });
      await dismissInspector(c, errors);
      console.log('  bracket peek and back ✓');
    }

    // Layout sanity: nothing should overflow horizontally on any phone.
    for (const [tag, page] of [['17promax', a], ['iphone11', b], ['cup', c]]) {
      const m = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        scrollH: document.documentElement.scrollHeight,
        clientH: document.documentElement.clientHeight,
      }));
      const overflowX = m.scrollW > m.clientW + 1;
      const overflowY = m.scrollH > m.clientH + 1;
      console.log(`  ${tag}: ${m.clientW}x${m.clientH} overflowX=${overflowX} overflowY=${overflowY}`);
      if (overflowX) errors.push(`[${tag}] horizontal overflow: ${m.scrollW} > ${m.clientW}`);
      if (overflowY) errors.push(`[${tag}] vertical overflow: ${m.scrollH} > ${m.clientH}`);
    }
  } finally {
    await browser.close().catch((e) => console.log('close failed:', e.message));
  }

  if (errors.length) {
    console.log('\n!! issues:');
    for (const e of [...new Set(errors)].slice(0, 20)) console.log('   ' + e);
    process.exitCode = 1;
  } else {
    console.log('\nNo console errors, no overflow. ✅');
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
