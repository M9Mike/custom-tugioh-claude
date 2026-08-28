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
export type AreaId =
  | 'grandpa-shop'
  | 'starting-area'
  | 'market-row'
  | 'step-lane'
  | 'domino-shrine';

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
/** A flat area standing proud of the ground, and how far proud. */
export interface Platform {
  x: number;
  z: number;
  hw: number;
  hd: number;
  /** Height of its surface, in metres above the area's floor. */
  y: number;
}

export interface Door {
  id: string;
  /** Walk into this and you leave. */
  trigger: Rect;
  to: AreaId;
  /**
   * The threshold itself, in **this** area's coordinates.
   *
   * Two doors that connect are two sides of one doorway, and this says where
   * that doorway is. Put both through `toWorld` and they have to land on the
   * same spot in Domino City. That assertion is the entire reason `world`
   * exists: it is what stops the city drifting apart as it grows, and it is
   * checked by `npm run areas`.
   */
  seam: { x: number; z: number };
  /**
   * Where you stand, and which way you are turned, when you come **in** through
   * this doorway. In this area's coordinates.
   *
   * ## Why the arrival lives with the door you arrive through
   *
   * This used to be `spawn`, and it held the coordinates of where you land in
   * the *other* area. Two areas, each storing the other's numbers: opening the
   * shop meant editing the street, moving the street's pavement meant hunting
   * through the shop, and nothing anywhere checked that the two agreed. With
   * two areas that is a nuisance. With thirty-six it is a bug generator, and
   * the bugs it generates are the silent kind — a door that lands you a metre
   * inside a wall, and no test that can tell.
   *
   * So a door now owns exactly one arrival: its own. Every number in this
   * object shares a coordinate space with the `trigger` directly above it,
   * which means nobody editing an area ever types a coordinate belonging to an
   * area they are not looking at. Walking A → B reads B's return door and uses
   * **its** arrival — that is `arrivalThrough`.
   *
   * Two things it must clear, both checked: every solid, because you cannot
   * arrive inside a wall; and every door trigger in the area, because arriving
   * in one walks you straight back out of the room you just entered.
   */
  arrive: { x: number; z: number; facing: number };
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
  /**
   * Where this area's origin sits in Domino City. Metres; +X is east, +Z south.
   *
   * ## It does not move any geometry
   *
   * Areas are still built at their own origin and only one is ever in the scene,
   * so nothing in `world/` reads this and nothing renders differently because of
   * it. What it buys is the one thing hand-matched doors could never give:
   * **a single place every area can be compared in.**
   *
   * With it, "the shop's door and the street's door are the same door" stops
   * being a promise in a comment and becomes arithmetic — `toWorld` both seams
   * and they must agree. It also makes two whole classes of mistake findable
   * that were previously invisible: an area dropped in the wrong ward, and two
   * areas whose walkable floors occupy the same ground in the city.
   *
   * The Starting Area is the origin, because that is where the game starts and
   * an origin has to be something. Everything else is measured from it.
   */
  world: { x: number; z: number };
  /** The outer limit of walking, set *inside* the enclosing geometry. */
  bounds: Rect;
  /** Everything you cannot walk through. */
  solids: Rect[];
  /**
   * Raised surfaces you can stand on, and how high they are.
   *
   * The pavements are 14 cm of kerb above the road, and the duelist was drawn at
   * y = 0 everywhere — so walking onto one buried both feet to the ankle. The
   * geometry was always right; nothing was reading it.
   *
   * Rectangles rather than a heightfield because that is what the world is: flat
   * planes at two or three heights, with a kerb between them. A mesh sample per
   * frame would be a raycast to answer a question the layout already knows.
   */
  platforms?: Platform[];
  /**
   * Rectangles the camera is stopped by but the player is not.
   *
   * A doorway is a hole in the collision on purpose — you have to be able to
   * walk through it. The camera does not, and letting it treat the hole the same
   * way is how stepping out of the shop and turning to face the street put the
   * camera through the doorway and inside the terrace, looking at the unlit back
   * of the shopfront. From the player's side a closed shopfront is a wall
   * whether or not there is a door in it, and this is where that is said.
   */
  /**
   * The lowest thing over this area's head, if it has one.
   *
   * Exteriors let the camera climb as far as it likes, which is right under an
   * open sky and wrong under a roof: pitch up hard in Market Row and the camera
   * passes through the arcade canopy at 6.2 m and looks down on the world from
   * above its own ceiling. An area with a lid says where it is.
   */
  ceiling?: number;
  camSolids?: Rect[];
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
  /*
   * Inside the north terrace, 14.5 m up the street from its middle.
   *
   * Not a guess: it is whatever puts this room's doorway on top of the street's.
   * The shop's threshold is at local z 5.5 and the street's at z −9, so the
   * origin has to sit at −14.5 for the two to be the same doorway. `npm run
   * areas` re-derives that and fails if either side moves without the other.
   */
  world: { x: 0, z: -14.5 },
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

    /*
     * The stack of cardboard boxes behind the counter.
     *
     * Drawn in `world/shop.ts` at (−4.4, −3.2) and, until now, solid to nothing.
     * You can get behind the counter — the gap at the right-hand end is
     * deliberate — and once there you could stand inside half a metre of
     * cardboard with both feet in it. Found by `npm run footing` the moment it
     * started sampling where a wall actually stops you rather than where the
     * grid happened to land.
     */
    { x: -4.4, z: -3.2, hw: 0.46, hd: 0.4 },

