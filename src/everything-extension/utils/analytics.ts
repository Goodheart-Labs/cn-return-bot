import { browser } from "#imports";
import { setAnalyticsSink } from "../../everything-shared/analytics";

// The extension's analytics transport: plain fetches against PostHog's HTTP
// API, registered as the sink behind everything-shared/analytics. posthog-js
// must never enter these bundles — it lazy-loads code from PostHog's CDN
// (remote code, a store-review rejection risk), its autocapture would run on
// host pages, and it weighs ~50KB per content script.
//
// Every event flows through the BACKGROUND: content-script fetches are
// subject to the host page's CSP, and one writer means no races on the ids.
// UI contexts (content scripts, popup) register a sink that fire-and-forgets
// a runtime message; the background does the actual fetch. Like the website,
// everything is a no-op while the build-time key is absent.
const KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

const MESSAGE_TYPE = "cn-analytics";
const DEVICE_ID_KEY = "cn-ph-device-id";
const USER_ID_KEY = "cn-ph-user-id";
// The supabase-js session in chrome.storage.local — one seam that sees every
// sign-in (email code, X OAuth) and sign-out, without instrumenting each flow.
const SUPABASE_AUTH_STORAGE_KEY = /^sb-.*-auth-token$/;

type AnalyticsMessage =
  | { type: typeof MESSAGE_TYPE; op: "capture"; event: string; props?: Record<string, unknown> }
  | { type: typeof MESSAGE_TYPE; op: "identify"; userId: string; traits?: Record<string, unknown> }
  | { type: typeof MESSAGE_TYPE; op: "reset" };

/** Sink for popup + content scripts: forward to the background. The .catch
 *  swallows "receiving end does not exist" — an orphaned content script after
 *  an extension reload must not throw on a stray capture. */
export function initUiAnalytics() {
  if (!KEY) return;
  const send = (message: AnalyticsMessage) => void browser.runtime.sendMessage(message).catch(() => {});
  setAnalyticsSink({
    capture: (event, props) => send({ type: MESSAGE_TYPE, op: "capture", event, props }),
    identify: (userId, traits) => send({ type: MESSAGE_TYPE, op: "identify", userId, traits }),
    reset: () => send({ type: MESSAGE_TYPE, op: "reset" }),
  });
}

/** Background: listen for UI events, watch auth, and register a direct sink
 *  for the background's own captures (a runtime.sendMessage from here would
 *  skip its own listener and reject with no receivers). */
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
    return undefined; // never an async response — captures are fire-and-forget
  });
  watchAuthChanges();
}

/** Minted lazily, only ever here in the background (single writer). */
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
    // Anonymous events don't mint a person profile — mirrors the website's
    // person_profiles: "identified_only"; identify upgrades them retroactively.
    ...(userId ? {} : { $process_person_profile: false }),
  });
}

/** Attribute this install's events to the signed-in user; $anon_distinct_id
 *  merges the prior anonymous history into the person. */
async function identify(userId: string, traits?: Record<string, unknown>) {
  const anonId = await deviceId();
  await browser.storage.local.set({ [USER_ID_KEY]: userId });
  await send("$identify", userId, { ...baseProps(), $anon_distinct_id: anonId, $set: traits ?? {} });
}

/** Sign-out: forget the person AND start a fresh anonymous identity, exactly
 *  what posthog.reset() does in the browser. */
async function reset() {
  await browser.storage.local.remove(USER_ID_KEY);
  await browser.storage.local.set({ [DEVICE_ID_KEY]: crypto.randomUUID() });
}

/** Comparing against the stored user id turns the noisy storage stream
 *  (token refreshes rewrite the same key) into exactly one signed_in +
 *  identify per real sign-in and one reset per sign-out. */
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
    // not a session payload — treat as signed out
  }
  const known = await knownUserId();
  if (user?.id && user.id !== known) {
    await identify(user.id, { auth_provider: user.app_metadata?.provider });
    await capture("signed_in", { provider: user.app_metadata?.provider });
  } else if (!user?.id && known) {
    await reset();
  }
}
