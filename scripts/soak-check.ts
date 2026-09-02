/**
 * Plays for a long time, and watches what the machine is holding.
 *
 * "It needs to be smooth always" is a different requirement from "it is
 * smooth". Every other check here loads a page, does one thing and throws the
 * page away — which is exactly the condition under which a leak is invisible.
 * A geometry that is never disposed costs nothing the first time and a whole
 * arcade the twentieth, and the frame rate goes down a step at a time over an
 * evening's play until the game feels heavy and nobody can say when it
 * started.
 *
 * So this keeps *one* page, and walks it through every door in Domino City
 * both ways, lap after lap. After each crossing it asks the renderer what it
 * holds — geometries, textures, shader programs — and asks the scene how many
 * things are in it, and asks the page how big its heap is, and then measures
 * how long a frame takes. Then it says whether any of those only ever went up.
 *
 * What a leak looks like here is a straight line. What it should look like is
 * a sawtooth that comes back to the same floor every lap: an area is built,
 * an area is dropped, and the numbers after the drop are the numbers before
 * the build. Growth is judged lap to lap, not crossing to crossing, because
 * the areas are different sizes and the numbers *inside* a lap are supposed to
 * move.
 *
 *   npm run soak                  six laps of every door, both ways
 *   npm run soak -- --laps=12     longer
 *
 * The duelist is moved between doors by `__teleport`, which the world exposes
 * for exactly this: the save route and a reload would hand back a fresh page,
 * and a fresh page is the one thing that cannot leak.
 */
import { chromium, type Page } from 'playwright';
import { AREAS, type AreaId, type Door, PLAYER_RADIUS } from '../src/story/areas';
import { BASE, NAME, PINNED_HOUR, ensurePlayer, enterStory, refuseRemote, walkUntil } from './story-setup';

const LAPS = (() => {
  const flag = process.argv.slice(2).find((a) => a.startsWith('--laps='));
  const n = flag ? Number(flag.slice(7)) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 6;
})();

interface Sample {
  crossing: number;
  lap: number;
  area: AreaId;
  geometries: number;
  textures: number;
  programs: number;
  sceneChildren: number;
  built: number;
  heapMB: number | null;
  frameMs: number;
  frameP95: number;
}

/**
 * The circuit: every door, both ways, ending where it began.
 *
 * Written as a list of doors and not derived, so that a new area is a new line
 * here and a lap still comes home — a walk that ends somewhere else compares
 * a shop's numbers against a burial ground's and calls the difference a leak.
 */
const CIRCUIT: [AreaId, string][] = [
  ['grandpa-shop', 'shop-to-street'],
  ['starting-area', 'street-to-market'],
  ['market-row', 'market-to-crown'],
  ['black-crown', 'crown-to-shop'],
  ['crown-shop', 'shop-to-crown'],
  ['black-crown', 'crown-to-market'],
  ['market-row', 'market-to-street'],
  ['starting-area', 'street-to-steps'],
  ['step-lane', 'steps-to-street'],
  ['starting-area', 'street-to-shrine'],
  ['domino-shrine', 'shrine-to-cemetery'],
  ['old-cemetery', 'cemetery-to-shrine'],
  ['domino-shrine', 'shrine-to-street'],
  ['starting-area', 'street-to-shop'],
];

/** Where to stand to walk into a door: back from its trigger along the line the arrival faces. */
function approach(door: Door): { x: number; z: number; facing: number } {
  let dx = door.trigger.x - door.arrive.x;
  let dz = door.trigger.z - door.arrive.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const clear = Math.abs(dx) * door.trigger.hw + Math.abs(dz) * door.trigger.hd + PLAYER_RADIUS + 1.9;
  return { x: door.trigger.x - dx * clear, z: door.trigger.z - dz * clear, facing: Math.atan2(dx, dz) };
}

const areaOf = (page: Page) =>
  page.evaluate(() => (window as unknown as { __probe?: { area: string } }).__probe?.area ?? null).catch(() => null);

async function waitForArea(page: Page, want: AreaId, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    if ((await areaOf(page)) === want) return true;
    if (Date.now() > until) return false;
    await page.waitForTimeout(200);
  }
}