    /* Shelf units down both side walls, and the display case by the window. */
    { x: -SHOP_W + 0.67, z: 0.6, hw: 0.55, hd: 2.4 },
    { x: SHOP_W - 0.67, z: -0.9, hw: 0.55, hd: 2.8 },
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
      /* The threshold, on the inner face of the front wall. The street calls the
         same doorway (2.6, −9); both land on (2.6, −9) in Domino City. */
      seam: { x: 2.6, z: SHOP_D },
      /*
       * Coming *in* off the street: well inside the room, clear of this door's
       * own trigger, looking at the counter.
       *
       * Both halves matter. The camera needs somewhere to stand behind you,
       * which an arrival against the front wall does not give it. And the door
       * is a trigger — arrive inside its rectangle and you walk straight back
       * out of the shop you just entered.
       */
      arrive: { x: 2.6, z: 2.6, facing: Math.PI },
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

/**
 * The lines the Starting Area's buildings stand on.
 *
 * They were four constants in `world/street.ts` and nothing here knew them, so
 * a door's threshold had to be typed as a bare −9 and hoped over. `street.ts`
 * imports these now, the same way it already takes its pavements from
 * `platforms` — one definition, and the renderer and the geometry cannot drift.
 */
export const STREET_FACES = { north: -9, south: 10, west: -18, east: 18 } as const;

/**
 * The step up to the shop's door.
 *
 * It is 22 cm rather than the pavement's 14, and that is not arbitrary: at 14 it
 * had its top face on exactly the plane of the paving around it and the two
 * flickered underfoot at the one spot every player walks over. Raising it fixed
 * the flicker and quietly introduced the opposite bug — the game still thought
 * the ground there was 14, so crossing the threshold put both feet 8 cm into the
 * stone. `npm run footing` found four cells of it, all of them directly in front
 * of Grandpa's door.
 *
 * So it is a `platform` like the pavements are, and like them it is written down
 * once: `world/street.ts` draws the step from this rectangle. A raised surface
 * the renderer knows about and the collision does not is the whole family of
 * bug, and it has now produced two of them.
 */
export const SHOP_STEP = { x: 2.6, z: -8.5, hw: 1.0, hd: 0.35, y: 0.22 };

const STARTING_AREA: Area = {
  id: 'starting-area',
  name: 'Starting Area',
  kind: 'exterior',
  /* The origin of Domino City. Something has to be, and this is where the game
     starts — every other area is measured from this one. */
  world: { x: 0, z: 0 },
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

    /*
     * The terrace opposite, along the south side (+Z).
     *
     * Broken once, five metres wide, for the path up to the shrine. It was the
     * last unbroken edge of this street and it is the right one to give up: the
     * shop is north, Market Row is east, Step Lane is west, and a street with a
     * way out of every side is a street you are *in* rather than one you pass
     * along.
     */
    { x: -17.45, z: ST_D - 3.5, hw: 4.55, hd: 3.5, tall: true },
    { x: 7.05, z: ST_D - 3.5, hw: 14.95, hd: 3.5, tall: true },

    /* West end: a hoarding across a building site. */
    { x: -ST_W + 2, z: 0, hw: 2, hd: ST_D, tall: true },
    /*
     * East end: the mouth of Market Row, and the wall either side of it.
     *
     * It was one slab across the whole end, closing a railed-off alley you could
     * look down and never enter. The arcade is on the other side of it now, so
     * the slab is two with 4.4 m of archway between them, set on the middle of
     * the road where a covered shopping street always meets the traffic.
     *
     * Same shape as the shop's doorway in the north terrace, and the same
     * consequence: a gap is a hole in the collision on purpose, so the camera
     * needs a `camSolid` put back across it or it walks through the arch and
     * looks at the unlit backs of the buildings.
     */
    { x: ST_W - 2, z: -9.35, hw: 2, hd: 7.65, tall: true },
    { x: ST_W - 2, z: 9.85, hw: 2, hd: 7.15, tall: true },

    /* Bollards across the arch: the road stops here, the arcade does not. */
    { x: 17.0, z: -1.2, hw: 0.16, hd: 0.16 },
    { x: 17.0, z: 2.2, hw: 0.16, hd: 0.16 },

    /* Street furniture, which is what stops the middle being an empty car park. */
    { x: -9.5, z: -6.9, hw: 0.28, hd: 0.28 },   // lamp post, north pavement
    { x: 9.5, z: -6.9, hw: 0.28, hd: 0.28 },    // lamp post, north pavement
    { x: -9.5, z: 7.9, hw: 0.28, hd: 0.28 },    // lamp post, south pavement
    { x: 9.5, z: 7.9, hw: 0.28, hd: 0.28 },     // lamp post, south pavement
    { x: -4.2, z: 8.6, hw: 1.0, hd: 0.42 },     // bench
    { x: 13.5, z: 8.6, hw: 1.0, hd: 0.42 },     // bench
    { x: -14.5, z: -7.5, hw: 0.9, hd: 0.9 },    // planter
    { x: 15.5, z: -7.5, hw: 0.9, hd: 0.9 },     // planter
    { x: 17.62, z: -4.0, hw: 0.42, hd: 0.62 },  // vending machine, facing the road
    { x: -17.4, z: -7.3, hw: 0.55, hd: 0.55 },  // post box, on the north pavement
  ],
  /*
   * Both pavements, which sit a kerb above the road. The numbers come from
   * `world/street.ts`: it lays the paving at y 0.14 between the building faces
   * (-9 and 10) and the kerbs (-6.5 and 7.5), and these are the same spans read
   * back. If one moves, the other has to move with it — the check in
   * `npm run areas` compares them.
   */
  platforms: [
    { x: 0, z: -7.75, hw: 22, hd: 1.25, y: 0.14 },
    { x: 0, z: 8.75, hw: 22, hd: 1.25, y: 0.14 },
    SHOP_STEP,
  ],
  /* The shop's doorway, closed to the camera. Same span and depth as the two
     terrace slabs it sits between, so the whole north side is solid to look at
     even though 1.6 m of it is walkable. */
  camSolids: [
    { x: 2.6, z: -ST_D + 4, hw: 0.9, hd: 4 },
    /* The archway into Market Row, closed to the camera for the same reason the
       shop's door is: from outside, a way through is still a wall to look at. */
    { x: ST_W - 2, z: 0.5, hw: 2, hd: 2.2 },

    /* And the gap through the south terrace, up to the shrine. */
    { x: -10.4, z: ST_D - 3.5, hw: 2.5, hd: 3.5 },

    /* And the terraces' awnings, for the reason Market Row's are stopped: the
       scalloped edges hang at 2.8 m, which is exactly where the walking camera
       sits, and backing towards a shopfront put one of them a hand's width in
       front of the lens. */
    { x: 0, z: -(7.3 + ST_D) / 2, hw: ST_W, hd: (ST_D - 7.3) / 2 },
    { x: 0, z: (8.3 + ST_D) / 2, hw: ST_W, hd: (ST_D - 8.3) / 2 },
  ],
  doors: [
    {
      id: 'street-to-shop',
      /* In the shop's doorway, on the pavement side. */
      /* In front of the shop door, and deeper than the pavement is wide, so
         walking at the door always crosses it. */
      trigger: { x: 2.6, z: -8.3, hw: 1.05, hd: 0.75 },
      to: 'grandpa-shop',
      seam: { x: 2.6, z: STREET_FACES.north },
      /*
       * Coming *out* of the shop: on the pavement, facing down the street.
       *
       * z −7.2, not −11.4. The first version put the arrival inside the shop's
       * own building — the north terrace runs from z −17 to −9 — so stepping out
       * of the door landed you in solid geometry and the collision pass shoved
       * you back out through whichever wall was nearest.
       *
       * Facing took three tries. Math.PI faced the door you had just walked out
       * of, which is what this was reported for. Facing 0 turned you to the
       * street but put the camera hard against the shopfront a metre and a half
       * behind you — the squeeze traded all of it for height and you arrived
       * looking at the top of your own head. A quarter turn east solves both:
       * the street runs away in front of you, and the camera has the whole
       * length of the pavement to sit back in.
       */
      arrive: { x: 2.6, z: -7.2, facing: Math.PI / 2 },
      label: 'Kame Game Shop',
    },
    {
      id: 'street-to-market',
      /* Across the mouth of the arch, and deep enough to cover the whole of it,
         so walking east out of the street always crosses it. */
      trigger: { x: 17.4, z: 0.5, hw: 0.9, hd: 2.1 },
      to: 'market-row',
      seam: { x: STREET_FACES.east, z: 0.5 },
      /*
       * Coming back out of the arcade: well clear of the arch, turned west.
       *
       * x 12.5 and not 15.2, and the difference is the camera rather than the
       * duelist. The walking shot sits four and a half metres behind you, which
       * from 15.2 facing west is at x 19.7 — inside the east wall. `cameraReach`
       * pulls it in to about three, `camLift` trades the metre and a half it
       * lost for height, and you arrive looking down at the top of your own
       * head. It is the same failure the shop's door hit facing 0, found the
       * same way, and the fix is the same: land where the camera has somewhere
       * to stand.
       */
      arrive: { x: 12.5, z: 0.5, facing: -Math.PI / 2 },
      label: 'Market Row',
    },
    {
      id: 'street-to-steps',
      /* Across the alley mouth, deep enough to cover the whole of it. */
      trigger: { x: -16.9, z: 4, hw: 0.9, hd: 1.7 },
      to: 'step-lane',
      seam: { x: STREET_FACES.west, z: 4 },
      /*
       * Coming back down the hill: turned east, along the street towards the
       * shop, which is where anybody coming down is going.
       *
       * x −13, not −15.2. The alley mouth is closed to the camera and that
       * `camSolid` is at −18, so an arrival at −15.2 put the camera two and a
       * half metres back and lifted almost overhead — `npm run doors` measured
       * camLift 0.43 against an allowance of 0.06. Five metres of clearance
       * gives it the full distance.
       */
      arrive: { x: -13, z: 4, facing: Math.PI / 2 },
      label: 'Step Lane',
    },
    {
      id: 'street-to-shrine',
      /* Inside the gap through the terrace, so walking south into it always
         crosses. */
      trigger: { x: -10.4, z: 12.5, hw: 2.2, hd: 1.2 },
      to: 'domino-shrine',
      /* The far side of the terrace, which is where the precinct starts. */
      seam: { x: -10.4, z: STREET_FACES.south + 8 },
      /*
       * Coming back down: out on the road, turned east along the street.
       *
       * z 6.8 rather than 8.6, which is on the pavement and a metre from a lamp
       * post — close enough that `cameraReach` clipped the shot to 3.94 m and
       * lifted it, so you came out of the passage looking at your own shoulders.
       */
      arrive: { x: -10.4, z: 6.8, facing: Math.PI / 2 },
      label: 'Domino Shrine',
    },
  ],
  /* On the pavement outside the shop — the same place the shop's door lands
     you, so arriving here by either route puts you in the same spot, looking
     the same way: east, down the length of the street. */
  spawn: { x: 2.6, z: -7.2, facing: Math.PI / 2 },
};

