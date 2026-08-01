/**
 * Drives two real browsers through the whole flow and captures screenshots so
 * the layout can be reviewed: home -> lobby -> duel board -> a few moves.
 *
 *   node scripts/shots.mjs [baseUrl] [outDir]
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const BASE = process.argv[2] ?? 'http://localhost:3000';
const OUT = process.argv[3] ?? '/tmp/shots';

let launched = null;


/** The card inspector is a modal on phones; dismiss it before driving the board. */
const dismissInspector = async (page) => {
  const scrim = page.locator('[data-testid="inspector-scrim"]');
  if (await scrim.count()) {
    await scrim.click({ position: { x: 5, y: 5 } });
    await page.waitForTimeout(220);
  }
};

const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  📸 ${name}`);
};

const main = async () => {
  await fs.mkdir(OUT, { recursive: true });
  // The sandbox ships a pinned Chromium; point at it rather than downloading one.
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  launched = browser;

  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  const errors = [];
  for (const [tag, page] of [
    ['A', a],
    ['B', b],
  ]) {
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  }

  console.log('• home');
  await a.goto(BASE, { waitUntil: 'networkidle' });
  await a.fill('input[placeholder="Enter your name"]', 'Mihail');
  await shot(a, '01-home');

  console.log('• create duel');
  await a.click('text=Start a new duel');
  await a.waitForURL(/\/duel\//, { timeout: 20000 });
  await a.waitForSelector('text=Shadow Duel', { timeout: 20000 });
  await a.waitForTimeout(1200);
  const code = a.url().split('/').pop();
  console.log(`  room ${code}`);
  await shot(a, '02-lobby-host');

  console.log('• second player joins');
  await b.goto(BASE, { waitUntil: 'networkidle' });
  await b.fill('input[placeholder="Enter your name"]', 'Sister');
  await b.fill('input[placeholder="CODE"]', code);
  await b.click('button:has-text("Join")');
  await b.waitForURL(/\/duel\//, { timeout: 20000 });
  await b.waitForTimeout(1500);
  await shot(b, '03-lobby-guest');

  console.log('• deck preview');
  await a.click('text=View 25-card deck');
  await a.waitForTimeout(900);
  await shot(a, '04-deck-preview');
  await a.keyboard.press('Escape');
  await a.click('body', { position: { x: 5, y: 5 } });
  await a.waitForTimeout(400);

  console.log('• choose duelists');
  await a.click('button:has-text("Seto Kaiba")');
  await a.waitForTimeout(400);
  await a.click('button:has-text("Duel as Seto")');
  await a.waitForTimeout(700);
  await b.click('button:has-text("Yugi Muto")');
  await b.waitForTimeout(400);
  await b.click('button:has-text("Duel as Yugi")');
  await a.waitForTimeout(2200);
  await shot(a, '05-duel-start-A');
  await shot(b, '06-duel-start-B');

  // Play through several real turns by clicking the actual UI.
  console.log('• playing real turns through the UI');
  for (let i = 0; i < 10; i++) {
    for (const [tag, page] of [
      ['A', a],
      ['B', b],
    ]) {
      if (!(await page.locator('button:has-text("End Turn")').count())) continue;

      // Summon from hand if we can.
      const hand = page.locator('[data-testid="hand-card"]');
      const n = await hand.count();
      for (let h = 0; h < n; h++) {
        await hand.nth(h).click();
        await page.waitForTimeout(350);
        const summon = page.locator('button:has-text("Normal Summon")');
        if ((await summon.count()) && (await summon.first().isEnabled())) {
          await summon.first().click();
          await page.waitForTimeout(1100);
          // A summon effect may ask for a target.
          const foeZone = page.locator('[data-testid="foe-monster-zone"] .targetable');
          if (await foeZone.count()) {
            await foeZone.first().click();
            await page.waitForTimeout(900);
          }
          await shot(page, `07-summon-${i}-${tag}`);
          break;
        }
        const cancel = page.locator('button:has-text("Cancel")').last();
        if (await cancel.count()) await cancel.click();
        await page.waitForTimeout(150);
      }

      // Battle phase + attack.
      const battle = page.locator('button:has-text("Battle")');
      if ((await battle.count()) && (await battle.first().isEnabled())) {
        await battle.first().click();
        await page.waitForTimeout(700);
        const mine = page.locator('[data-testid="my-monster-zone"] .selectable');
        if (await mine.count()) {
          await mine.first().click();
          await page.waitForTimeout(500);
          // The monster action sheet opens first.
          const attackBtn = page.locator('button:has-text("Attack with")');
          if (await attackBtn.count()) {
            await attackBtn.first().click();
            await page.waitForTimeout(400);
          }
          const direct = page.locator('button:has-text("Direct Attack")');
          const foeTarget = page.locator('[data-testid="foe-monster-zone"] .targetable');
          if (await foeTarget.count()) await foeTarget.first().click();
          else if (await direct.count()) await direct.first().click();
          await page.waitForTimeout(1300);
          await shot(page, `08-attack-${i}-${tag}`);
        }
      }

      // Respond to a trap window if one opened for either player.
      for (const p2 of [a, b]) {
        const doNothing = p2.locator('button:has-text("Do nothing")');
        if (await doNothing.count()) {
          await shot(p2, `09-trapwindow-${i}`);
          await doNothing.click();
          await p2.waitForTimeout(600);
        }
      }

      const et = page.locator('button:has-text("End Turn")');
      if (await et.count()) {
        await et.first().click();
        await page.waitForTimeout(900);
      }
      for (const p2 of [a, b]) {
        const doNothing = p2.locator('button:has-text("Do nothing")');
        if (await doNothing.count()) {
          await doNothing.click();
          await p2.waitForTimeout(500);
        }
      }
    }
  }
  await shot(a, '10-mid-duel-A');
  await shot(b, '11-mid-duel-B');
  // The win overlay covers the toolbar once a duel ends; only open the log if it is reachable.
  if (!(await a.locator('text=Rematch').count())) {
    await a.click('button[title="Duel log"]');
    await a.waitForTimeout(500);
    await shot(a, '12-duel-log');
  } else {
    await shot(a, '12-victory');
  }

  console.log('• mobile view');
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await ctxM.newPage();
  await m.goto(BASE, { waitUntil: 'networkidle' });
  await shot(m, '13-mobile-home');
  // A full duel started from the phone, so the mobile board can be reviewed.
  const ctxD = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const d = await ctxD.newPage();
  await m.fill('input[placeholder="Enter your name"]', 'Sister');
  await m.click('text=Start a new duel');
  await m.waitForURL(/\/duel\//, { timeout: 20000 });
  await m.waitForTimeout(1500);
  await shot(m, '14-mobile-lobby');
  const mcode = m.url().split('/').pop();
  await d.goto(BASE, { waitUntil: 'networkidle' });
  await d.fill('input[placeholder="Enter your name"]', 'Mihail');
  await d.fill('input[placeholder="CODE"]', mcode);
  await d.click('button:has-text("Join")');
  await d.waitForURL(/\/duel\//, { timeout: 20000 });
  await d.waitForTimeout(1200);
  await m.click('button:has-text("Mai Valentine")');
  await m.waitForTimeout(400);
  await m.click('button:has-text("Duel as Mai")');
  await m.waitForTimeout(600);
  await d.click('button:has-text("Joey Wheeler")');
  await d.waitForTimeout(400);
  await d.click('button:has-text("Duel as Joey")');
  await m.waitForTimeout(2500);
  await shot(m, '15-mobile-duel');
  // Summon on mobile to check the action sheet and board with a monster out.
  const mh = m.locator('[data-testid="hand-card"]');
  for (let i = 0; i < (await mh.count()); i++) {
    await dismissInspector(m);
    await mh.nth(i).click();
    await m.waitForTimeout(400);
    const btn = m.locator('button:has-text("Normal Summon")');
    if ((await btn.count()) && (await btn.first().isEnabled())) {
      await shot(m, '16-mobile-actionsheet');
      await btn.first().click();
      await m.waitForTimeout(1400);
      await shot(m, '17-mobile-summoned');
      break;
    }
    const c = m.locator('button:has-text("Cancel")').last();
    if (await c.count()) await c.click();
    await m.waitForTimeout(200);
  }

  if (errors.length) {
    console.log('\n!! console errors:');
    for (const e of [...new Set(errors)].slice(0, 25)) console.log('   ' + e);
  } else {
    console.log('\nNo console errors. ✅');
  }
};

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Never leave an orphaned browser behind, even when a step throws.
    if (launched) await launched.close().catch(() => {});
  });
