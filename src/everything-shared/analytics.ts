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

/* Analytics is a side channel. Nothing the app shows a reader depends on an
 * event reaching the database, so a sink that throws must never reach the code
 * that called track. A transport can fail for reasons that have nothing to do
 * with our code: the browser refuses access to storage, an extension blocks the
 * request, the network is down. Before these guards existed, the website called
 * track for the first pageview before it rendered anything, and a browser with
 * site data turned off threw there and left the reader on a blank page. */
function swallow(what: string, run: () => void) {
  try {
    run();
  } catch (err) {
    console.debug(`analytics ${what} failed`, err);
  }
}

export function track(event: string, props?: Record<string, unknown>) {
  swallow("capture", () => sink?.capture(event, props));
}

/** Link this client's events to the signed-in user: subsequent event rows
 *  carry both the device id and the user id, so funnels can span
 *  visit → sign-in. */
export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  swallow("identify", () => sink?.identify(userId, traits));
}

/** Stops attributing events to the signed-in person. This runs on sign-out. */
export function resetAnalytics() {
  swallow("reset", () => sink?.reset());
}
