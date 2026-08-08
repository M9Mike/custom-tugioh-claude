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
  /* "Destroyed" with no qualifier. The lookahead keeps the stricter
     by-battle clause above owning its own case rather than both matching.
     Nothing checked this before, which is how Chimera's "when this card is
     destroyed" shipped as `onSentToGrave` — a trigger that also fires on a
     tribute, so it revived two monsters in the middle of paying for a God. */
  { phrase: /when (this card|it) is destroyed(?! by battle)/i,
    needs: ['onDestroyed', 'onDestroyedByBattle', 'onSentToGrave'], label: 'when destroyed' },
  { phrase: /when (this card|it) is (normal )?summoned|when summoned/i,
    needs: ['onSummon', 'onNormalSummon'], label: 'when summoned' },
  { phrase: /once per turn:/i, needs: ['ignition'], label: 'once per turn:' },
  /* A Trap is the usual way to answer the opponent, and was the only way until
     Slifer: a monster sitting on the field can watch them summon too. Both
     satisfy the clause; nothing else does. */
  { phrase: /when your opponent (declares an attack|normal summons|summons)/i,
    needs: ['trap', 'onOpponentSummon'], label: "when your opponent's …" },
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

/** The same trap one rung down: "Level 4 or lower" needs a level bound to exist. */
const LEVEL_THRESHOLD = /\bLevel \d+ or (lower|less|higher|more)\b/i;

function thresholdIsExpressed(def: CardDef, kind: 'atk' | 'level'): boolean {
  const bounded = (f: CardFilter | undefined) =>
    !!f && (kind === 'atk' ? f.maxAtk != null || f.minAtk != null : f.maxLevel != null || f.minLevel != null);
  for (const eff of def.effects) {
    for (const op of eff.ops) {
      /* `in` rather than a cast: `Op` is a discriminated union and only some
         members carry a filter or a target, so narrowing asks the type which
         ones do instead of asserting a shape over the top of it.

         The bound lives on the op's own filter, or on the filter inside the
         selector it targets — `destroy` carries its in `target.filter`, which
         is where four cards were being reported as broken while being fine. */
      if ('filter' in op && bounded(op.filter)) return true;
      if ('target' in op && bounded(op.target?.filter)) return true;
    }
    if (bounded(eff.aura?.target.filter)) return true;
  }
  return false;
}

/**
 * "Gains 200 ATK for each card in your Graveyard" names a quantity that keeps
 * moving, so it has to be read live. Five cards granted it *once, on summon* —
 * when the Graveyard is usually empty, so they gained nothing and then never
 * grew. Two-Headed King Rex was worse still: its text says "for each Dinosaur"
 * and the scale it used counted every card there regardless of type.
 *
 * A snapshot is only honest when the text says so. "When Summoned: it gains 200
 * ATK for each card in your Graveyard" really is a one-off, and Dark Magician
 * says exactly that, so the sentence is checked for a trigger clause before the
 * card is judged.
 */
const PER_EACH = /gains? (\d+) ATK for (?:each|every) ([A-Za-z"' -]*?) ?(?:in|on) /i;
const SNAPSHOT = /\bwhen (?:this card is |it is )?(?:normal |fusion |flip )?summoned\b/i;

/**
 * A price the card names for what it can do.
 *
 * Sky Scout is "can attack your opponent directly, **but its battle damage is
 * halved**" — and only the first half of that sentence existed, so it was an
 * unblockable 1800 every turn for one Normal Summon. The clause after the "but"
 * is the whole reason the clause before it is allowed to be that good, and this
 * check exists because nothing else can see a missing one: the audit drives
 * effects that are there, and a downside that was never written has no effect
 * to drive.
 */
const COSTS: { phrase: RegExp; needs: (def: CardDef) => boolean; label: string }[] = [
  {
    phrase: /\bbattle damage (?:it inflicts |this card inflicts )?is halved\b|\bhalve[sd]? (?:its |the )?battle damage\b/i,
    label: 'its battle damage is halved',
    needs: (def) =>
      def.effects.some(
        (e) =>
          e.ops.some((o) => o.op === 'halvedBattleDamage') ||
          !!e.aura?.grants?.includes('halvedBattleDamage')
      ),
  },
  /* The narrower bargain, and it needs its own rule: a card that pays only on
     the direct swing carries `halvedDirectDamage`, which the clause above does
     not accept — and the clause above's phrase does not reach this sentence
     either, so without this one Gaia the Dragon Champion could promise the
     price and never be charged it.

     Three phrasings, because the sentence has been rewritten twice and a reword
     that lands outside this pattern switches the rule off in silence — which is
     worse than never having written it, since the suite goes on reporting all
     clear. Both cards now use the third, Konami's own "when it does so using
     this effect"; the first two stay so that a card written in the older voice
     is still charged. */
  {
    phrase:
      /\bbattle damage from a direct attack is halved\b|\bdirect attacks? (?:deals?|inflicts?) half\b|\bwhen it does so using this effect\b[^.]*\bbattle damage\b[^.]*\bis halved\b/i,
    label: 'its battle damage from a direct attack is halved',
    needs: (def) =>
      def.effects.some(
        (e) =>
          e.ops.some((o) => o.op === 'halvedDirectDamage') ||
          !!e.aura?.grants?.includes('halvedDirectDamage')
      ),
  },
];

/** The sentence a phrase sits in, so a trigger clause elsewhere cannot excuse it. */
function sentenceWith(text: string, re: RegExp): string | null {
  for (const s of text.split(/(?<=[.!?])\s+/)) if (re.test(s)) return s;
  return null;
}

const MONSTER_TYPES = new Set(
  Object.values(CARDS)
    .map((d) => d.type)
    .filter((t): t is string => !!t)
);

function checkScalingBonus(def: CardDef): string[] {
  const sentence = sentenceWith(def.text!, PER_EACH);
  if (!sentence) return [];
  // The text itself says it is taken at summon time, so a one-shot is honest.
  if (SNAPSHOT.test(sentence)) return [];

  const auras = def.effects.filter((e) => e.trigger === 'continuous' && e.aura?.per);
  if (!auras.length) {
    return [
      `${def.name} (${def.slug}) — text says "${sentence.match(PER_EACH)![0].trim()}…", a quantity that keeps ` +
        'changing, but no continuous aura scales with it, so it is frozen at whatever it was when the card arrived',
    ];
  }

  // "for each Dinosaur" has to actually be counting Dinosaurs.
  const named = sentence.match(PER_EACH)![2].trim().replace(/^"|"$/g, '');
  if (named && MONSTER_TYPES.has(named)) {
    const filtered = auras.some((e) => e.aura!.per!.filter?.type === named);
    if (!filtered) {
      return [
        `${def.name} (${def.slug}) — text counts "${named}" but the scaling aura carries no ` +
          `type filter for it, so it is counting everything`,
      ];
    }
  }
  return [];
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

  problems.push(...checkScalingBonus(def));

  for (const { phrase, needs, label } of COSTS) {
    if (!phrase.test(def.text) || needs(def)) continue;
    problems.push(
      `${def.name} (${def.slug}) — text charges "${label}" and nothing on the card collects it, ` +
        'so the card gets the upside for free'
    );
  }

  for (const [re, kind] of [[ATK_THRESHOLD, 'atk'], [LEVEL_THRESHOLD, 'level']] as const) {
    const threshold = def.text.match(re);
    if (threshold && !thresholdIsExpressed(def, kind)) {
      problems.push(
        `${def.name} (${def.slug}) — text says "${threshold[0].trim()}" but no filter on the card carries that bound, ` +
          'so the threshold does not exist'
      );
    }
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
