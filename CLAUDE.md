# Duelists

Everything that stands on two legs in Story Mode — the player, and any NPC —
is one system. This is how to use it and, more importantly, how to know when
what you have made is finished.

## Asking for people

"Create three NPCs", "add a shopkeeper", "populate the plaza" all mean: write
`StoryCharacter` values and hand them to `buildCharacter`. There is no second
character system and there must never be one. A duelist authored for an NPC
and a duelist authored in the booth go down the same code path, get the same
walk cycle, and are held to the same standard.

An NPC is four things, and only the first of them exists:

- **Who** — a `StoryCharacter`, exactly as the booth writes one. Done, and it
  is the whole of what is done.
- **Where** — a position and a facing in the field. Nothing places anything in
  the world; `OpenWorld` builds one rig, the player's.
- **What it does** — stand, pace a route, turn to face you, say something. There
  is no interaction of any kind: no proximity, no prompt, no dialogue.
- **What it plays** — a deck of card slugs. `validateDeck` checks a *player's*
  deck against the collection they own; an authored one has no collection to
  check against and wants checking against `CARDS` instead.

The last of those is nearer than it looks. `createDuel` and `applyAction` in
`src/game/engine.ts` run a duel, and `planTurn` with `AI_LEVELS` — rookie ·
duelist · champion — in `src/game/ai.ts` already plays one properly. An NPC you
can duel is a bridge from the field into the engine, not a new opponent.

So "add a shopkeeper" is one line of appearance and four pieces of system. Say
which of the four a request needs and which of them do not exist yet, rather
than building the model and calling it the job.

## The player's own flow

Story Mode opens, the booth makes a duelist, the deck is cut, the world opens —
and the deck belongs to that duelist from then on.

- Appearance binds **permanently** at the booth. Nothing can change it after.
- The first deck is cut from `STARTER_POOL` and *becomes* the collection: what
  is written back is the 25 that went in and nothing else.
- **Edit Deck** in the world menu posts to the same endpoint, which re-validates
  against the collection rather than the pool.

Which means Edit Deck is a real door with nothing yet behind it: you own exactly
the 25 you chose, so there is nothing to swap in. It starts meaning something
the moment a collection can grow — and the obvious thing that grows one is
beating an NPC. Those two gaps are the same gap.

## The spec

`src/story/character.ts` — `StoryCharacter` is the whole description of a
person. Every field, and nothing outside it, reaches the model.

- **Body** — `frame` (lean · balanced · sturdy), `build` 0–1, `height` 0–1.
- **Face** — `jaw`, `eyeShape`, `brow`, `nose`, `mouth`, `age`, all 0–1.
- **Colour** — `skin`, `eyeColor`, `hairColor`, `primary`, `secondary`,
  `trim`, `trouser`, `boots`, `capeColor`. All **indices into palettes**, never
  hex. A swatch can be re-tuned later without rewriting anybody, and a corrupt
  value can only ever be out of range.
- **Kit** — `hair` (12), `facialHair` (6), `outfit` (5), `gauntlet`, `cape`.

