/**
 * Six minutes in one place, with the clock running.
 *
 * `npm run soak` walks through every door and proves nothing is kept between
 * areas. This is the other thing Mike felt: enter, walk about, and after a few
 * minutes the game is slow — until a refresh, when it is fine again. Nothing
 * crosses a door here. One area, the sky moving, the stick held, and a sample
 * every half minute of what the renderer, the scene, the heap and the page
 * itself are carrying. Anything that only ever goes up is the leak.
 *
 *   npm run linger                    starting-area, six minutes
 *   npm run linger -- black-crown --minutes=10
 */
import { chromium, type Page } from 'playwright';
import { BASE, ensurePlayer, enterStory, refuseRemote, walkForward } from './story-setup';

const MINUTES = Number(process.argv.find((a) => a.startsWith('--minutes='))?.slice(10) ?? 6);
const AREA = process.argv.slice(2).find((a) => !a.startsWith('-') && !/^https?:/.test(a)) ?? 'starting-area';

interface Sample { geo: number; tex: number; prog: number; calls: number; tris: number; objs: number; dom: number; heap: number; fps: number; hour: number; listeners: number; nodes: number; level: number }

/**
 * The heap through the debugger, not `performance.memory`: Chromium quantises
 * that and refreshes it rarely, so it read 82 MB seven times running and
 * proved nothing. The debugger's number is exact, and it counts listeners and
 * DOM nodes too — the two things a leak in React code shows up in first.
 */
async function sample(page: Page): Promise<Sample | null> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await cdp.send('Performance.enable').catch(() => {});
  const m = await cdp.send('Performance.getMetrics').catch(() => null);
  const metric = (name: string) => m?.metrics.find((x) => x.name === name)?.value ?? -1;
  const precise = { heap: Math.round(metric('JSHeapUsedSize') / 1048576), listeners: metric('JSEventListeners'), nodes: metric('Nodes') };
  await cdp.detach().catch(() => {});
  const inPage = await page.evaluate(async () => {
    const w = window as unknown as {
      __renderer?: import('three').WebGLRenderer; __scene?: import('three').Scene; __probe?: { hour?: number };
    };
    const r = w.__renderer; const s = w.__scene;
    if (!r || !s) return null;
    let objs = 0; s.traverse(() => objs++);
    const f0 = r.info.render.frame; const t0 = performance.now();
    await new Promise((res) => setTimeout(res, 3000));
    const fps = (r.info.render.frame - f0) / ((performance.now() - t0) / 1000);
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      geo: r.info.memory.geometries, tex: r.info.memory.textures, prog: r.info.programs?.length ?? 0,
      calls: r.info.render.calls, tris: r.info.render.triangles, objs,
      dom: document.getElementsByTagName('*').length,
      heap: mem ? Math.round(mem.usedJSHeapSize / 1048576) : -1,
      fps: +fps.toFixed(2), hour: w.__probe?.hour ?? -1,
      level: (w.__probe as { quality?: { level?: number } } | undefined)?.quality?.level ?? -1,
    };
  });
  if (!inPage) return null;
  return { ...inPage, ...precise, listeners: precise.listeners, nodes: precise.nodes };
}

