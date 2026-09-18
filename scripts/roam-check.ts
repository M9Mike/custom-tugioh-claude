/**
 * Everybody who walks, and whether they have anywhere to walk.
 *
 *   npm run roam
 *
 * Three people in the city move under their own steam and a fourth is coming
 * every time Mike sends another one, so the things that go wrong with a route
 * are worth measuring rather than eyeballing. All four of them have:
 *
 * - **A point inside something.** The precinct at Domino Shrine is 64 × 52 m
 *   and looks empty on a plan; it has lanterns at x ±5.6, a font, a bench, two
 *   groves and a hall in the middle of it. Three of my first six candidate legs
 *   ran through one of those, and the symptom in the world is not a character
 *   standing in a lantern — `settle` shoves her out and she walks the rest of
 *   the lap along a line she was never authored on.
 * - **A speed that makes her run.** The rig picks its clip off a fraction of
 *   `TOP_SPEED` and blends towards Run from 0.62 of it, so a route over
 *   2.05 m/s is a character sprinting everywhere. Tina shipped doing exactly
 *   that for a week: 1.15 m/s of ground under a full Run clip, because her
 *   stride was being divided by a different number from the player's.
 * - **A speed that makes her mime.** The other end of the same rule. A clip
 *   plays at ground speed over its own rated coverage, so a route at three
 *   fifths of the rating is a walk in slow motion — every step longer than the
 *   ground it covers, which is the exact look of somebody sliding.
 * - **Two prompts at once.** Talk range is 3.2 m and the prompt names one
 *   person, so two characters who can come within the sum of their ranges are
 *   a choice of two conversations the world never offers. It is why Ash's own
 *   check keeps him 6.6 m from Grandpa, and with three sisters sharing one yard
 *   it is the rule that shapes the routes: theirs never close inside 7.6 m.
 *
 * `npm run ash` still walks his schedule and his two haunts; this is the same
 * measurement over everybody at once, so the next roamer is covered the day
 * they land rather than the day somebody remembers to add them.
 */
import { areaById, groundAt, settle, standingOn, inside } from '../src/story/areas';
import { WORLD_NPCS, type RoamRoute, type WorldNpc } from '../src/story/npcs';
import { DUELIST_MODELS } from '../src/story/premade';
import { RUN_FROM, TOP_SPEED } from '../src/story/gait';

let failures = 0;
const check = (ok: boolean, what: string, detail = '') => {
  console.log(`  ${ok ? '✅' : '❌'} ${what}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failures++;
};

/** Where a body may be pushed out of, which is the width of one. */
const R = 0.4;
/** Forty samples a leg, the same resolution `npm run ash` walks his at. */
const PER_LEG = 40;

interface Walk {
  who: string;
  area: string;
  route: RoamRoute;
  /** Where the character is standing when the area is built. */
  from: { x: number; z: number };
  range: number;
  model: string;
  /**
   * Somebody with no body to be pushed out of.
   *
   * A `spirit` is translucent, shadowless and walked *through* rather than
   * round — the player is never shoved by one, and one is never shoved by a
   * headstone. So Isha drifting through the old cemetery's stones is the point
   * of her rather than a fault in her route, and the count is reported instead
   * of failed. Everybody with a body still has to have somewhere to put it.
   */
  spirit: boolean;
}

/** Every route in the world: the ones on a record, and the ones on a haunt. */
const walks: Walk[] = [];
for (const npc of WORLD_NPCS) {
  if (npc.roam) {
    walks.push({ who: npc.id, area: npc.area, route: npc.roam, from: { x: npc.x, z: npc.z }, range: npc.range, model: npc.character.model, spirit: !!npc.spirit });
  }
  for (const haunt of npc.haunts ?? []) {
    if (!haunt.roam) continue;
    /* A haunt's own area and start, which for everybody but the first one is
       not the record's. */
    walks.push({ who: `${npc.id} @ ${haunt.area}`, area: haunt.area, route: haunt.roam, from: { x: haunt.x, z: haunt.z }, range: npc.range, model: npc.character.model, spirit: !!npc.spirit });
  }
}

/** The points a route actually passes through, with the floor under each. */
function samples(area: ReturnType<typeof areaById>, route: RoamRoute, from: { x: number; z: number }) {
  const out: { x: number; z: number; y: number; moved: number; out: boolean }[] = [];
  let y = standingOn(area, from.x, from.z);
  for (let i = 0; i + 1 < route.path.length; i++) {
    const a = route.path[i];
    const b = route.path[i + 1];
    for (let k = 0; k <= PER_LEG; k++) {
      const t = k / PER_LEG;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      y = groundAt(area, x, z, y);
      const s = settle(area, x, z, R, y);
      out.push({ x, z, y, moved: Math.hypot(s.x - x, s.z - z), out: !inside(area.bounds, x, z) });
    }
  }
  return out;
}

const sampled = new Map<string, ReturnType<typeof samples>>();

console.log('\nEverybody who walks\n');
for (const walk of walks) {
  const area = areaById(walk.area);
  const model = DUELIST_MODELS.find((m) => m.id === walk.model);
  console.log(`${walk.who} — ${walk.area}`);

  check(walk.route.path.length >= 2, 'a route of at least two points', `${walk.route.path.length}`);
  /* The record is the route's first point, written once. Read twice, the two
     drift, and the character is built standing somewhere she never walks. */
  const head = walk.route.path[0];
  check(
    Math.abs(head.x - walk.from.x) < 1e-9 && Math.abs(head.z - walk.from.z) < 1e-9,
    'and it starts where the record says they stand',
    `(${walk.from.x}, ${walk.from.z}) against (${head.x}, ${head.z})`
  );

  const points = samples(area, walk.route, walk.from);
  sampled.set(walk.who, points);
  const stuck = [...new Set(points.filter((p) => p.moved > 0.02).map((p) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`))];
  if (walk.spirit) {
    console.log(`  ·  a spirit, so nothing here is asked to make room for them${stuck.length ? ` — ${stuck.length} step(s) pass through something` : ''}`);
  } else {
    check(stuck.length === 0, 'every step of it is somewhere they can stand', stuck.slice(0, 6).join(' · ') + (stuck.length > 6 ? ` … ${stuck.length} in all` : ''));
  }
  const outside = points.filter((p) => p.out);
  check(outside.length === 0, 'and inside the area', outside.length ? `${outside.length} sample(s) out of bounds` : '');

  const len = walk.route.path.slice(1).reduce((m, p, i) => m + Math.hypot(p.x - walk.route.path[i].x, p.z - walk.route.path[i].z), 0);
  console.log(`  ·  ${len.toFixed(1)} m each way at ${walk.route.speed} m/s — ${(len / walk.route.speed).toFixed(0)}s a leg, height ${Math.min(...points.map((p) => p.y)).toFixed(2)}–${Math.max(...points.map((p) => p.y)).toFixed(2)} m`);

  check(
    walk.route.speed < RUN_FROM,
    'they walk it rather than run it',
    `${walk.route.speed} m/s against ${RUN_FROM.toFixed(2)} (${(walk.route.speed / TOP_SPEED).toFixed(2)} of top speed)`
  );
  /*
   * And the clip is playing at something like its own rate.
   *
   * Only for a model that has clips: a `still` model has no Walk to be slowed
   * down, and the root-level breath it gets instead is rated for nothing.
   */
  if (model && !model.still && model.walkSpeed) {
    const rate = walk.route.speed / model.walkSpeed;
    check(rate >= 0.75 && rate <= 1.05, 'at something like the pace their Walk was drawn for', `${rate.toFixed(2)}× of ${model.walkSpeed} m/s`);
  }
}

