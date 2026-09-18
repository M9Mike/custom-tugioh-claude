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

**A step is at least three hundred millimetres deep.** `footing` will not take
a drawn box smaller than that in plan as the floor — the rule that stops a
pigeon being the ground — so a flight with 290 mm treads is a flight that check
cannot see, and a hundred and sixty cells of one were a duelist standing on air.
The same rule cuts the other way: a desk is 1.1 m by 0.55 and therefore *is* the
floor unless something collides with it, so the furniture in a room you can walk
into belongs in `solids` as well as in the drawing.

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

**A wall that never sees the sun is a material decision.** Domino High's two
long blocks run east to west, so the corridor elevation — the one the gate and
the drive point at — is in its own shade at every hour of every day. In brick it
was black at four in the afternoon and black again at noon, and no amount of
`fill` fixed it: the answer was to build it out of pale render, which is what a
school of that period is anyway. Before you place a building, work out which of
its faces the sun never reaches and give that face something that reads without
it — then look at it at noon, because if it is dark at noon it is dark always.

**Numbers reach things.** The two failure modes that graded A− five times:
geometry *placed* rather than designed (a stair in whichever corner was free,
a rail round the leftovers), and numbers *near* the right one (slabs to ±16
with walls at ±17, a boundary wall 3.4 m tall on ground that climbs 3.6). When
a fault list clusters in one place, that place was never designed — redo it,
do not patch it. Before shipping a room, read its sibling calls as a column: a
wrong number hides alone and stands out beside its neighbours. The third mode is
a *sign*: a half-extent written `(OUT - IN) / -2`, a paired helper whose two
axes take their arguments in mirrored order, a shopfront pushed `- n` into the
wall it should stand `+ n` proud of. None of them throw — they make geometry
that is inert, inside-out or buried. Hold magnitudes as magnitudes (`PZ_IN`),
and give paired helpers the same argument order.

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

**A merge says what it is made of.** Nothing in an area moves, so an area of any
size bakes its repeats into one mesh per material — Domino Station is 1294 draw
calls unmerged and 228 merged. But four of the gates read the scene as *boxes*
(`footing`, `walls`, `embedded`, `coplanar`), and a mesh's bounding box is exact
for a box and a lie for a merge: a hundred light fittings in one mesh have a box
the size of the building, and a check handed that box believes there is geometry
everywhere inside it. So a builder that merges writes the boxes it baked through
`bakedFrom` (`world/kit.ts`) and the checks expand them. Skip it and you do not
get a failing check, you get a check that cannot fail, which is the worst thing
in this toolchain.

**Air is measured in metres, and it is the colour of the sky.** The fog is not
decoration: it is what makes the edge of an area read as distance rather than as
a hole. `new THREE.Fog(VOID, …)` *copies* the colour it is handed, so for months
the background followed the hour and the fog kept the black it was built with —
invisible while the largest area was 44 m across and under a roof, and a wall of
black buildings under a blue sky the moment Station Plaza opened 132 m of
daylight. The daylight keyframes now reach two to three hundred metres
(`src/story/sky.ts`); night keeps its tight ones, because fog closed in at night
is the point. Build an area bigger than the last one and you must stand in the
middle of it at 12:00 and look at the far side.

**When a neighbour gets built, open the door you drew shut.** Domino Station's
east exit was a rolled shutter with CLOSED on it for as long as the plaza was a
line in the ward plan. The plaza stood, `npm run doors` walked through it, every
gate was green — and you walked out through a picture of a shut gate. A dead end
that is no longer a dead end is a drawing job, and no check will ask you for it:
`npm run doorshots` photographs it and you have to look.

**A lamp costs the whole picture.** Three.js evaluates every point light for
every lit fragment, so a lamp you cannot see costs exactly what one you can
costs. Station Plaza had fifty-three and ran at a *ninth* of the frame rate it
runs at with fourteen — 0.42 fps against 3.5, the geometry held still at 404
draw calls. Every lamp here is written with a `distance` and contributes
nothing past it, and counted over a metre grid of every area there is, the
worst-lit square metre in the city is reached by ten. So `OpenWorld` lights the
nearest fourteen. The number is *fixed* and not a radius: the count of visible
lights is part of a material's shader key, and one that varies as you walk
recompiles every program in the scene. Build a big area and count its lamps.

