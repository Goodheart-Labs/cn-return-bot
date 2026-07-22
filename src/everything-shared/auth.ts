import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export function useSession(): { session: Session | null; ready: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Extension contexts (popup, content scripts, background) each run their
    // own supabase-js instance over one chrome.storage.local session, and
    // onAuthStateChange only fires in the context that changed it — watch the
    // shared storage so a login in the popup reaches every open page.
    const ext = (globalThis as unknown as { browser?: any; chrome?: any }).browser?.storage
      ?? (globalThis as unknown as { chrome?: any }).chrome?.storage;
    const logSession = (label: string, s: Session | null) => {
      if (!ext) return; // extension-only diagnostics; keep the website console clean
      console.debug(`[common-notes] session (${label}): ${s ? s.user.email ?? s.user.id : "none"}`);
    };

    supabase.auth.getSession().then(({ data, error }) => {
      setSession(data.session);
      setReady(true);
      logSession("mount", data.session);
      if (error) console.debug(`[common-notes] getSession error: ${error.message}`);
    });
    // What the shared storage itself holds, independent of supabase-js's view.
    ext?.local?.get?.(null)?.then((all: Record<string, unknown>) => {
      const key = Object.keys(all).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
      console.debug(`[common-notes] auth storage: ${key ? "present" : "absent"}`);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      logSession(`event ${event}`, s);
    });

    const onStorageChanged = (changes: Record<string, unknown>, area: string) => {
      const authKeyChanged = Object.keys(changes).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
      if (area === "local" && authKeyChanged) {
        supabase.auth.getSession().then(({ data }) => {
          setSession(data.session);
          logSession("storage change", data.session);
        });
      }
    };
    ext?.onChanged?.addListener(onStorageChanged);

    return () => {
      sub.subscription.unsubscribe();
      ext?.onChanged?.removeListener(onStorageChanged);
    };
  }, []);

  return { session, ready };
}

/** Send a magic link; the user returns to this same page signed in. */
export function signInWithEmail(email: string) {
  return supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href } });
}

/** Extension email sign-in, step 1: the same email as the magic link also
 *  carries a 6-digit code ({{ .Token }} in the template) — no redirect needed. */
export function signInWithEmailCode(email: string) {
  return supabase.auth.signInWithOtp({ email });
}

/** Extension email sign-in, step 2: verify the typed code. */
export function verifyEmailCode(email: string, code: string) {
  return supabase.auth.verifyOtp({ email, token: code, type: "email" });
}

export function signInWithTwitter() {
  return supabase.auth.signInWithOAuth({ provider: "twitter", options: { redirectTo: window.location.href } });
}

export function signOut() {
  return supabase.auth.signOut();
}