`defaultCharacter(name)` is the booth's starting point. `randomCharacter(name,
rnd)` rolls one; pass a seeded generator to get the same person twice.
`normaliseCharacter` clamps anything loaded from storage — loaded profiles
bypass the booth, so **every lookup keyed on a spec field needs a fallback**
(`FRAME_METRICS[spec.frame] ?? FRAME_METRICS.balanced`). An unknown value from
a stored profile would otherwise throw once per animation frame.

Author NPCs by name, not by dice: a named character whose values are written
down reads as a person, and a rolled one reads as a roll. Use `randomCharacter`
for crowds, and only after reading the rest of this file.

## Where the geometry lives

- `src/components/story/humanoid.ts` — body, garments, limbs, the pose
  function. Lofted cross-sections: profile tables of real measurements,
  interpolated with monotone cubics so a table that is right at its rows is
  right between them.
- `src/components/story/head.ts` — skull, face, ears, hair, beard. The face is
  mostly *paint*: vertex colours doing the work of features, with geometry only
  where there is a silhouette to change.
- `src/components/story/loft.ts` — `MeshBuilder`, `sample`, `sectionPoint`,
  `domeRings`.

No textures anywhere. Vertex colour is both pigment and ambient occlusion.

## The standard

These are not style preferences. Every one of them is something that shipped
looking wrong and had to be found in a photograph.

1. **Nothing passes through anything.** `npm run clash` proves it, standing and
   walking, across every mode. It must exit clean before anything ships.
2. **No free edge may surface.** A sheet buried inside a body — a collar's
   rim, a cape's hem, a hair curtain's top — is invisible until the body curves
   away from it, and then it is a torn sliver lying on the chest. Bury edges
   deep enough that no *profile* brings them out, not just the one you looked
   at.
3. **A garment that wraps gets photographed all the way round.** The cape's
   front hung two loose flaps beside the duelist's hands for four rounds of
   review because the outfit sweep shot the front without a cape and the back
   with one.
4. **A mask that is a sum of lobes will draw its lobes.** Beard height followed
   its own five-lobe mask and came out as five balls of clay round a mouth. Map
   coverage to height through a narrow band so the interior is a plateau.
5. **Anything defined by azimuth is degenerate at the crown**, where every
   azimuth meets one point. A mohawk driven by azimuth is a traffic cone. Drive
   crests, partings and anything else on the midline by distance from it.
6. **A piecewise curve must actually meet itself.** The hairline was four
   branches each adding the style's shift at its own strength; every boundary
   was a step, and a step in a hairline is a notch cut out of the fringe.
7. **Tints are multipliers on skin.** A colour chosen to read as hair does not
   read as *beard* — short hair shows skin through it, and a beard at the head's
   own saturation gave a redhead a tongue and a blond a beige chin. Darken,
   desaturate, and floor the contrast against skin.
8. **Detail finer than the mesh cannot be drawn by the mesh.** It aliases. Keep
   every modulation frequency well under the ring count.
9. **A phase is integrated, never `time × rate`.** If the rate depends on
   anything that changes — and a gait's rate depends on how fast you are
   walking — then `t × rate` jumps by `t × Δrate` whenever it changes, and `t`
   only grows. The walk cycle was written that way: ten minutes into a session,
   easing out of a standstill drove the legs through five thousand gait cycles
   a second. `gaitRate(stride)` exists to be integrated by whoever is moving
   the duelist, and the lab integrates it the same way so the workbench moves
   the way the game does.
10. **Feet must not slide.** Ground speed is step length × cadence, so both
    have to be derived from the same speed. Scale them independently and they
    agree at exactly one pace: the walk was correct at a full stick and skated
    by up to two fifths of every step at anything less, which nobody can name
    and everybody feels. `scripts/` has no check for this — it is arithmetic,
    and the arithmetic is in `gaitRate`.

## Proving it

Assertions are necessary and are not sufficient. Everything above passed every
assertion in the repo on the day it shipped.

```shell
npm run clash                      # nothing intersects, standing or walking
npm run character                  # every mode, one sheet per mode
npm run character -- --seed 1      # a rolled duelist. Do 1 through 4 at least:
npm run character -- --seed 2      # between them they cover a cape, a full
npm run character -- --seed 3      # beard, a goatee, a mohawk and a robe, and
npm run character -- --seed 4      # every one of those was broken on 2026-08-11
npm run character -- --paint --walk
npm run story                      # the flow end to end, two phone sizes
npm run handling                   # every control driven by hand, frame by frame
npm run build && npx tsc --noEmit && npx eslint
```

`/diag/character` is the instrument: `sheet` (six angles), `parts` (eleven
regions close up, including the ear), `seams` (the joints two parts can pass
through, walking), and a sweep per axis — `outfit`, `cape`, `hair`,
`hair-behind`, `beard`, `frame`, `gauntlet`, `skin`. `matte` strips the
material so a crease in geometry cannot hide as a step in a vertex colour;
`wire` shows which mesh a mark belongs to; the eight numbered stride phases
make two runs comparable.

**Then look at the pictures.** Not at whether the command exited zero — at the
duelist. Three habits, each of which caught something nothing else did:

- **Shoot randomised seeds, not the default.** The default duelist has dark
  hair, a clean chin and a plain jumper, and is the one character on which
  every bug listed above is invisible. Four seeds found six. Rolled duelists
  are not how to *author* an NPC — see above — but they are how to cover the
  space one might land anywhere in.
- **Magnify.** The booth's Face framing gets closer to the head than any lab
  view; an ear that reads as a slab at 40 px reads as a slab at 400.
- **Photograph the angle the game actually uses.** The open world is behind and
  16° above the duelist, and a drag takes it to 49°. The crown of the head had
  never been in a photograph.

If a defect is found, build the view that shows it and check it into the lab
before fixing it. A fix nobody can re-photograph is a fix that comes back.

## Verifying against production

Story Mode has no auth: one hardcoded name is admitted (`AUTHORISED` in
`src/server/story.ts`), and any caller stating a username is believed. Binding
a duelist is **permanent** — appearance cannot be changed afterwards, by
anything. `handling-check` refuses to bind against any host that is not
localhost for that reason, and no script should ever be pointed at a deployment
in a way that spends a real account's one chance.
