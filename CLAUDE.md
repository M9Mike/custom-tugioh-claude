# Working on Shadow Duel

Notes for whoever picks this up next, including me.

## Shipping

The owner's standing instruction: **test, merge, test on production, then report.**
Not "here is a PR, shall I merge it?" — carry it through.

1. Build and run the checks below against a local production build.
2. Push the branch and open the pull request.
3. Once CI is green, merge it.
4. Re-run the end-to-end tests **against `https://custom-tugioh-claude.vercel.app`**,
   not just the local server. Production is Vercel functions plus MongoDB in Paris;
   a bug that only appears with real latency and a cold start will not show up on
   localhost. One already did — see *Hydration* below.
5. Report what was verified where.

**Merge by fast-forwarding `main` locally, not with the button.** Once CI is green:

```bash
git fetch origin main
git checkout -B main origin/main
git merge --ff-only claude/yugioh-multiplayer-game-tcnufm
git push origin main          # GitHub marks the PR merged by itself
```

The commits then land exactly as they were written, with `Claude
<noreply@anthropic.com>` as both author and committer, and nothing shows as
Unverified. Every server-side merge method rewrites something — measured, not
assumed:

| merge method | author | committer | signed |
|---|---|---|---|
| squash | the merging user | `GitHub <noreply@github.com>` | yes, by GitHub |
| rebase | original (correct) | the merging user | **no** |
| local fast-forward | original | original | no, but the hook is satisfied |

Rebase looks like the obvious fix and is not: it repairs authorship but leaves the
commit unsigned, so it is the one method that really does display as Unverified.
None of this touches the code or the deploy — it is only about keeping history
legible and the pre-push hook quiet.

## The checks

```bash
npm run build && npx next start -p 3100     # always test a production build

npm run rules            # regressions for rules that were wrong once
npm run audit            # every card's effect, resolved and checked (256/256)
npm run playable         # every card in every deck can actually be reached
npm run text             # no card's text promises more than its effects do
npm run sim 400          # random duels; reports rule errors
npm run e2e      -- http://localhost:3100 3          # two players over HTTP
npm run e2e-ai   -- http://localhost:3100 3          # one seat is the computer
npm run e2e-tournament -- http://localhost:3100 6 yugi --skilled   # whole brackets
npm run iphone   http://localhost:3100 /tmp/shots    # WebKit, both iPhone sizes
npm run pwa      http://localhost:3100               # standalone insets
npm run anim     http://localhost:3100               # the signature flourish moves
```

`--skilled` on the tournament test plays the human seat with the AI too. Without it
the run almost always ends in the quarter-final and none of the round-to-round
machinery is exercised.

**Kill stale servers by PID.** `pkill -x next-server` does not reliably match, and a
stale `next-server` holding port 3100 will serve the *previous* build — which looks
exactly like a UI regression and has wasted an hour before:

```bash
for pid in $(ps -eo pid,comm | awk '/next-server/{print $1}'); do kill -9 $pid; done
```

## Things that bit, so they do not again

**Hydration.** The name field on the home page is a controlled input whose state is
filled from `localStorage` by a mount effect. Type before that lands and the text sits
in the DOM but never reaches React — and it *looks* fine, because setting empty state
to empty is a no-op and nothing re-renders. The next render throws it away. Any test
that checks the input still holds the text proves nothing; check what the room was
actually created with.

**Safe areas, three times.** Three separate causes, and each fix revealed the next:

1. Only the duel board inset itself, so the home page ran under the notch.
2. The fix for that was keyed off `@media (display-mode: standalone)`, which an
   iOS home-screen app does not reliably match, so it did nothing. Detect
   standalone with `navigator.standalone` — that has always worked on iOS. And do
   not use a `black-translucent` status bar: it draws the page under the clock and
   *then* reports `env(safe-area-inset-top)` as 0, so there is nothing to inset by
   and any fix is a guessed pixel value. Plain `black` has iOS reserve the bar.
3. **Overlays are positioned against the padding box.** Every overlay in the duel
   is absolutely positioned inside `.duel-root`, which is both the positioning
   context *and* the element carrying the safe-area padding — so `top: 0` on a
   child is the physical top of the screen, above the inset. The Direct Attack
   prompt sat under the Dynamic Island for exactly this reason. Anything pinned to
   an edge inside `.duel-root` has to add `var(--safe-top)`/`var(--safe-bottom)`
   itself.