/* ------------------------------------------------------------------ */
/* Market Row                                                          */
/* ------------------------------------------------------------------ */

/**
 * The covered shopping street, straight on through the arch at the east end of
 * Turtle Lane.
 *
 * A shōtengai: forty-six metres of shopfronts facing each other across ten
 * metres of paving, with a roof over the whole of it. Everything that makes the
 * Starting Area work is reused here — buildings for walls, warm light, an edge
 * you are stopped by rather than clamped at — and then it is asked to do the one
 * thing that area never had to.
 *
 * ## An exterior with a lid
 *
 * The street solves the void by being taller than the camera: look up at the end
 * of it and you see roofline, and past the roofline is black that reads as dusk
 * sky. That works because you are outdoors and the sky is *supposed* to be up
 * there.
 *
 * Market Row has a roof, so the black is not sky any more — it is a hole in the
 * building you are standing inside. There is nowhere to look up to. The arcade
 * canopy is therefore not decoration: it is the top wall, and it is the first
 * enclosure in this world that runs horizontally.
 *
 * That changes the light, too, and this is the real difference between the two
 * areas. A street at dusk is lit from the sky and picked out by lamps. An arcade
 * is lit *entirely by itself* — pendants down the spine, spill out of the shop
 * windows, and daylight only at the two ends where it opens. Nothing here is lit
 * by anything you cannot see hanging.
 *
 * ## Why it is narrow, and why that is the point
 *
 * Ten metres between shopfronts against the street's thirty. The camera sits
 * four and a half metres back, so walking the length of the arcade it has the
 * whole corridor to fall into, and walking across it clamps to a shopfront in
 * about a metre and a half. That is not a compromise — being close to things is
 * what a market feels like, and it is why the goods are on the floor rather than
 * behind glass.
 */
const MR_W = 23;   // half-length, so 46 m from the arch to the far gates
const MR_D = 9;    // half-depth, so 18 m across, units included

/** Where the two rows of shopfronts face each other. */
const MR_FRONT = 5;

/**
 * How far into the arcade a shopfront actually reaches.
 *
 * Not `MR_FRONT`. Every unit has a timber stallboard along the bottom of it
 * standing 25 cm proud, and guide rails on the shuttered ones proud of that —
 * so the plane the shops are *drawn* on is not the plane you are stopped at.
 *
 * The collision used to be `MR_FRONT`, which let a duelist walk to within 38 cm
 * of it — a hand's width *inside* the stallboard — and stand there with both
 * feet in the wood. Walking the length of the arcade close to the shops did it
 * the whole way along.
 *
 * So the blocks start here, 45 cm out, which is clear of everything hanging off
 * a shopfront below head height. `npm run footing` samples the position a wall
 * actually stops you at, which is how this was found and how it stays found.
 */
const MR_REACH = MR_FRONT - 0.45;

/** One thing left out on the arcade floor, and what it is. */
export type GoodsKind = 'crates' | 'bin' | 'sacks' | 'rack' | 'ice' | 'bench' | 'bicycles';

export interface Goods extends Rect {
  kind: GoodsKind;
  /** The dominant colour, where the thing has one. */
  tint?: string;
}

/**
 * The goods on the arcade floor — and the only place they are written down.
 *
 * These are simultaneously collision and scenery, and that is the point. They
 * are spread into `solids` below, and `world/market.ts` draws from this same
 * list: a crate is drawn where there is a solid because it *is* the solid, not
 * because two files were kept in step by somebody remembering to.
 *
 * The alternative is what the pavements taught. Those were spans in `street.ts`
 * and nothing here knew about them, so walking onto one buried the duelist's
 * feet to the ankle — the geometry was right and nothing was reading it. Two
 * copies of a rectangle is two copies until the day it is one and a half.
 *
 * All of it is against the shopfronts, 90 cm deep at the most, so the middle of
 * the arcade stays clear the whole way along. A market you have to slalom
 * through is a market nobody walks down twice.
 */
