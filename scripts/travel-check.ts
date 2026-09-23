/**
 * The tournament's travellers: every leg they walk, every stop they make and
 * every day they are planned — without a browser.
 *
 *   npm run travel
 *
 * Twelve people crossing nine areas through every gate between them is
 * hundreds of legs and thousands of stops a day, which is exactly the size of
 * thing nobody can check by reading. So this does not read, it walks:
 *
 * - **The legs are the areas' legs.** `travel-paths.json` carries the
 *   fingerprint of the collision it was found against, and it must be the
 *   collision that stands. Then every leg is walked again against it at ten
 *   centimetres a sample, with the same step test `nav.ts` found it with —
 *   somewhere a body stands, off every ledge, out of every doorway it is not
 *   using and out of Kaiba's forecourt. A leg that passed when it was found
 *   and fails now is a wall that moved.
 * - **The stops are somewhere to stand.** With room round them, clear of
 *   every gate by more than a conversation, never in the forecourt.
 * - **The travellers are who the city says.** Every home is where the NPC's
 *   own record stands them, and every speed is a walk at the pace their model
 *   was drawn for, not a run and not a mime.
 * - **Forty-five days of plans keep the rules.** Every day begins and ends at
 *   home, out after five and back by ten; nobody is ever seen in the Starting
 *   Area, the Kame Game Shop or Black Crown Games; every walk is a leg that
 *   exists, and every change of area is through a gate and out of its partner
 *   (or across the street, unseen, for as long as walking it takes); no area
 *   has more people stopped in it than it holds; no two people stopped are
 *   ever within eight metres of each other, or of anybody at home there.
 */
import { AREAS, areaById, partnerOf, standingOn, type AreaId, type Rect } from '../src/story/areas';
import { lineClear, standsAt, pathLength, type NavPoint } from '../src/story/nav';
import { WORLD_NPCS } from '../src/story/npcs';
import { DUELIST_MODELS } from '../src/story/premade';
import { RUN_FROM } from '../src/story/gait';
import {
  CAPACITY,
  DAY_SECONDS,
  HOST_SPOT,
  KEEP_OUT,
  PATHS_FINGERPRINT,
  STOPS,
  TRANSIT_AREA,
  TRAVELLERS,
  TRAVEL_AREAS,
  bandOf,
  gatesIn,
  hopsFrom,
  keptOut,
  legBetween,
  nodeAt,
  planFor,
  secondsAt,
  travelFingerprint,
  type Segment,
} from '../src/story/travel';
import paths from '../src/story/generated/travel-paths.json';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

/* ------------------------------------------------------------------ */
console.log('\nThe legs');
check(PATHS_FINGERPRINT === travelFingerprint(), 'were found against the collision that stands', `file ${PATHS_FINGERPRINT}, areas ${travelFingerprint()} — run npm run travel:paths`);

const file = paths as unknown as { areas: Record<string, { nodes: Record<string, number[]>; legs: { a: string; b: string; len: number; points: number[] }[] }> };
let legCount = 0;
const badLegs: string[] = [];
for (const id of TRAVEL_AREAS) {
  const area = areaById(id);
  const band = bandOf(area);
  const data = file.areas[id];
  if (!data) {
    badLegs.push(`${id}: no legs at all`);
    continue;
  }
  for (const leg of data.legs) {
    legCount++;
    const pts: NavPoint[] = [];
    for (let k = 0; k < leg.points.length; k += 2) pts.push({ x: leg.points[k], z: leg.points[k + 1] });
    const doorOf = (node: string) => (node.startsWith('g:') ? node.slice(2) : null);
    const avoid: Rect[] = [
      ...area.doors.filter((d) => d.id !== doorOf(leg.a) && d.id !== doorOf(leg.b)).map((d) => d.trigger),
      ...(KEEP_OUT[id] ?? []),
    ];
    const start = nodeAt(id, leg.a);
    const end = nodeAt(id, leg.b);
    if (!start || !end || Math.hypot(pts[0].x - start.x, pts[0].z - start.z) > 0.01 || Math.hypot(pts[pts.length - 1].x - end.x, pts[pts.length - 1].z - end.z) > 0.01) {
      badLegs.push(`${id} ${leg.a} → ${leg.b}: does not run between its nodes`);
      continue;
    }
    const gate = gatesIn(id).find((g) => `g:${g.door.id}` === leg.a);
    let y = gate ? gate.mouthY : standingOn(area, pts[0].x, pts[0].z);
    for (let i = 1; i < pts.length; i++) {
      const next = lineClear(area, pts[i - 1], y, pts[i], undefined, band, avoid);
      if (next === null) {
        badLegs.push(`${id} ${leg.a} → ${leg.b}: corner ${i} (${pts[i].x}, ${pts[i].z})`);
        break;
      }
      y = next;
    }
    if (Math.abs(pathLength(pts) - leg.len) > 0.05) badLegs.push(`${id} ${leg.a} → ${leg.b}: length ${leg.len} is not the walk's ${pathLength(pts).toFixed(2)}`);
  }
}
check(badLegs.length === 0, `all ${legCount} of them are walkable, sample by sample, and out of every door they do not use`, badLegs.slice(0, 8).join(' · ') + (badLegs.length > 8 ? ` … ${badLegs.length} in all` : ''));

