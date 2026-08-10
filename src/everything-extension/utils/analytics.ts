import { browser } from "#imports";
import { setAnalyticsSink } from "../../everything-shared/analytics";

// This is the extension's analytics transport. It sends plain fetches to
// PostHog's HTTP API and registers itself as the sink behind
// everything-shared/analytics.
//
// posthog-js must never enter these bundles. It lazy-loads code from PostHog's
// CDN, and remote code is a good way to get rejected in a store review. Its
// autocapture would run on the host pages the user visits. It also weighs around
// 50KB in every content script.
//
// Every event flows through the background. A fetch made from a content script
// is subject to the host page's content security policy, so it can be blocked.
// The background is also the only writer of the stored ids, so nothing races
// over them. The popup and the content scripts register a sink that sends a
// runtime message and does not wait for an answer. The background does the
// actual fetch. Just like on the website, all of this does nothing while the
// build-time key is missing.
const KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

const MESSAGE_TYPE = "cn-analytics";
const DEVICE_ID_KEY = "cn-ph-device-id";
const USER_ID_KEY = "cn-ph-user-id";
// This matches the key supabase-js keeps its session under in
// chrome.storage.local. Watching that one key catches every sign-in and every
// sign-out, whether it came from the email code flow or from X OAuth. No
// individual auth flow has to be instrumented.
const SUPABASE_AUTH_STORAGE_KEY = /^sb-.*-auth-token$/;

type AnalyticsMessage =
  | { type: typeof MESSAGE_TYPE; op: "capture"; event: string; props?: Record<string, unknown> }
  | { type: typeof MESSAGE_TYPE; op: "identify"; userId: string; traits?: Record<string, unknown> }
  | { type: typeof MESSAGE_TYPE; op: "reset" };

/** Registers the sink the popup and the content scripts use. It forwards every
 *  call to the background. The catch swallows the "receiving end does not exist"
 *  error. A content script left behind by an extension reload has no background
 *  to talk to any more, and a stray capture from it must not throw. */
export function initUiAnalytics() {
  if (!KEY) return;
  const send = (message: AnalyticsMessage) => void browser.runtime.sendMessage(message).catch(() => {});
  setAnalyticsSink({
    capture: (event, props) => send({ type: MESSAGE_TYPE, op: "capture", event, props }),
    identify: (userId, traits) => send({ type: MESSAGE_TYPE, op: "identify", userId, traits }),
    reset: () => send({ type: MESSAGE_TYPE, op: "reset" }),
  });
}

/** Sets analytics up in the background. It listens for the events the popup and
 *  the content scripts send, and it watches the stored session for sign-ins and
 *  sign-outs. It also registers a sink that fetches directly, because the
 *  background captures events of its own. A runtime.sendMessage sent from here
 *  would not reach the listener below and would reject for want of a receiver. */
export function initBackgroundAnalytics() {
  if (!KEY) return;
  setAnalyticsSink({
    capture: (event, props) => void capture(event, props),
    identify: (userId, traits) => void identify(userId, traits),
    reset: () => void reset(),
  });
  browser.runtime.onMessage.addListener((message: unknown) => {
    const m = message as AnalyticsMessage;
    if (m?.type !== MESSAGE_TYPE) return undefined;
    if (m.op === "capture") void capture(m.event, m.props);
    if (m.op === "identify") void identify(m.userId, m.traits);
    if (m.op === "reset") void reset();
    return undefined; // The listener never answers. Captures are fire and forget.
  });
  watchAuthChanges();
}

/** Returns this install's anonymous id and mints one the first time it is
 *  needed. Only the background ever calls this. That single writer is what stops
 *  two contexts from minting two different ids at once. */
async function deviceId(): Promise<string> {
  const { [DEVICE_ID_KEY]: existing } = await browser.storage.local.get(DEVICE_ID_KEY);
  if (typeof existing === "string") return existing;
  const fresh = crypto.randomUUID();
  await browser.storage.local.set({ [DEVICE_ID_KEY]: fresh });
  return fresh;
}

async function knownUserId(): Promise<string | null> {
  const { [USER_ID_KEY]: userId } = await browser.storage.local.get(USER_ID_KEY);
  return typeof userId === "string" ? userId : null;
}

async function send(event: string, distinctId: string, props: Record<string, unknown>) {
  await fetch(`${HOST}/i/v0/e/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: KEY,
      event,
      distinct_id: distinctId,
      properties: props,
      timestamp: new Date().toISOString(),
    }),
  }).catch(() => {});
}

function baseProps(): Record<string, unknown> {
  return {
    platform: "extension",
    browser: import.meta.env.BROWSER,
    app_version: browser.runtime.getManifest().version,
  };
}

async function capture(event: string, props?: Record<string, unknown>) {
  const userId = await knownUserId();
  await send(event, userId ?? (await deviceId()), {
    ...baseProps(),
    ...props,
    // An anonymous event does not create a person profile. This mirrors the
    // website, which sets person_profiles to "identified_only". Once the user
    // signs in, identify pulls those earlier events into the person.
    ...(userId ? {} : { $process_person_profile: false }),
  });
}

/** Attributes this install's events to the signed-in user from now on. The
 *  $anon_distinct_id property tells PostHog to merge the anonymous history
 *  collected under the device id into that person. */
async function identify(userId: string, traits?: Record<string, unknown>) {
  const anonId = await deviceId();
  await browser.storage.local.set({ [USER_ID_KEY]: userId });
  await send("$identify", userId, { ...baseProps(), $anon_distinct_id: anonId, $set: traits ?? {} });
}

/** Forgets the signed-in person and starts a fresh anonymous identity. This is
 *  exactly what posthog.reset() does in the browser. It runs on sign-out. */
async function reset() {
  await browser.storage.local.remove(USER_ID_KEY);
  await browser.storage.local.set({ [DEVICE_ID_KEY]: crypto.randomUUID() });
}

/** Watches the stored Supabase session and turns it into analytics calls. That
 *  storage stream is noisy, because every token refresh rewrites the same key.
 *  Comparing the session's user against the user id we already stored filters
 *  the noise out. What is left is one identify and one signed_in event per real
 *  sign-in, and one reset per sign-out. */
function watchAuthChanges() {
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    for (const [key, change] of Object.entries(changes)) {
      if (SUPABASE_AUTH_STORAGE_KEY.test(key)) void handleAuthChange(change.newValue);
    }
  });
}

async function handleAuthChange(newValue: unknown) {
  let user: { id?: string; app_metadata?: { provider?: string } } | null = null;
  try {
    const session = typeof newValue === "string" ? JSON.parse(newValue) : newValue;
    user = session?.user ?? null;
  } catch {
    // The value is not a session payload, so we treat the user as signed out.
  }
  const known = await knownUserId();
  if (user?.id && user.id !== known) {
    await identify(user.id, { auth_provider: user.app_metadata?.provider });
    await capture("signed_in", { provider: user.app_metadata?.provider });
  } else if (!user?.id && known) {
    await reset();
  }
}