export const MARKET_GOODS: Goods[] = [
  { kind: 'crates',   x: -16.3, z: -3.85, hw: 1.3, hd: 0.85, tint: '#6f5a3a' },
  { kind: 'bin',      x: -8.5,  z: -4.35, hw: 0.35, hd: 0.35 },
  { kind: 'sacks',    x: -6.2,  z: -3.9,  hw: 1.1, hd: 0.8 },
  { kind: 'rack',     x: 4.8,   z: -4.15, hw: 1.3, hd: 0.55 },
  { kind: 'crates',   x: 15.0,  z: -3.9,  hw: 1.2, hd: 0.8, tint: '#5f6a4a' },

  { kind: 'ice',      x: -12.0, z: 3.8,   hw: 1.6, hd: 0.9 },
  { kind: 'bench',    x: -1.5,  z: 4.1,   hw: 1.1, hd: 0.45 },
  { kind: 'bicycles', x: 9.0,   z: 4.2,   hw: 1.4, hd: 0.5 },
  { kind: 'crates',   x: 18.2,  z: 3.9,   hw: 1.0, hd: 0.8, tint: '#6a5a44' },
];

/**
 * Nothing on the floor may reach past here.
 *
 * The shopfronts are drawn at |z| 5 and their reveals start at 4.84, so a crate
 * whose footprint runs to 5.0 has its back face inside the joinery. Every one of
 * these used to: they were laid out against `MR_FRONT` as if the shopfront were
 * a flat plane, and it is not — it is 16 cm of frame, glass and reveal.
 *
 * 4.7 leaves them clear of all of it, and `npm run areas` holds them to it.
 */
export const MARKET_GOODS_LIMIT = 4.7;

const MARKET_ROW: Area = {
  id: 'market-row',
  name: 'Market Row',
  kind: 'exterior',
  /*
   * Due east of the Starting Area, on the far side of its east wall.
   *
   * x 41 is forced: the arcade's west threshold is at local −23 and the street's
   * east face is at 18, so the origin lands 41 m east of the street's. z 0.5 is
   * the same 0.5 the archway sits on, which is the middle of the road.
   *
   * Running east rather than turning north is also the only thing that fits. The
   * street's north terrace occupies the ground from z −17 to −9 across its whole
   * width; an arcade turning north out of the arch would have had its floor
   * inside those buildings.
   */
  world: { x: 41, z: 0.5 },
  bounds: { x: 0, z: 0, hw: MR_W - 1, hd: MR_D - 1 },
  solids: [
    /*
     * The two rows of units. One slab each rather than nine, because collision
     * only ever needs to know "there is building here" — the nine shopfronts are
     * drawn on the front of it by `world/market.ts`, and a player who cannot
     * reach behind them cannot tell the difference.
     */
    { x: 0, z: -(MR_REACH + MR_D) / 2, hw: MR_W, hd: (MR_D - MR_REACH) / 2, tall: true },
    { x: 0, z: (MR_REACH + MR_D) / 2, hw: MR_W, hd: (MR_D - MR_REACH) / 2, tall: true },

    /* West end: the arch back out to Turtle Lane, with wall either side of it.
       The 4.4 m gap between these is the doorway, and the camera gets it back
       as a `camSolid` below. */
    { x: -MR_W + 1, z: -3.6, hw: 1, hd: 1.4, tall: true },
    { x: -MR_W + 1, z: 3.6, hw: 1, hd: 1.4, tall: true },

    /*
     * East end: the far gates, shut.
     *
     * The arcade genuinely continues towards the station on the other side of
     * these, and one day the shutter goes up and this solid becomes a doorway.
     * Until then it is closed, and it is closed *visibly* — a rolled gate with a
     * lit wall behind it — rather than being a stretch of blank building
     * pretending the arcade was always this long. A dead end you can see the
     * reason for is a place. One you cannot is a budget.
     */
    { x: MR_W - 1, z: 0, hw: 1, hd: MR_FRONT, tall: true },

    /* And everything left out on the floor, which is what `MARKET_GOODS`
       exists for: these rectangles and the crates drawn on them are the same
       nine entries, read twice. */
    ...MARKET_GOODS,
  ],
  /* The arcade has a roof on it, and the camera is not allowed through it —
     the canopy's underside is at 6.2. */
  ceiling: 5.9,
  camSolids: [
    /* The archway, closed to the camera. Standing just inside it and turning
       back west would otherwise put the camera through the wall and into the
       void where the street is not built. */
    { x: -MR_W + 1, z: 0, hw: 1, hd: 2.2 },

    /*
     * The awnings, which the camera used to reverse straight into.
     *
     * Every unit's awning projects a metre and a half over the pavement and its
     * scalloped edge hangs at 2.7 m — and the walking camera sits at about 2.8.
     * Stand in the middle of the arcade and turn to face a shop and the camera
     * goes back four and a half metres, which puts it *under the awnings on the
     * other side*: a 32 cm cloth tab, 62 cm from the lens, filling a third of
     * the screen with flat colour that jumps to a different unit's colour as you
     * move. That is the flicker in front of the shops.
     *
     * The collision cannot fix it — you are supposed to be able to walk under an
     * awning, and you do. This is the camera's own limit, which is what
     * `camSolids` is for: it stops a metre and a half short of the shopfronts,
     * before the cloth starts, and trades the distance for height the way it
     * does against any other wall.
     *
     * Being *inside* one does not clamp — a slab entered from within returns
     * zero — so walking along under the awnings is unaffected. Only backing into
     * them from the open middle is.
     */
    { x: 0, z: -(3.4 + MR_D) / 2, hw: MR_W, hd: (MR_D - 3.4) / 2 },
    { x: 0, z: (3.4 + MR_D) / 2, hw: MR_W, hd: (MR_D - 3.4) / 2 },
  ],
  doors: [
    {
      id: 'market-to-street',
      /* Across the arch and as deep as it is wide, so walking west out of the
         arcade always crosses it. */
      trigger: { x: -20.4, z: 0, hw: 0.9, hd: 2.1 },
      to: 'starting-area',
      seam: { x: -MR_W, z: 0 },
      /*
       * Coming in under the arch: eight metres in, looking east down the length
       * of the arcade.
       *
       * Which is the whole reason the arcade runs the way it does. You step
       * through an archway and the place opens out ahead of you in one shot —
       * forty-six metres of roof, pendants and shopfronts running away to the
       * far gates. Arriving side-on to that would waste the only view this area
       * has that the street cannot match.
       *
       * Eight and not four, and the four was measured rather than guessed at: at
       * x −18.5 the camera wants to be at −23, which is the archway, so it came
       * in to 3.07 and lifted to 0.17 and the arrival shot was the floor and the
       * back of the duelist's head. From here it has its full distance and the
       * arcade is what you see.
       */
      arrive: { x: -15.0, z: 0, facing: Math.PI / 2 },
      label: 'Turtle Lane',
    },
  ],
  spawn: { x: -15.0, z: 0, facing: Math.PI / 2 },
};

/* ------------------------------------------------------------------ */
/* Step Lane                                                           */
/* ------------------------------------------------------------------ */

