# Duelists

Everything that stands on two legs in Story Mode — the player, and any NPC —
is one system, and since the model swap that system is: a **vendored, rigged,
animated model** plus a small stored record saying which one and how it is
dressed. This is how to use it and, more importantly, how to know when what
you have made is finished.

The characters are no longer generated geometry. Six finished models —
Warrior, Rogue, Ranger, Wizard, Monk, Cleric, from Quaternius' RPG Character
Pack, CC0 — live in `public/models/duelists/` with a `LICENSE.md` recording
exactly where they came from and under what terms. Do not add a model whose
license you cannot quote in that file. The old procedural system (the lofted
bodies, the painted faces) is retired from the game but still in the tree —
see the end of this file before touching it.

## Asking for people

"Create three NPCs", "add a shopkeeper", "populate the plaza" all mean: write
a `PremadeCharacter` — a catalog id, one tint per slot, a stature, a name —
and hand it to `buildPremadeRig`. There is no second character system and
there must never be one. A duelist authored for an NPC and a duelist authored
in the booth go down the same code path, play the same clips, and are held to
the same standard.

An NPC is four things, and only the first of them exists:

- **Who** — a `PremadeCharacter`, exactly as the booth writes one. Done, and
  it is the whole of what is done.
- **Where** — a position and a facing in the field. Nothing places anything in
  the world; `OpenWorld` builds one rig, the player's.
- **What it does** — stand, pace a route, turn to face you, say something. The
  models ship far more than the game plays: attacks, hit reactions, rolls,
  deaths, spell casts are all aboard every `.glb`, waiting for the duel
  cutscene that will want them. There is no interaction of any kind yet.
- **What it plays** — a deck of card slugs. `validateDeck` checks a *player's*
  deck against the collection they own; an authored one has no collection to
  check against and wants checking against `CARDS` instead.

The last of those is nearer than it looks. `createDuel` and `applyAction` in
`src/game/engine.ts` run a duel, and `planTurn` with `AI_LEVELS` — rookie ·
duelist · champion — in `src/game/ai.ts` already plays one properly. An NPC
you can duel is a bridge from the field into the engine, not a new opponent.

## The player's own flow

Story Mode opens, the booth makes a duelist, the deck is cut, the world opens —
and the deck belongs to that duelist from then on.

- The booth is a **model picker**: six duelists, two tintable garments each,
  one stature slider, a name. Every choice is a finished, photographed thing;
  the player combines them and names the result. "As made" — the model's own
  paint, byte for byte — is a real choice on every garment, not a swatch that
  happens to sit close.
- Appearance binds **permanently** at the booth. Nothing can change it after.
- The first deck is cut from `STARTER_POOL` and *becomes* the collection: what
  is written back is the 25 that went in and nothing else.
- **Edit Deck** in the world menu posts to the same endpoint, which re-validates
  against the collection rather than the pool.
- **Delete Character** in the world menu is the one way back: it erases the
  whole save — duelist, deck, collection, progress — and the next sign-in
  starts in the booth. Erasure, not editing, is what keeps the bind honest.

Which means Edit Deck is a real door with nothing yet behind it: you own exactly
the 25 you chose, so there is nothing to swap in. It starts meaning something
the moment a collection can grow — and the obvious thing that grows one is
beating an NPC. Those two gaps are the same gap.

## The record, and the catalog under it

`src/story/premade.ts` — everything the server and the booth agree on, and
no three.js anywhere in it.

- **`PremadeCharacter`** is the whole stored description of a person: `model`
  (a catalog id), `tints` (one entry per tint slot — `AS_AUTHORED` or an index
  into that slot's palette), `stature` (0..1 around the model's own height),
  `name`. Flat, small, validatable — written once, stored for good.
- **`DUELIST_MODELS`** is the catalog: file, display label, target height in
  metres, the ground speed its Walk and Run clips cover at playback rate 1,
  and the tint slots. Growing the roster is adding a row and a file, never a
  new code path.
- **Tint slots are windows, not meshes.** Each slot claims a box in
  hue/saturation/lightness that catches its garment's pixels on the atlas and
  nothing else's — authored by looking at the atlas, verified by photographing
  the repaint. Repainting keeps every caught pixel's lightness, so the
  painting (brush strokes, baked shadow) survives the recolour. The windows
  are data about the vendored file, exactly like its height: swap the file,
  re-check the windows.
- **Palettes are indices, never hex** — the same `CLOTH_COLORS` /
  `TRIM_COLORS` the rest of the game draws from (`src/story/character.ts`).
  A swatch can be re-tuned later without rewriting anybody, and a corrupt
  value can only ever be out of range.
- **`normalisePremade`** is the one door: the booth's POST goes through it on
  write, and `loadProfile` runs every stored character through it on read. A
  malformed field costs the field, never the run — a character can only be
  created once, so rejection is not an option. It also seats saves from
  before the swap (old procedural-spec records) on a model, deterministically,
  so nothing downstream ever meets the old shape.

