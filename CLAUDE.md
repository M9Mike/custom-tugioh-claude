# Duelists

Everything that stands on two legs in Story Mode — the player, and every NPC —
is **one vendored model plus one small record saying which model and how it is
dressed**. There is no second character system and there must never be one. A
duelist authored for an NPC and a duelist authored in the booth go down the
same code path, play the same clips, and are held to the same standard.

The characters are not generated geometry. Twelve finished, rigged, animated
models — six men, six women, from Quaternius' Ultimate Modular packs, CC0 —
live in `public/models/duelists/` with a `LICENSE.md` recording where they
came from, under what terms, and which clips were trimmed. **Do not add a
model whose license you cannot quote in that file.** That rule decides more
than it looks like it does — see "The characters we actually want".

---

## Asking for people

"Create three NPCs", "add a shopkeeper", "populate the plaza" all mean: write a
`PremadeCharacter` and hand it to `buildPremadeRig`. An NPC is four things, and
today **only the first exists**:

| | what it is | where it lives | state |
|---|---|---|---|
| **Who** | a `PremadeCharacter` — catalog id, one tint per slot, stature, name | `src/story/premade.ts` | **done** |
| **Where** | a position and a facing in the field | `OpenWorld` builds exactly one rig, the player's | missing |
| **What it does** | stand, pace a route, turn to face you, wave, speak | `premadeRig` wires 3 of the 13 clips aboard | missing |
| **What it plays** | a deck of card slugs | `validateDeck` (`src/story/roster.ts`) checks a *player's* deck against their collection | needs a variant |

Say which of the four a request needs, and which of them do not exist yet,
rather than building the record and calling it the job.

**Where the work goes when we start.** `OpenWorld.tsx` builds one rig inside
its mount effect and drives it from `here.current`. A second duelist is a
second `buildPremadeRig` and a second `update` in the same loop — the seam is
already the right shape, and the honest first step is lifting "a duelist in
the field" out of that effect into something that takes a list. Nothing about
the record, the catalog, or the rig has to change to place people.

**Deck-checking an NPC.** `validateDeck(deck, collection)` is written for a
player: it proves you own what you played. An authored NPC owns nothing, so it
wants the same shape checked against `CARDS` instead. That is a sibling
function, not a flag on the existing one — the two questions are different and
should stay different.

**Duelling one is a bridge, not a new opponent.** `createDuel` and
`applyAction` in `src/game/engine.ts` run a duel; `planTurn` with `AI_LEVELS`
— rookie · duelist · champion — in `src/game/ai.ts` already plays one
properly. Beating an NPC is also the obvious thing that first grows a
collection, which is what makes Edit Deck mean something.

---

## The player's own flow

Story Mode opens, the booth makes a duelist, the deck is cut, the world opens —
and the deck belongs to that duelist from then on.

- The booth is a **model picker**: twelve duelists, three tintable slots each
  (hair among them where the model has any), one stature slider, a name.
  "As made" — the model's own colour, exactly — is a real choice on every
  slot, not a swatch that happens to sit close.
- Appearance binds **permanently**. Nothing changes it afterwards.
- The first deck is cut from `STARTER_POOL` and *becomes* the collection: what
  is written back is the 25 that went in and nothing else.
- **Edit Deck** posts to the same endpoint, re-validated against the collection
  rather than the pool.
- **Delete Character** is the one way back: it erases the whole save and the
  next sign-in starts in the booth. Erasure, not editing, is what keeps the
  bind honest.

Edit Deck is therefore a real door with nothing behind it yet — you own exactly
the 25 you chose. It and "beat an NPC to win a card" are the same gap.

---

## The record, and the catalog under it

`src/story/premade.ts` — what the server and the booth agree on. No three.js
in it, on purpose: the same module sanitises a POST and tells the booth what
to offer.

