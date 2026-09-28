import { insertEvent } from "@cn/core/events";
import { setAnalyticsSink, track } from "@cn/core/analytics";
import { randomUuid } from "./randomUuid";
import { readStored, writeStored } from "@cn/core/safeStorage";

// The website's analytics transport: rows in the everything_events table
// (insert-only for clients, migration 077), registered as the sink behind
// everything-core/analytics. Events land in whatever backend
// VITE_SUPABASE_URL points at, so local dev writes to the local stack and
// only prod builds touch prod — there is no separate analytics key.

const DEVICE_ID_KEY = "cn-device-id";

// Set by identify while a session exists. Every event inserted while signed
// in carries both device_id and user_id, which is what stores the
// device-to-user link — there is no separate identify event.
let userId: string | null = null;

/* The id for a browser that cannot store one. It lasts as long as the page is
 * open, so such a visitor counts as a new device on every load. */
let inMemoryDeviceId: string | null = null;

function deviceId(): string {
  const existing = readStored(DEVICE_ID_KEY);
  if (existing) return existing;
  if (inMemoryDeviceId) return inMemoryDeviceId;
  const fresh = randomUuid();
  writeStored(DEVICE_ID_KEY, fresh);
  inMemoryDeviceId = fresh;
  return fresh;
}

/** The page URL without its fragment. The auth return (magic link, X OAuth)
 *  lands with access and refresh tokens in the fragment, so the fragment must
 *  never be stored; dropping it also stops the app's post-auth hash cleanup
 *  from counting as a second pageview. Routing is query-param based, so the
 *  fragment carries no navigation information anyway. */
function pageUrl(): string {
  return window.location.origin + window.location.pathname + window.location.search;
}

export function initAnalytics() {
  setAnalyticsSink({
    capture: (event, props) => void insertEvent({ event, platform: "web", deviceId: deviceId(), userId, props: props ?? {} }),
    identify: (id) => {
      userId = id;
    },
    // Sign-out forgets the user and starts a fresh anonymous identity, so a
    // later visitor on the same browser isn't linked to the previous account.
    reset: () => {
      userId = null;
      const fresh = randomUuid();
      writeStored(DEVICE_ID_KEY, fresh);
      inMemoryDeviceId = fresh;
    },
  });
  // The initial load fires immediately. PostHog used to defer this until the
  // tab became visible; a background-tab load now counts as a pageview, which
  // we accept for simplicity.
  capturePageviewNow();
}

// The URL of the last counted pageview.
let lastPageviewUrl: string | null = null;

function capturePageviewNow() {
  lastPageviewUrl = pageUrl();
  track("pageview", { url: lastPageviewUrl });
}

/** Capture a pageview for an in-app navigation, but only if the URL actually
 *  changed. Route handlers can then call this unconditionally after their
 *  pushState — re-selecting the current filter doesn't inflate the count. */
export function capturePageview() {
  if (pageUrl() === lastPageviewUrl) return;
  capturePageviewNow();
}
