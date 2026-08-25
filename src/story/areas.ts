/**
 * The places the world is made of, and what you can and cannot walk through.
 *
 * Story Mode used to be one field with a radius: an unbounded plain of grass
 * that stopped because a number said so, with the horizon fading into haze. That
 * is a harness, not a world. This file replaces it with **named areas** — real
 * rooms and streets with walls, doors between them, and an edge you cannot reach
 * because something is standing in the way.
 *
 * No three.js in here, deliberately, exactly like `npcs.ts` and `premade.ts`.
 * This is what a place *is* — how big, what is solid, where the doors go. What
 * one *looks like* is `src/components/story/world/`, and the two are kept apart
 * so that moving a wall is editing a number rather than editing a renderer.
 *
 * ## The rule about the edge
 *
 * **You must never be able to stand at the edge of the geometry and look out
 * into the void.** Beyond every area is black — no sky, no ground, nothing — and
 * the whole illusion depends on the player never reaching a place where that
 * black is the thing in front of them at eye level. So every area is enclosed by
 * *things*: walls in a room, building fronts and railings in a street. The
 * walkable rectangle is drawn a little inside those, so the player is stopped by
 * a shopfront rather than by an invisible plane, and the black is only ever seen
 * over a rooftop.
 *
 * That is why `bounds` and `solids` are separate. `bounds` is the outer limit,
 * set inside the enclosing geometry as a backstop; `solids` are what you
 * actually bump into. A correct area is one where you never touch `bounds`.
 *
 * ## Collision
 *
 * Axis-aligned rectangles, and nothing more. A duelist is a circle of
 * `PLAYER_RADIUS` pushed out of any rectangle it ends up inside, along whichever
 * axis it is least deep into — which is the standard cheap resolution and is
 * exactly right for a world built out of walls, counters and buildings. Anything
 * round is approximated by the box around it; at walking pace nobody can tell,
 * and the alternative is a physics engine for a game that does not have physics.
 */

/** Every area that exists. Names here are the ones to use when talking about them. */
export type AreaId = 'grandpa-shop' | 'starting-area';

/** A rectangle on the ground, centred on (x, z). */
export interface Rect {
  x: number;
  z: number;
  /** Half-extents, so a 4 m wide wall has `hw: 2`. */
  hw: number;
  hd: number;
  /**
   * Tall enough to put the camera behind — a wall or a building, not a bench.
   *
   * The camera sits several metres back from the duelist, which in an eleven
   * metre room is regularly *outside the building*. So it is pulled in until it
   * clears whatever is between it and the player, and this is the flag that says
   * what counts: a wall does, a counter does not. Without the distinction the
   * camera would slam into the player's back every time they walked past a
   * bench, which is worse than the problem it fixes.
   */
  tall?: boolean;
}

/**
 * A way out of one area and into another.
 *
 * The trigger is a rectangle you walk into rather than a button you press: a
 * doorway you are standing in the middle of is a doorway you meant to use, and
 * a prompt would be one more thing between the player and the next room.
 */
export interface Door {
  id: string;
  /** Walk into this and you leave. */
  trigger: Rect;
  to: AreaId;
  /** Where you arrive, in the target area's coordinates. */
  spawn: { x: number; z: number; facing: number };
  /** Shown briefly as the transition plays — "Kame Game Shop", "The Street". */
  label: string;
}

export interface Area {
  id: AreaId;
  /** What this place is called, for the player and for us. */
  name: string;
  /**
   * Interior rooms are lit and shaded differently from streets, and the camera
   * is held closer in one than the other. One flag rather than two builders'
   * worth of duplicated decisions.
   */
  kind: 'interior' | 'exterior';
  /** The outer limit of walking, set *inside* the enclosing geometry. */
  bounds: Rect;
  /** Everything you cannot walk through. */
  solids: Rect[];
  doors: Door[];
  /** Where a player with no saved position starts. */
  spawn: { x: number; z: number; facing: number };
}