- **`PremadeCharacter`** — `{ name, model, tints[], stature }`. Flat, small,
  validatable; written once, stored for good. `stature` is 0..1 mapped through
  `STATURE_RANGE` (0.93–1.07× the model's catalog height); `MAX_PREMADE_NAME`
  is 18.
- **`DUELIST_MODELS`** — the catalog: file, label, note, target height, the
  ground speed its Walk/Run clips cover at rate 1, and the tint slots. Growing
  the roster is **a row and a file**, never a new code path.
- **Tint slots name materials.** The models carry no textures — every part is
  a named flat-colour material — so a slot is a label, a palette, and the exact
  material names it owns. `Skin`, `Eye` and `Eyebrows` are `UNTINTABLE`,
  enforced by `npm run premade`: a tint reaching a face is not a bug we guard
  against, it is a state that cannot be expressed. The name lists are data
  about the vendored file, exactly like its height — swap the file, re-check
  the names.
- **Palettes are indices, never hex** — the same `CLOTH_COLORS` /
  `TRIM_COLORS` / `HAIR_COLORS` in `src/story/character.ts`. `AS_AUTHORED`
  (`-1`) means "leave it exactly as the file paints it".
- **`normalisePremade` is the one door.** The booth's POST goes through it on
  write; `loadProfile` runs every stored character through it on read. A
  malformed field costs the field, never the run — a character can only be
  created once, so rejection is not an option. It also seats pre-swap saves
  (old procedural records) on a model deterministically, so nothing downstream
  ever meets the old shape.

`defaultPremade(name)` is the booth's starting point. `randomPremade(name,
rnd)` rolls the whole space — pass a seeded generator for the same person
twice; a third of slots stay as authored, because the vendored looks are part
of the space.

---

## The roster

Twelve models, ~14 MB total. Heights are the catalog's target at stature 0.5;
all twelve currently share `walkSpeed 1.6` / `runSpeed 3.6`. **Materials** is
the file's full inventory — what tint slots are authored against, printed by
`npm run premade`.

| id | label | h | tint slots (materials) | other materials in the file |
|---|---|---|---|---|
| `punk` | Punk | 1.85 | Vest `Black` · Jeans `LightBlue` · Hair `Red`,`Red_Dark` | Skin, White, Eye, Eyebrows, Earrings |
| `suit` | Suit | 1.80 | Suit `Suit` · Tie `Tie` · Hair `Hair` | Skin, Eye, Eyebrows, White, Grey, Black, DarkBrown |
| `hoodie` | Hoodie | 1.80 | Hoodie `Purple` · Shirt `White` · Hair `Hair` | Skin, Eye, Eyebrows, LightBlue |
| `adventurer` | Adventurer | 1.80 | Jacket `Green`,`LightGreen` · Pack `Brown`,`Brown2` · Hair `Hair` | Skin, Eye, Eyebrows, Grey, Black, Gold |
| `king` | King | 1.84 | Robe `Blue` · Armour `Metal`,`Metal_Dark` · Crown `Gold` | Skin, Eye, Beige, DarkBrown, Hair_White |
| `astronaut` | Astronaut | 1.82 | Suit `SciFi_Main`,`SciFi_MainDark` · Panels `SciFi_Light`,`SciFi_Light_Accent` · Visor `Grey` | *(none — sealed suit, no Skin material at all)* |
| `wanderer` | Wanderer | 1.80 | Hood `DarkBrown` · Tunic `LightBrown`,`Brown` · Armour `Metal`,`Metal_Dark` | Skin, Gold, Black, Brown2, White · carries a sword |
| `witch` | Witch | 1.95 | Robe `Purple` · Trim `Gold` · Hair `Hair_Black` | Skin, Brown, Brown2 · wide hat |
| `rebel` | Rebel | 1.84 | Outfit `Black` · Boots `Brown` · Hair `Pink` | Skin, Grey, Hair_Brown |
| `executive` | Executive | 1.78 | Jacket `Red` · Blouse `LimeGreen` · Trim `Gold` | Skin, Brown |
| `pilot` | Pilot | 1.79 | Suit `Blue`,`LightBlue` · Under-layer `Black` · Hair `Hair_Black` | Skin, Metal, Grey, Brown, DarkBrown |
| `casual` | Casual | 1.78 | Top `White` · Trousers `Orange` · Hair `Hair_Blond`,`Hair_Brown` | Skin, Grey, Brown |

Two things that catch people: **`astronaut` has no `Skin`** (it is a sealed
suit, so a "skin tone" question about it is meaningless), and **material names
are shared across files but mean different garments** — `Black` is a punk's
vest and a pilot's under-layer. Slots are per-model for exactly that reason.

---

## Where the geometry lives

- `public/models/duelists/*.glb` — mesh, rig, named materials, kept clips.
  Self-contained; nothing fetches anything else.
- `src/components/story/premadeRig.ts` — record → duelist in a scene: one
  cached template per model, materials rebuilt (recoloured where tinted, and
  as cloth-rough standard so the booth's key and the field's sun land the same
  way), scaled to catalog height, clips through an `AnimationMixer`. The seam
  is a `root`, an `update(dt, stride, groundSpeed)`, a `dispose`.

**Thirteen clips are aboard; the rig plays three.** Idle, Walk and Run drive
the field. Also in every file, waiting: `Idle_Neutral`, `Wave`, `Interact`,
`Sword_Slash`, `Punch_Left`, `Punch_Right`, `HitRecieve`, `HitRecieve_2`,
`Roll`, `Death`. NPC behaviour and duel cutscenes are mostly a matter of
exposing these, not authoring animation.

**A crowd is cheap to fetch and not free to hold.** Templates cache per model,
so ten NPCs on `m_suit` cost one download and share geometry — but each rig
builds its own materials and skeleton. Fine at NPC counts; measure before a
literal crowd.

---

## The standard

Five rules. Every one of them shipped wrong once before it was written down.

1. **Feet must not slide.** Ground speed is the one truth: playback rate is
   real ground speed ÷ the catalog's `walkSpeed`. Scale them independently and
   they agree at exactly one pace and skate at every other. In the world the
   speed is measured off the position the boundary clamp *actually allowed*,
   so a duelist pinned at the edge slows to a stand instead of marching on the
   spot.
2. **Nothing advances by `time × rate`.** The mixer integrates `dt`. The old
   lesson, in full: a phase computed from the elapsed clock jumped by
   `t × Δrate` on every change of pace — ten minutes in, easing out of a
   standstill drove the legs through five thousand cycles a second.
3. **A tint must never touch the skin**, and here that is structural: a slot
   recolours only the materials it names, and the face's materials may not be
   named. Keep it structural. The moment tinting grows cleverer than a name
   list, `UNTINTABLE` has to grow with it.
4. **The authored look stays reachable, exactly.** `AS_AUTHORED` keeps the
   file's own colour untouched. A "default" that is a nearby swatch is a
   drifting copy of a finished thing.
5. **The model on screen is the model that ships.** The booth previews with
   `buildPremadeRig` and the world walks with `buildPremadeRig`. Anything
   previewed by a different code path will drift, and you will find out from a
   player.

Two more that are about the async-ness, learned in the booth: **never show an
empty stage between two models** (the old one holds the plinth until its
replacement is ready), and **never let a permanent decision be approved before
its subject has been drawn** (Bind is gated on the first model landing).

---

## Proving it

Assertions are necessary and not sufficient. Photographs are the other half.

```shell
npm run premade      # the files hold what the catalog claims: rigged,
                     # Idle/Walk/Run aboard, every slot naming real materials
                     # and none of them the face's — plus each file's full
                     # material inventory, which is what slots are written from
npm run story        # the flow end to end, two phone sizes
npm run handling     # every control driven by hand, frame by frame — every
                     # duelist read off the page, so a new row is photographed
                     # without touching the script
npm run build && npx tsc --noEmit && npx eslint
```

**Then look at the pictures.** Not at whether the command exited zero.

- **Photograph every model, not the default.** A bad scale, a wrong facing or a
  lost accessory shows in the per-duelist frame first.
- **Photograph the tints landing.** A slot naming the wrong material shows as
  colour moving on the wrong part of the body — or nowhere.
- **Photograph the angle the game actually uses.** The world is behind and
  above; the booth is in front. A model can be right in one and wrong in the
  other.

If a defect is found, build the view that shows it into `npm run premade` or
the driving scripts *before* fixing it. A fix nobody can re-photograph is a fix
that comes back.

---

## The characters we actually want

The goal is duelists with the presence of the ones this game is about — Yugi,
Kaiba, Joey, Mai. The constraint is the licensing rule at the top of this file,
and it is not a formality: fan-made models of those characters are almost
always ripped from the official games or licensed non-redistributably, so
their provenance cannot be written honestly into `LICENSE.md` and they cannot
go into this repo. That is true regardless of the project being personal and
non-commercial.

What actually gets us there:

1. **The tint system is already a costume system.** Spiked hair in black and
   magenta over a dark jacket reads as one silhouette; the Suit model in white
   with gold trim reads as another; Punk in blond reads as a third. New catalog
   rows with original names and evocative styling cost a row and a file.
2. **Accessories carry more than faces do.** A duel disk on the forearm would
   do more to say "this is a duelist" than any amount of head geometry — and
   it is one small mesh, parented to a bone, in a system that already loads and
   scales models.
3. **Commissioned or CC0-base originals** for the handful of named characters
   the lore actually needs. Twelve archetypes cover a plaza; a rival needs to
   be somebody.

When we do this, it is still a row in `DUELIST_MODELS` and a file with a
license we can quote. No exceptions, no second path.

---

## The retired system

`src/components/story/humanoid.ts`, `head.ts`, `loft.ts`, `toon.ts`,
`src/story/presets.ts`, and the `/diag/character` lab with `npm run clash` /
`npm run character` are the old procedural duelists — bodies lofted from
cross-sections, latterly cel-shaded and inked. They are unreachable from the
game (booth, world and server all speak `PremadeCharacter`) but still compile
and their lab still runs. They stay until removing them is a decision somebody
makes on purpose. **Nothing new may be built on them** — "there must never be
a second character system" now cuts against them.

---

## Verifying against production

Story Mode has no auth: one hardcoded name is admitted (`AUTHORISED` in
`src/server/story.ts`) and any caller stating a username is believed. Binding a
duelist is **permanent**; the only way back is Delete Character, which erases
the whole save. `handling-check` therefore refuses to *bind* against any host
that is not localhost, and `story-check` refuses to *delete* against one. No
script may be pointed at a deployment in a way that spends — or erases — a
real account's progress.
