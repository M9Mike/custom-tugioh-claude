# Working on Shadow Duel

Notes for whoever picks this up next, including me.

## Shipping

The owner's standing instruction: **test, merge, test on production, then report.**
Not "here is a PR, shall I merge it?" — carry it through.

1. Build and run the checks below against a local production build.
2. Push the branch and open the pull request. **Open it before merging** —
   fast-forwarding `main` first leaves no commits between the two, GitHub
   refuses the pull request with "No commits between…", and the change ships
   with no record of why. Done exactly that once; the ordering is the whole
   guard. The pull request is a record, nothing more.
3. Merge it *immediately*. The owner's explicit instruction: **do not wait on,
   read, or rely on the bot reviews (Corgea, CodeRabbit) at all** — the local
   battery before the push and the production battery after the deploy are the
   whole gate, and they are yours to run. CodeRabbit rate-limits at this
   shipping pace anyway, and in six pull requests the bots produced one
   defensive nit between them.
4. Re-run the end-to-end tests **against `https://custom-tugioh-claude.vercel.app`**,
   not just the local server. Production is Vercel functions plus MongoDB in Paris;
   a bug that only appears with real latency and a cold start will not show up on
   localhost. One already did — see *Hydration* below.
5. Report what was verified where.

**Merge by fast-forwarding `main` locally, not with the button.** As soon as the
local battery is green:

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
npm run ai               # the computer plays obvious positions the obvious way
npm run sim 400          # random duels; reports rule errors
npm run layout   http://localhost:3100               # the board sits in the same place in all three modes
npm run e2e      -- http://localhost:3100 3          # two players over HTTP
npm run e2e-ai   -- http://localhost:3100 3          # one seat is the computer
npm run e2e-tournament -- http://localhost:3100 6 yugi --skilled   # whole brackets
npm run iphone   http://localhost:3100 /tmp/shots    # WebKit, both iPhone sizes
npm run pwa      http://localhost:3100               # standalone insets
npm run anim     http://localhost:3100               # the flourish moves, the LP bar glides
npm run audio    http://localhost:3100               # the AudioContext waits for a tap
npm run deck-bench pegasus 100                       # a deck's real win rate, ±95%
npm run pacing   http://localhost:3100               # the computer's turn reads as beats
npm run rematch  http://localhost:3100               # the second duel narrates too
npm run race                                         # two requests cannot undo each other
npm run rejoin   http://localhost:3100               # you can walk back into your own duel
npm run spectate http://localhost:3100               # the exhibition plays, pauses, resumes
npm run paint    http://localhost:3100               # no screen is too expensive to sit and look at
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

**Time on screen is not reading time.** The declaration held for 800ms and was
*legible* for 200–540ms of it: one cubic-bezier stretched over the whole run
dragged the fade-in out and started the fade-out early, so most of the beat was
spent at an opacity nobody could read. Reported as "texts showed but so fast I
didn't understand anything", and invisible to `npm run pacing`, which was timing
`offsetParent !== null` — the element sitting there at `opacity: 0` counted as
shown. That is the exact trap two notes below, walked into from the inside.
Each segment carries its own timing function now, full opacity across 86% of the
run, and the floor is 1100ms.

Measuring it needs care too: accumulating a fixed step per `setInterval` tick
undercounts precisely the beats with the most animation behind them, so the
probe blamed the game for its own blinking. Sum the real elapsed time between
ticks.

**A timeout is not a stall detector.** The win screen's backstop counted eight
seconds from the moment the duel ended — fine when beats were brief, a
guillotine once each held for over a second. The turn that kills you is the
longest chain in the duel (summon, summon, battle, attack, damage, attack,
damage), so the end of a losing duel was the one part nobody could follow. It
watches for three seconds of *silence* instead: while beats keep arriving the
tail plays out in full, and a genuine stall still shows the result.

**One line, in the middle, for every beat.** There used to be two: the card's
cry in the centre of the screen and the declaration near the edge — so Crush
Card Virus, whose cry is "Crush Card!", printed its own name twice. The cry
banner is gone. What remains says who did what, sits in the middle, and speaks
for *every* beat: each log line is paired with an animation as it is written, so
nothing the duel records has to be read out of the log afterwards. The log is a
memory aid, not the place a player goes to find out what happened.

Pair the line to the beat **whichever order the caller wrote them in.** Most
sites log first and animate second, so `anim()` claims the pending line — but
some do the reverse, and giving those an extra beat made Kuriboh's token
announce itself twice. Leftovers attach to the last beat that has no line, and
only a genuinely orphaned line gets one of its own.

**The board must not know things the player has not been told.** `state` from
the server is already final, and it arrives one commit before any effect can
react — so in that commit the Life Points showed the post-damage total and the
monster stood in its zone, both before the queue had said a word. That is the
Life Points flashing to the final number and then counting down to it again, and
a signature card's flourish playing *over* a monster already on the board.

`playedAnims` is state, not a ref, and the board derives from it **during
render**: Life Points hold back whatever damage is unspoken, and a monster whose
summon has not been announced is drawn as an empty zone. Reading a ref during
render is the tempting version and lint is right to refuse it — the value has to
participate in rendering, so it has to be state.

**A prompt with one option is not a choice.** `scanOps` hardcoded `count: 1` for
a Special Summon, so The Flute of Summoning Dragon — which brings out *two*
Dragons — resolved the moment the first was picked and chose the second itself.
It reads `op.count` now, and the prompt only opens when more cards qualify than
the effect will take, so holding exactly one Dragon summons it without asking.

**"It gains 400 ATK" means the monster it just summoned.** Call of the Haunted
revived a monster and then buffed `pick: 'strongest'`, so reviving anything
small handed the bonus to whatever was already the biggest thing you controlled.
`pick: 'summoned'` resolves to what that same effect brought out.

**An action used to destroy the previous action's animations.** `applyAction`
emptied `state.anims` every time, which is only correct if the client sees every
single version — and it does not. The computer plays one action per nudge while
the poll loop runs on its own 1.1s timer, so a poll landing after two AI actions
jumped a version, and the skipped action's events were already gone. A whole
turn arrived as nothing but its final beat: *"I instantly just saw their fusion
on the board."* The same hole is worse in a two-player duel, where the other
player can summon, attack and end their turn inside one 2.6s poll. `anims` keeps
a rolling tail of 48 now, ids are unique per version, and the client ignores any
it has already played — plus it swallows the tail on the *first* view, or
opening a duel would re-enact its recent history.

**The board must wait for its own narration.** The nudge asked the computer for
its next action every 750ms regardless of what was on screen, so a six-action
turn was six requests deep before the first had finished announcing itself.
`setAnimating` reports the drain to the room, the nudge holds while it is true,
and the turn resumes the moment the board goes quiet. That, not the queue alone,
is what makes a turn read as one thing after another. A beat carrying a
declaration also has a floor (`MIN_SPOKEN_MS`) so backlog compression can never
squeeze a line below readable — silent beats still compress freely.

`npm run pacing` plays a real vs-AI duel and times every declaration the board
puts up. Note that its own loop has to wait for the computer rather than click
on a timer: the first version clicked End Turn every 400ms, outran the improved
pacing, and reported the fix as a regression.

**A Fusion Summon is a thing being made.** Three cards spent at once for the
strongest body in the game, and it resolved with the same small banner as
drawing a card. The materials now swing in from the sides, meet, flare, and the
monster comes out of the flash — and the event carries `from` (the material
slugs) so the board can show what it was made of. Every Fusion gets it, not only
a duelist's emblem card. Sampled by `npm run anim` the same way as the signature
flourish: materials travel 121px inward to dead centre, the result peaks at
1.18×, and the result must not appear before its materials have met.

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