/* ------------------------------------------------------------------ */
console.log('\nThe stops');
const badStops: string[] = [];
for (const s of STOPS) {
  if (!TRAVEL_AREAS.includes(s.area)) {
    badStops.push(`${s.id}: in ${s.area}, where nobody travels`);
    continue;
  }
  const area = areaById(s.area);
  const y = standingOn(area, s.x, s.z);
  if (!standsAt(area, s.x, s.z, y, 0.8)) badStops.push(`${s.id}: no room to stand`);
  if (keptOut(s.area, s.x, s.z)) badStops.push(`${s.id}: in the forecourt`);
  for (const g of gatesIn(s.area)) {
    const d = Math.min(Math.hypot(g.mouth.x - s.x, g.mouth.z - s.z), Math.hypot(g.inner.x - s.x, g.inner.z - s.z));
    if (d < 7.8) badStops.push(`${s.id}: ${d.toFixed(1)} m from ${g.door.id}`);
  }
  if (s.area === HOST_SPOT.area && Math.hypot(HOST_SPOT.x - s.x, HOST_SPOT.z - s.z) < 8) badStops.push(`${s.id}: within talking distance of Kaiba`);
}
check(badStops.length === 0, `all ${STOPS.length} have room, are clear of the gates, and keep out of the forecourt`, badStops.join(' · '));
/* And clear of every home: somebody at home at the wrong hour — back early,
   out late — is somebody standing in front of whoever is stopped there. */
const nearHome = STOPS.flatMap((s) => TRAVELLERS.filter((t) => t.home.area === s.area && Math.hypot(t.home.x - s.x, t.home.z - s.z) < 8).map((t) => `${s.id} is ${Math.hypot(t.home.x - s.x, t.home.z - s.z).toFixed(1)} m from ${t.id}'s home`));
check(nearHome.length === 0, 'and more than a conversation from anybody\'s home', nearHome.join(' · '));
check(new Set(STOPS.map((s) => s.id)).size === STOPS.length, 'and no two share a name');
for (const id of TRAVEL_AREAS) check(STOPS.some((s) => s.area === id), `${areaById(id).name} has somewhere to stop`);

/* ------------------------------------------------------------------ */
console.log('\nThe travellers');
for (const t of TRAVELLERS) {
  const npc = WORLD_NPCS.find((n) => n.id === t.id);
  if (!npc) {
    check(false, `${t.id} is somebody in the city`);
    continue;
  }
  check(
    npc.area === t.home.area && Math.abs(npc.x - t.home.x) < 1e-9 && Math.abs(npc.z - t.home.z) < 1e-9,
    `${npc.character.name} lives where the record stands them`,
    `record ${npc.area} (${npc.x}, ${npc.z}), plan ${t.home.area} (${t.home.x}, ${t.home.z})`
  );
  const model = DUELIST_MODELS.find((m) => m.id === npc.character.model);
  check(t.speed < RUN_FROM, `and walks rather than runs`, `${t.speed} m/s against ${RUN_FROM.toFixed(2)}`);
  if (model && !model.still && model.walkSpeed) {
    const rate = t.speed / model.walkSpeed;
    check(rate >= 0.75 && rate <= 1.05, `at the pace their Walk was drawn for`, `${rate.toFixed(2)}× of ${model.walkSpeed} m/s`);
  }
  const area = areaById(t.home.area);
  check(standsAt(area, t.home.x, t.home.z, standingOn(area, t.home.x, t.home.z)), 'and home is somewhere to stand');
}