**A way out has to look like one, and only your eye will say so.** The plaza's
one open gateway was drawn with a shopfront standing across it, its name ten
metres up where no camera points, no lamp on it while every closed shop beside
it burned two, and a twenty-five metre city block parked inside the closed box
behind it. Twenty gates were green — `doors` walked through it, `seams`,
`walls`, `footing` and `coplanar` all passed — and Mike could not find the way
to Domino High. `seams` *cannot* fail on this: a ray out through a doorway is
excused as a door, which is right, and nothing then asks whether the box behind
it is closed. The instrument is a vantage in `corner-shots.ts` at every way out
of every area, and looking at it. Three of the plaza's four ways had one.

**When you fix a predicate, grep for its twin.** A range's `face` is the side it
looks at; a way out's is the wall it is cut into, so `wy.face === o.face` is
never true. That was found and fixed for the hole in the brick — and the test
that decides where *not* to draw a shopfront kept the old form, so all four
ways out of the square had one drawn across them. Two readings of one word,
eight lines apart, and only one of them was corrected.

**A tread exactly a stride up is a coin toss.** Domino High's towers rise 200 mm
a tread and `CLIMB` is 400, so every second tread sits exactly one stride above
the last — and `0.3 + 0.2 * 3` is `0.9000000000000001`, which is not `<= 0.9`.
The tread she was about to step on stopped being a floor and became "a step you
cannot climb", which `settle` treats as a wall: it pushed her back down the
stairs. **Both towers were unclimbable and the school's upper floor could not be
reached at all** — and every gate was green, because `stairs` measured her feet
against `groundAt` asked from the height the game itself reported (which agrees
with the game by construction), `footing` only asks about places you can already
stand, and `walls` compares collision with what is drawn, which up there
matched. `REACH = CLIMB + 1e-6` is the fix and `groundAt` and `settle` must read
the *same* one: a tread one will put her on and the other will not let her reach
is a duelist stuck against thin air. A flight now has to *gain height* to pass
`npm run stairs`, and that rule found two more flights that were never being
climbed.

**A rise over 200 mm is a staircase with no way up it.** The same rule that
makes the side of a flight a wall — a platform more than a stride above you is
the face of a step — makes the tread *two above the one you are on* a wall the
moment two rises exceed `CLIMB`. That wall stands one going ahead of you and you
are 380 mm wide, so at Central Towers' 205 and 215 mm it was inside your own
body: the two grand flights out of the sunken forecourt could not be climbed at
all, and the flight out of each arm stopped you on its second step. Under 200 mm
the first wall is three treads up, two goings away, and a going is never that
short. Every other stair in the city was already 180. `npm run stairs` said
`+0.43 m` and passed it, because `GAINED` only asks that she moved *some* height
— so `flightPlatforms` now refuses to build a flight it knows you cannot climb,
which is a failure at import time, in every check and in the build.

**A floor is any number `groundAt` will answer, and two of them are nobody's.**
`groundAt` cannot go below the base plate, so at Central Towers — whose whole
site stands six metres up so a forecourt can be sunk into it — every column with
no platform in it answers *nought*, and nought is under the arms' staircases:
the fill walked twelve metres up the basement inside the drawn stone of every
tread. The other is a platform you drew for one place that keeps going into
another: the canyon's pavement runs on under both podiums, which is harmless
where the podium is solid stone and a trap where it is hollow — inside a lobby
it was a second floor 300 mm under the real one, drawn nowhere, hanging over an
open stairwell, and it was also a wall standing across the arm's flight where
the treads came up past four metres. `footing` is satisfied by *a* floor and
both of these are floors. Cut a platform where the thing above it stops, and
give a mass you can walk under a floor of its own or no floor at all.