/** A duelist is about this wide through the shoulders. */
export const PLAYER_RADIUS = 0.38;

/* ------------------------------------------------------------------ */
/* Grandpa's Shop Area                                                 */
/* ------------------------------------------------------------------ */

/**
 * The Kame Game Shop, from the inside. Where Story Mode opens.
 *
 * Eleven metres by eight and a half, which is a shop rather than a hall: big
 * enough that the camera has somewhere to sit behind you, small enough that the
 * counter is the first thing you see and Grandpa is behind it.
 *
 * The room is a ring of wall solids one metre thick rather than four thin
 * planes, because a thin wall is a wall you can be pushed through by a bad
 * frame — a metre of depth means the resolution always has somewhere to put
 * you. They sit *outside* `bounds`, so the backstop catches anything the wall
 * boxes somehow miss.
 */
/*
 * Thirteen metres by eleven.
 *
 * It started at 11 x 8.5, which is a real shop and was too small for the
 * *camera*. The walking shot sits four and a half metres behind the duelist, and
 * in a room 8.5 deep that is through the front wall from almost anywhere — so
 * the camera spent the whole room clamped hard against the player's back,
 * looking at their shoulder blades. Enlarging the room is the honest fix: the
 * alternative is a camera so close that the shop is never actually seen.
 */
const SHOP_W = 6.5;   // half-width, so 13 m across
const SHOP_D = 5.5;   // half-depth, so 11 m deep

const GRANDPA_SHOP: Area = {
  id: 'grandpa-shop',
  name: "Grandpa's Shop",
  kind: 'interior',
  /* Half a metre inside the walls: the player is stopped by the wall solids
     below long before this, and this only exists so a bug cannot put anybody
     outside the room. */
  bounds: { x: 0, z: 0, hw: SHOP_W - 0.4, hd: SHOP_D - 0.4 },
  solids: [
    /* The four walls, a metre thick, centred just outside the room. */
    { x: 0, z: -SHOP_D - 0.5, hw: SHOP_W + 1, hd: 0.5, tall: true },   // back wall (shelves)
    { x: 0, z: SHOP_D + 0.5, hw: SHOP_W + 1, hd: 0.5, tall: true },    // front wall (door + window)
    { x: -SHOP_W - 0.5, z: 0, hw: 0.5, hd: SHOP_D + 1, tall: true },   // left wall
    { x: SHOP_W + 0.5, z: 0, hw: 0.5, hd: SHOP_D + 1, tall: true },    // right wall

    /*
     * The counter Grandpa works behind, and the reason the room reads as a shop
     * the moment you walk in. You cannot get round it: it runs from the left
     * wall to within a metre of the right, and the gap at that end is where he
     * stands, not where you go.
     */
    { x: -1.1, z: -2.6, hw: 3.9, hd: 0.55 },

    /* Shelf units down both side walls, and the display case by the window. */
    { x: -SHOP_W + 0.55, z: 0.6, hw: 0.55, hd: 2.4 },
    { x: SHOP_W - 0.55, z: -0.9, hw: 0.55, hd: 2.8 },
    { x: SHOP_W - 0.7, z: 3.0, hw: 0.7, hd: 0.6 },
  ],
  doors: [
    {
      id: 'shop-to-street',
      /* Inside the doorway, against the front wall, slightly into the room so
         you cross it walking out rather than grazing it walking past. */
      /*
       * Well inside the room, not in the doorway.
       *
       * It was against the front wall, and the wall is also where the bounds
       * clamp stops you — leaving a band 22 cm wide that you had to land inside
       * to leave the shop. In practice you walk up to the door and nothing
       * happens. A door is not a precision test: this one is a metre and a half
       * deep and you cross it on the way to the handle.
       */
      /*
       * Generous, and it has been widened twice.
       *
       * A door is not a target you aim at — it is the end of a walk. Both
       * earlier versions were technically reachable and repeatedly missed in
       * testing by a few centimetres, which in play is a player pressing towards
       * their own front door and nothing happening. This covers the whole
       * approach: from a metre and a half inside the room out to the wall.
       */
      trigger: { x: 2.6, z: 4.0, hw: 1.05, hd: 1.1 },
      to: 'starting-area',
      /*
       * On the pavement outside the shop, facing down the street.
       *
       * z −7.2, not −11.4. The first version put the arrival *inside the shop's
       * own building* — the north terrace runs from z −17 to −9 — so stepping
       * out of the door landed you in solid geometry and the collision pass
       * shoved you back out through whichever wall was nearest.
       */
      spawn: { x: 2.6, z: -7.2, facing: Math.PI },
      label: 'The Street',
    },
  ],
  /* Just inside the door, facing into the shop — so the first thing a new
     duelist sees is the counter and the man behind it. */
  /*
   * Well inside the door rather than in it.
   *
   * Two reasons, and the second is not obvious. The camera needs somewhere to
   * stand behind you, which a spawn against the front wall does not give it. And
   * the door is a *trigger*: spawn inside its rectangle and you walk straight
   * back out of the room you just entered.
   */
  spawn: { x: 2.6, z: SHOP_D - 4.3, facing: Math.PI },
};