/**
 * The residential hill, up the alley at the west end of Turtle Lane.
 *
 * Thirty-six metres of stepped alley climbing five and three-quarter metres
 * between houses. No shops, nobody selling anything: doors, meter boxes, bicycles
 * chained to railings, pot plants on the steps, a jizo in a niche, and the
 * power lines that hang over every residential street in Japan.
 *
 * ## The one new thing it asks for
 *
 * **Ground that is not at zero.** Every area so far has been flat — the shop's
 * floor, the street's road, the arcade's paving, all at y 0 with a 14 cm kerb as
 * the single exception, and that kerb is what `platforms` and `groundAt` were
 * built for. A kerb you step onto. A hill you *climb*, for thirty seconds, and
 * everything that assumed a floor at zero has to stop assuming it.
 *
 * The duelist was already fine: `groundAt` answers per position and `OpenWorld`
 * eases towards it. The camera was not — it sat at a flat `1.55 + …` measured
 * from zero, so on this lane it would have stayed down at street level looking
 * up through the hillside while the player walked away over the top. It rides
 * `groundY` now, and clamps against the ground under *itself* rather than the
 * ground under the player, because walking down a flight the camera is behind
 * and therefore above.
 *
 * ## Why steps rather than a slope
 *
 * `platforms` are flat rectangles, so a ramp would have to be a staircase of
 * very small ones pretending to be smooth, and it would still be a staircase to
 * `groundAt`. A stepped alley is the honest version of the same geometry — and
 * it is what these lanes actually are, because you cannot get a car up one and
 * nobody ever tried.
 *
 * Eighteen centimetres a step, half a metre of tread. That is a real, slightly
 * shallow stair, gentle enough that the ease in `OpenWorld` reads as walking up
 * rather than as being lifted.
 */
const SL_W = 18;       // half-length, so 36 m from the mouth to the top
const SL_D = 7;        // half-depth, so 14 m including the houses

/** Half the width of the walkable alley, houses either side of it. */
export const STEP_LANE_HALF = 2.3;

/** One step. Everything about the climb is a multiple of this. */
export const STEP_LANE_RISE = 0.18;

/** A stretch of the lane: level where `from` and `to` match, a flight where they do not. */
export interface Run {
  /** Along x, east (down the hill) to west (up it). */
  east: number;
  west: number;
  from: number;
  to: number;
}

/**
 * The climb, written as the runs it is made of.
 *
 * Both the collision and the geometry come from this one list — `platforms`
 * below turns it into the surfaces you stand on, and `world/steplane.ts` draws
 * the stone off the same numbers. Two copies of a staircase is two staircases,
 * and the second one is always the one you are standing in.
 *
 * Four flights of eight with a landing between each, which is how a long stair
 * is actually built: nobody lays thirty-two steps in one run, because nobody
 * wants to climb thirty-two steps without somewhere to stop.
 */
export const STEP_LANE_CLIMB: Run[] = [
  /* The mouth, level with the street, and six metres of it — long enough that
     you arrive on flat ground with the camera at its full distance behind you,
     looking up the whole climb. See the door's `arrive`. */
  { east: 18, west: 12, from: 0, to: 0 },
  { east: 12, west: 8, from: 0, to: 1.44 },
  { east: 8, west: 6, from: 1.44, to: 1.44 },
  { east: 6, west: 2, from: 1.44, to: 2.88 },
  { east: 2, west: 0, from: 2.88, to: 2.88 },
  { east: 0, west: -4, from: 2.88, to: 4.32 },
  { east: -4, west: -6, from: 4.32, to: 4.32 },
  { east: -6, west: -10, from: 4.32, to: 5.76 },
  { east: -10, west: -SL_W, from: 5.76, to: 5.76 },  // the top, and the gate across it
];

/**
 * A run of ground as things to stand on, level or climbing, along either axis.
 *
 * Step Lane needed this along x and the shrine needs it along z, which is the
 * moment to stop writing it twice. A level run is one rectangle; a flight is one
 * rectangle per step, each at the height of its own tread — so walking onto the
 * first step puts you a step up immediately, which is what a step is.
 *
 * `from` and `to` may run in either direction along the axis: `climbPlatforms`
 * builds Step Lane east to west, downhill values first.
 */
export function flightPlatforms(o: {
  along: 'x' | 'z';
  /** Where the run begins and ends along `along`. */
  start: number;
  end: number;
  /** The height at each of those. */
  from: number;
  to: number;
  /** Half-extent across the other axis, and where it is centred. */
  half: number;
  cross?: number;
  /** Step height. The world's stairs are all the same stair unless told. */
  rise?: number;
}): Platform[] {
  const cross = o.cross ?? 0;
  const rise = o.rise ?? STEP_LANE_RISE;
  const span = o.end - o.start;
  const put = (mid: number, halfSpan: number, y: number): Platform =>
    o.along === 'x'
      ? { x: mid, z: cross, hw: halfSpan, hd: o.half, y }
      : { x: cross, z: mid, hw: o.half, hd: halfSpan, y };

  if (o.from === o.to) return [put((o.start + o.end) / 2, Math.abs(span) / 2, o.to)];

  const steps = Math.round(Math.abs(o.to - o.from) / rise);
  const tread = span / steps;
  const out: Platform[] = [];
  for (let i = 0; i < steps; i++) {
    out.push(put(
      o.start + tread * (i + 0.5),
      /*
       * Two millimetres over half, so consecutive treads *overlap* rather than
       * abut.
       *
       * Abutting exactly leaves a boundary, and a boundary is a place where
       * `groundAt` answers one step and the box drawn there is the other — 18 cm
       * of daylight under the feet, forty cells wide, at every tread whose edge
       * happens to fall on the sampling grid. `npm run footing` found 475 of
       * them on a twelve-step flight.
       *
       * Overlapping, `groundAt` takes the taller of the two, which is the one
       * whose box covers that point. Nothing is ever on an edge.
       */
      Math.abs(tread) / 2 + 0.002,
      o.from + ((o.to - o.from) / steps) * (i + 1)
    ));
  }
  return out;
}

/** How high the lane is at the top of it. */
export const STEP_LANE_TOP = STEP_LANE_CLIMB[STEP_LANE_CLIMB.length - 1].to;

/**
 * The climb as things to stand on.
 *
 * A level run is one rectangle. A flight is one rectangle per step, each at the
 * height of its own tread — so walking west off a landing puts you 18 cm up
 * immediately, which is what a step is.
 */
export function climbPlatforms(): Platform[] {
  return STEP_LANE_CLIMB.flatMap((run) =>
    flightPlatforms({
      along: 'x',
      start: run.east,
      end: run.west,
      from: run.from,
      to: run.to,
      half: STEP_LANE_HALF,
    })
  );
}

/** What is left out along the lane, and what the builder draws on each. */
export interface LaneThing {
  kind: 'planter' | 'bicycles' | 'bin' | 'jizo' | 'crates' | 'pole';
  x: number;
  z: number;
  hw: number;
  hd: number;
}

/**
 * Kept against the houses, never in the middle.
 *
 * The lane is 4.6 m across and a stair is a bad place to meet an obstacle, so
 * everything sits within 80 cm of a wall and the walking line stays clear the
 * whole way up. `npm run areas` holds them to the lane's own width.
 */
