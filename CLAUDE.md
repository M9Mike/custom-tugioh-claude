# Shadow Duel — the rules of the world

Read this before touching anything under `src/story/`, `src/components/story/`
or `scripts/*-check.*`. It is the shortest honest account of how Domino City is
built, what has gone wrong before, and what "done" means. Everything in it was
paid for.

## What this is

A Yu-Gi-Oh! fan game: a duel engine, and a Story Mode that is an open world you
walk through — Next.js 16, React 19, three.js, MongoDB, deployed on Vercel.
Mike owns it and plays it; only the name `Mike` is admitted while it is being
built. NPCs and their cast come later, together with him — the three that stand
in the world now are the templates for every interaction the rest will use.

Nothing in this file is about the duel engine. See `docs/AI-PLAN.md` for that.

## The laws

**No neon. Ever.** Not an area, not a sign, not an accent, not "just this
once". The palette is brick, brass, timber, plaster, stone and lamplight. If a
colour would not exist in a city lit by tungsten and daylight, it does not
exist here.

**Every area is a world of its own.** Not a corridor between doors. Ask how
long it would take to walk it in life: a burial ground is a hundred metres
across, a shop is thirteen. The Old Cemetery is 112 × 104 m and the plan says
the city gets bigger from here, not smaller.

**Everything touches the ground.** Nothing floats, nothing sinks, and a shadow
stays joined to its owner. A light has a fixture — a lamp, a rod, a bracket —
or it does not exist. Three rounds of Mike's feedback were this sentence.

**The drawn thing is the colliding thing.** A tree trunk drawn at a quarter of
its solid is an invisible ring a metre out from a tree you can see all of. The
walking surface is exactly the number `groundAt` answers; a floor reaches its
wall; a stair lands on a floor. `npm run footing` measures this and `npm run
embedded` measures its opposite.

**There is one sun over Domino City.** The hour comes from the wall clock
(`src/story/sky.ts`), is the same in every area, and is never stored. A day
is 72 real minutes; night is held dark from 22:00 to 04:00 — a third of the
sky light, lamps at full, fog closed in — and dawn and dusk are wide because
they are the best-looking part. Every check pins the hour (`?t=16`) because
two frames under a moving sun are not comparable. An area answers to the
clock through its `Sky`: it does not carry its own moon. When you change a
room, look at it at 16:00 *and* at 00:00 and 12:00.

**Buildings can have floors.** `groundAt(area, x, z, near)` is asked from the
height you are already at, which is what tells a gallery from the floor under
it. `hasStoreys` is opt-in per area; the checks that assume one storey stay
stable for everything else.

**Numbers reach things.** The two failure modes that graded A− five times:
geometry *placed* rather than designed (a stair in whichever corner was free,
a rail round the leftovers), and numbers *near* the right one (slabs to ±16
with walls at ±17, a boundary wall 3.4 m tall on ground that climbs 3.6). When
a fault list clusters in one place, that place was never designed — redo it,
do not patch it. Before shipping a room, read its sibling calls as a column: a
wrong number hides alone and stands out beside its neighbours.

**Textures are sized in metres.** `box()` scales its UVs by the mesh; `slab()`
does the same when the material says `tiled(m, metres)`. A plane's UVs run 0–1
whatever it measures, so one shared repeat across three terraces of different
depth is corduroy. And a drawer is a drawer: `gravel` draws rake furrows
because it is the shrine's yard — turf gets `turf`.

**Ownership is total.** Every geometry, material and texture goes through
`Owned.keep`; lights ride on the area's `root`; a rig disposes its own; a `Sky`
disposes its shadow maps. Leaving an area disposes the lot. The garbage
collector cannot see the card, and an area entered twenty times must cost what
it cost the first. `npm run soak` walks one page through every door for six
laps and fails if anything only ever goes up.