async function main() {
  refuseRemote();
  await ensurePlayer();
  await fetch(`${BASE}/api/story/save`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'Mike', world: { area: AREA, x: 0, z: 0, facing: 0 } }),
  }).catch(() => {});
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined });
  const page = await (await browser.newContext({ viewport: { width: 900, height: 640 } })).newPage();
  console.log(`\nLinger — ${MINUTES} minute(s) in ${AREA}, clock running, against ${BASE}\n`);
  let there = await enterStory(page, AREA, null);
  if (!there) there = await enterStory(page, AREA, null);
  if (!there) { console.log('  ❌ never reached the world'); process.exit(1); }
  const rows: Sample[] = [];
  const t0 = Date.now();
  let leg = 0;
  while (Date.now() - t0 < MINUTES * 60000) {
    /* Walk a while, then face a new way, so she keeps moving rather than
       leaning on one wall for six minutes. */
    await walkForward(page, 15000).catch(() => {});
    await page.evaluate((leg) => {
      const w = window as unknown as { __probe?: { player?: [number, number] }; __teleport?: (x: number, z: number, f: number) => void };
      const p = w.__probe?.player; if (p && w.__teleport) w.__teleport(p[0], p[1], (leg % 4) * (Math.PI / 2) + 0.4);
    }, ++leg).catch(() => {});
    const s = await sample(page);
    if (!s) { console.log('  ⚠️  no renderer on the page'); break; }
    rows.push(s);
    const m = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`  ${m.padStart(4)} min  geo ${s.geo}  tex ${s.tex}  prog ${s.prog}  objs ${s.objs}  nodes ${s.nodes}  listeners ${s.listeners}  calls ${s.calls}  heap ${s.heap} MB  fps ${s.fps}  quality ${s.level}`);
  }
  await browser.close();
  if (rows.length < 3) { console.log('\nLINGER: too short to say ❌\n'); process.exit(1); }
  /*
   * The second half against the last sample — measured by *position in the
   * run*, not by sample number.
   *
   * She turns through four headings in the first minute, and the renderer
   * uploads a geometry or a texture the first time it is *seen* — so the
   * counts climb for as long as there is somewhere she has not looked yet,
   * and that is warming up, not leaking. This used to take the third sample
   * as the baseline, which is the same instant only if every area samples at
   * the same rate. It does not: the shop turns out fourteen samples in six
   * minutes and Turtle Lane five, so "the third" was 1.3 minutes in one area
   * and 4.1 in another — and Domino Station failed on four textures that had
   * all arrived before the second minute and never moved again. Half way
   * through is half way through whatever the cadence.
   *
   * Two more of each is the slack a late corner still gets. Draw calls depend
   * on where she is facing and are reported, not judged.
   */
  const a = rows[Math.min(Math.max(1, Math.floor(rows.length / 2)), rows.length - 2)];
  const b = rows[rows.length - 1];
  let bad = 0;
  const flat = (label: string, x: number, y: number, slack = 0) => {
    if (y > x + slack) { console.log(`  ❌ ${label} went up: ${x} → ${y}`); bad++; } else console.log(`  ✅ ${label} did not grow (${x} → ${y})`);
  };
  flat('geometries', a.geo, b.geo, 2);
  flat('textures', a.tex, b.tex, 2);
  flat('shader programs', a.prog, b.prog);
  flat('objects in the scene', a.objs, b.objs);
  flat('DOM nodes', a.nodes, b.nodes, 20);
  flat('event listeners', a.listeners, b.listeners, 4);
  console.log(`  ·  draw calls ${rows.map((r) => r.calls).join(' ')} (facing-dependent)`);
  if (a.heap > 0 && b.heap > a.heap * 1.25 + 10) { console.log(`  ❌ the heap grew: ${a.heap} → ${b.heap} MB`); bad++; } else console.log(`  ✅ the heap is not growing (${a.heap} → ${b.heap} MB)`);
  if (a.fps > 0 && b.fps < a.fps * 0.7) { console.log(`  ❌ the frame rate fell: ${a.fps} → ${b.fps}`); bad++; } else console.log(`  ✅ the frame rate held (${a.fps} → ${b.fps})`);
  /* Headless Chromium draws in software at about a frame a second, which is
     exactly the slowness the governor exists for: by the end it must have
     stepped down. On a machine that keeps up it stays at nought, and that is
     right too. */
  if (b.fps < 25 && b.level === 0) { console.log(`  ❌ frames ran long (${b.fps}/s) and the governor did nothing`); bad++; }
  else console.log(`  ✅ the governor ${b.level > 0 ? `stepped down to level ${b.level} while frames ran long` : 'had no cause to act'}`);
  console.log(bad ? `\nLINGER: ${bad} thing(s) only go up ❌\n` : '\nLINGER: as light after the last minute as the first. ✅\n');
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