/* ------------------------------------------------------------------ */
/* Starting Area                                                       */
/* ------------------------------------------------------------------ */

/**
 * The street outside the shop. Four times the floor area of the room, which is
 * the difference between "somewhere to stand" and "somewhere to go".
 *
 * Enclosed on all four sides and every one of them is a *thing*: the shop's own
 * building and its neighbours across the top, a terrace down the far side, and
 * the two ends closed by a hoarding and a railed-off alley. Nothing here is an
 * invisible wall — walk in any direction and you are stopped by something you
 * can see and could have predicted.
 */
const ST_W = 22;   // half-width, so 44 m across
const ST_D = 17;   // half-depth, so 34 m deep

const STARTING_AREA: Area = {
  id: 'starting-area',
  name: 'Starting Area',
  kind: 'exterior',
  bounds: { x: 0, z: 0, hw: ST_W - 1, hd: ST_D - 1 },
  solids: [
    /*
     * The shop's terrace, along the north side (−Z). The shopfront itself is at
     * x ≈ 2.6, which is where the door lines up with the interior's.
     */
    /*
     * Two slabs with a doorway between them, and the doorway is 1.6 m wide.
     *
     * It was four overlapping slabs leaving a gap of 0.8 m — which a duelist of
     * radius 0.38 fits through with 2 cm either side, so walking into your own
     * shop was a game of millimetres. One solid each side, meeting the shop's
     * own frontage, is both easier to reason about and passable at a walk.
     */
    { x: -10.1, z: -ST_D + 4, hw: 11.9, hd: 4, tall: true },
    { x: 12.7, z: -ST_D + 4, hw: 9.3, hd: 4, tall: true },

    /* The terrace opposite, along the south side (+Z). Unbroken. */
    { x: 0, z: ST_D - 3.5, hw: ST_W, hd: 3.5, tall: true },

    /* West end: a hoarding across a building site. */
    { x: -ST_W + 2, z: 0, hw: 2, hd: ST_D, tall: true },
    /* East end: a railed-off alley mouth. */
    { x: ST_W - 2, z: 0, hw: 2, hd: ST_D, tall: true },

    /* Street furniture, which is what stops the middle being an empty car park. */
    { x: -9.5, z: -6.9, hw: 0.28, hd: 0.28 },   // lamp post, north pavement
    { x: 9.5, z: -6.9, hw: 0.28, hd: 0.28 },    // lamp post, north pavement
    { x: -9.5, z: 7.9, hw: 0.28, hd: 0.28 },    // lamp post, south pavement
    { x: 9.5, z: 7.9, hw: 0.28, hd: 0.28 },     // lamp post, south pavement
    { x: -4.2, z: 8.6, hw: 1.0, hd: 0.42 },     // bench
    { x: 13.5, z: 8.6, hw: 1.0, hd: 0.42 },     // bench
    { x: -14.5, z: -7.5, hw: 0.9, hd: 0.9 },    // planter
    { x: 15.5, z: -7.5, hw: 0.9, hd: 0.9 },     // planter
    { x: 17.6, z: -4.0, hw: 0.5, hd: 0.85 },    // vending machine
    { x: -17.2, z: 2.5, hw: 0.55, hd: 0.55 },   // post box
  ],
  doors: [
    {
      id: 'street-to-shop',
      /* In the shop's doorway, on the pavement side. */
      /* In front of the shop door, and deeper than the pavement is wide, so
         walking at the door always crosses it. */
      trigger: { x: 2.6, z: -8.3, hw: 1.05, hd: 0.75 },
      to: 'grandpa-shop',
      /* Inside the shop, clear of its own door trigger, looking at the counter. */
      spawn: { x: 2.6, z: 2.6, facing: Math.PI },
      label: 'Kame Game Shop',
    },
  ],
  /* On the pavement outside the shop — the same place the shop's door lands
     you, so arriving here by either route puts you in the same spot. */
  spawn: { x: 2.6, z: -7.2, facing: Math.PI },
};