`npm run pwa` guards all of it, and forces a 59px notch to do so. Note that its
overlay half drives *two human seats* rather than the computer: against the AI it
reached an attack only sometimes and reported the check "unchecked" the rest of
the time, which reads as a pass. Not reaching the prompt is now a failure.

`/diag` reads the real numbers off the phone when something still looks wrong,
because none of this reproduces off-device. And iOS caches the status-bar style at
install time — after changing it the app has to be removed from the home screen
and added again.

**"The effect works" is not "the card works".** The audit resolves every effect
directly and was perfectly happy while three cards sat dead in their owners' hands:
The Dark Door, Dark Sanctuary and Umi are Continuous or Field Spells whose whole
effect is an aura, so they carry no `activate` trigger — and the rule deciding what
may be played from the hand asked for one. `npm run playable` asks the engine's own
gates instead. Related: Relinquished fired on `onNormalSummon`, and it is a Ritual
monster, so it never fired at all. If a card looks inert, check that a player can
reach it before checking the effect.

**A modal over the board is a trap.** Michizure and Ring of Destruction ask you to
point at a monster, and the trap response window is full-screen — so choosing the
trap left the prompt sitting on top of the board with no way past it and the card
could not be used at all. Anything that starts a target selection has to get out of
the way: `pendingPrompt` is gated on `mode.kind === 'idle'`.

**Flip effects resolve after the damage step**, not before. Firing them first let
Man-Eater Bug remove the attacker and end the battle early, so the bug itself
survived untouched. `resolveFlip()` runs on every exit path from an attack.

**Effects are queued, not batched.** Every animation the server reports used to be
played in one frame, so a turn snapped to its final state. `Duel.tsx` drains them one
at a time. It is cosmetic only — the board state is already current and input never
blocks on it.

The engine reports events in the order things actually happen, so a combo arrives as
a chain of beats and each one has to be given its moment: the Flute is declared, the
dragon *arrives* (its own announcement — without it a monster fetched by a Spell
simply appeared), then the dragon's own effect is declared, then what it destroys.
Compression is therefore gentle and only for a genuinely long line; racing through
to save four seconds throws away the thing the queue exists for. A monster going off
reads "Blue-Eyes White Dragon's effect activates", not "Kaiba activates Blue-Eyes
White Dragon" — it is already standing there.

**The banner is for the cry, never the name.** It fell back to the card's name when
a card had no flavour line, so the screen read "Joey activates Monster Reborn" with
"Monster Reborn" printed again right under it.

**No 3D engine.** Every effect animates `transform`, `opacity` or `filter`, which the
compositor handles for free. A WebGL context would roughly double a 1MB bundle to
draw the same rectangles, and CSS does a real rotateY card flip natively.

**2.5D by the moment, never the board.** Tilting the whole field costs playability on
a 414px phone: the far row shrinks and vertical space is already the scarce thing.
Depth is spent where it is free instead — a signature card's flourish, the flip, the
lunge, a card being laid onto the field. Those use `perspective()` *inside* the
transform rather than the property on a parent, so the zones stay plain 2D boxes and
nothing about hit-testing, clipping or layout changes; only the card being animated is
ever in 3D, and only while it moves. The signature moment is the one thing exempt from
the queue's backlog compression — cut to a third it stops mid-rush, which reads as a
bug rather than a flourish.

**Check the thing, not a proxy for it.** Three separate false results this way:
a deploy watcher grepping the HTML for a class that only exists in the CSS bundle;
another looking for `/_next/static/css/` when Next serves it from `/chunks/`; and a
declaration counted as "seen" because the element was still in the DOM at
`opacity: 0`. Assert what a person would look at — the computed style, the served
bundle, the seat name the room really opened with.

**Everyone duels.** The bracket pairs off whoever is left rather than padding to a
power of two: ten becomes five matches, then two and a bye, then one and a bye,
then the final. Only an odd count makes a bye at all, and it never goes to the
player. Sizing it to the next power of two handed six of ten a walkover.

**Benchmarks need intervals.** At 30 games an AI matchup is ±18%, which is wide enough
to hide any real difference. Early tuning against numbers that noisy sent this AI down
a blind alley. `scripts/ai-arena.ts` prints 95% intervals; believe those, not a raw
win count.

