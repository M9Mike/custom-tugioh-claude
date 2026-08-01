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
npm run sim 400          # random duels; reports rule errors
npm run e2e      -- http://localhost:3100 3          # two players over HTTP
npm run e2e-ai   -- http://localhost:3100 3          # one seat is the computer
npm run e2e-tournament -- http://localhost:3100 6 yugi --skilled   # whole brackets
npm run iphone   http://localhost:3100 /tmp/shots    # WebKit, both iPhone sizes
npm run pwa      http://localhost:3100               # standalone insets
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

**Benchmarks need intervals.** At 30 games an AI matchup is ±18%, which is wide enough
to hide any real difference. Early tuning against numbers that noisy sent this AI down
a blind alley. `scripts/ai-arena.ts` prints 95% intervals; believe those, not a raw
win count.

**Loops the rules allow.** A monster could once be turned between Attack and Defence
without limit — every move legal, the turn never ending. If the AI ever seems to hang,
suspect a repeatable no-op action, not the search. `stepAI` caps a turn at 60 actions
as a backstop.

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
