# The Computer's Game — the improvement plan

*Written 2026-08-27. A plan, not a changelog: nothing below is built yet, and
each workstream lands only after the one before it has paid its gate. The
reports that shaped it are the owner's, from real duels.*

## Where the pilot stands

A beam search over whole-turn action sequences, scored by a hand-built
evaluation, checked against sampled worlds for what it cannot see, with a
paranoid branch for what a Set card might be. Thirty-one pinned positions play
correctly at 10/10 across ten deck orders. A per-duelist learning pass nudges
evaluation knobs after every real game. An A/B arena (`npm run ai-ab`, with
`AB_JOURNAL`) races two builds head to head.

Two blind spots are diagnosed, both from owner reports on 2026-08-27:

**1. The unknown monster is a wall by decree.** Measured — same board, same
face-down, bigger and bigger attacker:

| attacker | ATK | swings at a face-down | at an empty board |
|---|---|---|---|
| Lady of Faith | 1100 | 0/5 | 5/5 |
| Battle Ox | 1700 | 1/5 | 5/5 |
| Summoned Skull | 2500 | 5/5 | 5/5 |

The cause is two lines in `src/game/ai.ts`: a face-down monster is priced as a
flat average body (`UNKNOWN_DEF = 1300`), and the attack-candidate builder
**filters out** any attack that does not clear it. An attacker under 1300 never
has the move generated — it is not declined, it is never considered. That
filter is right against a face-up wall, where a losing attack in this game is
pure donation; it is wrong against the unknown, where the same swing was a 65%
favourite in the reported position and the bad third cost ~100 Life Points on
average.

**2. Fear of the backrow eats whole plans.** Reported: Tiger Axe forces the
opponent's board into face-up Defence — its own effect, revealing their exact
DEF — and then declines to attack a monster it beats, because a Set
Spell/Trap taxes the line. The first half of the plan was paid and the second
half abandoned. A card spent to create an attack that is then not taken is a
card spent on nothing, which is a rule this codebase already enforces at
activation time and has never asked of the *plan*.

## Principles

1. **Measure before changing.** Every workstream opens by drawing the current
   behaviour as a curve. "Different" is easy; the gate is *better*.
2. **Price, don't forbid.** Hard filters on move generation make good moves
   unthinkable. The search should see the move and pay for it.
3. **The guard lands in the same commit as the loosening.** Every permission
   granted below ships with the case that would abuse it, pinned.
4. **No peeking.** Everything here reads public information only — decklists,
   graveyards, what was revealed, what was paid for. `ai-honesty` stays green.
5. **Pin, falsify, battery, A/B, ship.** The discipline every card fix has
   used all session, applied to every judgment change.
6. **Rules at the source.** Nothing per-card, nothing hand-written per combo:
   every mechanism below derives from the effect DSL or public state, so
   future cards inherit it for free.

---

## Workstream A — price the unknown monster

*The face-down attack fix. Diagnosed, direction agreed with the owner.*

- **A0. Decision-surface harness.** Promote the diagnosis probes into a
  checked-in script that draws attack-rate as a surface over attacker ATK ×
  opponent's unseen pool × own LP × own board, across the real duelist decks.
  Baseline recorded before anything moves.
- **A1. The unseen pool.** `unseenPool(state, viewer)`: the opponent's
  decklist minus everything public (Graveyard, banished, face-up field,
  revealed cards). From it, per attacker: `pKill`, `pBounce`, expected
  overshoot, flip-punish risk. Two priors sharpen it, both from public facts:
  a Set that arrived **without** Tributes can only be Level ≤ 4, so the pool
  skews small; a Set that visibly **cost** Tributes skews to the big end —
  the tributes happened in public and the computer is allowed to remember
  them.
- **A2. Filter → price.** Generate the attack into a face-down whenever it is
  legal; let the evaluation charge for the risk instead of deleting the move.
  The face-up-wall filter stays exactly as it is. (Branching grows here —
  nodes/sec measured before and after, serving budget unchanged.)