**A gate the rules do not enforce is not a rule.** Five monsters said "Requires
Toon World" in their text and could be Normal Summoned without it; three Ritual
monsters walked out of the hand for free while the Ritual Spells whose entire job
is to summon them sat unused. `summonBlocked()` is now the one place that decides,
and the player, the AI and both test drivers all ask it rather than each carrying
a copy of the rule. Two of those copies had already drifted.

**Then check the deck still works.** Gating the Toons dropped Pegasus from 41% to
23% under `npm run sim` — but that plays at random, and a combo deck at random
never draws its enabler on purpose. Measured with the real search he wins 68% ±12
and has Toon World down in 73% of games. Believe the AI's number, not the random
one, before rebalancing anything.

**Gating also stranded cards.** Both Ritual Spells searched only the Deck, so a
Ritual monster you had *drawn* became a dead card the moment it could no longer be
Normal Summoned. And Crab Turtle had no Ritual Spell in the game at all. `from` on
a Special Summon now takes a list of zones, and `npm run playable` checks that a
monster it refuses to summon has something in the same deck that brings it out.

**The Toon idea, in full.** Toon World is the engine: while it is face-up your
Toons need no Tribute, gain 500 ATK, attack directly and cannot be targeted.
Blue-Eyes Toon Dragon, Toon Summoned Skull, Toon Mermaid, Manga Ryu-Ran and Dark
Rabbit cannot be Summoned without it. Toon Alligator is the way in — it is never
gated, and Normal Summoning it fetches Toon World from the Deck. Ryu-Ran,
Bickuribox and Parrot Dragon take the aura but do not need it.

**The board runs ahead of the queue, so the numbers have to be held back.**
`Duel.tsx` drains animations one at a time while the state from the server is
already final — which meant Life Points dropped before the attack that took them
landed, and the win screen arrived on top of the blow that ended the duel. The
total shown is now the real one *plus* whatever damage or healing is still
queued, which converges on its own: an empty queue adds nothing. The win screen
waits for the queue, the damage number and the banner, with an eight-second
backstop, because "the duel is over and nothing says so" is far worse than a
modal over a tail of animation. Paying Life Points as a cost emits a `damage`
event for the same reason — the total must never move with nothing on screen
saying why.

**The board's cards are `compact`.** That skips the whole name/stat block in
`GameCard`, so the ATK and DEF on the field come from a separate overlay bar in
`Duel.tsx`. A change to the card's own stats is invisible on the board. Both are
tinted when a stat is off its base now — red for lowered, green for raised —
because a monster hollowed out by Skull Dice looked exactly like an untouched
one, which is how a 0 ATK monster gets sent into an attack.

**Audio does not reproduce off an iPhone.** Desktop WebKit recovers from a
suspended AudioContext by itself, so the "sometimes plays, sometimes not" report
cannot be reproduced or its fix proved here — a probe that suspends the context
and taps passes on the broken code too. What is defensible without proof: the
unlock listeners now stay bound for the life of the page rather than being
removed on first success (iOS re-suspends whenever it likes), and nothing is
scheduled against a suspended clock, where it is silently lost. `/diag` reports
the context state and has a button that makes a noise inside a real gesture,
which is the only way to tell "never unlocked" from the ringer switch.

**A card's text is a promise, and the audit cannot read it.** The audit drives
each effect and proves it fires — which can only ever check the half of the card
that was written. It is blind to a sentence with no effect behind it, and three
cards were reported by a player for exactly that: Sword Arm of Dragon's "1800 or
less ATK" was hung on a boolean immunity flag and evaporated, leaving a 1750 body
unkillable; Masaki's "while you control another Warrior" was granted permanently
on summon, so he was immortal alone; Rocket Warrior's second sentence did not
exist at all. `npm run text` reads the rules text and insists the effects account
for it — a phrase naming a trigger must have that trigger, a phrase naming a
condition must carry one, and an ATK threshold must land in a filter that can
hold it. It found eight more the same day it was written.

**Auras can be conditional, and were not being read that way.** `aurasFor`
ignored `eff.condition` entirely, so every conditional aura applied
unconditionally. `conditionMet` only reads counts and slugs, never effective
stats, so calling it from inside the stat calculation cannot recurse.

**A passive that is granted on summon is not a property.** Roughly forty cards
granted themselves `pierce`, `directAttack` or battle immunity through an
`onSummon` op. A Flip Summon fires `onSummon` so that path was fine, but a
monster flipped face-up *by being attacked* is not summoned — so its own "cannot
be destroyed by battle" did not apply in the battle that revealed it, and Winged
Dragon, Guardian of the Fortress #1 was reported for exactly that.