**Ask Vercel whether it deployed; do not grep the bundle.** Twice now a deploy
watcher has reported "still building" while the change was already live —
hashing the homepage's chunk list, which does not change when only the duel
route did, and then grepping for a string that lives in a chunk the homepage
never references. `list_deployments` gives the deployment's own `state`, which
is the actual answer. Grep the served bundle only to confirm *what* is in it,
never to decide *whether* the deploy happened.

**A watcher that cannot reach its target looks exactly like one still waiting.**
A CI poller here curled `api.github.com` directly, which this environment answers
with a 403 — and its error handling turned an unparseable body into "not done
yet", so it would have looped in silence for sixteen minutes and reported
nothing. Silence is the same shape as patience. Prove a watcher can *see* before
trusting what it does not say, and make the timeout path say so out loud rather
than just exiting. `npm run audio` follows the same rule from the other side: if
it reaches neither the pass nor the fail state it reports "this proves nothing"
and exits non-zero, because an earlier version of that probe passed happily on
the broken code by never getting far enough to look.

**Sound needs a tap the page has not had yet.** iOS will not honour a later
`resume()` on an AudioContext *constructed* outside a user gesture — only one
built inside a real tap ever plays. The tell is precise: sound absent at first,
present after backgrounding the app and returning, because `visibilitychange`
recreates the conditions that work. `primeAudio()` only arms listeners now;
`unlock` is the one thing allowed to construct the context. The path that
actually broke is landing straight on a duel URL — a shared link, or the app
restoring into a duel — where nothing has been tapped. Arriving via the home page
happens to build it inside a click, so any probe that navigates normally passes
on broken code; `npm run audio` seeds the stored identity and goes direct.

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

**A condition asked once is not a condition.** "While *Umi* is on the field,
this card gains 800 ATK" was an `onSummon` op behind a `condition`, so the order
of play decided everything: Umi down first and 7 Colored Fish kept the 800 for
good — even after Umi was destroyed — while summoning first meant it never got
them at all, however long Umi then sat there. Reported from a real duel, and
Amphibian Beast had the same shape. A conditional *continuous* aura is re-read
every time the stat is wanted, so it simply follows Umi. `aurasFor` already
honours `eff.condition`; the cards just were not using it.

**A Tribute Summon makes its own room.** The hand sheet required a free Monster
Zone before offering any summon, so a full board locked out the one summon a
full board is *for* — exactly backwards. The engine was always fine, and
`finishSummon` already resolved the destination after the tributes were paid;
only the gate was wrong. A summon costing nothing needs a spare zone, a Tribute
Summon needs bodies.

**The bye rode to the final.** `matchesForRound` walks the survivors in pairs, so
an odd count always leaves the *last* name over — and a bye winner stayed last,
having been last when they got the bye. The same duelist could go from the
quarter-final to the trophy without duelling once; half of all brackets had a
repeat bye. Whoever just had one now goes to the front of the queue, which is a
real match by construction. The player still comes first of all, so the bye is
never theirs.

**Only the picker could show a deck.** The deck viewer's markup lived inside the
`if (picking)` branch, so opening it from the home page's duelist strip set the
state and drew nothing whatsoever. It is one function rendered by both screens
now. Worth remembering when a modal "does not open": check it is on the screen
you are looking at.

**Exodia had no moment.** `case 'win': break;` — the five pieces came together
and the victory modal simply appeared, for the one card in the game that ends a
duel outright. The flourish is earned by carrying a slug the client can name, so
the engine sends one and the signature set includes Exodia even though it is
nobody's emblem and wins from the hand rather than the field. The win screen
already waits for the queue, so giving the event a real beat delays it for free.

**Believe `npm run deck-bench`, not `npm run sim`.** Pegasus measures **29%**
under random play and **85% ±7** under the real AI, because a combo deck at
random never draws its enabler on purpose. The gap is not a rounding error, it
is the whole picture — check a deck change with `npm run deck-bench <duelist>`
before concluding anything. It prints a 95% interval, which at a hundred games
is around ±8: two runs a dozen points apart are usually the same deck.

**"Gains 200 ATK for each card in your Graveyard" is a number that keeps
moving.** Six cards granted it *once, on summon* — when the Graveyard is
normally empty, so they gained nothing and then never grew. Two-Headed King Rex
is Rex's signature monster and says "for each **Dinosaur**", while the
`perCardInGrave` scale counted every card there regardless of type. Dark Magician
Girl says "400 for each Dark Magician in **either** Graveyard" and was getting
200 per card in her own — wrong pool, wrong filter, wrong figure, and frozen.
Machine King was a different card entirely: a flat 200 to every Machine you
controlled, rather than 200 to *himself* per Machine on the field.

A scaling bonus belongs in `aura.per` — read live like any other aura, so it
tracks the Graveyard filling up. Counting only ever touches printed card data,
never an effective stat, so a Machine counting Machines cannot recurse. Dark
Magician keeps its one-shot on purpose: its text says "When Summoned: it gains…",
which really is a snapshot, and `npm run text` reads the sentence for a trigger
clause before judging.

**A check that cannot fail is worse than no check.** Teaching the audit about
`per` looked done when it went green — and it passed just as happily with the
scaling ripped out of the engine. Restoring the aura puts the card's own body
back on the board, which satisfies "something moved" all by itself, so relaxing
the `onlySelf` guard left nothing being tested. Scaling auras get their own
measurement now: empty the counted zone, read the stat, add one matching card,
and insist the number moves by exactly the promised step — fed on the *far* side
wherever the wording allows, so a card that only ever looks at its own is caught
rather than flattered. Verified by disabling the engine's scaling and watching
all six fail.

**A count is not a finding.** `npm run audit` printed "effects not driven: 9" and
never said which — so nobody noticed that seven of the nine were *every Fusion
monster in the game*, the most exciting cards there are, whose effects had
therefore never been verified once. It names them now. Driving all seven through
a real Fusion Summon found five correct and turned up the hole below.

**Nothing was asking whether the Extra Deck could be reached.** Every playability
check drives a card the player could hold, and a Fusion monster is never held.
Four duelists carried a Polymerization with no Fusion to summon — a dead card in
a twenty-five card deck, roughly one wasted draw in six games — and Mai had a
Normal Spell, Harpie Lady Phoenix Formation, filed in her Extra Deck where
nothing could ever reach it. Polymerization *is* the relationship: it does
nothing alone, so it is only playable if some Fusion in the same Extra Deck has a
recipe whose materials sit in the same main deck, and `npm run playable` checks
exactly that now. Mai's Spell moved to her main deck where it works; the other
three swapped the dead card for a second copy of a monster that already defines
the deck. Flame Swordsman and Bickuribox are still flagged `isFusion` with no
recipe, which is harmless only because no deck lists them — the check would catch
it the moment one did.

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

The same class had two stragglers found later: `attackAllMonsters` and a
permanent `extraAttacks` are properties too, and were still `onSummon` ops — so
a Monster Reborn'd Blue-Eyes Ultimate Dragon lost "attacks every monster once
each", and a Set Two-Headed King Rex flipped face-up by an attack attacked once
for the rest of the duel. Both lift into aura grants now (`attackAll`,
`doubleAttack`). Parrot Dragon's "attack once more *this turn*" is the
counter-example: the op carries `duration: 'turn'` and stays behind, because it
used to be applied permanently and stacked — one extra attack per turn for every
monster it had ever killed.