- **A3. Life Points priced as a fraction.** 900 out of 9000 is not 900 out of
  1500. Risk scales with remaining LP and with the opponent's actual clock —
  reusing `clock()`, not inventing a second notion of danger.
- **A4. Information has a value.** Small and explicit, larger when a follow-up
  in hand depends on knowing what is under the card. Deliberately the smallest
  knob in the set — generous information value is how suicide probing starts.
- **A5. The guards.** Never trade the last blocker into an unknown while their
  board threatens lethal; never attack when the plausible overshoot is
  near-lethal; weight flip-punish by what is genuinely still in their pool —
  Man-Eater Bug in the unseen list is a real cost, one already in the
  Graveyard is not.
- **A6. Pins at the target curve** (tolerant thresholds — these are
  probabilistic decisions, so "≥ 4/5", never "= 5/5"), falsified by reverting
  A2, then full battery and A/B.

Target curve, honouring the owner's steer without copying its numbers:

| situation | today | target |
|---|---|---|
| ~1100 ATK, healthy LP, board to spare | 0/5 | 3–5/5, pool-dependent — the reported position is an attack |
| ~1700 ATK | 1/5 | 4–5/5 — declines need a nameable reason |
| ≥ 2000 ATK | 5/5 | 5/5 |
| small attacker into a Set that cost Tributes | — | ~0/5 — the unknown averages Level 5+ |
| big attacker into a Set that cost Tributes | — | high — *corrected by measurement*: Tribute monsters kneel on LOW DEF (Summoned Skull hides 2500 ATK behind 1200), so killing the boss while it is down is a blowout, not a risk. The guessed 1–2/5 assumed walls; the priced worlds knew better, which is the whole argument for pricing |
| empty board (control) | 5/5 | 5/5, unchanged |

## Workstream B — fear sized to the facts, and plans that follow through

*The Tiger Axe report, and task #39.*

- **B1. The backrow priced off the same pool.** Fear of a Set Spell/Trap
  scales with what can still exist behind it: if both Mirror Forces are in the
  Graveyard, the fear of Mirror Force is zero. Same `unseenPool` machinery as
  A1, applied to Spells and Traps.
- **B2. Follow-through.** A plan that pays an effect to create an attack and
  then declines the attack has spent a card on nothing — "a card is never
  spent on nothing" extended from activation legality to plan quality. The
  Tiger Axe line (force their board into Defence, then kill what it beats,
  Set card or no Set card) becomes a pinned position.
- **B3. Never feed the whole board to one Set card.** Staggering as an
  information play: the expendable attacker swings first into the unknown,
  the rest of the board commits after the window resolves. Ordering within
  the found plan, not new search. With lethal on the table and nothing to
  learn, no staggering theatre — take the win.
- **B4. Pins:** Tiger Axe follows through; two attackers + one Set card →
  the expendable one leads; the existing Shadow Spell, Mirror Wall, and
  Spellbinding pins all stay 10/10.

## Workstream C — plans that outlive the turn

*"It needs a strategy at the first turn, and cards drawn either aid it or set
a new multi-turn strategy."*

- **C1. The tribute ladder.** Holding a Level 5+/7+ or a God, bodies on board
  gain future-Tribute value and fodder summons stop reading as weak tempo —
  the own-side mirror of the `menace()`/boss work already shipped.
- **C2. Combos derived, not written.** A card that searches, summons, or
  equips another names it in its ops. Build the enables-graph mechanically
  from the effect DSL at load — zero hand-written combo lists, so every
  future card inherits its lines for free.
- **C3. Win-condition weights.** Beatdown, control, burn, Exodia — read off
  the decklist and mapped onto the existing per-duelist learning knobs rather
  than a second weight system.
- **C4. Hold-back.** Do not dump the hand past what wins; keep an answer. The
  discard-spare sort already knows which card is spare — this teaches the
  summon path the same restraint.

