import { supabase } from "../../../everything-shared/supabase";
import { setAnalyticsSink, track } from "../../../everything-shared/analytics";

// The website's analytics transport: rows in the everything_events table
// (insert-only for clients, migration 073), registered as the sink behind
// everything-shared/analytics. Events land in whatever backend
// VITE_SUPABASE_URL points at, so local dev writes to the local stack and
// only prod builds touch prod — there is no separate analytics key.

const DEVICE_ID_KEY = "cn-device-id";

// Set by identify while a session exists. Every event inserted while signed
// in carries both device_id and user_id, which is what stores the
// device-to-user link — there is no separate identify event.
let userId: string | null = null;

function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, fresh);
  return fresh;
}

export function initAnalytics() {
  setAnalyticsSink({
    capture: (event, props) =>
      void supabase
        .from("everything_events")
        .insert({ event, platform: "web", device_id: deviceId(), user_id: userId, props: props ?? {} })
        .then(({ error }) => {
          if (error) console.debug("analytics insert failed", error.message);
        }),
    identify: (id) => {
      userId = id;
    },
    // Sign-out forgets the user and starts a fresh anonymous identity, so a
    // later visitor on the same browser isn't linked to the previous account.
    reset: () => {
      userId = null;
      localStorage.setItem(DEVICE_ID_KEY, crypto.randomUUID());
    },
  });
  // The initial load fires immediately. PostHog used to defer this until the
  // tab became visible; a background-tab load now counts as a pageview, which
  // we accept for simplicity.
  track("pageview", { url: window.location.href });
}

// The URL of the last counted pageview, starting with the landing URL that
// initAnalytics captures.
let lastPageviewUrl = window.location.href;

/** Capture a pageview for an in-app navigation, but only if the URL actually
 *  changed. Route handlers can then call this unconditionally after their
 *  pushState — re-selecting the current filter doesn't inflate the count. */
export function capturePageview() {
  if (window.location.href === lastPageviewUrl) return;
  lastPageviewUrl = window.location.href;
  track("pageview", { url: window.location.href });
}
