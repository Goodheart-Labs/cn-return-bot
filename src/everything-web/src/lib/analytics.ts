import posthog from "posthog-js";
import { setAnalyticsSink, track } from "../../../everything-shared/analytics";

// This is the website's analytics transport. It registers posthog-js as the sink
// behind everything-shared/analytics, which is the module components import
// `track` and friends from.
//
// The key is a publishable PostHog project key, the kind that starts with phc_.
// It is inlined at build time, the same way the Supabase anon key is. When it is
// absent, which happens in local dev and before the repo secret is set, no sink
// is registered. The app then runs untouched and no build breaks for want of it.
const KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

export function initAnalytics() {
  if (!KEY) return;
  posthog.init(KEY, {
    api_host: HOST,
    // An anonymous reader does not mint a person profile. They still count in
    // the "visited" step, as anonymous events. A profile is created the moment
    // we identify them.
    person_profiles: "identified_only",
    // This covers the initial page load only. Navigation inside the app is a
    // pushState that changes query parameters, and posthog's history detection
    // watches the pathname, so it ignores those. App.tsx calls capturePageview
    // on a route change instead. Posthog also holds this first capture back
    // until the tab is actually visible, so a page opened in a background tab
    // counts only once someone looks at it.
    capture_pageview: true,
    // We track only the events we chose deliberately. Auto-captured clicks would
    // add volume without answering any question the database or our own events
    // cannot already answer.
    autocapture: false,
  });
  posthog.register({ platform: "web" });
  setAnalyticsSink({
    capture: (event, props) => posthog.capture(event, props),
    identify: (userId, traits) => posthog.identify(userId, traits),
    reset: () => posthog.reset(),
  });
}

// The URL of the last pageview we counted. It starts at the landing URL, whose
// pageview posthog captures on its own through the capture_pageview option set
// above.
let lastPageviewUrl = window.location.href;

/** Captures a $pageview for a navigation inside the app, but only when the URL
 *  actually changed. A route handler can therefore call this unconditionally
 *  after its pushState. Re-selecting the filter that is already showing does not
 *  inflate the count. */
export function capturePageview() {
  if (window.location.href === lastPageviewUrl) return;
  lastPageviewUrl = window.location.href;
  track("$pageview");
}