`liftPassives` in `cards.ts` moves every *permanent* one into a continuous aura
on the card itself, once, rather than in forty card definitions — so a definition
may still read "when summoned: pierce", which is how a player thinks of it, while
the engine treats it as the property it is. Auras are read from what is face-up
on the field, so it holds however the monster arrived, lapses when the card is
negated, and is gone the moment the card is.

Only `duration: 'permanent'` is lifted. Sabersaurus can attack directly "this
turn", which belongs to the moment it arrived — lifting that would quietly let it
do so every turn, and `npm run text` caught precisely that within a minute of the
change.

**Audio: the context must be *built* inside a gesture, not merely resumed in
one.** The report was exact — "when I switch to the background and come back the
sound is there, initially it is not" — and that is the signature of a context
constructed outside a user gesture: iOS will not honour a later `resume()` on it,
but `visibilitychange` re-creates the conditions that do. `primeAudio()` used to
construct one from a mount effect. It now only arms the gesture listeners;
`unlock` is the only thing that may build the context, and it only ever runs
inside a tap.

The path that actually broke was landing straight on a duel URL — a shared link,
or the app restoring into a duel — because on that page nothing had been tapped
yet. Coming through the home page happened to build it inside a click, which is
why a probe that only walked the normal route passed on the broken code.

**Loops the rules allow.** A monster could once be turned between Attack and Defence
without limit — every move legal, the turn never ending. If the AI ever seems to hang,
suspect a repeatable no-op action, not the search. `stepAI` caps a turn at 60 actions
as a backstop.

**`pointerType === 'mouse'` does not mean a mouse.** iOS synthesises mouse events
after a tap on anything carrying `:hover` styling — the hand cards lift, so they
qualify. The hover preview was gated on the pointer type and fired on taps anyway,
opening the card inspector over the board; the inspector is a modal, so the next tap
went into its scrim and the board looked dead. Ask the device what it can do
(`matchMedia('(hover: hover) and (pointer: fine)')`), not the event what it claims to
be. The hand also now sits *above* the inspector's scrim, so reading a card can never
take your own cards away from you.

That one surfaced as a one-in-four flake in `npm run iphone`, reported as
`<div …> intercepts pointer events` after a thirty-second timeout — a message that
names the symptom and hides everything else. The check now says which element is on
top and screenshots the board, which is what turned a week-old mystery into an
afternoon.

**A tap before hydration is gone, not queued.** The typed name was fixed by having
the mount effect keep whatever is already in the field — but a *tap* has nowhere to
be kept. On a cold serverless start over a phone connection, Join did nothing, gave
no error and gave no reason, and the tap never fired even once React was listening;
the only way through was to tap again. The home page's four actions now sit disabled
until the mount effect runs, and the first one says "Waking the arena…" so the state
is visible rather than silent. It only ever shows on a cold load.

**Sample animations, do not squint at them.** A signature card's flourish looked
static in screenshots and it was: with one ease-out over the whole run, the card
covered all 600px of its depth in the first 200ms — while still fading in — so it
appeared already arrived and just sat there. Pause the animation and step it with
`document.getAnimations()`, then read `getBoundingClientRect()` at each point. The
projected scale is the answer; a screenshot lands wherever it lands.

**Emblems worth knowing when testing the flourish.** It only fires for the ten
signature cards, so a duel that never draws one proves nothing. Rex Raptor's
Two-Headed King Rex and Bakura's Man-Eater Bug are the cheap ones — level four and
below, out with a plain Normal Summon. Kaiba's Blue-Eyes needs two tributes and will
not show up.

## Shape of the thing

- `src/game/` — the rules engine. Pure and deterministic, shared by client and server.
  `engine.ts` resolves duels, `ai.ts` searches, `types.ts` is the effect DSL.
- `src/server/rooms.ts` — rooms, load → mutate → save on every request so no player is
  pinned to one serverless instance. `tournament.ts` rides on the same nudge endpoint.
- `GAME_AI` in `src/game/ai-levels.ts` is the one place naming the level the game plays
  at. There is no difficulty setting; the weaker configs exist only for the arena.
- Functions are pinned to `cdg1` (Paris) beside the MongoDB cluster. The database is
  read and written on every move, so co-locating them matters more than the player's
  own hop.