export const STEP_LANE_THINGS: LaneThing[] = [
  { kind: 'planter',  x: 11.5, z: -1.85, hw: 0.4,  hd: 0.35 },
  { kind: 'bicycles', x: 8.0,  z: 1.85,  hw: 1.1,  hd: 0.35 },
  { kind: 'pole',     x: 5.0,  z: -1.95, hw: 0.18, hd: 0.18 },
  { kind: 'bin',      x: 2.0,  z: -1.85, hw: 0.34, hd: 0.34 },
  { kind: 'planter',  x: -1.5, z: 1.85,  hw: 0.4,  hd: 0.35 },
  { kind: 'jizo',     x: -4.0, z: -1.9,  hw: 0.45, hd: 0.3 },
  { kind: 'planter',  x: -7.5, z: -1.85, hw: 0.4,  hd: 0.35 },
  { kind: 'pole',     x: -9.0, z: 1.95,  hw: 0.18, hd: 0.18 },
  { kind: 'bicycles', x: -11.5, z: 1.85, hw: 1.1,  hd: 0.35 },
  { kind: 'crates',   x: -14.5, z: -1.85, hw: 0.6, hd: 0.35 },
];

const STEP_LANE: Area = {
  id: 'step-lane',
  name: 'Step Lane',
  kind: 'exterior',
  /*
   * West of Turtle Lane, through the gap beside the hoarding.
   *
   * The street's west face is at −18 and the alley opens at z 4, so with the
   * lane's own mouth at its local (18, 0) the origin lands 36 m west of the
   * street's. Nothing above ground is shared: the street stops at x −22 and this
   * begins at −18 in the street's own coordinates, which is the four metres of
   * wall the mouth is cut through.
   */
  world: { x: -36, z: 4 },
  bounds: { x: 0, z: 0, hw: SL_W - 0.6, hd: SL_D - 1 },
  solids: [
    /* The houses, one run each side. Collision only needs to know the lane is a
       corridor; `world/steplane.ts` draws them as the terrace of separate
       two-storey houses stepping up the hill that they are. */
    { x: 0, z: -(STEP_LANE_HALF + SL_D) / 2, hw: SL_W, hd: (SL_D - STEP_LANE_HALF) / 2, tall: true },
    { x: 0, z: (STEP_LANE_HALF + SL_D) / 2, hw: SL_W, hd: (SL_D - STEP_LANE_HALF) / 2, tall: true },

    /*
     * The top of the lane, closed.
     *
     * The steps genuinely continue towards Domino Park and one day this becomes
     * a doorway. Until then it is a gate across them with the hill behind it, and
     * it is closed *visibly* — you can see the lane carry on and see why you
     * cannot. A dead end you can see the reason for is a place.
     */
    { x: -SL_W + 1, z: 0, hw: 1, hd: SL_D, tall: true },

    ...STEP_LANE_THINGS,
  ],
  /* The mouth, closed to the camera: turning back east at the bottom would
     otherwise put it through the alley and into the void where the street is
     not built. */
  camSolids: [{ x: SL_W - 0.3, z: 0, hw: 0.3, hd: STEP_LANE_HALF }],
  platforms: climbPlatforms(),
  doors: [
    {
      id: 'steps-to-street',
      /* Across the mouth and as deep as the lane is wide, so walking down out of
         the alley always crosses it. */
      trigger: { x: 16.6, z: 0, hw: 0.9, hd: STEP_LANE_HALF - 0.4 },
      to: 'starting-area',
      seam: { x: SL_W, z: 0 },
      /*
       * Coming up off the street: two metres in, looking straight up the hill.
       *
       * Which is the whole reason the lane runs this way round. You step out of
       * a gap beside a hoarding and the thing in front of you is a stair going
       * up between houses, four flights of it, with the top lit and the rest in
       * shadow. Arriving side-on would waste the only view this area has.
       */
      /*
       * Twelve metres in, not fifteen.
       *
       * The mouth is closed to the camera — it has to be, or turning round at the
       * bottom looks out into the void where Turtle Lane is not built — and that
       * `camSolid` is three metres behind an arrival at 14.6. The camera arrived
       * squeezed to two metres and lifted almost overhead, which is the one shot
       * this area cannot afford to get wrong: the whole point of arriving here is
       * that the stair opens up in front of you.
       */
      arrive: { x: 12.4, z: 0, facing: -Math.PI / 2 },
      label: 'Turtle Lane',
    },
  ],
  spawn: { x: 12.4, z: 0, facing: -Math.PI / 2 },
};

/* ------------------------------------------------------------------ */
/* Domino Shrine                                                       */
/* ------------------------------------------------------------------ */

/**
 * The shrine, up the steps through the south terrace of Turtle Lane.
 *
 * Sixty-four metres by fifty-two, which is nearly five times the floor of Market
 * Row and about eight times Step Lane. That is the point of it.
 *
 * ## Why this one is big
 *
 * Everything built so far is a corridor. Turtle Lane, Market Row and Step Lane
 * are all "walk from one end to the other", and each of them is good at being
 * that — but a city made only of corridors reads as a series of hallways however
 * well each one is dressed. Mike said so, in those words, looking at Step Lane
 * and liking it: *some areas need to feel like a huge playing world on their
 * own.*
 *
 * A shrine precinct is the natural first one, because a shrine is not a route.
 * It is grounds. You come up the steps and the place opens out, and from there
 * nothing tells you where to go: the approach runs to the hall, but the basin is
 * off to the west, the ema rack and the bell are east, there is a smaller shrine
 * in the trees that you only find by leaving the path, and a way round the back
 * of the hall to a stone that has been there longer than the hall has.
 *
 * **Explorable means the player chooses**, not that the area is long. So the
 * middle is deliberately empty — gravel, and the avenue of lanterns to give it
 * a spine — and everything worth finding is off to a side.
 */
const SH_W = 32;   // half-width, so 64 m across
const SH_D = 26;   // half-depth, so 52 m from the gate to the trees

/** How wide the way in is, from the street up to the precinct. */
const SH_APPROACH = 5;

/** The floor of the precinct, and the hall's platform above it. */
export const SHRINE_FLOOR = 2.16;
export const SHRINE_PLATFORM = 3.24;

/**
 * The ground, in the four heights it comes in.
 *
 * The passage through the terrace is still the street's level; twelve steps lift
 * the precinct above it; six more lift the hall above that. The precinct itself
 * is one enormous rectangle, which is what makes it a place to wander rather
 * than a path to follow.
 */
export const SHRINE_GROUND: Platform[] = [
  { x: 0, z: -23.25, hw: SH_APPROACH, hd: 2.75, y: 0 },
  ...flightPlatforms({ along: 'z', start: -20.5, end: -15, from: 0, to: SHRINE_FLOOR, half: SH_APPROACH }),
  { x: 0, z: 4.5, hw: 28, hd: 19.5, y: SHRINE_FLOOR },
  ...flightPlatforms({ along: 'z', start: 6, end: 9, from: SHRINE_FLOOR, to: SHRINE_PLATFORM, half: 7 }),
  { x: 0, z: 14.25, hw: 9.5, hd: 5.25, y: SHRINE_PLATFORM },
];