**"Once each" needs a memory.** `maxAttacks` read the opponent's *current*
monster count, so every kill shrank the allowance: against three defenders the
Ultimate Dragon killed two and the third was unreachable, the ceiling having
dropped below the attacks already spent. And nothing remembered which monster
had been visited, so it could hammer one survivor repeatedly. `attacked` on the
instance records the visits (declaration counts, outcome does not), resets with
`attacksUsed`, and the allowance is spent-plus-unvisited so a kill never revokes
the next attack. The audit only began driving Fusion Summons the same day —
every Fusion monster's effect had shipped unverified, which is where this class
of bug had been hiding.

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

**A component declared inside another is a new component every render.**
`PlayerBar` lived in `Duel`'s render body, so each render produced a fresh
function identity — React reads that as a *different component type* and
unmounts and remounts the whole subtree. The Life Point bar carries
`transition-[width] duration-500` and a node that mounts already at its final
width has nothing to transition from, so the bar snapped while every other part
of pacing damage was being carefully held back. It is the only CSS transition in
the app, which is why nothing else looked wrong.

Lint said so all along — "Cannot create components during render" sat in a pile
of nineteen problems that were being waved through as "same total as `main`". A
warning count is not a triage. The trivial ones are cleared now so a real error
cannot hide among them; what remains is `set-state-in-effect` on mount effects
that read `localStorage`, and two React Compiler "could not preserve
memoization" notes, all of which are correct code.

Functions that *return* JSX and are called directly — `renderSTZone(owner)` —
are fine and unaffected: their output is spliced into the parent's tree, so
reconciliation is by position and the DOM node survives. Only `<Foo />` on a
locally-declared `Foo` remounts. `npm run anim` now tags the bars, forces a
re-render and fails if they are replaced; it was checked against the broken code
and does fail there.

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

**A declared attack is not a landed one.** Reported as "the AI is not trained to
play against Mirror Wall". It was worse than untrained: declaring an attack opens
a response window, and the search stopped the line right there and scored the
board with the blow hanging in the air — neither landed nor answered. Swinging
into a face-up Mirror Wall therefore looked like a clean kill, when what follows
is the attack negated, the attacker permanently halved and 300 Life Points to the
other side. It also meant the AI could never plan a second attack in any turn
where the first drew a response. `settleWindows()` plays the window out before
scoring, using the same `chooseTrapResponse` that will really settle it.

**Then check it is not reading the cards.** That fix, written the obvious way,
made the AI sidestep *face-down* traps too — it was settling the window by the
Set card's real text. Strictly stronger, completely unplayable to sit across
from, and a straight contradiction of the promise at the top of `ai.ts`. A
response may only be modelled with what the planning seat could see: everything
in its own seat, face-up cards in the other, nothing else. The check pairs
"refuses a face-up Mirror Wall" with "attacks into a face-down one" for exactly
this reason — remove the visibility filter and the second goes 0/10.

**The lookahead was reading the deck.** `rollout` plays real turns through the
real `applyAction`, which draws the real next card — so it could discover that
passing "wins" two turns later, because the winning card was on top and the
playout knew it. That is how the AI came to pass its turn holding the only
blocker it had, with the board rating the summon nearly 6000 points higher.
`hideTheFuture()` reshuffles both decks first, deterministically from the state's
own seed.

**And its verdict was replacing the board, not refining it.** `line.score =
rollout(...)` threw away the immediate evaluation outright, so one cheap playout
— beam 2, no lookahead, budget-starved — could erase a decisive one-ply read, and
`evaluate`'s ±1e9 for a decided duel meant a *speculative* win outranked
everything real. A playout now shifts a line by at most `ROLLOUT_AUTHORITY`
(3600, about the full range of the race term): enough to re-rank lines the
evaluation rates closely, which is its job, never enough to overturn arithmetic.

**Three of those only bite on some deck orders**, so `npm run ai` plays every
position over ten of them. On one board the buggy AI passed all nine cases; over
ten it scores 7/10 and 9/10 where the fixed one is 10/10. A single position is
not a test of a search that has any randomness downstream of it.

**Measure "better", not "different".** All of the above is worth nothing if the
AI got weaker, and nothing else in the battery can tell you: `npm run sim` and
`npm run deck-bench` put the same brain in both seats, so a change to the AI
moves both sides at once and the numbers barely stir. `npm run ai-ab` plays the
working copy against a snapshot of what it is replacing:

```bash
git show HEAD:src/game/ai.ts > src/game/ai-baseline.ts   # git-ignored
npm run ai-ab -- 600
```

Believe the interval. At 300 games it is ±5.7, so two configs five points apart
are the same config; 600 games buys ±4.

**And then read the sign before you panic.** This change measured 45.7% ±4.0 —
a real regression, not noise. Bisecting it: with only the deck reshuffle
disabled it is 49.0% ±5.7, level. So every point of the loss is
`hideTheFuture`, and those are games the old search was winning by knowing its
own next three draws. A cheat being removed *should* cost win rate against the
cheat. The other three parts of the change cost nothing measurable.

Bisect the same way — one piece reverted at a time, against the same baseline —
before concluding a fix was wrong. The first sweep here compared "working at
depth 0" against "baseline at depth 3" and read the gap as evidence about the
fix, when it was only ever a measurement of depth. Both arms have to differ in
exactly one thing.

**A sampling change measures as nothing at a starved budget.** `rolloutSamples`
averages several blind futures per line instead of trusting one; screened at the
harness's symmetric 1200ms it read 50.0% ±5.7, dead level, because each sample
was getting ~30ms of future. The honest number is the *deployed* delta —
`AB_BUDGET_WORKING=4000 AB_BUDGET_BASE=2500 npm run ai-ab` plays the new AI at
the thinking time it will really have against the old one at the time it really
had. Live duels think for 4000ms per turn (`rooms.ts`; the route allows 30s);
tournament side matches keep their quick 900ms because nobody is watching them.

**A probe that forces a value can measure a page that cannot happen.** Chasing
an intermittent `npm run pacing` failure I found `.declare` running 1000ms while
a spoken beat is held for `MIN_SPOKEN_MS` = 1100, concluded every declaration
ended on 100ms of blank band, and proved it by forcing each duration with
`animation-duration: … !important` — 71–76% of the beat legible at 1000ms
against 81–86% at 1100. The mechanism is real and the shipped code has never
been in it: `Duel.tsx` sets `animationDuration` inline from `fxHold`, the beat's
actual hold, and `!important` was overriding exactly that. The stylesheet number
only applies if the inline style goes missing. Check what governs the property
before measuring what happens when you change it.

**The failure that started it was the check's own jitter.** Visible time can
only ever be undercounted: a busy frame delays the sampling tick, and if it
lands after the fade the whole interval is credited to the hold and none of it
to the reading. A per-beat floor of 700ms on *that* number duly failed at 691 on
a beat held for the full 1100. The check asserts the hold per beat, where the
measurement is sound, and the visible share across the run, where the jitter
averages out.

It also counted the last declaration of a finished duel, which simply stays in
the DOM at `opacity: 0` with nothing after it to push it out — a twenty-second
hold, 19% legible. A beat is only recorded once the next one replaces it.

**And the beat it kept reporting as cut short was the one it joined halfway
through.** For a while this showed a single short hold — 294, 365, 624, 662,
775, 791, 853ms against a floor of 1100 — in an otherwise clean run, more often
on production than locally, and it was written down here as an open bug. It was
always the *first* line, and everything after it held past 1080. The probe
starts watching a fixed three seconds after load, by which time the board is
already narrating the opponent's opening turn, so it measured the remainder of a
beat that began before it was looking. Production made it worse only because the
extra latency moved where in the beat that landed.

Whatever is on screen at the first tick is now dropped, the same way the beat
still on screen at the end already was. Both ends of the run are bounded by a
beat replacing another; only those are measured. The tell that this was the
probe and not the game: a genuinely rushed queue does not politely rush exactly
one beat and then behave for the next nine.

