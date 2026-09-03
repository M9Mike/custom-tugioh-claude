/**
 * Stands in front of every door, facing it, and photographs what you see.
 *
 * A doorway is the one place a player looks *out* of an area on purpose, and
 * what they see through it is not the next area — that is a different scene —
 * but a closed box dressed to read as "the street is out there". This is the
 * frame that says whether it does: every door in Domino City, from the spot a
 * player stands at the moment before crossing, in both directions.
 *
 *   npm run doorshots                 every door, at the pinned hour
 *   npm run doorshots -- --hour=0     at midnight
 *   npm run doorshots -- shrine       only doors whose area or id says shrine
 *
 * Frames land in /tmp/doors as <area>--<door>-t<hour>.png. The vantage is the
 * same run-up `npm run doors` walks from, so what is photographed is what is
 * crossed.
 */
import { chromium, type Page } from 'playwright';
import { mkdirSync } from 'node:fs';
import { AREAS, type AreaId, type Door } from '../src/story/areas';
import { BASE, NAME, PINNED_HOUR, ensurePlayer, enterStory, refuseRemote, approach } from './story-setup';

const only = process.argv.slice(2).filter((a) => !a.startsWith('-') && !/^https?:/.test(a));


/**
 * Everybody out of the shot. The camera is left exactly where the game puts it:
 * the corner shots drag the horizon up to photograph architecture, and on a
 * flight of steps that pulls the lens down behind the duelist into the risers.
 * A doorway is judged from the view a player actually has walking up to it.
 */
async function compose(page: Page) {
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => {
      const w = window as unknown as { __scene?: { traverse(fn: (o: { isSkinnedMesh?: boolean; visible: boolean }) => void): void } };
      let k = 0;
      w.__scene?.traverse((o) => { if (o.isSkinnedMesh) { o.visible = false; k++; } });
      return k;
    }).catch(() => 0);
    if (n) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(900);
}

async function main() {
  refuseRemote();
  await ensurePlayer();
  mkdirSync('/tmp/doors', { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();

  const shots: { area: AreaId; door: Door }[] = [];
  for (const id of Object.keys(AREAS) as AreaId[]) {
    for (const door of AREAS[id].doors) {
      if (only.length && !only.some((o) => id.includes(o) || door.id.includes(o))) continue;
      shots.push({ area: id, door });
    }
  }
  console.log(`\nDoors — ${shots.length} frame(s) into /tmp/doors\n`);
  for (const s of shots) {
    const at = approach(s.door);
    await fetch(`${BASE}/api/story/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: NAME, world: { area: s.area, ...at } }),
    }).catch(() => {});
    let there = await enterStory(page, s.area, PINNED_HOUR);
    if (!there) there = await enterStory(page, s.area, PINNED_HOUR);
    await compose(page);
    const file = `/tmp/doors/${s.area}--${s.door.id}-t${PINNED_HOUR}.png`;
    await page.screenshot({ path: file, timeout: 60000 });
    console.log(`  ${there ? '📸' : '⚠️ '} ${s.area} / ${s.door.id} → ${s.door.to}`);
  }
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
