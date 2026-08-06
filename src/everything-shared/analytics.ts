// Analytics event sink, shared by the website and the browser extension.
// This module has zero dependencies on purpose: the website plugs in a
// posthog-js sink, the extension a hand-rolled fetch sink (posthog-js must
// never enter its bundles — remote-code store policy, autocapture on host
// pages, ~50KB per content script). Until a sink is registered every call
// here is a no-op, so unconfigured builds send nothing.
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

/** Link this client's events to the signed-in user (merges the prior
 *  anonymous history into the person, so funnels span visit → sign-in). */
export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  sink?.identify(userId, traits);
}

/** Sign-out: stop attributing events to the person. */
export function resetAnalytics() {
  sink?.reset();
}