**The map is a projection, not a picture.** `Menu → Map` draws every area from
its own `bounds` through its own `world` offset and every doorway from the
doors' own `seam`, deduplicated across the two sides. So it gains the next area
the day that area lands, with nobody remembering to redraw anything — and it
disagrees *visibly* when the city does: two areas overlapping where they should
not is a wrong rectangle, and a door whose two sides have stopped agreeing is
two dots where there should be one. Open it after any area work. Tapping it to
teleport is scaffolding and is one prop; the drawing does not depend on it.

**A record is where somebody starts.** An NPC's `x`/`z` was read in three
places — the turn-to-face, the talk range, and the cylinder you are pushed out
of — and the moment one of them can walk, all three are reading the wrong
thing. A roamer carries a live position; a route is there and back along a path
of at least two points, because a loop's last leg is the jump from the end to
the start and that jump is the character walking through everything between.
They stop when you are close enough to be noticed, or you cannot talk to them.
A `spirit` has no collision cylinder at all, which is the only reason a route
may run down the middle of an avenue: a *moving* cylinder can shove the player
off a terrace.

**A gait is a fraction of `TOP_SPEED`, and there is only one of them.** The rig
picks its clip off `stride`, blending to Run across 0.62–0.92 — numbers tuned
against what a full stick covers. An NPC's speed was divided by "a nominal
walk" of 1.4 instead, so Tina's 1.15 m/s amble came out at 0.82 and ran her
three quarters into the Run clip: sprinting arms and legs, with the ground going
past at half the speed her feet were selling. Two scales for one number is how
that happens. Below the run threshold a *walking* NPC still has to read as
walking, so the fraction has a floor (0.32) and how fast they are going is the
clip's own playback rate, off the real ground speed. Set a route's speed to what
the model's Walk is *rated* at — `npm run gait` measures it — and the feet are
honest by construction; three fifths of it is a walk played in slow motion.

**A stop belongs where the route turns round.** The dwell used to be charged at
every point, and a path bent through the middle of an arcade so it would not
read as a sentry beat then bought a three-second stop in the middle of a
straight walk. Mike's words were "few steps stop few steps stop". A point in
the middle of a path is a corner; only the ends are somewhere to arrive at.

**The secret is where he is, not what he plays.** Ash Ketchum's deck sits on
the Home page beside every other deck — playable as, playable against, drawn
into the bracket, dealt to a random computer opponent — by Mike's own ruling,
and the first version that hid it from those lists was wrong. What is hidden
is *him*: he is in the world only when `story/ash.ts` says so — a seeded
schedule per seventy-two-minute day, two shops, three visits, never at three
in the morning — and nothing in the world explains it: no line in Grandpa's,
no hint, no map marker. `?t=` pins his day as well as his hour; `?day=` names
one. His cards are Mike's own art in `data/art/` (tracked, artIds
`900000001` up, copied into `public/art` by `prepare-art.mjs` before anything
is downloaded), his deck is one file (`effects/pokemon.ts`), and in Story
Mode his cards are never handed over (`KEEPS_THEIR_CARDS`).

**A card on the table is escrow, like the money.** Ash duels for one of your
cards (`CARD_WAGER`): it leaves the collection in the same write as the duel's
note, after the room is seated — the first version took it before, and in
the gap the save held a deck naming a card it did not own with no duel on
record to excuse it, and `mendDeck` squared the deck a card short on the way
into a duel about to be won. A claimed win puts it back into the collection
*and the deck it was sleeved in*, because the claim and the `duelDone` save
race out of the same screen; a loss keeps it gone, and a deck a card short is
sent to the builder with no way back until it is twenty-five (`deckIsShort`).
`npm run ash` walks all of it through the real routes on the in-process store.

**A note nobody clears is a conversation that never ends.** The world is
unmounted by every other screen — the deck builder, the collection, the map —
and it reads the resume note in a `useState` initialiser, which means on *every*
mount. So a note left in place reopened the conversation you had just ended,
every time you came back from sleeving a card. Whoever hands a note over has to
be told it was taken (`onResumed`), and a roamer named by one is put back in
front of the player rather than at the top of her route: a rig's live position
dies with the field, and the fiction is that you never stopped talking. While
somebody is being spoken to they hold still — being talked to, not being stood
next to, which is a proximity test and the player has been away for a duel.