## Workstream D — evaluation depth *(task #36)*

Initiative (who is forced to answer whom), a threat horizon over the unseen
pool one and two turns out (extending `clock()`), honest card-advantage
counted across zones, and posture quality building on the `POSTURE` map. Each
term ships **alone** with its own A/B; a term that does not move the race is
deleted, not kept for plausibility.

## Workstream E — the gate *(task #37)*

The decision-surface library from A0 grows with every workstream. Ship rule
for each slice: all pins green (tolerant where probabilistic) · `ai-honesty`
green · serving wall-clock within budget · an A/B race of ≥ 600 games not
worse at the 95% band, with the journal naming the games that flipped. Every
loosening reverts cleanly.

---

## Order, and what could go wrong

**A → B → C → D, with E running throughout.** A and B share the unseen-pool
machinery; C leans on B's sequencing; D's terms only mean anything once the
world is priced honestly.

Risks, named: A2 widens the search (measured, budget unchanged, or it does
not ship); C can overfit archetypes (goal weights stay coarse; the knobs
already learn per-duelist); and the pins most likely to break are exactly the
ones that matter — *"will not swing into a monster that kills it"*, the
Mirror Wall pair, *"holds Spellbinding Circle"*, *"does not burn itself to
one Life Point"*. Any of those going red is a stop, not a negotiation.

Done looks like: the computer attacks when the maths says attack, holds when
it can name the reason, and the reason survives being asked.

---

## Execution log (2026-08-27)

**A landed** (`f982599`, `d8aa428`): the measured curve moved exactly to
target — 1100 ATK probes 8/10 at the pin (was 0 by construction), 1700 → 4/5,
2000 → 5/5, controls untouched, the last-blocker guard bends it back to 0/5.
Three latent defects surfaced on the way and are fixed and pinned: the
expectation world's proxy had rotted into a 2400/2000 wall; the batteries'
verdicts moved with machine load (`setPureClock` — node budgets for tests);
and the sampled-world dealer was stream-sensitive to refactors.

**B landed** (same commits): fear is zero when zero answers remain (unit-
pinned both directions), commitment counts bodies (Tiger Axe follows through,
pinned), the expendable attacker leads where order matters (guarded to
independent swings — the unguarded version broke direct attacks and the
waves pin caught it at 1/10). What the measurement corrected: baiting is
worthless against wipe-shaped fear, so the real doctrine is "one blow tests
the water, the cheap body stays safe or leads" — measured 5/5, pinned.

**C landed**: the Tribute ladder and the enables-graph as evaluation terms
(unit-pinned as deltas — a body is worth more while a boss waits in hand; a
searcher promises its target only while the Deck still holds one), and
`deckStyle` — the brain's starting point read off the decklist, bounded
inside half the learning clamp, Exodia holds back from game one, NEUTRAL
untouched (rules-pinned). C4's hold-back was measured already present
(the whole-board GUARD pin at 10/10); nothing further shipped for it.

**The E gate caught a real regression, and the bisection found it.** With
every pin green, the full stack raced 43.2% ±3.2 against the pre-plan AI
over 900 games — weaker, and weaker three races in a row while judge-level
fixes (per-pool medians, knife-edge rollouts, the median gate on probe
generation) changed nothing. Race-level bisection: reverting a four-piece
fear/eval cluster read neutral (47.3% ±8.0/150), and racing the pieces
singly convicted ONE — the face-down evaluation charge, doubled from 120 to
240 to fatten the probing margin. A flat bounty on attacking Set monsters,
paid in nearly every game, worth seven points of win rate. Back at 120 —
with every other piece of the stack kept — the race reads 51.0% ±5.7 over
300 pilot-swapped games, and the full battery is green, the 1100-probe pin
at its designed floor. The lesson, recorded where the plan said it would
be: pins prove positions, only the arena proves strength, and a subsidy is
not a price.

