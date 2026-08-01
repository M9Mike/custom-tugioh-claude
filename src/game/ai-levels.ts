/**
 * The difficulty names, kept apart from the AI itself.
 *
 * The home page and the lobby only need to label a button. Importing them from
 * `ai.ts` would drag the whole rules engine into the landing page bundle for
 * the sake of three strings.
 */
export type AiLevel = 'rookie' | 'duelist' | 'champion';

export const AI_LEVEL_ORDER: AiLevel[] = ['rookie', 'duelist', 'champion'];

export const AI_LEVEL_LABELS: Record<AiLevel, { name: string; blurb: string; short: string }> = {
  rookie: {
    name: 'Rookie',
    short: 'Gentle',
    blurb: 'Plays honestly, but shallowly, and will let a mistake go. A kind first duel.',
  },
  duelist: {
    name: 'Duelist',
    short: 'Reads your board',
    blurb: 'Searches whole turns and plays out your reply before committing. A real opponent.',
  },
  champion: {
    name: 'Champion',
    short: 'Plays for lethal',
    blurb: 'Widest search, no mercy, and it counts the race to zero every single turn. It will not miss lethal.',
  },
};