**A model may be rigged and carry no animation.** A `sculpt` has no skeleton
and can never move; the rest ship Idle, Walk and Run; a UniRig export has the
bones and none of the clips. `premadeRig` needs no telling — it looks for an
`Idle`, finds none, and gives the root the breath and step-rise the unrigged
cast gets, which on a drifting spirit is the right motion rather than a
fallback. `still: true` on the model record is for `npm run premade`, which
otherwise reads one decision as three faults; the audit still demands the
skeleton, and it checks a `still` model has *no* clips, so the word cannot rot.
Put clips in the file and delete the word.

**A gesture carries rotation and nothing else, and a skinned mesh measures its
bind pose.** The exporter bakes every bone into every action, so a gesture clip
is a full-skeleton pose track: a rotation, a *position* and a scale for all
thirty-one bones. `makeClipAdditive` turns those positions into deltas of zero,
which holds only while the clip really is blended additively — drive one at a
normal weight and every bone goes to the origin. Tina shipped invisible on
that: thirty-one bones at one height and a "Talk to Tina" prompt over an empty
arcade. So a gesture keeps only the quaternion tracks whose values actually
change, and layers by ordinary blending. The reason it reached Mike is the
second half of the sentence: `Box3.setFromObject` on a `SkinnedMesh` reports
bind geometry and knows nothing about skinning, so a rig crushed to a point
measures 1.70 m and reports `visible: true`, and my own screenshots of an empty
street read as a framing problem. Measure a character by its **bones**' world
positions — metres whatever the file was authored in, where running the skin by
hand fails a centimetre-authored Sarah at 0.017 m — and measure them **while
they move**: a rig is in its rest pose the instant it is built, which is why a
build-time reading of a collapsed Tina came back a healthy 1.441 m. `npm run
faces` now runs the rig and fires every gesture it owns.

**A floor nobody can reach is a floor nobody has looked at.** All twenty-two of
Domino High's vantages were on the ground, because a save carries x, z and a
facing but no floor and an upstairs vantage photographs the room underneath it.
The moment the towers opened, `walls` failed on the first run: the doorway at
the head of each was *drawn* a whole 9.5 m bay wide against a 4.8 m opening in
the collision, so two metres either side was wall with nothing on it. A vantage
can `climb` now — walk up until the probe says she is there, then teleport,
which keeps the floor. Build a storey, put a vantage on it.