export const AREAS: Record<AreaId, Area> = {
  'grandpa-shop': GRANDPA_SHOP,
  'starting-area': STARTING_AREA,
};

/** Where a brand new duelist begins: inside the shop, in front of Grandpa. */
export const FIRST_AREA: AreaId = 'grandpa-shop';

export function areaById(id: unknown): Area {
  return (typeof id === 'string' && id in AREAS ? AREAS[id as AreaId] : AREAS[FIRST_AREA]);
}

/* ------------------------------------------------------------------ */
/* Geometry helpers, shared by the renderer and the save route          */
/* ------------------------------------------------------------------ */

export function inside(r: Rect, x: number, z: number): boolean {
  return Math.abs(x - r.x) <= r.hw && Math.abs(z - r.z) <= r.hd;
}

/**
 * Pushes a circle out of a rectangle, along whichever axis it is least deep in.
 *
 * Returns the corrected position, or null when there was nothing to correct.
 * Least-depth is what makes a corner behave: pushed along the shorter overlap,
 * a duelist walking into the end of a counter slides along the front of it
 * instead of being fired sideways across the room.
 */
export function pushOut(
  r: Rect,
  x: number,
  z: number,
  radius: number
): { x: number; z: number } | null {
  const dx = x - r.x;
  const dz = z - r.z;
  const overlapX = r.hw + radius - Math.abs(dx);
  const overlapZ = r.hd + radius - Math.abs(dz);
  if (overlapX <= 0 || overlapZ <= 0) return null;
  if (overlapX < overlapZ) {
    return { x: r.x + Math.sign(dx || 1) * (r.hw + radius), z };
  }
  return { x, z: r.z + Math.sign(dz || 1) * (r.hd + radius) };
}

/**
 * Everything that stops a duelist in one area: its solids, then its bounds.
 *
 * Order matters. Solids first, because that is what the player is actually
 * meant to hit, and the bounds clamp last so that a push out of a wall cannot
 * leave somebody outside the room.
 */
export function settle(
  area: Area,
  x: number,
  z: number,
  radius: number
): { x: number; z: number } {
  let px = x;
  let pz = z;
  for (const solid of area.solids) {
    const fixed = pushOut(solid, px, pz, radius);
    if (fixed) {
      px = fixed.x;
      pz = fixed.z;
    }
  }
  const b = area.bounds;
  px = Math.max(b.x - b.hw + radius, Math.min(b.x + b.hw - radius, px));
  pz = Math.max(b.z - b.hd + radius, Math.min(b.z + b.hd - radius, pz));
  return { x: px, z: pz };
}

/** The door whose trigger contains this point, if any. */
export function doorAt(area: Area, x: number, z: number): Door | null {
  return area.doors.find((d) => inside(d.trigger, x, z)) ?? null;
}

