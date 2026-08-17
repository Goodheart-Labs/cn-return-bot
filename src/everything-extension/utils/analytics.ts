import { browser } from "#imports";
import { supabase } from "../../everything-shared/supabase";
import { setAnalyticsSink } from "../../everything-shared/analytics";

// The extension's analytics transport: rows in the everything_events table
// (insert-only for clients, migration 077), registered as the sink behind
// everything-shared/analytics. No third-party analytics library enters these
// bundles — the shared supabase client is already part of the extension, so
// analytics adds no new dependency or remote code.
//
// Every event flows through the BACKGROUND: content-script fetches are
// subject to the host page's CSP, and one writer means no races on the ids.
// UI contexts (content scripts, popup) register a sink that fire-and-forgets
// a runtime message; the background does the actual insert.

const MESSAGE_TYPE = "cn-analytics";
const DEVICE_ID_KEY = "cn-device-id";
const USER_ID_KEY = "cn-user-id";
// The keys the PostHog-era transport used; adopted on first read so existing
// installs keep their device identity.
const LEGACY_DEVICE_ID_KEY = "cn-ph-device-id";
const LEGACY_USER_ID_KEY = "cn-ph-user-id";
// The supabase-js session in chrome.storage.local — one seam that sees every
// sign-in (email code, X OAuth) and sign-out, without instrumenting each flow.
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
  setAnalyticsSink({
    capture: (event, props) => void capture(event, props),
    identify: (userId) => void identify(userId),
    reset: () => void reset(),
  });
  browser.runtime.onMessage.addListener((message: unknown) => {
    const m = message as AnalyticsMessage;
    if (m?.type !== MESSAGE_TYPE) return undefined;
    if (m.op === "capture") void capture(m.event, m.props);
    if (m.op === "identify") void identify(m.userId);
    if (m.op === "reset") void reset();
    return undefined; // The listener never answers. Captures are fire and forget.
  });
  watchAuthChanges();
}

/** Read a storage key, falling back to its PostHog-era name once: the legacy
 *  value is persisted under the new key and removed. */
async function readWithLegacy(key: string, legacyKey: string): Promise<string | null> {
  const values = await browser.storage.local.get([key, legacyKey]);
  if (typeof values[key] === "string") return values[key];
  if (typeof values[legacyKey] === "string") {
    await browser.storage.local.set({ [key]: values[legacyKey] });
    await browser.storage.local.remove(legacyKey);
    return values[legacyKey];
  }
  return null;
}

/** Minted lazily, only ever here in the background (single writer). */
async function deviceId(): Promise<string> {
  const existing = await readWithLegacy(DEVICE_ID_KEY, LEGACY_DEVICE_ID_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  await browser.storage.local.set({ [DEVICE_ID_KEY]: fresh });
  return fresh;
}

/** The auth watcher's dedupe state: which user this install last identified. */
async function knownUserId(): Promise<string | null> {
  return readWithLegacy(USER_ID_KEY, LEGACY_USER_ID_KEY);
}

async function capture(event: string, props?: Record<string, unknown>) {
  // user_id must match the JWT the insert carries (RLS checks
  // user_id = auth.uid()), so it comes from the live session, not from the
  // stored id — a stored id with an expired session would fail the check.
  const { data } = await supabase.auth.getSession();
  await supabase.from("everything_events").insert({
    event,
    platform: "extension",
    device_id: await deviceId(),
    user_id: data.session?.user.id ?? null,
    props: {
      browser: import.meta.env.BROWSER,
      app_version: browser.runtime.getManifest().version,
      ...props,
    },
  });
}

/** Remember which user this install belongs to — only used by the auth
 *  watcher's dedupe. The device-to-user link itself is stored by every event
 *  row that carries both ids; no dedicated event is needed. */
async function identify(userId: string) {
  await browser.storage.local.set({ [USER_ID_KEY]: userId });
}

/** Sign-out: forget the user AND start a fresh anonymous identity, so later
 *  events on this install aren't linked to the previous account. */
async function reset() {
  await browser.storage.local.remove(USER_ID_KEY);
  await browser.storage.local.set({ [DEVICE_ID_KEY]: crypto.randomUUID() });
}

/** Comparing against the stored user id turns the noisy storage stream
 *  (token refreshes rewrite the same key) into exactly one signed_in per real
 *  sign-in and one reset per sign-out. */
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
    await identify(user.id);
    await capture("signed_in", { provider: user.app_metadata?.provider });
  } else if (!user?.id && known) {
    await reset();
  }
}
