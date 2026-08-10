// Analytics event sink, shared by the website and the browser extension.
// This module has zero dependencies on purpose. Both apps plug in a transport
// that inserts rows into the everything_events table (the website directly,
// the extension via its background worker so content scripts stay free of
// cross-origin fetches). Until a sink is registered every call here is a
// no-op, so contexts that never initialize analytics send nothing.
export interface AnalyticsSink {
  capture(event: string, props?: Record<string, unknown>): void;
  identify(userId: string, traits?: Record<string, unknown>): void;
  reset(): void;
}

let sink: AnalyticsSink | null = null;

export function setAnalyticsSink(next: AnalyticsSink) {
  sink = next;
}

export function track(event: string, props?: Record<string, unknown>) {
  sink?.capture(event, props);
}

/** Link this client's events to the signed-in user: subsequent event rows
 *  carry both the device id and the user id, so funnels can span
 *  visit → sign-in. */
export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  sink?.identify(userId, traits);
}

/** Sign-out: stop attributing events to the person. */
export function resetAnalytics() {
  sink?.reset();
}