/**
 * How far the camera may sit back along a ray before something tall is in the way.
 *
 * A 2D slab test against every tall solid, plus the area's own bounds, marching
 * outwards from the duelist. The camera is placed at whatever comes first: the
 * distance it asked for, or a hand's width in front of the wall it would
 * otherwise be standing in.
 *
 * Only the horizontal geometry is considered, which is a simplification that
 * holds because everything marked `tall` in this world runs from the floor to
 * well above head height. A world with a low wall you could see over would need
 * the real thing.
 */
export function cameraReach(
  area: Area,
  fromX: number,
  fromZ: number,
  dirX: number,
  dirZ: number,
  want: number,
  clearance = 0.35
): number {
  let best = want;

  const slab = (r: Rect) => {
    /* Grown by the clearance so the camera stops short of the surface rather
       than with its near plane inside it. */
    const minX = r.x - r.hw - clearance;
    const maxX = r.x + r.hw + clearance;
    const minZ = r.z - r.hd - clearance;
    const maxZ = r.z + r.hd + clearance;
    let t0 = 0;
    let t1 = best;
    for (const [o, d, lo, hi] of [
      [fromX, dirX, minX, maxX],
      [fromZ, dirZ, minZ, maxZ],
    ] as const) {
      if (Math.abs(d) < 1e-6) {
        if (o < lo || o > hi) return;
        continue;
      }
      let a = (lo - o) / d;
      let b = (hi - o) / d;
      if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a);
      t1 = Math.min(t1, b);
      if (t0 > t1) return;
    }
    if (t0 > 0 && t0 < best) best = t0;
  };

  for (const solid of area.solids) if (solid.tall) slab(solid);

  /* The bounds are a box the camera must stay *inside*, which is the opposite
     test: find where the ray leaves it. */
  const b = area.bounds;
  for (const [o, d, lo, hi] of [
    [fromX, dirX, b.x - b.hw - 0.9, b.x + b.hw + 0.9],
    [fromZ, dirZ, b.z - b.hd - 0.9, b.z + b.hd + 0.9],
  ] as const) {
    if (Math.abs(d) < 1e-6) continue;
    const exit = d > 0 ? (hi - o) / d : (lo - o) / d;
    if (exit > 0 && exit < best) best = exit;
  }

  return Math.max(0.9, best);
}

/**
 * Where a saved position actually puts you, which is not always where it says.
 *
 * Two ways a stored position can be meaningless, and both have to be caught here
 * rather than trusted:
 *
 * - **It predates areas.** The world used to be one open field 120 metres
 *   across, so a save from then holds coordinates like (9.5, 14.5) — a real
 *   place in a world that no longer exists, and a point well outside every room
 *   in the one that replaced it. Resolving only the *area* and keeping the
 *   numbers drops the player into the void outside the shop, looking at the
 *   backs of its walls. Which is exactly what it did.
 * - **The geometry moved.** Areas are still being built; a wall that shifts a
 *   metre can leave a previously-valid save inside it.
 *
 * So a position is only kept if it is inside the area it names. Anything else
 * gets that area's spawn, which is always somewhere a person can stand.
 */
export function landing(
  world: { area?: AreaId; x: number; z: number; facing: number } | null | undefined
): { area: AreaId; x: number; z: number; facing: number } {
  const area = areaById(world?.area);
  if (!world || !world.area || !Number.isFinite(world.x) || !Number.isFinite(world.z)) {
    return { area: area.id, ...area.spawn };
  }
  const b = area.bounds;
  const within =
    Math.abs(world.x - b.x) <= b.hw && Math.abs(world.z - b.z) <= b.hd;
  if (!within) return { area: area.id, ...area.spawn };
  const settled = settle(area, world.x, world.z, PLAYER_RADIUS);
  return { area: area.id, x: settled.x, z: settled.z, facing: world.facing };
}
