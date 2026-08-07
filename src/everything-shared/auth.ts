import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export function useSession(): { session: Session | null; ready: boolean } {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // The popup, the content scripts and the background each run their own
    // supabase-js instance, and all of them share one session in
    // chrome.storage.local. onAuthStateChange only fires in the context that made
    // the change. So we also watch the shared storage, and a login in the popup then
    // reaches every open page.
    const ext = (globalThis as unknown as { browser?: any; chrome?: any }).browser?.storage
      ?? (globalThis as unknown as { chrome?: any }).chrome?.storage;
    const logSession = (label: string, s: Session | null) => {
      if (!ext) return; // These diagnostics are for the extension only. The website's console stays clean.
      console.debug(`[common-notes] session (${label}): ${s ? s.user.email ?? s.user.id : "none"}`);
    };

    supabase.auth.getSession().then(({ data, error }) => {
      setSession(data.session);
      setReady(true);
      logSession("mount", data.session);
      if (error) console.debug(`[common-notes] getSession error: ${error.message}`);
    });
    // This logs what the shared storage itself holds. It can differ from what
    // supabase-js believes the session to be.
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

/** The length of the one-time code Supabase sends by email. Local development
 *  mirrors it in config.toml under auth.email.otp_length. */
export const EMAIL_OTP_LENGTH = 8;

/** Step one of email sign-in, used by both the website and the extension. The email
 *  carries an 8-digit code, which the templates render as {{ .Token }}. There is no
 *  magic link. That means email sign-in never touches the redirect allow-list, and
 *  the code can be typed on a different device. */
export function signInWithEmailCode(email: string) {
  return supabase.auth.signInWithOtp({ email });
}

/** Step two of email sign-in. It verifies the code the user typed. */
export function verifyEmailCode(email: string, code: string) {
  return supabase.auth.verifyOtp({ email, token: code, type: "email" });
}

export function signInWithTwitter() {
  return supabase.auth.signInWithOAuth({ provider: "twitter", options: { redirectTo: window.location.href } });
}

export function signOut() {
  return supabase.auth.signOut();
}