/** What stands in the precinct, and what the builder makes of each. */
export interface ShrineThing {
  kind: 'torii' | 'lantern' | 'chozuya' | 'ema' | 'komainu' | 'subshrine' | 'marker' | 'notice' | 'tree';
  x: number;
  z: number;
  hw: number;
  hd: number;
  /**
   * Whether there is a flame in it. Lanterns only.
   *
   * Said here rather than worked out from the index in this array, which is what
   * it used to be: `i % 2` meant that adding one fixture anywhere above a
   * lantern put out every lamp below it and lit every dark one. Which lights are
   * burning is a decision about the place, not an accident of list order.
   */
  lit?: boolean;
}

/**
 * Everything in the grounds, and every one of them solid.
 *
 * The trees especially. A grove drawn as one block you cannot enter is scenery;
 * a grove of trunks you can walk between is somewhere to go, and the difference
 * costs one rectangle each. There are two of them here and the smaller shrine is
 * inside the eastern one, which is the whole reason to push through it.
 */
export const SHRINE_THINGS: ShrineThing[] = [
  /* The two gates on the approach. */
  { kind: 'torii', x: 0, z: -20.9, hw: 3.6, hd: 0.4 },
  { kind: 'torii', x: 0, z: -9, hw: 3.2, hd: 0.36 },

  /* The avenue of lanterns, which is the only thing giving the middle a line. */
  /* Lit down one side then the other, rather than all of one side, so the
     avenue has light on both hands as you walk it. */
  { kind: 'lantern', x: -5.6, z: -12, hw: 0.42, hd: 0.42, lit: true },
  { kind: 'lantern', x: 5.6, z: -12, hw: 0.42, hd: 0.42 },
  { kind: 'lantern', x: -5.6, z: -6.5, hw: 0.42, hd: 0.42 },
  { kind: 'lantern', x: 5.6, z: -6.5, hw: 0.42, hd: 0.42, lit: true },
  { kind: 'lantern', x: -5.6, z: -1, hw: 0.42, hd: 0.42, lit: true },
  { kind: 'lantern', x: 5.6, z: -1, hw: 0.42, hd: 0.42 },

  /* And a pair at the foot of the great flight. These are the only lights in
     the area low enough and far enough south to reach the risers, which face
     squarely back down the steps and are otherwise black the whole climb. */
  { kind: 'lantern', x: -3.6, z: -21.4, hw: 0.42, hd: 0.42, lit: true },
  { kind: 'lantern', x: 3.6, z: -21.4, hw: 0.42, hd: 0.42, lit: true },

  /* Off the path, west: the basin you rinse your hands at. */
  { kind: 'chozuya', x: -16, z: -6.5, hw: 2.1, hd: 1.5 },
  /* Off the path, east: the rack the wooden plaques hang on. */
  { kind: 'ema', x: 15.5, z: -9, hw: 1.9, hd: 0.5 },
  /* And the board by the gate that tells you whose shrine this is. */
  { kind: 'notice', x: -9.4, z: -13.4, hw: 1.0, hd: 0.3 },

  /* The pair at the foot of the hall's steps. */
  { kind: 'komainu', x: -6.6, z: 4.4, hw: 0.5, hd: 0.5 },
  { kind: 'komainu', x: 6.6, z: 4.4, hw: 0.5, hd: 0.5 },
  /* And a lit pair outside them, for the same reason as the pair at the foot of
     the great flight: these six risers face south and every other light in the
     precinct is north of them. */
  { kind: 'lantern', x: -8.4, z: 4.6, hw: 0.42, hd: 0.42, lit: true },
  { kind: 'lantern', x: 8.4, z: 4.6, hw: 0.42, hd: 0.42, lit: true },

  /* In the eastern trees, which you have to leave the path to find. */
  { kind: 'subshrine', x: 22.5, z: 12.5, hw: 1.6, hd: 1.4 },
  /* And behind the hall, which you have to go round it to find. */
  { kind: 'marker', x: 0, z: 21.6, hw: 0.6, hd: 0.6 },

  /* The western grove. Nothing north of z 22.1: each of these now carries a
     planter 1.2 m out from its trunk, and the back fence starts at 23.55. */
  { kind: 'tree', x: -24.5, z: -9, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: -21, z: -4.5, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: -25.5, z: -1, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: -20.5, z: 3.5, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: -24, z: 8, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: -19.5, z: 12.5, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: -24.5, z: 16.5, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: -19, z: 20, hw: 1.2, hd: 1.2 },

  /* The eastern grove, thicker, with the small shrine inside it. */
  { kind: 'tree', x: 19.5, z: -3, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: 24, z: 0.5, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: 19, z: 5, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: 24.5, z: 7.5, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: 18.5, z: 11, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: 25.5, z: 15, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: 20, z: 17.5, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: 24, z: 20.5, hw: 1.2, hd: 1.2 },

  /* And a band of them across the back, behind everything. */
  { kind: 'tree', x: -12, z: 21.5, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: -6, z: 22.1, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: 7, z: 22.1, hw: 1.2, hd: 1.2 },
  { kind: 'tree', x: 13, z: 21.5, hw: 1.2, hd: 1.2 },
];

/**
 * The things, as rectangles you bump into.
 *
 * Everything is itself except a torii, which is a *gate*: two legs and a lintel
 * over your head. Taken at face value its rectangle spans the whole opening and
 * the way in is walled off — which is what happened, and what pushed the arrival
 * out of its own entrance.
 */
export function shrineSolids(): Rect[] {
  return SHRINE_THINGS.flatMap((t) =>
    t.kind === 'torii'
      ? [-1, 1].map((s) => ({ x: t.x + s * (t.hw - 0.3), z: t.z, hw: 0.34, hd: t.hd }))
      : [{ x: t.x, z: t.z, hw: t.hw, hd: t.hd }]
  );
}