**E paid, and the plan ships.** The final gate, all of it on the exact
configuration merged: a 600-game pilot-swapped race against the pre-plan
AI reads **50.0% ±4.0 (300W–300L)** — not worse at the 95% band, with the
journal kept; all 41 pinned positions and every unit pin green;
`ai-honesty` green; the decision surface on target (1100 → 3/5 healthy,
1700 → 4/5, controls 5/5, last-blocker 0/5, a Tributed Set feared by the
small and blown up by the big, Tiger Axe 5/5, fear-of-nothing 0, the
stagger doctrine 5/5); the serving clock measured inside its caps
(`scripts/.bench/wall-clock.ts`); rules 1451, text, audit, picker,
playable, gods, Ra, premade, invariants, race, sim, build, and all three
end-to-end suites green. What the game bought: a computer that pays for
the unknown instead of forbidding it, fears what can still exist instead
of what once could, follows through on the plans its own cards start, and
plays the deck it was handed from the first turn — at exactly the
strength it had, which is what "no regression" was always going to cost
in a fair arena.

## The day after (2026-08-28)

The plan shipped and the owner played — and came back with two turns and a
rule. Morphing Jar summoned face-up over three Sheep Tokens, attacking
nothing; Lady of Faith declining a Leghul she beat dry; and "a stolen card
goes home to its owner's Graveyard." The diagnosis went eight layers deep,
every one a universal rule, every one pinned and falsified:

- **The token protection racket.** The phantom hand-threat switched OFF over
  a full enemy board, so killing a blocker "let them summon" and the
  computer guarded their chaff. Now the phantom counts zones honestly: in
  space the hand adds its average body, on a full board it Tributes over
  their weakest attacker — and stands down when that would be a downgrade.
- **The race term's shout.** "One 700 attacker versus none" read as the full
  ±4-turn clamp whether the kill was three turns out or seventeen. Urgency
  now falls with the square of the shorter clock past the horizon.
- **Flip effects at face value**, count-aware (draw-5 is not a cantrip), and
  a draw engine is worth more the emptier the hand that holds it — all read
  off the ops.
- **The near-tie tiebreak** measured only Life Points KEPT, inside a band
  ten times wider than its comment claimed: 800 dealt counted for nothing,
  400 hypothetically saved for everything. It reads the LP differential now,
  inside a true near-tie band.
- **The hallucinated draw.** The beam built turns around cards it drew
  inside its own imagined world (Sonic Maid's draw supplied a fantasy trap;
  the real draw differed; the plan died mid-sequence in front of lethal).
  A plan may not spend a card it has not seen — worldBlind marks bind the
  planned turn and are stripped at rollout entry, because futures play
  their draws.
- **The dominance lift**, narrowed to what it can prove: only between a line
  and the same line plus trailing attacks may unanimity silence a playout —
  everywhere else the playout's horizon testimony is the point of having
  one. Its first, wider cut walked a self-healing 800 into a piercing 2500.
- **Overtime for a hung jury.** Vote-reweighting (by scatter, by direction)
  traded pinned positions for pinned positions; the honest instrument is
  more throws. When the top two end inside one authority, extra rounds feed
  exactly that pair until they separate.
- **The commitment discount prices bodies, never the duel.** The lone-body
  zero-fear doctrine sent one attacker into a Set card whose nightmare read
  the duel LOST, with Swords in hand. A dark branch that reads a loss now
  applies the prior at full weight whatever the line committed; Tiger Axe,
  whose nightmare only ever loses the axe, follows through untouched.

And the engine grew the owner's rule verbatim: every route to the Graveyard
goes through one door that sends a card home to its OWNER — the cast
borrowed Spell, the revived enemy body, the stolen card discarded from
hand, the fusion material paid from the wrong side. Five new rules
regressions (1456 total), three new AI positions, `CASE_FILTER` for
stream-exact extraction of a failing pin, faces on the battery trace, and
sample counts on the judge's debug line.