**Two siblings with one React key, and every probe went blind.** The
declaration band was `key={fx.id}` and the damage vignette `key={hit.id}` — and
on a damage beat those are the *same string* in the same children list, which is
undefined behaviour in React's reconciler. What it actually did was orphan the
loser: every damage beat left a frozen copy of the declaration in the DOM at
opacity 0, in pairs, forever. A player never saw them — but `querySelector`
returns the *first* match, so every probe that read the declaration was reading
a fossil within a minute of play. That is where "declarations shown: 3", "the
board never announced anything", and the silent-rematch report all came from:
the game was narrating correctly the whole time. Every keyed overlay now
carries its own prefix (`fuse-`, `sig-`, `say-`, `vign-`), and the diagnosis
came from counting `[data-testid=declaration]` nodes over a minute of play —
1 on the fixed build, accumulating on the old one.

**A rematch is a new duel on the same mounted board.** Nothing remounts, so
every piece of animation bookkeeping survived into the next duel: the new
duel's beat ids restart at `a1_0` and collided with the old duel's in
`seenAnims`/`playedAnims` (opening beats silently skipped), `forceWin` stayed
true so the next win screen and fanfare fired instantly over the killing blow,
and `sungFor` kept the old winner so a repeat winner got no fanfare at all.
The duel's own `version` only climbs while a duel is alive, so version going
*backwards* means a different duel is on the board: everything resets, and
`primedAnims` drops so the new duel's tail is swallowed as history exactly like
walking in fresh. `npm run rematch` plays two duels in a browser and insists
both narrate; against the old code it fails (3 then 1 declarations), against
the fix it passes (13 and 14).

**Three producers race for the view.** The poll loop, action responses and the
AI nudge each apply whatever lands, and a poll that left the server before an
action resolved can arrive after it — rewinding the board a frame and making
`state.version` dip, which would also have broken the rematch detection.
`applyView` now refuses anything older than what is on screen, by the room's
`revision` (which survives a rematch, unlike the duel's version); `connect()`
alone may force, because a re-join is authoritative.

**Unlocking a stalled drain is not the same as ending it.** The four-second
watchdog used to only set `stalled` — the dead drain kept `drainingRef` true,
so every later beat queued behind a chain that would never run (the board fell
silent for the rest of the duel), and `setAnimating(true)` was never taken
back, so the vs-computer nudge held forever and the AI stopped playing. A
stall now dismantles the drain the way a finished queue does, and marks the
stranded beats played so their Life-Point holds let go.

**Probes: sample from outside, and never trust the first match.** Two in-page
samplers lied here — a 50ms `setInterval` starved while Playwright's
accessibility queries held the main thread, and a MutationObserver read the
same fossil node the interval did. The rematch check reads the DOM from the
Node side on each pass instead; coarser, but every sighting is real. And its
duel-over test once matched `/draw/i`, which also matches "draws a card" — the
probe called the duel over the first time anybody drew. Match the modal
heading exactly.

**A guard that compares with `<` needs to know it has a number.** Found while
probing the above: `normalSummon` with no `zone` sailed through
`action.zone < 0 || action.zone >= MONSTER_ZONES` — both false for `undefined` —
and the card was spliced out of the hand and written to `p.monsters[undefined]`.
It vanished, with no error and nothing on the field. The API route hands
`body.action` straight to the engine and a TypeScript type is no help at a
network boundary, so `Number.isInteger` goes first in every such guard.

**The board has to finish its sentence.** Beats were held long enough to read
and nothing waited for them: your own turn ran ahead of its own narration, so
you could summon, attack and end the turn with three declarations still queued
behind you, and they went past in a rush belonging to nobody. `busy` now
includes the drain, in both seats. A four-second stall watchdog is the way out —
input locked behind a beat that never lands is far worse than input over the
tail of an animation, and silence is the failure mode to design against.

The victory sting was the same bug with a speaker: it fired on `state.winner`,
which arrives one commit before the queue has said a word, so you heard you had
lost and *then* watched the blow that did it. It waits for the win screen now.

**A question on screen is the only thing on screen.** Activating Ring of
Destruction opens "choose a card to destroy" — and with that prompt up you could
still summon a monster and end your turn, leaving the trap mid-resolution. A
target, a tribute and an attack target are all the same shape: nothing else is
available until it is answered or cancelled.

**Offer only what the engine will accept.** Celtic Guardian "cannot be targeted
by your opponent's card effects" and was still offered to Ring of Destruction —
which then destroyed nothing while the damage beside it, "equal to that
monster's ATK", went through for free. And with Celtic Guardian the *only*
monster on the board, `hasPickable` (strictly-greater) auto-submitted an empty
target list, so the card left the zone having done nothing at all. Three fixes,
one shape: the picker filters what the engine would refuse, a single candidate
is submitted *by name* rather than as an empty list for the engine to guess at,
and an effect with no legal target is refused with a reason instead of being
spent. `targetAtk` honours the same protection, so one card is one effect.

**A Token is not the card whose face it wears.** Kuriboh's Token was announced
as "Mihail summons Kuriboh", so a second body arrived carrying the first one's
line and nothing said what it was. The beat carries `as` now.

**Life Points can only lose what they have.** The board reconstructs the total it
has not yet announced by adding queued damage back, and it was adding the
*headline* figure: 1200 Life Points hit for 1900 showed 1900 — the attacker's
ATK — and counted down from a number the player had never had. `dealDamage`
reports `applied` alongside `amount`; the popup keeps the full figure, the bar
uses what actually moved.

**A moth knows which rung it is on.** Larvae Moth and both Great Moths sit in
Weevil's main deck, so one can be Normal Summoned straight from the hand — and
it arrived with no Evolution Counters, needing three more End Phases to reach
the rung *above* the one it was standing on. Seeded in `newInstance`, so every
route is covered by construction rather than at five summon sites.

**Which Graveyard is the card's own business.** Making Magician of Faith reach
for your own first — the report was "it gave me back the enemy spell card" —
quietly broke Graverobber, which says "from your opponent's Graveyard" and means
only that. They share an op; the op now takes a side. The audit caught it, which
is what the audit is for; `npm run rules` pins both preferences by name, because
the audit can only ask that a card left *a* Graveyard.

**One button set the height of the whole board.** The control column beside the
opponent's Life Point bar is taller than the bar, so it is what the top strip
measures — and a bracket match adds a fourth button to that column, pushing the
opponent's hand and both halves of the field down 29px. `npm run layout` opens
the same board as two players, against the computer and in a tournament, and
insists all three put it in the same place. Two-player is the reference.

**`npm run e2e` was failing one round in six, and had been for a while.**
`autoplay.ts` was the one driver that never asked `summonBlocked`, so it
proposed Ritual monsters and ungated Toons, the engine refused them exactly as
it should, and the round was recorded as failed. Frequent enough to teach you to
ignore a red run, rare enough to look like a real intermittent. Every driver
asks the gate now — which is what this file already claimed.

**A condition that gets lifted is a condition that gets lost.** `liftPassives`
moves permanent `onSummon` grants into a continuous aura, and it was pouring
every one of them into a *single, unconditional* bag — so `eff.condition` was
dropped on the way through. The Legendary Fisherman says "While *Umi* is on the
field, this card cannot be targeted or destroyed by your opponent's effects and
can attack directly", and had the whole sentence from the moment he arrived,
for good, with no Umi anywhere: he attacked directly past blockers and walked
out of a Dark Hole untouched. Reported as two separate bugs, and it is one line
of bookkeeping — the grants are grouped by the condition they came from now.
The card is written as a conditional aura anyway, beside 7 Colored Fish and
Amphibian Beast, because that is the shape the sentence has.

**Setting a monster is not summoning one.** The Normal Summon path opened the
`opponentSummon` trap window whether the card went down face-up or face-down,
so Trap Hole went off on a Set — and the prompt read "Foe summoned Man-Eater
Bug", naming a card that was still face-down, which is the opposite of what
setting one is for. A Set opens nothing now. While in there: Trap Hole says
"Normal Summons" and was also firing on Fusion Summons, so a Normal Summon
opens `opponentNormalSummon` and a Fusion opens `opponentSummon`, with
`windowMatches` letting a card that watches the wider window catch both —
Torrential Tribute's "when your opponent summons" still gets everything.

**An ongoing effect belongs to its card, not to a clock.** Spellbinding Circle
— "the attacking monster loses 700 ATK and cannot attack while this card
remains face-up" — was `gainAtk -700` plus `freezeMonsters who:'opp' turns:1`,
which is wrong three ways at once: it locked down *every* monster they
controlled rather than the attacker, it ran on a one-turn timer rather than on
the card being there, and the −700 was written into the monster so it survived
the circle's destruction. It attaches itself now (`equipTo` gained an optional
`target` so it can reach the attacker). An equip is read live as an aura, so
all three fall out for free: the penalty and the lock last exactly as long as
the card does, they reach only the monster it is on, and `toGrave` already
sends an equip down with its host — which answers the other half of the report,
what happens when the bound monster leaves the field.

