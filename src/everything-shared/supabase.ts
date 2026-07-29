import { createClient } from "@supabase/supabase-js";

// The anon key is public by design — it's baked into the static site and the
// extension. What the anon role can actually do is locked down in migration
// 050: read the everything_* tables and cast votes (auth + RLS), nothing else.
const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error("Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (root .env for local dev)");
}

// In the browser extension every context (popup, background, content scripts)
// shares one session via chrome.storage.local — a content script's
// localStorage belongs to the HOST PAGE, so the default storage would scatter
// sessions across visited sites. autoRefreshToken is off because the MV3
// service worker's timers die with it; supabase-js refreshes an expired
// session on demand inside getSession(), which every authed call goes through.
// `browser.*` first (Firefox's promise API; Chrome lacks the global), then
// `chrome.*` (promise-based in MV3). On a plain web page neither exposes
// .storage, so the web app keeps supabase-js's default localStorage.
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

// auth-js defaults its session lock to navigator.locks when present. In a
// Firefox content script `navigator` is an Xray to the HOST PAGE's, and the
// lock manager hands back a page-compartment Promise whose `then` the sandbox
// is denied ("Permission denied to access property 'then'") — killing every
// query. A pass-through lock skips the API; the only thing left unguarded is
// a rare concurrent on-demand token refresh, which GoTrue's refresh-token
// reuse window absorbs.
const passthroughLock = <R>(_name: string, _acquireTimeout: number, fn: () => Promise<R>) => fn();

export const supabase = createClient(url, anonKey, extensionStorage
  ? { auth: { storage: extensionStorage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, lock: passthroughLock } }
  : undefined);