**The bill, paid in full: all 44 pinned positions green on every deck
order, and a 600-game pilot-swapped race against the shipped AI at
48.8% ±4.0 — no measurable difference, with every reported misplay gone.**

**D verdicts**, per the delete-if-idle rule. The threat horizon shipped
with the world-pricing work: the expectation world's phantom threat scales
with the opponent's actual grip. The other three candidates were built and
raced against the fixed stack, and none survived. *Initiative* (bodies
forced to answer or die, counted both ways) died at the pin it broke
before its race even finished — counting the opponent's dominated bodies
as a standing bonus taxes killing them, and the 1100-probe pin fell to
4/10; a term that rewards farming dominated boards is wrong by
construction. *Cross-zone card advantage* and the *kneeling leak* (the
mirror of the standing-leak) raced together with every pin green and read
49.3% ±5.7 over 300 pilot-swapped games — they did not move the race, and
were deleted rather than kept for plausibility. The evaluation keeps its
depth where the arena said it mattered: the world priced honestly, the
cliffs, the leak, the clock.

## The deck that knows itself (2026-09-11)

The owner's ask: the computer should play perfectly, and it should play
*Jaden* perfectly — a deck built so that, played right, it barely loses.
Measured first (`scripts/.bench/jaden-bench.ts`, Jaden against every other
deck four times, the shipped AI on both seats, the arena's 1500 ms budget):
**85.3% ±8.4**. Then the losses were watched, one transcript at a time, and
every misplay traced to a mechanism. Eight of them were general — nothing
about HEROes, everything about how the search reads a board — and those
shipped as general rules; what was left was the shape of one deck, and that
became the first *duelist brain*.

**The battle's own arithmetic, in the model.** `bodyOf` read ATK, DEF,
pierce and direct attack, and nothing else the engine applies when two
monsters meet. Skyscraper's thousand, Clayman's toll, Metalzoa's doubling
and halving, Wildedge's attack-all and half-defender, Rampart Blaster's
fixed gun and its shooting from Defence, LV10's "cannot be attacked" and
"does not block", Winged Kuriboh's shut door on the rest of the turn's
damage — all invisible to the evaluation and to the attack filter, so a
HERO under the city was priced a thousand short on every swing and a 1600
was never even offered the 2000 it beats. `swingInto`/`guardAgainst`/
`directSwing` mirror `resolveBattle` clause for clause, and the candidate
filter, the leak term, the judge's tie-break and the threat model all read
the same numbers. Pinned: the 2500 that will not swing into a wall that
saps a thousand (and the 3100 that does), the Sparkman that attacks a 2000
from under Skyscraper (and does not without it).

**A plan is a bet on a world, and the world is checked.** Pot of Greed
draws two imagined cards in the planning world and two real ones in the
duel; the old plan kept walking and the real two were never played. A
stand-in their Sangan summoned turned out to be a Zoa and the attack
planned into the stand-in landed on the Zoa. Every plan now carries the
visible board it expects after each action (`expectedHashes`), the runtime
and the room compare, and the moment reality disagrees the rest of the
plan is dropped and the turn searched again from the board as it is.
Their Graveyard hashes as a count, because a destroyed proxy lands there
under the proxy's name. Pinned: the Battle Ox drawn by Pot of Greed is
summoned the same turn.

**The plan carries its own answers.** A search the plan decided to make
used to be answered inside the beam by a one-step greedy pick the line
never wrote down, then asked again in the real room, and the fetched card
arrived `worldBlind` — unspendable for the rest of the turn it was fetched
for. A choice window the planning seat itself must answer is now a
decision the beam branches on (`chooseCard` in the line), the chosen card
is claimed as known, and the room plays the recorded answer. Fusions may
not be built on imagined materials either. Pinned: E - Emergency Call
fetches the Clayman that finishes Thunder Giant, and the Giant is made in
the same turn.

**The nightmare is priced against this board.** The paranoid world stood
the trap that priced highest on an empty table behind their Set card.
Ring of Destruction prices as a plain kill there, because "damage equal to
that monster's ATK" is unbound — so with a 5200 Bladedge standing on 4700
Life Points the nightmare was a Crush Card Virus, every line lost the
Bladedge equally, and the computer walked into the Ring and lost. The
threat is read against the body it would be wrapped round, lethal is
lethal, and the judged pool widens to two dozen lines chosen round-robin
by what each develops before it attacks — so the version of the kill that
first summons Avian and breaks the Ring, or first fuses to shrink the
Bladedge below the Life Points, is in the room when the dark world votes.

**Smaller things the transcripts named.** A floater is worth what it gives
back (`floatWorth`, read off `onAnyToGrave`-family ops and checked against
what is still in the Deck). A Set card keeps the promise it carried in hand
(the opening turn used to keep Hero Signal unarmed for a hundred points of
imaginary value). One Spell/Trap Zone means a Set trap is a door shut on
every Spell in the hand, and is charged for it. A Fusion that is a wall, or
fights from its knees, is offered lying down. The beam's dedup signature
carries the Normal Summon — Bubbleman called for free and Bubbleman Normal
Summoned left the same board and the dedup kept the wrong one. The
near-tie band halved to 350 and only a decisive Life-Point difference may
overrule the judge inside it: at 700 with a secondary key, an exact tie fell
through to "bodies exposed" and kneeled Lady of Faith away from a free 800,
then to "board left" and swung Morphing Jar face-up into a Sheep Token.

**The brain.** `src/game/brain.ts` is the contract, `src/game/brains/` the
registry, looked up by the `duelistId` every seat carries — rooms, bracket,
arena and checks alike. A brain adds evaluation terms only its own cards
explain and ranks its own questions; everything else is shared. Jaden's
(`brains/jaden.ts`) prices a Fusion half-assembled in hand against the
board it would land on (Thunder Giant is worth nothing against three 1900s
and most of a duel against a Blue-Eyes), the Kuriboh-and-Wings option at
what stands across the table, and answers "which HERO" by the Fusion it
completes, the free summon it enables, the burn it lands — not the biggest
number. Both seats read their brains, so the computer fears Jaden's combos
when a human plays them.

**Measured.** All 55 pinned positions green on every deck order, `ai-honesty`
green. Jaden against the field, the same search on both seats at the arena's
1500 ms budget: **86.8% ±4.7 over 204 games (177W–27L)**, against 85.3% ±8.4
over 68 before — the losses that remain are mostly hands with no body to
summon, which a 25-card deck with two Kuribohs, a Level 5 and a Level 7 in it
deals more often than it looks. Measured again on `main` once the HERO pairs
stopped fetching each other off a Polymerization and Mirror Gate's row started
falling one swing at a time: **84.3% ±5.0 over 204 games (172W–32L)** — the
same search, a deck that now pays for its Fusions, and inside the band. The general AI against the shipped one, pilot-
swapped over every deck pair: **51.9% ±5.7 (154W–143L over 297 games)** — no
measurable difference at the 95% band, with every reported misplay pinned and
gone, which is what "not worse in a fair arena" has cost every time.

## The three Gods (2026-09-12)

Three more brains, one per Egyptian God, on the scaffolding Jaden's built. The
shared helpers every brain was about to copy — reading their board, telling a
real card from an imagined one, finding where a choice is pointing, counting
the damage that arrives at every turn start — moved into `brains/common.ts`,
and Jaden's copies were deleted rather than left to drift.

**What each deck knows that the DSL does not.** Slifer has a printed ATK of
nought and fights with a thousand for every card in the hand that summoned it,
and the Summon costs nothing in hand size because its own effect draws the card
back — so it lands at exactly a thousand times the hand holding it, and the
deck's real engine is the monsters that arrive in threes to pay for it (the
Queen calls the King, the King calls the Jack; Multiply lays three Tokens for
one card; Valkyrion comes apart into the three Warriors that made him).
Millennium Seeker is a one-card Obelisk — it fetches the God from the Deck or
the Graveyard and lays two more of itself beside it — and Obelisk with two
spare souls is not a 4000 body, it is a Fist of Fate and a won duel, which
makes the deck's Ka Tokens ammunition rather than chaff. Ra has no numbers of
its own at all: its ATK is the combined *effective* ATK of what it ate, so
Melchid's aura is worth fifteen hundred on the God he is fed to, and once a
turn it will take every Life Point but one and add it — Life Points are
ammunition in that deck, not a health bar. Under all of it Marik's burn
collects eleven hundred a turn per Bowganian whether the God ever arrives or
not, and the beam, which searches one turn, prices an engine that collects
every turn at one turn's collection.