`defaultPremade(name)` is the booth's starting point; `randomPremade(name,
rnd)` rolls across everything the booth offers — pass a seeded generator to
get the same person twice. A third of rolled slots keep the vendored paint,
because the authored looks are part of the space.

## Where the geometry lives

- `public/models/duelists/*.glb` — the models themselves: mesh, rig, atlas,
  and every animation clip. Self-contained; nothing fetches anything else.
- `src/components/story/premadeRig.ts` — turns a record into a duelist in a
  scene: loads and caches one template per model, repaints the atlas where
  the player tinted, scales to catalog height, and plays Idle/Walk/Run
  through an `AnimationMixer`. The seam it exposes is the old one: a `root`
  to add, one call per frame, a `dispose`.
- The files ship unlit materials; the rig rehangs the maps on lit standard
  materials so the booth's key and the field's sun actually land.

## The standard

The old system's list was ten lessons long and most of them were about
generated meshes. These are the ones that transfer, and every one of them
still shipped wrong once before it was written down:

1. **Feet must not slide.** Ground speed is the one truth: the clip's playback
   rate is real ground speed divided by the catalog's `walkSpeed` — the speed
   that clip covers at rate 1. Scale them independently and they agree at one
   pace and skate at every other. Same arithmetic the old `gaitRate` wrote
   down, new home in `premadeRig.update`.
2. **Nothing advances by `time × rate`.** The mixer integrates `dt`. If a
   rate ever multiplies the elapsed clock anywhere near a duelist again, read
   the old lesson: ten minutes in, easing out of a standstill drove the legs
   through five thousand cycles a second.
3. **A tint must never touch the skin.** The atlases are paintings with faces
   in them; a tint that multiplies the whole image recolours the face with
   the coat. Windows are authored against the atlas and photographed proving
   they catch the garment and nothing else. If a repaint ever catches a face,
   the window is wrong, not the face.
4. **The authored look stays reachable, exactly.** `AS_AUTHORED` reuses the
   file's own texture byte for byte. A "default" that is a nearby swatch is a
   drifting copy of a finished thing.
5. **The model on screen is the model that ships.** The booth previews with
   `buildPremadeRig` and the world walks with `buildPremadeRig`; what you
   approve is literally what you get. Anything previewed by a different code
   path will drift.

## Proving it

Assertions are necessary and are not sufficient. Photographs are the other
half, and both halves are one command each:

```shell
npm run premade                    # the files hold what the catalog claims —
                                   # rigged, Idle/Walk/Run aboard — and every
                                   # tint window's catch is written out as a
                                   # sheet: atlas · magenta mask · repaints.
                                   # Look at the sheets, not the exit code.
npm run story                      # the flow end to end, two phone sizes
npm run handling                   # every control driven by hand, frame by
                                   # frame — including every duelist in the
                                   # catalog, read off the page, so a new row
                                   # is photographed without touching the script
npm run build && npx tsc --noEmit && npx eslint
```

**Then look at the pictures.** Not at whether the command exited zero — at
the duelist. The habits that keep catching things:

- **Photograph every model, not the default.** The handling run taps every
  `data-pick` it finds; the sheet per duelist is where a bad scale, a wrong
  facing or a lost weapon shows first.
- **Check the repaint sheets at full size.** A stray pixel in a mask is
  invisible at thumbnail size and is exactly the thing the sheet exists to
  show.
- **Photograph the angle the game actually uses.** The open world is behind
  and above the duelist; the booth is in front. A model can be right in one
  and wrong in the other.

If a defect is found, build the view that shows it into `npm run premade` (or
the driving scripts) before fixing it. A fix nobody can re-photograph is a fix
that comes back.

## The retired system

`src/components/story/humanoid.ts`, `head.ts`, `loft.ts`, `src/story/
presets.ts`, the `/diag/character` lab and its sweeps (`npm run clash`,
`npm run character`) are the old procedural duelists: bodies lofted from
cross-sections, faces painted in vertex colour. They are no longer reachable
from the game — the booth, the world and the server all speak
`PremadeCharacter` — but they still compile, their lab still runs, and their
ten-lesson standard is still written in that lab's files. They stay until
their removal is decided deliberately; nothing new may be built on them, and
"there must never be a second character system" now cuts against *them*.

## Verifying against production

Story Mode has no auth: one hardcoded name is admitted (`AUTHORISED` in
`src/server/story.ts`), and any caller stating a username is believed. Binding
a duelist is **permanent** — appearance cannot be changed afterwards, by
anything; the only way back is Delete Character, which erases the whole save.
`handling-check` therefore refuses to *bind* against any host that is not
localhost, `story-check` refuses to *delete* against one, and no script should
ever be pointed at a deployment in a way that spends — or erases — a real
account's progress.