const DOMINO_SHRINE: Area = {
  id: 'domino-shrine',
  name: 'Domino Shrine',
  kind: 'exterior',
  /*
   * South of Turtle Lane, behind its terrace.
   *
   * The gap through the terrace runs from z 10 to 18 and the precinct starts
   * where it ends, so with this area's own entrance at its local (0, −26) the
   * origin lands at z 44. Nothing overlaps: the street stops at 17, Step Lane is
   * west and Market Row east, and both of them end well north of here.
   */
  world: { x: -10.4, z: 44 },
  /*
   * The depth runs to the full 26 rather than stopping a metre short.
   *
   * The way in is a passage 5.5 m long and the arrival stands in it, so a metre
   * of margin at that end is a metre the camera does not have — it clipped to
   * 3.8 m and lifted, and you came up the steps looking at your own shoulders.
   * Nothing can walk off the end: the passage is closed by the terrace.
   */
  bounds: { x: 0, z: 0, hw: SH_W - 1, hd: SH_D },
  platforms: SHRINE_GROUND,
  solids: [
    /* The way in, walled both sides until the precinct opens out. */
    /* To −14.7 rather than −15, so the kerb along the front of the precinct is
       behind them and not something you can stand on and sink into. */
    { x: -18.5, z: -20.35, hw: 13.5, hd: 5.65, tall: true },
    { x: 18.5, z: -20.35, hw: 13.5, hd: 5.65, tall: true },

    /* The precinct wall, three sides of it. */
    { x: -30, z: 0, hw: 2, hd: SH_D, tall: true },
    { x: 30, z: 0, hw: 2, hd: SH_D, tall: true },
    /* Reaching forward to 23.4, for the same reason: the kerb is part of the
       wall, not a step. */
    { x: 0, z: 24.7, hw: SH_W, hd: 1.3, tall: true },

    /*
     * The hall, and the edge of the platform it stands on.
     *
     * The platform is a metre above the precinct and the steps up to it are only
     * on the north side, so without an edge you could walk onto it sideways and
     * be lifted a metre in one frame. The edge is what makes the steps the way
     * up rather than one option among four — and a raised hall with a stone kerb
     * round it is what a shrine looks like anyway.
     */
    { x: 0, z: 14.5, hw: 7.5, hd: 4, tall: true },
    { x: -9.5, z: 14.25, hw: 0.4, hd: 5.25 },
    { x: 9.5, z: 14.25, hw: 0.4, hd: 5.25 },
    { x: 0, z: 19.5, hw: 9.5, hd: 0.4 },
    { x: -8.25, z: 9, hw: 1.25, hd: 0.4 },
    { x: 8.25, z: 9, hw: 1.25, hd: 0.4 },

    ...shrineSolids(),
  ],
  /* The way in, closed to the camera: turning back at the top of the steps
     would otherwise put it through the terrace and into the void where Turtle
     Lane is not built. */
  camSolids: [{ x: 0, z: -24, hw: SH_APPROACH, hd: 2 }],
  doors: [
    {
      id: 'shrine-to-street',
      /* Across the passage, deep enough that walking north out of the grounds
         always crosses it. */
      trigger: { x: 0, z: -24.4, hw: SH_APPROACH - 0.6, hd: 1.2 },
      to: 'starting-area',
      seam: { x: 0, z: -SH_D },
      /*
       * Coming up from the street: at the foot of the great flight, looking up
       * it.
       *
       * The whole area is arranged around this one view — the steps, the outer
       * torii at the top of them, the avenue of lanterns beyond, and the hall at
       * the far end of it. Everything else in the precinct is off to a side on
       * purpose, so that the first thing you see is the one thing that tells you
       * where you are.
       */
      arrive: { x: 0, z: -22.1, facing: 0 },
      label: 'Turtle Lane',
    },
  ],
  spawn: { x: 0, z: -22.1, facing: 0 },
};

export const AREAS: Record<AreaId, Area> = {
  'grandpa-shop': GRANDPA_SHOP,
  'starting-area': STARTING_AREA,
  'market-row': MARKET_ROW,
  'step-lane': STEP_LANE,
  'domino-shrine': DOMINO_SHRINE,
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
  const blockers = area.camSolids ? [...area.solids, ...area.camSolids] : area.solids;

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

  /* Camera-only blockers are always tall — they exist precisely to stop the
     camera passing through something a player may walk through. */
  for (const solid of blockers) if (solid.tall || area.camSolids?.includes(solid)) slab(solid);

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
 * How high the ground is under a point.
 *
 * The tallest platform containing it, or the floor. Tallest rather than first so
 * that overlapping rectangles — a step onto a terrace, say — behave the way a
 * player expects rather than the way the list happens to be ordered.
 */
export function groundAt(area: Area, x: number, z: number): number {
  let y = 0;
  for (const p of area.platforms ?? []) {
    if (Math.abs(x - p.x) <= p.hw && Math.abs(z - p.z) <= p.hd && p.y > y) y = p.y;
  }
  return y;
}

/** The door whose trigger contains this point, if any. */
export function doorAt(area: Area, x: number, z: number): Door | null {
  return area.doors.find((d) => inside(d.trigger, x, z)) ?? null;
}

/* ------------------------------------------------------------------ */
/* Domino City                                                          */
/* ------------------------------------------------------------------ */

/**
 * How far apart two sides of one doorway may be and still be one doorway.
 *
 * A metre, which sounds slack and is not. Two areas model the wall between them
 * at whatever thickness suits each of them — the shop's front wall is a metre
 * deep, the street's terrace is eight — so demanding they agree to the
 * centimetre would only mean typing numbers until the check went quiet, which
 * is not the same as being right.
 *
 * What a metre does catch is every mistake that matters: a door put on the wrong
 * side of a building, an area dropped in the wrong ward, a `world` offset with a
 * sign error or a transposed digit. All of those are out by many metres, and all
 * of them are silent without this.
 */
export const SEAM_TOLERANCE = 1.0;

/** A point in one area's coordinates, in Domino City's. */
export function toWorld(area: Area, x: number, z: number): { x: number; z: number } {
  return { x: area.world.x + x, z: area.world.z + z };
}

/** A point in Domino City's coordinates, in one area's. */
export function toLocal(area: Area, x: number, z: number): { x: number; z: number } {
  return { x: x - area.world.x, z: z - area.world.z };
}

/**
 * The door on the other side of this one.
 *
 * Matched by **where the doorway is in Domino City**, not by name and not by
 * position in a list. Both sides declare a `seam`; the partner is the door in
 * the target area that leads back here and whose seam is standing in the same
 * place.
 *
 * Which is what makes `world` load-bearing rather than documentation. If an
 * offset is wrong, this stops finding partners and the check says so — the
 * numbers cannot rot quietly, because the game reads them every time anybody
 * walks through a door.
 *
 * It also settles the case two areas joined twice would otherwise break: two
 * archways between the same pair are told apart by which one you walked into,
 * where matching on `to` alone would always pick the first.
 */
export function partnerOf(door: Door, from: AreaId): Door | null {
  const here = AREAS[from];
  const there = AREAS[door.to];
  if (!here || !there) return null;
  const seam = toWorld(here, door.seam.x, door.seam.z);
  let best: Door | null = null;
  let bestGap = SEAM_TOLERANCE;
  for (const other of there.doors) {
    if (other.to !== from) continue;
    const at = toWorld(there, other.seam.x, other.seam.z);
    const gap = Math.hypot(at.x - seam.x, at.z - seam.z);
    if (gap <= bestGap) {
      bestGap = gap;
      best = other;
    }
  }
  return best;
}

/**
 * Where walking through this door puts you.
 *
 * The partner door's own arrival, which is the point of the whole arrangement:
 * the numbers describing a landing in Market Row live in Market Row, and the
 * street simply asks for them.
 *
 * The fallback is the target area's spawn. It should never run — `npm run areas`
 * fails on any door without a partner — but a city with a mis-typed offset in it
 * ought to drop the player somewhere they can stand rather than throw on the
 * frame they walked through a door.
 */
export function arrivalThrough(
  door: Door,
  from: AreaId
): { area: AreaId; x: number; z: number; facing: number } {
  const target = AREAS[door.to];
  const partner = partnerOf(door, from);
  return { area: target.id, ...(partner ? partner.arrive : target.spawn) };
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
