import { useEffect, useState } from "react";
import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export function useSession(): { session: Session | null; ready: boolean; event: AuthChangeEvent | null } {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  // The last auth transition. Lets a consumer tell an actual SIGNED_IN apart
  // from INITIAL_SESSION (a returning user's persisted session on page load).
  const [event, setEvent] = useState<AuthChangeEvent | null>(null);

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
      setEvent(event);
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

  return { session, ready, event };
}

/** Returns the signed-in user, creating an invisible anonymous account when
 *  there is none. Voting and writing notes call this instead of demanding a
 *  sign-in, so a reader can act right away. The anonymous account lives in
 *  this browser's stored session like any other, and a later email or X
 *  sign-in upgrades it in place, keeping the votes and notes. Returns null
 *  when the backend refuses (anonymous sign-ins disabled, rate limit); the
 *  caller then falls back to the sign-in form. */
export async function ensureUser(): Promise<User | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.user;
  const { data: anon, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.warn(`[common-notes] anonymous sign-in failed: ${error.message}`);
    return null;
  }
  return anon.user;
}

/** The length of the one-time code Supabase sends by email. The prod value
 *  lives in the dashboard (Authentication → Email → OTP Length); local
 *  development mirrors it in config.toml under auth.email.otp_length. */
export const EMAIL_OTP_LENGTH = 6;

/** Which email flow a code belongs to. "signin" is the ordinary one-time-code
 *  sign-in. "upgrade" attaches the email to the current anonymous account, so
 *  the account and everything it did stay the same. The caller carries the
 *  flow from step one to step two, because the two flows verify their codes
 *  under different types. "done" means the upgrade already applied and there
 *  is no code to type; that happens on a backend with email confirmations
 *  turned off, such as local development. */
export type EmailFlow = "signin" | "upgrade" | "done";

/** Step one of email sign-in, used by both the website and the extension. The
 *  email carries a one-time code, which the templates render as {{ .Token }};
 *  there is no magic link, so email sign-in never touches the redirect
 *  allow-list and the code can be typed on a different device.
 *  With an anonymous session held, the email is attached to that account
 *  instead, which keeps its votes and notes. When the address already belongs
 *  to another account, that upgrade is impossible, and we fall back to the
 *  ordinary sign-in for it. */
export async function signInWithEmailCode(email: string): Promise<{ error: { message: string } | null; flow: EmailFlow }> {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.is_anonymous) {
    const { data: updated, error } = await supabase.auth.updateUser({ email });
    // A backend with confirmations off applies the change on the spot: the
    // user object already carries the email and no code is coming.
    if (!error && updated.user?.email === email) return { error: null, flow: "done" };
    if (!error) return { error: null, flow: "upgrade" };
    // Any failure to attach falls through to the ordinary sign-in. The
    // common case is an email that already has an account; signing into that
    // account is what its owner wants, even though the anonymous votes stay
    // behind.
    console.warn(`[common-notes] email upgrade failed, falling back to sign-in: ${error.message}`);
  }
  const { error } = await supabase.auth.signInWithOtp({ email });
  return { error, flow: "signin" };
}

/** Step two of email sign-in. It verifies the code the user typed, under the
 *  type belonging to the flow step one chose. */
export function verifyEmailCode(email: string, code: string, flow: EmailFlow = "signin") {
  return supabase.auth.verifyOtp({ email, token: code, type: flow === "upgrade" ? "email_change" : "email" });
}

/** X sign-in. With an anonymous session held, the X identity is linked onto
 *  that account instead, which keeps its votes and notes. Linking fails
 *  before the redirect when manual linking is disabled on the backend; we
 *  fall back to the ordinary sign-in then. An X identity that already
 *  belongs to another account fails after the redirect, and the reader
 *  simply stays anonymous and can try again. */
export async function signInWithTwitter() {
  const options = { redirectTo: window.location.href };
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.is_anonymous) {
    const { error } = await supabase.auth.linkIdentity({ provider: "twitter", options });
    if (!error) return { error: null };
    console.warn(`[common-notes] X identity link failed, falling back to sign-in: ${error.message}`);
  }
  return supabase.auth.signInWithOAuth({ provider: "twitter", options });
}

export function signOut() {
  return supabase.auth.signOut();
}