**"Other" is a word in the text.** Mystical Elf shields "your **other** Defense
Position monsters" and her aura was a plain `pick: 'all'` behind a position
filter — and she sits in Defence herself, so she was shielding herself and
could not be destroyed in battle at all. `excludeSelf` on the selector, honoured
in `aurasFor` and `resolveTargets` both.

**A Field Spell is the weather, not a personal buff.** Umi's aura was
`side: 'own'` while its text says "all WATER monsters", so one player's sea
lifted their own Fish and left the other player's alone — reported from a real
duel, from the losing side of it. Umi and Harpie's Hunting Ground read "all"
and are two-sided now. Dark Sanctuary is the counter-example and stays as it
is: "your opponent's monsters lose 400" is one-sided on purpose, and so is Toon
World's "your Toon monsters". Read the sentence, not the card type. The
Fisherman needed no change to go with it — `requiresField` has always looked at
either Field Zone, which is what "on the field" means.

**A rider is not a reason to play the card.** Mai kept activating De-Spell at an
empty Spell/Trap Zone, because it is "Destroy 1 Spell or Trap your opponent
controls, **then draw 1 card**" and the draw works whatever happens — so
nothing was asking whether the destroy had anything to destroy.
`activationIsDead` asks, and is wired into the two gates the interface and the
AI go through *and* into the action handler, so a tap that raced the board is
refused with a reason instead of spending the card.

**Judging only the leading op is the obvious version of that, and it is wrong
three ways.** Written that way it refused three cards that were doing their
job, none of which the battery caught: Harpie's Feather Duster reaches the
Field Zone with its *second* op when the Spell/Trap Zone is empty; Swords of
Revealing Light is the three-turn freeze behind a flip that may hit nothing;
and Harpie's Hunting Ground is a Field Spell whose aura is the whole card and
whose destroy is the rider, listed first only because that is the order the
engine runs them in. The card set does not put the headline first, so the
question is asked of the effect as a whole: dead only when *every* targeting op
has an empty pool, *every* remaining op is a rider (`draw`, `mill`, `search`,
`revealHand` — the compensation clause, never the reason), and the card leaves
nothing standing on the field. A Continuous or Field Spell is therefore never
refused, which is right: putting it down is the activation.

**And the probe that asks "is there a target?" must not be `resolveTargets`.**
Its `chosen` branch deliberately falls back to the strongest card in the
*unfiltered* pool when the player supplied nothing usable, and only then drops
protected ones — a sensible resolution rule and a disastrous question. One
untargetable top-ATK monster hid every legal target behind it, so with a
Blue-Eyes Toon Dragon under Toon World seven Spells were unplayable for the
rest of the duel, even when the client named a legal target explicitly.
`hasLegalTarget` reads the pool directly. Both it and `resolveTargets` build
that pool through the same `targetPool`, because two copies of a rule is how
`summonBlocked` drifted.

**A trap that picks its own target must ask the player nothing.** Giving
Spellbinding Circle an `equipTo` op made `targetSpecFor` offer a picker — over
the *responder's own* Monster Zones, because that is what an Equip Spell wants
— so the human seat could not activate it at all while controlling no
monsters, which is exactly when they are being attacked directly and want it
most. `ui.ts` skips the prompt when the op carries its own selector. The AI
never goes through `ui.ts`, so it played the card correctly the whole time and
every driver in the battery reported green: a bug in `ui.ts` is invisible to
anything that does not press the button.

**And then the probe had the same blind spot as the card.** That gate turned
twelve perfectly good cards red in `npm run playable`, which sets up a board
for the *player* — two bodies to tribute, spares to discard — and left the
opponent's side completely empty. Its own comment already described the fault
one side over: "probing from an empty field reports them unplayable when they
are merely unaffordable". The other seat gets monsters and a face-up Spell to
point at now, with an Insect among them because Eradicating Aerosol only
destroys those.

**A regression that cannot fail is not a regression.** Written the obvious way,
"Trap Hole sits out a Fusion Summon" passed on the *unfixed* engine too — the
Fusion in the test was Blue-Eyes Ultimate Dragon, whose own effect destroys
every Spell and Trap the opponent controls, so the Trap Hole was gone before
the window could open. Gaia the Dragon Champion has no such effect and the
check works. The whole set was then run against a stash of the old engine, and
every one of the six reported bugs reproduces there and passes here; two others
in the same batch were measuring the wrong thing (`canAttackWith` reads false
for a monster that has simply already attacked, which is not the same as being
bound). Check the assertion fails before believing it passes.

**A suite that cannot report failure is worse than a check that cannot fail.**
Those regressions were appended to the end of `rules-check.ts` — which is to
say *after* the line that prints the count and sets `process.exitCode`. So the
battery printed "All rules regressions pass ✅", exited 0, and had a real ❌ on
screen four lines further down, hiding the fact that half the Trap Hole fix was
never written: the new `opponentNormalSummon` window existed and no card used
it. Every run since had been read as green. The summary is last now and
`checks` is asserted against a floor, so deleting tests cannot quietly turn the
battery green either. The tell was there and went unread — the summary line
stopped appearing at the bottom of the output the moment the tests were
appended.

**Adversarial verification found all four of those, and the battery found
none.** Six independent skeptics, one per fix, each told to try to break it
rather than confirm it — they turned up the missing Trap Hole window (twice,
independently), the `ui.ts` picker that made Spellbinding Circle unusable in
the human seat, the three cards the activation gate over-refused, and the
untargetable-monster hole in its probe. Every one had passed `npm run rules`,
`npm run audit`, `npm run playable`, `npm run text`, and the whole browser
battery. A green suite means "nothing I thought to check is broken", and after
writing a fix you are the last person able to think of what to check.

**A write on the read path undid duels.** `touch` kept a seat's presence
timestamp fresh, and to do it wrote the *entire room* — the duel included —
back from whatever snapshot the poll had loaded, every eight seconds, per
player. It went through `writeJson` rather than `saveRoom`, so it did not even
bump `revision`: the room went backwards while its version number stood still.
A summon landing between a poll's read and its write was simply erased.
Reported three separate ways, and it is one bug:

