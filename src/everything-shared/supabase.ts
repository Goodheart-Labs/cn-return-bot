import { createClient } from "@supabase/supabase-js";

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
// getSession(), and every authenticated call goes through that.
// We look for `browser` first, which is Firefox's promise-based API and does not
// exist in Chrome, and then for `chrome`, which is promise-based under MV3. On a
// plain web page neither of them exposes .storage, so the web app keeps
// supabase-js's own default of localStorage.
const extApi = (globalThis as unknown as { browser?: any; chrome?: any }).browser
  ?? (globalThis as unknown as { chrome?: any }).chrome;
const local = extApi?.storage?.local;
const extensionStorage = local
  ? {
      getItem: async (key: string) => (await local.get(key))[key] ?? null,
      setItem: async (key: string, value: string) => { await local.set({ [key]: value }); },
      removeItem: async (key: string) => { await local.remove(key); },
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

export const supabase = createClient(url, anonKey, extensionStorage
  ? { auth: { storage: extensionStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, lock: passthroughLock } }
  : undefined);