/*
 * And nobody can stand close enough to somebody else to offer two
 * conversations at once. Static characters count as a route of one point.
 */
console.log('\nTwo prompts at once\n');
const spots = (npc: WorldNpc): { area: string; points: { x: number; z: number }[] }[] => {
  /* Gathered per area, not per route: a character with haunts carries the
     first one on the record as well, so Ash is in Grandpa's shop twice and the
     same pair would otherwise be judged — and reported — twice over. */
  const byArea = new Map<string, { x: number; z: number }[]>();
  const add = (area: string, points: { x: number; z: number }[]) => {
    const had = byArea.get(area);
    if (had) had.push(...points);
    else byArea.set(area, [...points]);
  };
  if (npc.roam) add(npc.area, sampled.get(npc.id) ?? npc.roam.path.map((p) => ({ x: p.x, z: p.z })));
  else add(npc.area, [{ x: npc.x, z: npc.z }]);
  for (const haunt of npc.haunts ?? []) {
    add(
      haunt.area,
      haunt.roam ? sampled.get(`${npc.id} @ ${haunt.area}`) ?? haunt.roam.path.map((p) => ({ x: p.x, z: p.z })) : [{ x: haunt.x, z: haunt.z }]
    );
  }
  return [...byArea.entries()].map(([area, points]) => ({ area, points }));
};

let pairs = 0;
for (let i = 0; i < WORLD_NPCS.length; i++) {
  for (let j = i + 1; j < WORLD_NPCS.length; j++) {
    const a = WORLD_NPCS[i];
    const b = WORLD_NPCS[j];
    for (const pa of spots(a)) {
      for (const pb of spots(b)) {
        if (pa.area !== pb.area) continue;
        pairs++;
        let min = Infinity;
        for (const x of pa.points) for (const y of pb.points) {
          min = Math.min(min, Math.hypot(x.x - y.x, x.z - y.z));
        }
        const want = a.range + b.range;
        check(min > want, `${a.id} and ${b.id} keep out of each other's talk range in ${pa.area}`, `${min.toFixed(2)} m against ${want.toFixed(1)}`);
      }
    }
  }
}
if (!pairs) console.log('  ·  nobody shares an area with anybody');

console.log(
  failures === 0
    ? `\nROAM: ${walks.length} route(s), every step of them walkable. ✅\n`
    : `\n${failures} thing(s) wrong with the routes. ❌\n`
);
process.exit(failures === 0 ? 0 : 1);
