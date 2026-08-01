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
at a time and compresses the timing when a backlog builds, so the computer's turn
still reads as a sequence without making anyone wait. It is cosmetic only — the board
state is already current and input never blocks on it.

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