/** What the page holds right now, and how fast it is drawing. */
async function sample(page: Page, crossing: number, lap: number): Promise<Sample> {
  /* And bounded on this side too: an evaluate has no timeout of its own. */
  return Promise.race([
    page.waitForTimeout(45000).then(() => { throw new Error('sample: the page did not answer in 45 s'); }),
    page.evaluate(async ({ crossing, lap }) => {
    const w = window as unknown as {
      __renderer?: { info: { memory: { geometries: number; textures: number }; programs: { length: number } | null } };
      __scene?: { children: unknown[] };
      __probe?: { area: string; built: number };
    };
    /* Sixty frames, timed one to the next. Long enough for the mean to be a
       frame time and not a hiccup; short enough not to be the test's own cost. */
    const times: number[] = [];
    let last = performance.now();
    /* Bounded. A frame that never comes — a page the browser has stopped
       painting — must not hang the whole run; it hung this one for forty
       minutes with the header printed and nothing after it. Whatever frames
       arrive inside the deadline are the sample. */
    const deadline = performance.now() + 25000;
    for (let i = 0; i < 60 && performance.now() < deadline; i++) {
      await new Promise<void>((r) => {
        const t = setTimeout(() => r(), 2000);
        requestAnimationFrame(() => { clearTimeout(t); r(); });
      });
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    if (times.length === 0) times.push(2000);
    times.sort((a, b) => a - b);
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const p95 = times[Math.floor(times.length * 0.95)];
    /* Collect first, twice — the first pass frees, the second frees what the
       first pass made collectable. Then read. */
    const gc = (window as unknown as { gc?: () => void }).gc;
    if (gc) { gc(); gc(); }
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      crossing,
      lap,
      area: (w.__probe?.area ?? '?') as AreaId,
      geometries: w.__renderer?.info.memory.geometries ?? -1,
      textures: w.__renderer?.info.memory.textures ?? -1,
      programs: w.__renderer?.info.programs?.length ?? -1,
      sceneChildren: w.__scene?.children.length ?? -1,
      built: w.__probe?.built ?? -1,
      heapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
      frameMs: +mean.toFixed(2),
      frameP95: +p95.toFixed(2),
    };
  }, { crossing, lap }),
  ]);
}

