import type { CardInstance } from '@/game/types';

/**
 * Throwaway card instances so a decklist can be rendered with the same card
 * component the board uses. Shared by the lobby and the tournament picker,
 * which both let you read a deck before committing to it.
 */
export function previewInstances(slugs: [string, number][]): CardInstance[] {
  const out: CardInstance[] = [];
  slugs.forEach(([slug, count], i) => {
    for (let n = 0; n < count; n++) {
      out.push({
        uid: `${slug}_${i}_${n}`,
        slug,
        owner: 'p1',
        face: 'up',
        position: 'atk',
        atkMod: 0,
        defMod: 0,
        turnAtkMod: 0,
        turnDefMod: 0,
        counters: 0,
        equips: [],
        flags: {},
        turnFlags: {},
        summonedOnTurn: -1,
        attacksUsed: 0,
        effectUsedOnTurn: -1,
        absorbed: [],
      });
    }
  });
  return out;
}