**Measured, and the honest version of it.** Each deck against the whole field,
the same search on both seats at the arena's 1500 ms budget, 204 games:

| | before | after |
|---|---|---|
| Priest Seto (Obelisk) | 64.2% ±6.6 | **68.6% ±6.4** |
| Yami Marik (Ra) | 59.8% ±6.7 | 60.8% ±6.7 |
| Yami Yugi (Slifer) | 66.7% ±6.5 | 66.2% ±6.5 |

Only Seto moved. The reason is in the census (`scripts/.bench/god-census.ts`):
over sixteen games Obelisk was drawn in twelve and landed in seven, on turn 4.7
— the Seeker is a one-card route and the brain's job was to see one turn past
it. Ra landed seven times but on turn 8.9. Slifer landed **three** times in
sixteen, and was held and never Summoned in six — and reading those six, the
search was mostly right to hold: the board had three bodies in four of them,
but the hand was one, two, three and three cards, so the God on offer was a
1000 to a 3000 body against a board worth more. Slifer is not worth more than
everything; it is worth a thousand a card, and the first version of its pin
asked the search to Summon it over three Knights worth 5900 and was refused ten
times out of ten, rightly. The pin was rewritten to the honest claim — cheap
Tokens, a full hand — and passes.

So: Seto's brain is worth four points, Marik's and Yami's are inside the noise,
and all three play their God's signature line correctly and pinned. What the
three decks have in common is where they lose — to Jaden, at 17–25% — and that
is a card-power fact about a HERO deck with fourteen Fusions, not something an
evaluation term reaches.

