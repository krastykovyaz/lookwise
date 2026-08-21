// Pure toggle logic for the persisted 👍/👎 buttons — extracted out of
// the API route (src/app/api/activity/signals/route.ts) so the
// like<->dislike / toggle-off / repeat-click decision is unit
// testable without a database or an HTTP request (see
// scripts/verify-signals.ts).

export type ProductSignal = "like" | "dislike";
export type SignalState = ProductSignal | null;

/** Given the user's current signal for a product and the button they
 *  just clicked, returns what the signal should become. Clicking the
 *  already-active button clears it back to neutral (null); clicking
 *  the other button (or clicking from neutral) sets it. */
export function resolveSignalToggle(current: SignalState, requested: ProductSignal): SignalState {
  return current === requested ? null : requested;
}
