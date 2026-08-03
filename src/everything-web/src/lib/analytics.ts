import posthog from "posthog-js";

// Product analytics for commonnotes.net (the funnel: visited → signed in →
// voted → voted on multiple notes). This module is web-only on purpose — the
// browser extension shares everything-shared/* but must NOT pull in posthog, so
// every capture lives in the web app's own components and routes through here.
//
// The key (a publishable PostHog project key, phc_…) is inlined at build time
// like the Supabase anon key. When it's absent — local dev, or before the repo
// secret is set — every function below is a no-op, so the app runs untouched
// and no build ever breaks for lack of it.
const KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

let live = false;

export function initAnalytics() {
  if (!KEY) return;
  posthog.init(KEY, {
    api_host: HOST,
    // Anonymous readers don't mint a person profile (they still count in the
    // "visited" step as anonymous events); a profile is created on identify.
    person_profiles: "identified_only",
    capture_pageview: true,
  });
  live = true;
}

/** Link this browser's events to the signed-in user (merges the prior
 *  anonymous session into the person, so the funnel spans visit → sign-in). */
export function identifyUser(userId: string, traits?: Record<string, unknown>) {
  if (live) posthog.identify(userId, traits);
}

/** Sign-out: stop attributing events to the person. */
export function resetAnalytics() {
  if (live) posthog.reset();
}

export function track(event: string, props?: Record<string, unknown>) {
  if (live) posthog.capture(event, props);
}