**A latent fault this turned up.** A plan that lays Tokens and then Tributes
them names uids the real game will never mint: `makeUid` mixes the RNG into
every new card's name, and the search's world deliberately carries a different
seed (that is what `ai-honesty` insists on). So Multiply into Slifer plans
correctly, fails on "Invalid tribute", and is re-planned from the board that
now really has the Tokens — the room recovers and the God lands, at the cost of
one wasted search. Left as it is rather than made deterministic: the random part
of a uid is what keeps a rematch's cards from colliding with the previous
duel's, and this codebase has already paid once for that collision.

## The deck that remembers (2026-09-12)

Mike asked whether the brain had learned anything from a duel he pasted, and
the honest answer was: two knobs. `server/learning.ts` folded a finished duel
into an aggression and a caution number, clamped to a quarter either way, and
that was the whole of the memory. Reading it found two faults on top of that.
`recordGame` seeded a deck's first record from `NEUTRAL`, so the first duel a
deck ever played wiped the style it was built with (`deckStyle`); it now seeds
from `firstLesson`, which folds the first game on top of the built style. And
every learning write went into the store with the *room's* TTL — ninety
minutes — so a lesson outlived the duel that taught it by about an hour and a
half. Learning now writes with `LEARN_TTL_SECONDS`, a year.