**Smooth beats sharp.** The renderer watches its own frame time
(`OpenWorld`'s governor) and gives up pixels, then shadow-map size, before it
gives up frames; a phone starts at one and a half times its pixels, not two.
`npm run linger` watches it act. Nothing else in the world may assume a
pixel ratio.

**Speed is the same everywhere.** Inside and outside, on the flat and on the
stairs. The ease that keeps feet on a step is clamped on the way up
(`groundY ≥ wantY − 0.02`) and free on the way down.

## How the world is put together

- `src/story/areas.ts` — what every area *is*: bounds, `solids`, `platforms`,
  `doors`, `spawn`, its `world` offset in the city. No three.js in here. Door
  partners are matched by seam position across that offset (`partnerOf`), so a
  door is written once per side and its landing is derived.
- `src/components/story/world/<area>.ts` — what it *looks like*. Reads the
  same constants the collision does; never a second copy of a number.
- `src/components/story/world/kit.ts` — `box`, `slab`-style helpers, `matt`,
  `glow`, `decal`, `basePlate`, `surfaceOf`, `tiled`, `Owned`.
- `src/components/story/world/surfaces.ts` — every texture, drawn into a
  canvas at load. The project ships no image assets.
- `src/components/story/world/sky.ts` — the `Sky` an area owns; the light rig
  that answers the clock. `reach/half/deep` size the shadow camera; `gain/fill`
  are about enclosure, not about brightness.
- `src/components/story/OpenWorld.tsx` — the one renderer: movement, camera,
  doors, the HUD, the probe (`window.__probe`, `__scene`, `__renderer`,
  `__camera`, `__THREE`, `__teleport`) that every check reads.
- `src/story/npcs.ts` — who stands where and what they say. Adding somebody is
  a row, not a renderer change.

### Adding an area

1. Constants and collision in `areas.ts`: `AreaId`, bounds, solids, platforms,
   doors (both sides), spawn, `world` offset. Big solid counts get the grid
   broad phase for free (`solidsNear`, from 96 solids).
2. A builder in `world/`, registered in `OpenWorld`'s `BUILDERS`.
3. A `Sky` with a shadow camera that covers the whole area *and* whatever
   stands outside its walls to close the horizon.
4. Vantages in `scripts/corner-shots.ts`, flights in `scripts/stairs-check.ts`,
   walks in `scripts/walk-record.ts`, a line in `scripts/soak-check.ts`'s
   circuit. `npm run areas` refuses an area missing from a sweep that needs
   naming.
5. The ward plan artifact: mark it standing.

### The camera

Trails 4.6 m behind. It gives up distance for height when something is behind
it (`camLift`), which indoors is the point and outdoors means a landing was
put against a wall — a door's `arrive` needs the camera's 4.5 m clear behind
it. `camSolids` close a doorway to the camera without closing it to the
duelist. It rides the highest floor between the lens and the duelist, asked
from a metre above the lens — so on a flight it rises onto the treads behind
you instead of showing you the inside of a riser — and anything more than
eighty centimetres over the lens is a ceiling, not a floor.

### What is beyond a door

A different scene, which is to say the void. Every doorway you can see through
gets a closed box behind it — back, two returns, a lid — sized so no sight
line from inside the area gets past its edges, with no two of its faces in one
plane. And a floor that reaches it: a strip of nothing between two floors is
the void, seen through whatever stands over it. Nothing else may stand inside that box: a canopy that reaches into it
hangs in the doorway. And a closed box you can see into is a hole until
something stands in it: the first two metres of the place beyond — a lantern
burning, the path going on, a fence, a lit window — so the gate says where it
goes. `npm run doorshots` photographs every approach; look at each one.

## The gates

Nothing ships without all of these green. Run them; do not reason about them.

```
npm run areas      # every area holds; every sweep names every area; all reachable
npm run footing    # a floor everywhere you can stand; feet never in it, never over it
npm run coplanar   # no two same-facing faces in one plane (measured from vertices)
npm run embedded   # nothing driven into a wall (containers must fill their box)
npm run seams      # no sight line out, from four heights up to 6 m; every floor you can see is there (above 6 m: the corner frames)
npm run doors      # every door reaches, lands where its partner says, camera clear
npm run walls      # collision is what is drawn: no walls of air, nothing drawn where you stand
npm run doorshots  # a frame from the approach to every door, both ways — look at them
npm run stairs     # feet on every step, every flight
npm run carryon    # leave, come back, same spot
npm run shimmer    # no flicker
npm run walk       # recorded walks — descriptive, watch them
npm run soak       # one page, six laps of every door: nothing only goes up
npm run linger     # one page, six minutes in one area with the clock running: nothing only goes up
npm run duelreturn # into a duel from a conversation and back: no sign-in, same spot, conversation resumed
npm run models     # every model the size it says
npm run stale      # the guard that puts you back where you were
npm run story      # the whole flow, tapped, at both phone sizes
npm run build && npm run lint
```

Then look. Render the corners (`npm run corners -- <area>` at t16 and
`--hour=12`) and read every frame at full size. Five times a passing check
had a hole in it that an eye found in a second: a wall buried under the ground
you stand on passed seams, footing and coplanar because trees happened to
close the horizon. **When Mike names an object, go and look at the object.**

And probe the instrument. When you loosen a check, put the fault back and
prove the check still catches it. When you tighten one, prove it still passes
on everything that was clean. A check that has never failed has never been
proved: the seams check reported "none" for five days because every standing
place it used had a NaN height — `walkableCells` leaves `y` NaN in a
single-storey area, a ray from a NaN origin hits everything at NaN, and NaN
counted as a hit. Stand on `groundAt` where `c.y` is not finite, count only
finite hits, and before trusting a new pass reopen a known hole and watch it
fail. `npm run seams -- <area> --shots` and `npm run walls -- <area>
--why=x,z` exist so a fault list can be looked at rather than reasoned about.

## Working with Mike

- **❤️ means fully done.** He plays the moment he sees it. Send it only when
  every gate is green, the frames are looked at, main is pushed and production
  has the bundle. Never for "nearly".
- Write less. He reads the work, not the account of it.
- Push straight to `main`. No bot reviews. Never delete a remote branch —
  other agents work on them. `main` and the card-balance branch are the only
  two that exist on purpose.
- Never run `npm run cards` — it clobbers a parallel agent's work.
- Never print the Vercel token. Never explain shop stock timing. Auth is
  deferred to the end.
- If a check is slow or stuck for five minutes, kill everything and restart —
  it goes faster. Buffered output is not a hang; a healthy run is one that
  has a browser process burning CPU.
- Browser checks lie in four ways: WebGL contexts exhaust (fresh context per
  item), `keyboard.down` is flaky (drive the on-screen stick), headless
  Chromium draws in software at a couple of frames a second (budgets are per
  metre, not per second), and a dev server that has hot-reloaded for hours
  wedges long-lived pages — a `page.evaluate` that never returns and a race
  that never fires. Restart the dev server before `npm run soak`, and never
  edit `src/` while it runs.

## Where things live

- Production: https://custom-tugioh-claude.vercel.app — verify the shipped
  bundle, not the push.
- The ward plan artifact lists every area, built and proposed, and the build
  order. Update it when an area stands.
- Memory of past sessions: `~/.claude/projects/-Users-mike-Desktop-custom-tugioh-game/memory/`.
