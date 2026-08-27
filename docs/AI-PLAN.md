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
