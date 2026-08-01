/**
 * Every card must do what its text says.
 *
 * The card audit drives each effect and proves it fires. That can only ever
 * check the half of the card that was written — it is blind to a sentence with
 * no effect behind it at all, and three cards have now been reported by a player
 * for exactly that:
 *
 *   Sword Arm of Dragon  "of 1800 or less ATK"   — a threshold the engine has no
 *                                                  concept of, so a 1750 body was
 *                                                  simply unkillable
 *   Masaki               "while you control      — granted permanently on summon,
 *                         another Warrior"         so he was immortal alone
 *   Rocket Warrior       "when it attacks…"      — no effect whatsoever
 *
 * So this reads the rules text and insists the effects account for it: a
 * sentence that names a trigger must have that trigger, and a sentence that
 * names a condition must carry one. It is deliberately literal — it matches
 * phrases we actually write, and says so when it cannot judge a card, rather
 * than guessing and being quietly wrong.
 *
 *   npx tsx scripts/text-check.ts
 */
import { CARDS } from '../src/game/cards';
import type { CardDef, CardEffect, CardFilter, Trigger } from '../src/game/types';

/** A phrase in the rules text, and the triggers that would satisfy it. */
const TRIGGERS: { phrase: RegExp; needs: Trigger[]; label: string }[] = [
  { phrase: /\bFLIP:/i, needs: ['onFlip'], label: 'FLIP:' },
  { phrase: /when (this card|it) attacks|each time (this card|it) attacks|when it declares an attack/i,
    needs: ['onDeclareAttack'], label: 'when it attacks' },
  { phrase: /when (this card|it) destroys (a|1) monster (by|in) battle/i,
    needs: ['onBattleDestroy'], label: 'when it destroys a monster in battle' },
  { phrase: /when (this card|it) is destroyed by battle/i,
    needs: ['onDestroyedByBattle', 'onSentToGrave'], label: 'when destroyed by battle' },
  { phrase: /when (this card|it) is (normal )?summoned|when summoned/i,
    needs: ['onSummon', 'onNormalSummon'], label: 'when summoned' },
  { phrase: /once per turn:/i, needs: ['ignition'], label: 'once per turn:' },
  { phrase: /when your opponent (declares an attack|normal summons|summons)/i,
    needs: ['trap'], label: "when your opponent's …" },
];

/** Wording that promises the effect only applies sometimes. */
const CONDITIONAL = /\bwhile you control\b|\bif you control\b|\bas long as\b|\bwhile this card is face-up\b/i;

/**
 * An ATK threshold in the text is fine when it lands in a card *filter*, which
 * carries `minAtk`/`maxAtk` — Sangan's search really is capped. It is a lie when
 * it is attached to something with no notion of a threshold, which is how Sword
 * Arm of Dragon ended up permanently unkillable: its "1800 or less" was hung on
 * a boolean immunity flag and simply evaporated.
 */
const ATK_THRESHOLD =
  /\b(of|with) \d{3,4} or (less|fewer|lower|more|higher) ATK\b|\bATK is \d{3,4} or (less|fewer|lower|more|higher)\b/i;

function thresholdIsExpressed(def: CardDef): boolean {
  const bounded = (f: unknown) =>
    !!f && typeof f === 'object' && ((f as CardFilter).maxAtk != null || (f as CardFilter).minAtk != null);
  for (const eff of def.effects) {
    for (const op of eff.ops as Record<string, unknown>[]) {
      // The bound lives on the op's own filter, or on the filter inside the
      // selector it targets — `destroy` carries its in `target.filter`, which
      // is where four cards were being reported as broken while being fine.
      if (bounded(op.filter)) return true;
      const target = op.target as { filter?: unknown } | undefined;
      if (bounded(target?.filter)) return true;
    }
    if (eff.aura && bounded((eff.aura.target as { filter?: unknown }).filter)) return true;
  }
  return false;
}

/** Does any effect on the card carry one of these triggers? */
const hasTrigger = (def: CardDef, needs: Trigger[]) => def.effects.some((e) => needs.includes(e.trigger));

/** A continuous aura counts as conditional if the aura itself is conditional. */
const hasCondition = (def: CardDef) =>
  def.effects.some((e: CardEffect) => !!e.condition) ||
  // "While this card is face-up" is what a continuous aura *is*, so one of
  // those satisfies the phrase on its own.
  def.effects.some((e) => e.trigger === 'continuous');

const problems: string[] = [];
let checked = 0;

for (const def of Object.values(CARDS)) {
  if (def.slug === 'facedown' || !def.text) continue;
  checked += 1;

  for (const { phrase, needs, label } of TRIGGERS) {
    if (!phrase.test(def.text)) continue;
    if (hasTrigger(def, needs)) continue;
    problems.push(
      `${def.name} (${def.slug}) — text says "${label}" but the card has no ${needs.join(' or ')} effect`
    );
  }

  if (CONDITIONAL.test(def.text) && !hasCondition(def)) {
    problems.push(
      `${def.name} (${def.slug}) — text promises a condition ("${def.text.match(CONDITIONAL)![0]}") ` +
        'but every effect on the card is unconditional'
    );
  }

  const threshold = def.text.match(ATK_THRESHOLD);
  if (threshold && !thresholdIsExpressed(def)) {
    problems.push(
      `${def.name} (${def.slug}) — text says "${threshold[0].trim()}" but no filter on the card carries that bound, ` +
        'so the threshold does not exist'
    );
  }
}

console.log(`Text against effects — ${checked} cards\n`);
if (problems.length) {
  console.log('Cards whose text promises more than they do:');
  for (const p of problems) console.log(`  ❌ ${p}`);
  console.log(`\n${problems.length} card(s) do not do what they say`);
  process.exitCode = 1;
} else {
  console.log('Every card does what its text says. ✅');
}