async function main() {
  refuseRemote();
  await ensurePlayer();

  /* The Chrome flag is what makes `performance.memory` answer with a real
     number rather than a quantised one; without it the heap column is a
     rounded guess and the verdict leans on the renderer's counts instead. */
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
    /* Not `--js-flags=--expose-gc`. It would let the page collect before it
       is measured, and both runs launched with it hung before the first sample
       with nothing printed; the run without it did not. So the heap column is
       live-plus-uncollected, and the verdict reads its *plateau* — lap two to
       lap three of the first run went 90 → 91 MB — rather than its level. If
       `gc` happens to exist it is still called. */
    args: ['--enable-precise-memory-info'],
  });
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

  const first = CIRCUIT[0];
  const firstDoor = AREAS[first[0]].doors.find((d) => d.id === first[1])!;
  const start = approach(firstDoor);
  await fetch(`${BASE}/api/story/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: NAME, world: { area: first[0], ...start } }),
  }).catch(() => {});
  /* Said out loud, so a hang has a last line to point at. */
  console.log(`  entering ${first[0]}…`);
  const entry = () => Promise.race([
    enterStory(page, first[0], PINNED_HOUR),
    page.waitForTimeout(240000).then(() => { throw new Error('entering the world took over four minutes'); }),
  ]);
  let there = await entry();
  if (!there) there = await entry();
  console.log(`  ${there ? 'in' : 'never got in'}`);
  if (!there) {
    console.log('  ❌ the world never opened');
    await browser.close();
    process.exit(1);
  }
  /* Let the first area settle — the rig fetch, the shadow map's first draw —
     so the baseline is a page that is playing, not one that is loading. */
  await page.waitForTimeout(4000);

  console.log(`\nSoak — ${LAPS} lap(s) of ${CIRCUIT.length} doors on one page, against ${BASE}\n`);
  console.log('  sampling…');
  const samples: Sample[] = [await sample(page, 0, 0)];
  const s0 = samples[0];
  console.log(`  start   ${s0.area.padEnd(14)} geo ${s0.geometries}  tex ${s0.textures}  prog ${s0.programs}  scene ${s0.sceneChildren}  heap ${s0.heapMB ?? '?'} MB  frame ${s0.frameMs} ms (p95 ${s0.frameP95})`);

  let crossing = 0;
  let failed = 0;
  for (let lap = 1; lap <= LAPS; lap++) {
    for (const [from, doorId] of CIRCUIT) {
      const door = AREAS[from].doors.find((d) => d.id === doorId);
      if (!door) throw new Error(`no door ${from}/${doorId}`);
      const here = await areaOf(page);
      if (here !== from) {
        console.log(`  ❌ lap ${lap}: expected to be in ${from} before ${doorId}, but in ${here}`);
        failed++;
        break;
      }
      const at = approach(door);
      await page.evaluate(
        ({ x, z, facing }) => (window as unknown as { __teleport?: (x: number, z: number, f: number) => void }).__teleport?.(x, z, facing),
        at
      );
      await page.waitForTimeout(300);
      /* Generous, because headless Chromium draws this world in software at a
         couple of frames a second, and the duelist moves per frame. A budget
         that suits a phone leaves her three metres short of the door here. */
      await walkUntil(page, 40000, async () => (await areaOf(page)) !== from);
      const landed = await waitForArea(page, door.to, 20000);
      crossing++;
      if (!landed) {
        console.log(`  ❌ lap ${lap}: ${from}/${doorId} did not reach ${door.to}`);
        failed++;
        break;
      }
      /* The fade, the swap and the rig fetch for the new area all land in the
         first second or two. Sampling before that measures the transition. */
      await page.waitForTimeout(2500);
      samples.push(await sample(page, crossing, lap));
    }
    if (failed) break;
    const s = samples[samples.length - 1];
    console.log(`  lap ${String(lap).padStart(2)}  ${s.area.padEnd(14)} geo ${s.geometries}  tex ${s.textures}  prog ${s.programs}  scene ${s.sceneChildren}  heap ${s.heapMB ?? '?'} MB  frame ${s.frameMs} ms (p95 ${s.frameP95})`);
  }
  await browser.close();

  if (failed) {
    console.log('\nSOAK: the circuit broke — see above. ❌');
    process.exit(1);
  }

  /*
   * The verdict, lap end against lap end.
   *
   * The first lap is the warm-up: shader programs compile the first time each
   * material is drawn and never again, and the heap after the first lap holds
   * every module the world will ever need. So growth is measured from the end
   * of lap one to the end of the last, in the same area, with the same things
   * built. A number that grew by more than a handful of items per lap, or a
   * heap that grew by more than a fifth, or a frame that got a third slower,
   * is something being kept that should have been let go.
   */
  const ends = samples.filter((s) => s.crossing % CIRCUIT.length === 0 && s.crossing > 0);
  const a = ends[0];
  const b = ends[ends.length - 1];
  const laps = Math.max(1, ends.length - 1);
  let bad = 0;
  const judge = (ok: boolean, what: string, detail: string) => {
    console.log(`  ${ok ? '✅' : '❌'} ${what}${ok ? '' : ` — ${detail}`}`);
    if (!ok) bad++;
  };
  console.log('');
  judge(b.geometries - a.geometries <= 2 * laps, 'the renderer holds no more geometry than it did after the first lap',
        `${a.geometries} → ${b.geometries} over ${laps} lap(s)`);
  judge(b.textures - a.textures <= 2 * laps, 'nor more textures', `${a.textures} → ${b.textures}`);
  judge(b.programs - a.programs <= 0, 'nor more shader programs', `${a.programs} → ${b.programs}`);
  judge(b.sceneChildren - a.sceneChildren <= 0, 'the scene has no more in it than it did', `${a.sceneChildren} → ${b.sceneChildren}`);
  if (a.heapMB !== null && b.heapMB !== null) {
    judge(b.heapMB <= a.heapMB * 1.2 + 8, 'the heap is not growing', `${a.heapMB} MB → ${b.heapMB} MB`);
  } else {
    console.log('  ⚠️  the heap could not be read (no performance.memory) — judged on the renderer alone');
  }
  judge(b.frameP95 <= a.frameP95 * 1.3 + 2, 'and a frame takes no longer than it did',
        `p95 ${a.frameP95} ms → ${b.frameP95} ms`);

  const worst = samples.reduce((m, s) => (s.frameP95 > m.frameP95 ? s : m), samples[0]);
  console.log(`\n  slowest frame p95 seen: ${worst.frameP95} ms in ${worst.area} (lap ${worst.lap})`);
  console.log(bad ? '\nSOAK: it gets heavier the longer you play. ❌' : '\nSOAK: as smooth after the last lap as the first. ✅');
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
