import posthog from "posthog-js";
import { setAnalyticsSink } from "../../../everything-shared/analytics";

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
    // pathname changes), so App.tsx captures $pageview manually on route changes.
    capture_pageview: true,
  });
  posthog.register({ platform: "web" });
  setAnalyticsSink({
    capture: (event, props) => posthog.capture(event, props),
    identify: (userId, traits) => posthog.identify(userId, traits),
    reset: () => posthog.reset(),
  });
}