Then the actual request: learn the opponent, learn the deck, and learn from a
loss why it was lost. Three memories, all in `src/game/experience.ts`, all
read off `state.log` and nothing else — the log is the record of what was
*shown*, so a memory built from it cannot know a card it was never allowed to
see, and `ai-honesty` keeps meaning what it says. (That needed the engine's
Summon and activation lines to carry the card's slug, which they now do; a
synthetic pin passed for a whole afternoon while the real log carried none,
and the learner learned nothing but Sets. The pin now reads a log the engine
wrote.)

**The opponent's profile** — keyed by their name and their deck: duels, Sets,
Sets that turned out to be an answer (a Trap that fired), which Traps, which
cards they have been seen to play and in how many duels, and the cards they
played on the turn that turned a duel they won. The search reads it three
ways. `learnedPrior` leans the paranoia prior an eighth either way by how
often this opponent's Sets have fired, scaled up over six Sets, and never past
the ceiling or below the floor. `nightmareWeight` makes an answer they have
fired three times six tenths scarier than a stranger when the nightmare picks
the trap to fear. `handWeight` deals the cards they actually play into their
imagined hand first — an Efraimidis–Spirakis weight, so a card played every
duel is three times as likely to be in hand as one never shown, and one that
turned two lost duels half again on top of that; a sample stays a sample.

**The matchup's book** — keyed by *deck against deck*, not by seat: per card
the pilot played, how many duels and how many wins. A duel writes two books,
one for each side, so the day the computer is dealt the human's deck it
already holds the lines the human won with. The judge adds `bookBonus` to a
line — ±110 per card at full confidence, a third of that on one sighting,
each card once, capped at ±300 on the whole line — last and bounded, so it is
a tiebreak between near-equal turns and never the reason to play a turn the
board says is wrong. A custom deck is keyed by a hash of its cards, whatever
duelist it is dressed as.

**The post-mortem** — the room records the computer's own reading of the
board (`evaluate` over `expectationWorld`, never the real state) at the start
of each of its turns. When the duel ends, the biggest fall between two
readings brackets the human's turn that did the damage; the biggest rise,
its own turn that won. The cards played in that turn are the lesson: one
sentence on the win screen (*"Turn 4: Mike's Polymerization and Elemental
HERO Flame Wingman turned the duel, and the board never came back."*), a
list of eight per deck in the store, and — for a loss — the cards go into
the profile as `decisive`, which is what `handWeight` reads. Analyse why it
lost; expect it next time.

The room caches a reading of the memory for a minute in-process, since the
computer asks for it on every action and it changes only when a duel ends.
Computer-versus-computer duels neither read nor write any of it.

**Measured.** `scripts/.bench/learn-curve.ts`: Priest Seto against Jaden,
forty duels on the same forty seeds, the learner's seat carrying everything
the previous duels taught, the other seat the plain search. Jaden is the
matchup the God decks lose at 17–25%, chosen because there was room.

| | blocks of ten | total |
|---|---|---|
| no memory | 2 · 0 · 1 · 1 | 4/40 |
| profile + book | 2 · 1 · 3 · 1 | 7/40 |
| + post-mortem | 2 · 1 · 2 · 1 | 6/40 |

The first ten duels are the same duels — the memory is a tiebreak, and it
takes a few duels' worth before it flips one. After forty, Seto's book had
Obelisk at 6/10, Soul Exchange at 3/5 and Newdoria at 0/12, and Jaden's
profile had 26 Sets of which 17 fired — Hero Signal eight times, Mirror Gate
six. The post-mortem's forty duels named Burstinatrix thirteen times, Bladedge
and Sparkman eight, Avian and The Warrior Returning Alive seven — the HERO
engine, read off its own losses — and dealing those into Jaden's imagined
hand first did not add wins on top of the book on this sample: six against
seven is the same number. Forty duels is a small sample and the honest
reading is "a few points against a deck built to be unbeatable"; it is not a
200 IQ player, it is a player that no longer walks into the same Mirror Gate
twice, and that can tell you which turn it lost on.
