import posthog from "posthog-js";
import { setAnalyticsSink, track } from "../../../everything-shared/analytics";

// The website's analytics transport: posthog-js, registered as the sink behind
// everything-shared/analytics (the module components import `track` etc. from).
//
// The key (a publishable PostHog project key, phc_…) is inlined at build time
// like the Supabase anon key. When it's absent — local dev, or before the repo
// secret is set — no sink is registered, so the app runs untouched and no
// build ever breaks for lack of it.
const KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

export function initAnalytics() {
  if (!KEY) return;
  posthog.init(KEY, {
    api_host: HOST,
    // Anonymous readers don't mint a person profile (they still count in the
    // "visited" step as anonymous events); a profile is created on identify.
    person_profiles: "identified_only",
    // Covers the initial load only — in-app navigation is query-param
    // pushState, which posthog's history detection ignores (it only watches
    // pathname changes), so App.tsx calls capturePageview on route changes.
    // Note: posthog defers this initial capture until the tab is actually
    // visible, so a page loaded in a background tab counts only once viewed.
    capture_pageview: true,
    // We track deliberate events only; auto-captured clicks would just add
    // volume without answering any question the DB or our events don't.
    autocapture: false,
  });
  posthog.register({ platform: "web" });
  setAnalyticsSink({
    capture: (event, props) => posthog.capture(event, props),
    identify: (userId, traits) => posthog.identify(userId, traits),
    reset: () => posthog.reset(),
  });
}

// The URL of the last counted pageview, starting with the landing URL (whose
// pageview posthog captures itself via capture_pageview above).
let lastPageviewUrl = window.location.href;

/** Capture a $pageview for an in-app navigation, but only if the URL actually
 *  changed. Route handlers can then call this unconditionally after their
 *  pushState — re-selecting the current filter doesn't inflate the count. */
export function capturePageview() {
  if (window.location.href === lastPageviewUrl) return;
  lastPageviewUrl = window.location.href;
  track("$pageview");
}
