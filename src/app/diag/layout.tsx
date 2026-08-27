import { notFound } from 'next/navigation';

/**
 * The labs exist in development and nowhere else.
 *
 * ## Why this gate is here
 *
 * `/diag/npc` builds a field with the whole cast standing in it under a blue
 * sky. It is a tool — it is how a wrong face or a wrong scale gets caught before
 * it ships, and `npm run faces` drives it — but it is also, from a player's
 * side, a grass field with Yugi and Kaiba standing in it that has nothing to do
 * with the game. There is no route into it from anywhere in Story Mode, and it
 * should not be *possible* to be in it, which is a different and stronger
 * statement than "no link points at it".
 *
 * So in a production build the whole `/diag` tree is a 404. The three checks
 * that drive these pages — `npm run faces`, `npm run character`, `npm run
 * clash` — all default to `http://localhost:3000`, so they are unaffected.
 *
 * `NODE_ENV` is inlined at build time, so this is not a runtime check that could
 * be flipped; the pages are simply not reachable in the deployed game.
 */
export default function DiagLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return <>{children}</>;
}