- *"I summoned harpie lady and destroyed the ai's negate attack and it returned
  my harpie to the hand and re set their negate attack"* — the write landing on
  top of the summon.
- *"I click the atk button from curse of dragon and when I select the enemy
  monster I see a banner you must be in the battle phase (obviously I am in
  it)"* — the same write rolling the phase back to Main, while the client, which
  correctly refuses a view older than the one on screen, carried on showing the
  Battle Phase. The board and the server had genuinely diverged.
- *"the more rematches the more bugs happen"* — it is a rate, not an event, so
  the longer a room lives the more of them you see. Nothing to do with rematches
  as such, and worse in a two-player duel than against the computer, because two
  players polling is twice the traffic.

`connected` is derived from `lastSeen` and **no screen displays it**, so the
write bought nothing at all. `touch` updates the timestamp in memory now and
never persists. Every real write goes through `saveRoom`, which is
compare-and-set on `revision`: a save from a copy that has gone stale throws
`StaleRoom`, and the route reloads and replays rather than clobbering. Replaying
is safe because the decision is re-made from the reloaded room — a move that is
no longer legal comes back as an ordinary refusal.

`npm run race` covers it, and note what it took to make that check honest: the
old `touch` only wrote once the timestamp was eight seconds stale, so a
snapshot taken moments earlier never triggered it and the first version of the
check passed happily on the broken code. It ages the snapshot deliberately, and
compares a fingerprint of the whole board rather than a version number — two
different writes both land on version N+1.

**Two duels shared one set of bookkeeping.** The computer's turn plan was keyed
`${turn}:${pid}`, and a rematch starts a fresh duel back at turn 1 — so the new
duel's turn 3 *was* the old duel's turn 3. `aiPlan` happened to be cleared on
the way through `maybeStart`; `aiActions` was not, so the action count for a
given turn kept accumulating across duels until it crossed the 60-action
ceiling, at which point the computer began abandoning that turn the moment it
reached it. `DuelState` carries a `duelId` now and the key includes it, so a
collision is impossible by construction rather than by remembering to clear.

**The search threw away its own scores one line before using them.** This is
the whole of *"why did Mai Valentine attack my dark magician with weaker
monsters and lost on purpose, she killed her self?"* — and the answer is not
the evaluation. Declaring an attack opens a response window, and a window the
AI cannot read is deliberately left where it is (see `canSeeResponse`: assuming
"they decline" walks into every Set trap, and measured six points worse). But
the line is then scored on a board with the blow still in the air — no damage,
no loss, nothing having happened. Fair about what the attack might *gain*,
blind to what it *costs*.

Scoring now takes the worse of leaving the window alone and of the attack
simply landing, which keeps the caution and removes the blindness. That looked
like it barely worked — 6 of 10 deck orders — until the real culprit turned up
forty lines later:

```ts
for (const line of all) line.score = evaluate(line.state, pid, w);   // gone
```

Every score the search had computed was discarded and re-derived from the board
alone. On the reported position the numbers are: the attack unresolved −3375,
the attack actually landing −29930, ending the turn −4495. The search worked out
−29930, replaced it with −3375, and swung. Every line already carries the score
it was pushed with; there was never anything to recompute.

Measured at 52.3% ±4.9 over 400 games against the previous AI — no strength
change worth the name, which is the right result for a correctness fix. The
paired control matters as much as the case: an AI that had simply stopped
attacking would pass "does not swing into a 3100" perfectly, so it is paired
with "swings when the same unread Set card sits behind a monster it beats".

**Toon World was untouchable twice over.** Reported as "Toon World as a field
spell should be destroyable (for example de spell, harpie lady summon effect,
etc..)". First, every card that says "destroy 1 Spell or Trap your opponent
controls" pointed at `zone: 'spellTrap'`, which is the Spell/Trap Zone alone —
and a Field Spell is a Spell they control. Worse, the client and the test driver
had *both* been offering the Field Zone card for those effects all along, so the
player could point at it and the engine would decline to touch it: three copies
of the rule, two agreeing with each other and neither agreeing with the engine.
There is a `backrow` zone now meaning both, and the three consumers read the
same word.

Second, and the reason it survived even a card that could reach it: Toon World's
own aura is "your Toon monsters gain 800 ATK … and cannot be targeted", written
as `filter: { toon: true }` with no `kind`. `isToon` matches on the name, and
the card is called *Toon World* — so it granted itself `untargetable` and every
targeting effect in the game skipped it. Pegasus is unchanged by the fix at
86% ±7, because the deck was never winning on that.


**A card printed Continuous is not automatically continuous here.**
`activateTrapCard` leaves a Trap face-up when `def.subKind === 'Continuous'`,
straight off the printed card data — and Call of the Haunted is printed
Continuous because the real card equips itself to what it revived, each
destroying the other when it leaves. None of that link existed here, so the
trap simply sat in the one Spell/Trap Zone for the rest of the duel with no
window to fire and no aura to grant; tributing the revived monster left it
stranded there, which is how it was reported. `subKindOverride: 'Normal'`
makes it a one-shot: the monster comes back for good, the 400 ATK goes to it,
and the card goes to the Graveyard. Stronger than the printed card on purpose
— the revival is unconditional and the zone is free — and it is how the card
reads in the anime, which is what this game is for. Anything else printed
Continuous whose whole text is a one-shot wants the same treatment.


**Rooms are cleaned up by a TTL and by nothing else.** No leave endpoint, no
disconnect handling, no explicit delete — `deleteKey` exists and is only used
by the health probe. `ROOM_TTL_SECONDS` is 90 minutes, stamped onto
`expiresAt` by every write, and enforced twice: a Mongo TTL index removes the
document (its sweeper runs about once a minute) and `readRaw` refuses anything
past the deadline itself, so a room is logically gone the instant it expires.
`claim()` will reuse an expired code, so codes recycle. Storage cannot grow
without bound — an abandoned room is a document for at most 90 idle minutes.

Since `touch` stopped persisting, the clock is refreshed by real writes only —
joining, choosing a duelist, every action, every AI step, rematch, tournament
progress — so a room expires 90 minutes after the last *move* rather than the
last *poll*. Identical for a duel in progress; the difference only shows on an
idle room with a tab left open, which used to live forever.

**A seat is never given up, so the way back in has to work.** Reported as "same
code when I try to re enter it says two players are already in, I just swiped
up the game and tried to enter it again I couldn't so we would both create a
new room". Nothing frees a seat when a player closes the app — by design, so a
refresh keeps your place — which makes reclaiming it the only route back. The
home page's Join passed `undefined` for the token, so the server had no way to
know it was you and tried to seat you afresh, into a room whose two seats were
already taken, one of them yours. Reopening the `/duel/CODE` link worked the
whole time, because `connect()` loads the stored identity; typing the code did
not.

The shape of that bug is the one this file keeps recording: the read half
(`loadIdentity`) was private to `useDuelRoom`, and `Home.tsx` carried *two*
hand-rolled copies of the write half. Three copies of one rule, and the one
that mattered was missing. Both are exported and used in one place each now.

`npm run rejoin` covers it, and it has to be a browser check: both seats are
filled over HTTP, so an API-level driver reproduces nothing — the bug was never
in the endpoint, it was in which argument the page handed it. Two notes on
making it honest. It closes and reopens the page rather than navigating, which
is the truer model of a swipe *and* avoids WebKit killing its own renderer when
a live duel page is navigated out from under its poll loop; that crash happens
in this container often enough that the read of the duel page is guarded and
reports "this proves nothing" rather than a failure. And it waits for *either*
the room or the refusal, whichever lands first, so a refusal reads as a refusal
instead of a timeout naming a selector.


