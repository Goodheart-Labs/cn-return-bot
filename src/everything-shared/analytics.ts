// This is the analytics event sink shared by the website and the browser
// extension. The module has no dependencies of its own, and that is deliberate.
// The website plugs in a sink built on posthog-js. The extension plugs in a
// hand-rolled sink that posts events with fetch, because posthog-js must never
// enter the extension bundles. It loads code from a CDN at runtime, which puts a
// store review at risk. Its autocapture would run on the pages the user is
// reading. It also adds around 50KB to every content script.
//
// Until something registers a sink, every call here does nothing. A build with
// no analytics key configured therefore sends nothing.
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

/** Links this client's events to the signed-in user. The anonymous history this
 *  client collected before is merged into that person. A funnel can therefore
 *  run from the first anonymous visit through to the sign-in that followed. */
export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  sink?.identify(userId, traits);
}

/** Stops attributing events to the signed-in person. This runs on sign-out. */
export function resetAnalytics() {
  sink?.reset();
}
