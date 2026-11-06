import { browser } from "#imports";

// The random id that marks one browser profile in everything_events. Only the
// background reads and writes it.
const DEVICE_ID_KEY = "cn-device-id";
// The key the PostHog-era transport used. It is adopted on first read, so
// existing installs keep their device identity.
const LEGACY_DEVICE_ID_KEY = "cn-ph-device-id";

/** Read a storage key, falling back to its PostHog-era name once: the legacy
 *  value is persisted under the new key and removed. */
export async function readWithLegacy(key: string, legacyKey: string): Promise<string | null> {
  const values = await browser.storage.local.get([key, legacyKey]);
  if (typeof values[key] === "string") return values[key];
  if (typeof values[legacyKey] === "string") {
    await browser.storage.local.set({ [key]: values[legacyKey] });
    await browser.storage.local.remove(legacyKey);
    return values[legacyKey];
  }
  return null;
}

let pendingDeviceId: Promise<string> | null = null;

/** The device id is created lazily, on the first event. On the first start
 *  after an install, the heartbeat and extension_installed ask for it at the
 *  same moment. Each used to find storage empty and create its own id, so the
 *  install event carried an id that never appeared again (GOO-743). Callers
 *  that ask at the same time now share one attempt. Once that attempt is done,
 *  the next call reads storage again, so it sees the new id a sign-out sets. */
export function deviceId(): Promise<string> {
  pendingDeviceId ??= readOrCreateDeviceId().finally(() => {
    pendingDeviceId = null;
  });
  return pendingDeviceId;
}

async function readOrCreateDeviceId(): Promise<string> {
  const existing = await readWithLegacy(DEVICE_ID_KEY, LEGACY_DEVICE_ID_KEY);
  if (existing) return existing;
  const fresh = crypto.randomUUID();
  await browser.storage.local.set({ [DEVICE_ID_KEY]: fresh });
  return fresh;
}

/** Sign-out starts a fresh anonymous identity, so later events on this install
 *  are not linked to the previous account. */
export async function replaceDeviceId() {
  await browser.storage.local.set({ [DEVICE_ID_KEY]: crypto.randomUUID() });
}