**Smooth beats sharp.** The renderer watches its own frame time
(`OpenWorld`'s governor) and gives up pixels, then shadow-map size, before it
gives up frames; a phone starts at one and a half times its pixels, not two.
`npm run linger` watches it act. Nothing else in the world may assume a
pixel ratio.

**Speed is the same everywhere.** Inside and outside, on the flat and on the
stairs. The ease that keeps feet on a step is clamped on the way up
(`groundY ≥ wantY − 0.02`) and free on the way down.

**Every area is a file, built in Blender.** `npm run world -- <area>` writes
the collision truth out of `areas.ts` (`scripts/world/layout.ts`), draws the
pictures the room hangs from the game's own card art, builds the area
headless in Blender (`scripts/blender/world`, one `recipe` per kind of place
— `shop`, `street`, `arcade`, `lane`, `shrine`, and `port`), and compresses
it into `public/models/world/<area>.glb`, which `world/glb.ts` loads;
`world/files.ts` lists every one, and the door sheet prefetches the areas
behind every door of the one you stand in off that list. A `port` is an area
whose old three.js builder still exists, under `scripts/world/legacy/`:
`scripts/world/capture.ts` runs it in Node with a canvas that draws nothing
and writes down every box and plane it made, and Blender puts them back with
photographed materials — the same boxes that passed the gates, dressed. The
drawer a canvas texture came from, and the tint it was handed, are read off
the stack and the source line (`surfaces.ts`, `tagged`), so a port's brick
that was redder stays redder. Three rules hold it all to the laws above. The
drawing is made *from* the collision: the walls are the tall solids, the
counter and the shelving are built to the footprint of the solid that stops
you (`draw: 'counter'` on the solid says what to draw there), so the drawn
thing is the colliding thing by construction — and a solid you move without
rebuilding is caught by `npm run drawn`, which refuses a GLB whose layout
hash is not the room's. Every box the kit bakes into a mesh is written into
that mesh's `parts`, so the four gates that read boxes read the same boxes.
And nothing in the file lights anything: the lamps and the sky stay in the
area's own TypeScript (`world/shop.ts`, `world/ported.ts`), placed off the
same dressing file Blender hangs the fittings from, so the lamp budget is
counted before a byte of the file has landed; the probe says `ready` when it
has, `enterStory` waits for it, and so does the sheet a door brings down —
with the name of the place on it, for at least half a second and for as long
as the file takes, because the one thing a door must never show is the
duelist standing in a room that is not there yet. What it looks like lives
in `data/world/<area>.dressing.json`; what it is made of is Poly Haven, CC0,
listed in `data/world/assets.json` and fetched into `.cache` by
`npm run world:fetch`. Textures tile in metres there too — every face the
kit makes carries its own world coordinates as UVs. What bit on the way in,
each written down where it was fixed: a fresh BMesh vertex carries index −1
until the table is renumbered (every un-bevelled box vanished, silently);
meshopt stores positions as normalised integers with the scale on the node,
so a matrix applied to that attribute clamps a room to a unit cube; the
optimiser deduplicates identical geometry, so fifteen bills of one size are
one geometry under fifteen nodes and each must bake on its own copy; the
exporter wrote `metallicFactor: 1` for a metal channel linked from a
photograph, and a metal with no environment map is black under the sun;
Poly Haven's photographs are true albedo — asphalt is 0.10, table wood
0.017 — and a tint multiplies, so a dark texture is lifted with
`blend: SCREEN` in the dressing, never darkened further; a Poly Haven tree
is 317k triangles and is drawn as a picture on two crossed planes
(`Kit.billboard`), and the kit *measures* a model by importing it, so it
remembers the answer beside the picture — a fir is half a gigabyte and a
build that measured it once per tree ran for an hour; a billboard is sized
to where it stands, because a nine-metre island tree is eleven wide and
puts a stretched face against the camera in a grove you can walk; nothing
may stand inside a door's closed box, not even a hillside; headless Blender
exits 0 after a traceback unless it is told `--python-exit-code 1`; walls
are grids with a column at every opening edge, because pieces that meet at
a T-junction crack; a slab's *part* is its face and not a centimetre of box,
because the box's underside sat four millimetres below whatever stood on
the floor and `coplanar` read the two undersides as a pair; a marking laid
on a surface comes through the port as a material named `decal:`, which
`glb.ts` gives the polygon offset the old `decal()` had and `coplanar`
leaves out of the running, as it always did; a Poly Haven prop is joined
into one mesh on import, because a model that arrives as a lid and a body
is two boxes to the checks sharing every face where they meet; a surface
split into a flat bake and an upright one (turf and hedge) splits its parts
too, the flat one carrying the tops as faces and the upright one stopping a
centimetre under them, or the two bakes read as one box drawn twice; and a
check that enters an area on its own must wait for `__probe.ready` as
`enterStory` does — the coplanar sweep waited for the area's *name* and
audited four base plates as four clean rooms, and the first time it saw
the shop it found forty-one hairline faces nobody had measured: a pegboard
hung in the plane of the dado rail, shelving whose boards ran through its
back panel, a door frame whose uprights ran up through its head, a kick
plate two millimetres off its door.

## How the world is put together

- `src/story/areas.ts` — what every area *is*: bounds, `solids`, `platforms`,
  `doors`, `spawn`, its `world` offset in the city. No three.js in here. Door
  partners are matched by seam position across that offset (`partnerOf`), so a
  door is written once per side and its landing is derived.
- `src/components/story/world/<area>.ts` — what it *looks like*. Reads the
  same constants the collision does; never a second copy of a number.
- `src/components/story/world/kit.ts` — `box`, `slab`-style helpers, `matt`,
  `glow`, `decal`, `basePlate`, `surfaceOf`, `tiled`, `Owned`, `bakedFrom`.
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
- `scripts/world/` and `scripts/blender/world/` — the Blender pipeline for an
  area that is a file: `layout.ts` (the collision, written out), `build.mjs`
  (the whole run), `capture.ts` (an old builder from `legacy/`, run in Node
  and written down), `kit.py` (boxes with UVs in metres, raw triangles from
  a capture, Poly Haven materials and models, billboards, bakes that say
  what they baked), `fixtures.py` (walls with openings, trims, counters,
  shelving, cases, doors, windows, posters, pendants, the street beyond the
  window), `street.py`/`arcade.py`/`lane.py`/`shrine.py`/`port.py` (the
  recipes), `optimize.mjs` (simplify, WebP, meshopt).
- `src/components/story/world/<area>.ts` is a thin builder now: lamps and sky
  off the dressing, then `loadArea`. The seven ported areas share
  `ported.ts`. `StoryMenu.tsx` is the pause sheet; `WorldMap.tsx` the plan.

### Adding an area

1. Constants and collision in `areas.ts`: `AreaId`, bounds, solids, platforms,
   doors (both sides), spawn, `world` offset. Big solid counts get the grid
   broad phase for free (`solidsNear`, from 96 solids).
2. A recipe (or a dressing for one that exists) in `scripts/blender/world`
   and `data/world/<area>.dressing.json`, `npm run world -- <area>`, the file
   named in `world/files.ts`, and a thin builder in `world/` (lamps and sky
   off the dressing, then `loadArea`) registered in `OpenWorld`'s `BUILDERS`.
3. A `Sky` with a shadow camera that covers the whole area *and* whatever
   stands outside its walls to close the horizon — in the dressing's `sky`.
4. Vantages in `scripts/corner-shots.ts` — including one standing in front of
   every way out, which is the only thing that ever looks at whether a door
   reads as a door — flights in `scripts/stairs-check.ts`,
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
npm run ash        # Ash's schedule, both routes, the roster, and the card wager end to end
npm run drawn      # every area built in Blender is the room that stands: hash, parts, budget, manifest
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
on everything that was clean. Three of the sweeps are hand-written lists of
areas — `coplanar-check.mjs`, `seam-check.ts`'s `ENCLOSED`/`OPEN`, and
`shimmer-check.ts`'s views — and two of them had silently fallen behind by the
time anybody looked; `npm run areas` now holds all three to naming every area
there is. A check that has never failed has never been
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
  edit `src/` while it runs — nor `data/world/*.dressing.json`, which the
  thin builders import, nor `public/models/world/*.glb`, which the page
  fetches: a recompile changes the build id, the page reloads itself into
  the "current" build, and a corner shot comes back as the sign-in card.
  And a fifth: **a page wears out**. `npm run walk`
  built two dozen areas on one page and reported, three runs running, exactly
  one route that "never finished building" — a different route each time. A
  check that fails somewhere new every run is the instrument, not the world;
  each route gets its own context now. When a failure moves, suspect the
  harness before the geometry — and before the harness, suspect the *machine*.
  `npm run soak` failed four runs running, at four different doors, while a
  second session on this laptop held a headless Chromium at 900%; the tell was
  that `grandpa-shop`, which nothing had touched, was sampling at 730 ms
  against a 330 ms baseline. A world that got slower in an area you did not
  edit is not your world getting slower. Check `uptime` and `ps` before you
  read a fault list, and do not run two browser checks on one machine.

## Where things live

- Production: https://custom-tugioh-claude.vercel.app — verify the shipped
  bundle, not the push. And know that **an app that stays open keeps its old
  build**: Skew Protection pins a running page to the deployment it loaded,
  so Mike's phone can play a week-old bundle until it is relaunched — a fix
  he cannot see is not a fix he has. A page asks `/api/build` with its
  cookies left at home and reloads into the current build when it is
  behind (`src/lib/freshBuild.ts`), on the way back from a duel and on
  arrival in Story Mode; `npm run duelreturn`'s fourth leg walks it.
- The ward plan artifact lists every area, built and proposed, and the build
  order. Update it when an area stands.
- Memory of past sessions: `~/.claude/projects/-Users-mike-Desktop-custom-tugioh-game/memory/`.
