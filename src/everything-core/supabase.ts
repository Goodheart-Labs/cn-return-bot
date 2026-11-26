import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { extensionStorage } from "./extensionStorage";
import { fetchWithRetries } from "./retry";

// The anon key is public by design, because it is baked into the static site and
// into the extension. Migration 050 locks down what the anon role can actually
// do. It may read the everything_* tables and it may cast votes, which row level
// security ties to the signed-in user. It may do nothing else.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (root .env for local dev)");
}

// In the browser extension the popup, the background script and the content
// scripts all share one session, held in chrome.storage.local. A content
// script's localStorage belongs to the host page, so the default storage would
// scatter a separate session across every site the user visits.
// autoRefreshToken is off because an MV3 service worker loses its timers when it
// shuts down. Instead supabase-js refreshes an expired session on demand inside
// getSession(), and every authenticated call goes through that. On a plain web
// page there is no extension storage, and the website keeps supabase-js's own
// default of localStorage.
//
// The extension's client also needs a storage key of its own. supabase-js
// names a BroadcastChannel after the storage key and uses it to tell other
// clients of the same key about sign-ins and sign-outs. A content script
// shares that channel with the page it runs in, and the extension runs one on
// commonnotes.net, because that site has notes too. There the extension's
// client and the website's client heard each other: the website's sign-in
// corner showed the extension's session while the website had none of its
// own, and voting asked a reader who looked signed in to sign in
// (September 2026). The adapter still stores the session under the old key,
// so no reader is signed out of the extension by the rename.
const local = extensionStorage()?.local;
const EXTENSION_AUTH_KEY = "sb-cn-extension-auth-token";
const STORED_AUTH_KEY = `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
const storedKey = (key: string) => key.replace(EXTENSION_AUTH_KEY, STORED_AUTH_KEY);
// After the extension is reloaded or updated, a content script left running in
// an open tab can no longer reach the extension's storage, and every read
// throws "Extension context invalidated". supabase-js reads the session again
// each time the tab becomes visible, and it logs that failure, which Chrome
// then lists among the extension's errors. Such a script is orphaned and will
// never work again, so it reads no session and stays quiet. Chrome takes the
// extension's id away from an orphaned script, which is how we tell.
const isOrphaned = () => {
  const g = globalThis as { browser?: { runtime?: { id?: string } }; chrome?: { runtime?: { id?: string } } };
  return !(g.browser?.runtime?.id ?? g.chrome?.runtime?.id);
};
async function readSession(area: NonNullable<typeof local>, key: string): Promise<string | null> {
  try {
    return ((await area.get(storedKey(key)))[storedKey(key)] as string | undefined) ?? null;
  } catch (err) {
    if (isOrphaned()) return null;
    throw err;
  }
}
const sessionStorageAdapter = local
  ? {
      getItem: (key: string) => readSession(local, key),
      setItem: (key: string, value: string) => local.set({ [storedKey(key)]: value }),
      removeItem: (key: string) => local.remove(storedKey(key)),
    }
  : null;

// auth-js uses navigator.locks for its session lock whenever that API is
// present. In a Firefox content script `navigator` is an Xray wrapper around the
// host page's own navigator. Its lock manager hands back a Promise belonging to
// the page's compartment, and the sandbox is not allowed to read that Promise's
// `then`. The resulting "Permission denied to access property 'then'" killed
// every query. A pass-through lock skips the API entirely. The only thing left
// unguarded is then a rare pair of concurrent on-demand token refreshes, and
// GoTrue's refresh-token reuse window absorbs that.
const passthroughLock = <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) => fn();

// Every request goes through fetchWithRetries. A read that hits a network blip
// or a server error is tried again a few times, while a write goes out once.
// A select is a GET request and a database function call is a POST, so a
// function call is never retried here, even one that only reads. The cast is
// needed because Bun's type of fetch has a preconnect method that no browser's
// fetch has.
export const supabase = createClient<Database>(url, anonKey, {
  global: { fetch: fetchWithRetries as typeof fetch },
  ...(sessionStorageAdapter && {
    auth: { storage: sessionStorageAdapter, storageKey: EXTENSION_AUTH_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, lock: passthroughLock },
  }),
});