/* ------------------------------------------------------------------ */
console.log('\nForty-five days');
const SEEN_IN = new Set<AreaId>(TRAVEL_AREAS);
const problems = new Map<string, string[]>();
const note = (rule: string, what: string) => {
  const list = problems.get(rule) ?? [];
  if (list.length < 6) list.push(what);
  problems.set(rule, list);
};
const DAYS = 45;
const t0 = performance.now();
for (let k = 0; k < DAYS; k++) planFor(20500 + k * 37);
const perDay = (performance.now() - t0) / DAYS;
check(perDay < 25, `a day plans in ${perDay.toFixed(1)} ms`, 'too slow for a phone to do between two frames');

const visited = new Map<AreaId, number>();
for (let k = 0; k < DAYS; k++) {
  const day = 20500 + k * 37;
  const plan = planFor(day);
  const stops = new Map(STOPS.map((s) => [s.id, s]));
  for (const t of TRAVELLERS) {
    const segs = plan[t.id];
    const who = `${t.id} day ${day}`;
    if (!segs?.length) {
      note('every traveller has a day', who);
      continue;
    }
    if (segs[0].kind !== 'home' || segs[0].t0 !== 0) note('every day starts at home', who);
    if (segs[segs.length - 1].kind !== 'home' || Math.abs(segs[segs.length - 1].t1 - DAY_SECONDS) > 1e-6) note('every day ends at home', who);
    if (segs[0].t1 < secondsAt(5) - 1e-6) note('nobody is out before five', who);
    const lastOut = segs[segs.length - 1].t0;
    if (lastOut > secondsAt(22) + 1e-6) note('everybody is home by ten', `${who} at ${(lastOut / DAY_SECONDS * 24 + 2).toFixed(2)}h`);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (i > 0 && Math.abs(s.t0 - segs[i - 1].t1) > 1e-6) note('a day has no gaps', `${who} #${i}`);
      if (s.t1 < s.t0 - 1e-9) note('time runs forwards', `${who} #${i}`);
      if (s.kind === 'walk' || s.kind === 'wait') {
        if (!SEEN_IN.has(s.area)) note('nobody is seen outside the travel areas', `${who} in ${s.area}`);
        visited.set(s.area, (visited.get(s.area) ?? 0) + 1);
      }
      if (s.kind === 'walk') {
        const leg = legBetween(s.area, s.from, s.to);
        if (!leg) {
          note('every walk is a leg that exists', `${who} ${s.area} ${s.from} → ${s.to}`);
          continue;
        }
        if (Math.abs((s.t1 - s.t0) * s.speed - leg.len) > 0.05) note('every walk takes as long as walking it', `${who} ${s.from} → ${s.to}`);
        if (Math.abs(s.speed - t.speed) > 1e-9) note('everybody walks at their own pace', who);
      }
      if (s.kind === 'wait' && !stops.has(s.stop)) note('every stop is a stop', `${who} ${s.stop}`);
      /* Areas change through a gate and out of its partner, or across the street. */
      if (i > 0 && s.kind === 'walk') {
        const prev = segs[i - 1];
        const before = prev.kind === 'cross' ? segs[i - 2] : prev;
        if (before?.kind === 'walk' && before.area !== s.area) {
          const hop = hopsFrom(before.area).find((h) => h.to === s.area && h.exit === before.to && h.entry === s.from);
          if (!hop) note('areas change through gates that meet', `${who} ${before.area} ${before.to} → ${s.area} ${s.from}`);
          else if (hop.cross && prev.kind !== 'cross') note('the street is crossed, not skipped', `${who} ${before.area} → ${s.area}`);
          else if (!hop.cross && prev.kind === 'cross') note('only the street is crossed unseen', `${who} ${before.area} → ${s.area}`);
          else if (hop.cross && prev.kind === 'cross' && Math.abs((prev.t1 - prev.t0) * t.speed - hop.cross) > 0.05) note('crossing the street takes as long as walking it', who);
        }
      }
    }
  }
  /* Everybody stopped, sampled every three seconds: how many in each area,
     and how far from each other and from anybody at home. */
  for (let at = 0; at < DAY_SECONDS; at += 3) {
    const stopped: { id: string; area: AreaId; x: number; z: number }[] = [];
    const home: { id: string; area: AreaId; x: number; z: number }[] = [];
    for (const t of TRAVELLERS) {
      const segs = plan[t.id];
      let s: Segment | undefined;
      for (const seg of segs) if (seg.t0 <= at && at < seg.t1) s = seg;
      if (!s) continue;
      if (s.kind === 'wait') {
        const stop = stops.get(s.stop);
        if (stop) stopped.push({ id: t.id, area: s.area, x: stop.x, z: stop.z });
      } else if (s.kind === 'home') {
        home.push({ id: t.id, area: t.home.area, x: t.home.x, z: t.home.z });
      }
    }
    const count = new Map<AreaId, number>();
    for (const p of stopped) count.set(p.area, (count.get(p.area) ?? 0) + 1);
    for (const [area, n] of count) if (n > (CAPACITY[area] ?? 1)) note('no area has more people stopped in it than it holds', `${area} holds ${CAPACITY[area]}, ${n} at ${(at / DAY_SECONDS * 24 + 2).toFixed(2)}h day ${day}`);
    for (let i = 0; i < stopped.length; i++) {
      for (let j = i + 1; j < stopped.length; j++) {
        const a = stopped[i];
        const b = stopped[j];
        if (a.area === b.area && Math.hypot(a.x - b.x, a.z - b.z) < 8) note('nobody stops within eight metres of anybody else stopped', `${a.id} & ${b.id} day ${day}`);
      }
      for (const h of home) {
        const a = stopped[i];
        if (a.area === h.area && Math.hypot(a.x - h.x, a.z - h.z) < 8) note('or of anybody at home', `${a.id} & ${h.id} day ${day}`);
      }
      if (stopped[i].area === HOST_SPOT.area && Math.hypot(stopped[i].x - HOST_SPOT.x, stopped[i].z - HOST_SPOT.z) < 8) note('or of Kaiba', `${stopped[i].id} day ${day}`);
    }
  }
}
const RULES = [
  'every traveller has a day',
  'every day starts at home',
  'every day ends at home',
  'nobody is out before five',
  'everybody is home by ten',
  'a day has no gaps',
  'time runs forwards',
  'nobody is seen outside the travel areas',
  'every walk is a leg that exists',
  'every walk takes as long as walking it',
  'everybody walks at their own pace',
  'every stop is a stop',
  'areas change through gates that meet',
  'the street is crossed, not skipped',
  'only the street is crossed unseen',
  'crossing the street takes as long as walking it',
  'no area has more people stopped in it than it holds',
  'nobody stops within eight metres of anybody else stopped',
  'or of anybody at home',
  'or of Kaiba',
];
for (const rule of RULES) check(!problems.has(rule), rule, (problems.get(rule) ?? []).join(' · '));
for (const id of TRAVEL_AREAS) {
  const n = visited.get(id) ?? 0;
  check(n > DAYS * 2, `${areaById(id).name} is visited`, `${n} walks and stops in ${DAYS} days`);
}
check(!TRAVEL_AREAS.includes(TRANSIT_AREA) && !TRAVEL_AREAS.includes('grandpa-shop') && !TRAVEL_AREAS.includes('crown-shop'), 'the street and both card shops are nobody\'s to wander');
/* Every gate a traveller uses is a real doorway with a partner on the far side. */
const orphan = TRAVEL_AREAS.flatMap((id) => AREAS[id].doors.filter((d) => (TRAVEL_AREAS.includes(d.to) || d.to === TRANSIT_AREA) && !partnerOf(d, id)).map((d) => `${id}:${d.id}`));
check(orphan.length === 0, 'and every gate they use has a partner', orphan.join(', '));

console.log(
  failures === 0
    ? `\nTRAVEL: ${legCount} legs, ${STOPS.length} stops, ${TRAVELLERS.length} travellers, ${DAYS} days — every step and every stop in order. ✅\n`
    : `\n${failures} thing(s) wrong with the travellers. ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
