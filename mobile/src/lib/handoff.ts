/**
 * A one-shot slot for handing a result back to the screen that navigated away.
 *
 * expo-router pushes screens; it does not return values from them. Planning a
 * route from inside the ride form needs exactly that. The rider left a half-
 * filled form to go and draw a road, and when they come back two things have to
 * be true at once: the form is still theirs, and the road is already in it.
 *
 * The obvious alternatives both fail one of those. Navigating back with the new
 * id as a route param remounts the ride form and throws away everything typed —
 * which is the bug this exists to fix, not a fix for it. A context provider
 * would hang a mutable cross-screen value off the render tree for the sake of
 * one hand-off, and every screen would pay for it.
 *
 * So: one slot, written on the way back, consumed once by whoever asked for it.
 * Anything left behind — the rider planned a route and then went somewhere else
 * entirely — is dropped the next time the slot is read, so a stale road can
 * never turn up in a form the rider opens tomorrow.
 */
type Slot = { key: string; value: unknown };

let slot: Slot | null = null;

/** Leave a result for the screen underneath, then navigate back to it. */
export function handOff(key: string, value: unknown): void {
  slot = { key, value };
}

/**
 * Take the result if it is the one being waited for. Returns null otherwise,
 * and clears whatever was there either way — an unclaimed hand-off is stale by
 * definition, and holding it would make it arrive somewhere it was never meant
 * to.
 */
export function takeHandOff<T>(key: string): T | null {
  const held = slot;
  slot = null;
  if (!held || held.key !== key) return null;
  return held.value as T;
}

/** Keys, so a typo is a compile error rather than a hand-off that never lands. */
export const HANDOFF = {
  /** A Route just created in /route/plan, on its way back to the ride form. */
  plannedRoute: 'planned-route',
} as const;