**Only a God is proof against both battle and card effects.** A monster that
cannot be removed on either axis is not a wall, it is a stalemate — the only
honest answer to it is having no answer — and that is a Divine-Beast's
privilege. Reported as "big shield gardna can't be not affected by card
effects (he's not a god)", and it was true of *four* cards, two of which this
session had just introduced. Each kept the half that makes it distinctive:
Big Shield Gardna, Beta and Relinquished keep battle immunity and lose the
effect half; Deepsea Warrior goes the other way, because being untouchable by
Spells and Traps is the whole of its name, so a bigger monster is its answer.

The rule is asserted over the whole card set in `npm run rules` rather than
fixed four times and forgotten — I broke it twice in one pass, so it belongs
in the battery, not in anybody's memory. Toons are exempt by construction
rather than by exception: their protection is Toon World's aura, not their
own, and Toon World is a Field Spell that can be destroyed, which is exactly
the counterplay the rule is about.

Watch the paired assertion, too: "the shield survives an attack" was first
written with a 2500 ATK attacker against 2600 DEF, which it survives on the
arithmetic alone — the check passed with the flag deleted. It swings a 3000
now. yami 73→71%, pegasus 86→84%, mako 39→39%, all inside their intervals.

**Take a card's identity away and you owe it one back.** Relinquished lost
immunity to card effects to the rule above and was left with nothing in its
place, which is a nerf rather than a redesign. The printed card's most famous
clause came in instead: *any battle damage you take from a battle involving
this card is dealt to your opponent as well.* Blanket immunity is the absence
of an answer; the mirror is a reason not to attack that the other player gets
to weigh, and it is the whole flavour of the card — the monster it swallowed
is the shield, and what gets through goes back across the table.

`reflectBattleDamage` only ever *adds*: it never spares its own controller,
or it would be a third kind of immunity and straight back into the rule it
was written to escape. That is pinned by name — "CONTROL: the mirror adds
damage, it does not absorb it". All four battle-damage sites route through
one `battleHit`, which asks the *hurt* player's own monster in that battle,
so a direct attack (no monster on that side) reflects nothing by
construction. Pegasus is 84% ±7, unchanged by the swap.

**A dead renderer is not a failed assertion.** `npm run rejoin` failed against
production with "typing your own code puts you back in your seat — neither",
which reads as the feature being broken. It was not: WebKit had dropped its
renderer, `Promise.race(...).catch(() => 'neither')` swallowed the crash
whole, and the probe reported a red check against working code. The tell came
from making the failure print what was on screen — the read itself returned
`"?"`, because the page it was reading was already gone.

Both races classify the error now: anything saying the page or its target has
died is rethrown and the run is called **inconclusive** (non-zero, but saying
so), and only a genuinely quiet timeout is still `neither`. Six production
runs afterwards: three pass, three inconclusive, no false failures. The crash
rate in this container is that high, which is why it was chased twice as a
production bug.

The outer block was `try`/`finally` with no `catch`, so a crash also killed
the process before the summary line — a probe exiting on a stack trace reads
as "the feature is broken" rather than "the probe could not look". Same
lesson as the rules-check summary, one level up.

Two latent bugs fell out of the same read, both now fixed: the join race
waited 20s while `joinRoomWithRetry`'s own ladder is **23.5s of sleeps** plus
eleven requests, so the probe could give up while the client was still
legitimately retrying; and the CONTROL leg waited only 15s for the same
ladder. Neither ever showed against localhost, where the first attempt always
lands.

**Never `tail -2` a probe.** Every check here prints its failures *above* the
summary line, so piping a run through `tail -2` keeps the verdict and throws
away the only thing that explains it. Done exactly that on a production
`npm run pwa`: it printed "1 problem(s)", the reason scrolled past unread, and
seven clean re-runs on the same deployment afterwards could establish it was
intermittent but never what it *was*. Capture the whole output, or grep for
`❌|⚠️` and print the run in full when it is not green — which is what the
diagnosis actually needs, and costs nothing on a passing run.

That flake is real and unexplained, at roughly one run in eight against
production and none locally. It is not worth guessing at: the probe's own
documented failure mode is "did not reach the attack prompt", which real Paris
latency would plausibly cause, but chasing a fix without a captured failure is
how a check that cannot fail gets written.

**One CSS declaration was crashing the browser, and it read as flakiness for
weeks.** `npm run rejoin` could not finish a single run against production —
four attempts, four different deaths, every one classified "this proves
nothing" by the crash handling added the day before. That handling was right
and it was also hiding the answer: *four* inconclusive runs is not patience,
it is a finding. Sitting on the duelist-choice screen killed the WebKit
renderer **8 times out of 8**; `about:blank` and the home page, 0 out of 6.

`.btn` transitioned `filter`, and `.btn:hover` set `brightness(1.22)`. A
click leaves the cursor exactly where it clicked, so arriving on the lobby
left a button hovered — promoting it to a composited layer re-rasterised
through a filter every frame, inside a `.panel.grain` whose `::after` paints
an SVG `feTurbulence` with `mix-blend-mode: overlay`. A filtered layer
compositing through a blended one is pathological in WebKit, and the lobby
stacks fifteen of them. The hover is painted rather than filtered now — the
same colours, `brightness(1.22)` worked out per variant by hand — and it is
behind `@media (hover: hover) and (pointer: fine)`, because iOS synthesises
hover after a tap and never takes it back. 8/8 → 0/10, and `npm run rejoin`
went 3/3 including its CONTROL.

Every other probe in the battery clicks off that screen inside a second,
which is the only reason this survived. It has been there since the first
commit.

Three things about how it was found, all of which cost time:

- **Every arm needs a null control.** Three "fixes" scored 0/5 early on,
  including one that turned out to be a *no-op* — `will-change: auto` when
  nothing in the codebase sets `will-change`. That should have been the tell
  that the injection itself was suspect. Two inert arms then crashed 8/8 and
  6/8, clearing the method — but had they not, every result to that point
  would have been measuring the act of injecting a stylesheet.
- **Bisect the whole before the parts.** Hiding the duelist grid, the aside
  and every image each changed nothing; `* { transition: none }` was 0/8. The
  page-level arm found in one run what the element-level arms missed in three.
- **A rate is not a diagnosis.** Production crashed 1 in 5 and localhost 8 in
  8, and the difference is only cold-start timing deciding where the cursor
  comes to rest. The louder reproduction was the local one, which is the
  opposite of where a production-only failure suggests looking.

`npm run paint` guards it from both ends deliberately: the mechanism (nothing
may transition `filter` — cheap, deterministic, names the defect) and the
symptom (park the cursor on a button, sit there, insist the renderer is still
alive — coarse, but blind to *how* a future regression makes a screen too
expensive). Verified against the unfixed build, where it goes red three ways
and reports the lobby as unreachable rather than passing by never looking.

Whether this crashes a real iPhone is untested and probably not — a phone has
a GPU, and headless WebKit here composites in software. What is certain is
that the work was real, on the one screen you sit and read.

**A God that did not pay for itself does not stay.** Three tributes is the
price of a Divine-Beast and nothing charged it on a *Special* Summon — so the
first time Slifer died it became a one-card play for anybody, Monster Reborn
being in all eleven decks and reading **either** Graveyard. The worst version
was theft: revive it from its owner's Graveyard onto your own field, where its
second mouth then drains every monster *they* summon, permanently. The printed
rule closes exactly that, so `returnBorrowedGods` sweeps at the End Phase and
a revival is a rental for the turn — which is still a real play and a good
anime beat. Both fields are swept, because a trap window can Special Summon
during the *opponent's* turn, so "the End Phase of the turn it was Summoned"
is not always its controller's own. `toGrave` already sends a card to its
**owner's** Graveyard, so a stolen God goes home rather than into the thief's.

`specialSummonedOnTurn` is what records that it arrived without paying;
`resetInstance` clears it and the Normal Summon path clears it too, or a card
bounced to the hand and then properly Tribute Summoned would inherit a stale
marker and vanish. Keyed off the type like `tributesRequired`, so Obelisk and
Ra inherit it. And the rule is on the card's text, unlike the Magnet Warriors'
secret: a bonus is worth finding, a restriction that makes your God disappear
with nothing explaining why is the bad kind of surprise.

Both directions are pinned. Disabling the sweep turns four assertions red and
leaves all three CONTROLs green; *widening* it — dropping the Divine-Beast
filter so it eats every Special Summon — turns exactly the "an ordinary
revived monster is unaffected" control red and nothing else.

**A free Fusion assembles from the field.** Valkyrion combines with no
Polymerization, but only from three bodies already *standing* — three cards
falling out of a hand is not the same commitment, and letting it reach the
hand left Polymerization with no job in the deck that carries it. Spending the
card is what buys the shortcut. `fusionRoute` is the one place that decides,
prefers the free route because it costs nothing, and is asked by the Fusion
button, the AI and the action alike; `matchRecipe` replaced two copies of the
material matching that were already drifting apart.

**A picker that ignores the filter turns a decision into a chore.** Valkyrion
coming apart is "Special Summon Alpha, Beta and Gamma" — three named cards,
three taken, nothing to decide — and it opened a modal showing the *entire*
Graveyard. Two separate copies of the same omission: `pickableUids` honoured
the filter for a Deck search and not for the Graveyard or the hand, and the
grave modal's own JSX filtered on nothing but `kind === 'monster'`. The first
is also what opened the prompt at all, since the interface only asks when more
cards qualify than the effect will take. Both modals now render exactly what
the picker counts as legal, so a modal can never offer a card the pick would
refuse.

That pool builder is `targetCandidates` in `ui.ts` now, not a closure in
`Duel.tsx`. It had to move to be testable: a regression written against a
closure it cannot import has to re-implement the rule, and a test that
re-implements the rule agrees with the bug. The first version of this check
did exactly that and passed on the broken code — it only earned its keep once
it called the real function.

**An exhibition is a room with no players in it.** "Watch the computers duel"
seats the AI on both sides (`room.spectate`), starts the duel at creation, and
whoever opened it holds no seat at all — the token is the literal string
`spectator` and the routes ignore it, because a spectate room has nothing to
protect: both hands are shown to the audience by design (set cards stay hidden
— neither computer can see those either, and whether the attack walks into a
Mirror Force is the drama). Anyone with the code may watch and nudge, which is
what lets a second phone watch the same duel.

**Pause is not asking.** Nothing on a serverless room moves unless a client
requests it, so the pause button simply stops the nudge loop and the duel
freezes mid-swing, indefinitely; resume re-runs the nudge effect and it picks
straight back up. Per-viewer by construction — a second watcher keeps nudging.
The probe proves the freeze by watching the page's whole text hold still for
eight seconds *after a nine-second settle*, because a think already in flight
lands after the tap; checked against a build with the pause disconnected, it
goes red.

**`view.you` is an AI's seat in an exhibition.** The board needs an
orientation, so the spectator watches from p1's side — which means every
"is it my turn / my window" gate would light up for a seat the computer is
already playing. `myTurn` and `respondingToTrap` both carry `!spectator`, and
everything else already asks those two. The trap-response prompt showing to a
spectator is the tell that gate broke; `npm run spectate` watches a whole duel
and fails if it ever appears, alongside "no End Turn button ever existed".
The pause button shares the control column's bottom row the way the bracket
button does — that column being three rows is what sets the top strip's
height, and the layout check now measures the spectate board as a fourth mode.

## Adding a duelist

`data/decklists.json` is the authoring source and names cards in English;
`node scripts/fetch-cards.mjs` resolves them against YGOPRODeck, writes
`src/game/generated/{cards,decklists}.json` and downloads the artwork (which is
git-ignored and re-fetched by the `prebuild`). Effects go in
`src/game/effects/`. Nothing else has to change: the AI enumerates through the
same engine gates the interface uses and scores with one generic `evaluate`, so
a new deck is played competently from the first duel without a line of AI work.

**A God costs three bodies.** `tributesRequired` gives any `Divine-Beast` three
tributes, written against the type rather than a per-card override so Obelisk
and Ra cost the same the day they arrive. Tokens are bodies, so Kuriboh and
Multiply are how Yami Yugi actually gets there, and a Tribute Summon makes its
own room — three tributes on a three-zone board is payable, you simply commit
the whole field. `npm run playable` said otherwise: its ceiling was written
`need > 2` back when two was the maximum, so it called Slifer unplayable while
the engine summoned him perfectly well.

**Slifer is only ever as strong as the hand behind it.** ATK and DEF are 1000
per card in your hand, read live through `aura.per` (which gained an `ownHand`
zone for it), so every card you spend developing the board takes 1000 off the
thing you spent three monsters to summon. That tension is the whole card, and
it is also what keeps a God fair: `npm run deck-bench yami` is 55% ±10, mid-field
against Pegasus at 86%. It is `untargetable`, which in this engine means no
opposing effect can reach it at all — including Dark Hole and Mirror Force, both
of which filter protected monsters — so the only honest answer is a bigger body
while the hand is thin.

**The second mouth needed a trigger that did not exist.** Nothing let a monster
sitting on the field react to the opponent summoning; only traps could.
`onOpponentSummon` fires on every face-up monster the other player controls,
with the new arrival in the trigger context so `pick: 'attacker'` reaches it —
the same context a summon trap window already builds. A Set fires nothing,
matching the rule the trap windows follow. `npm run text` had to learn that the
clause "when your opponent summons" is now satisfied by a monster as well as a
trap; that is the check being taught, not loosened.

**`destroyIfNoAtk` reads the effective stat, deliberately.** The drain lands
first and then finishes whatever it emptied — two halves of one sentence, in
order. A `maxAtk: 0` filter would not do it: `matchesFilter` is deliberately
blind to auras to avoid recursing through the stat calculation, so it would
consult the printed number and destroy the wrong monsters.

**An eleventh duelist broke the simulator's pairing, silently.** `npm run sim`
pairs `i % n` against `(7i + 3) % n` and skipped the game when both drew the
same duelist. At ten that never happened — `6i` is even and `7` is odd, so they
cannot be congruent mod 10 — and at eleven they collide every eleventh game: 36
of 400 games were dropped, and Bakura, whose index only ever came up in exactly
those games, stopped being simulated at all while the run still printed "No rule
errors". A skipped game is a deck that went unchecked. The second seat steps to
the next duelist along now, so nothing is skipped at any roster size.

**Audit gaps are not card bugs, but they are still gaps.** Both things the audit
reported on Slifer were its own: it could not stock a hand to measure a
hand-scaling aura, and it had no driver for the new trigger — which it said out
loud, under "effects not driven", which is exactly what that line is for. Its
driver then had to summon a monster *big enough to survive* the drain, because a
small one is destroyed by the second half of the sentence and the drop in ATK
becomes invisible: the op reads as "did nothing" when it did precisely what it
says. The destroy half is pinned by name in `npm run rules`, where both outcomes
can be set up separately.

**Prove the card can fail before believing it passes.** Slifer's regressions
were run against a deliberately broken Slifer — drain set to 0, scaling set to 0
— and six of them went red. A God that shipped green on a broken engine would
have been worse than no test at all.


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
