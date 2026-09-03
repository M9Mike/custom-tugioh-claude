import { useSyncExternalStore } from 'react';

const never = () => () => {};

/**
 * A value that exists only in the browser, read without a hydration mismatch.
 *
 * The server renders `fallback`; the client renders `fallback` while hydrating
 * and `read()` from then on — which is exactly what `useSyncExternalStore` is
 * for, and what an effect that called `setState` on mount was doing by hand,
 * one render late and against the React Compiler's rule about it.
 *
 * `read` is called on every render and its result compared with `Object.is`,
 * so it must return a primitive or a cached object — never a fresh one.
 */
export function useClientValue<T>(read: () => T, fallback: T): T {
  return useSyncExternalStore(never, read, () => fallback);
}
