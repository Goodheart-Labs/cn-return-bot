import { isAuthRetryableFetchError, type AuthChangeEvent, type Session, type User } from "@supabase/supabase-js";
import { extensionStorage, readBrowserFlag, setBrowserFlag } from "./extensionStorage";
import { supabase } from "./supabase";

/* Whether a real account has ever signed in on this browser. Once it has,
 * signing out and voting again must not mint a fresh anonymous account: that
 * loop would let one person vote on the same note as often as they can click
 * sign-out. A browser that has signed in before therefore has to sign in to
 * act. Clearing site data resets the flag, which we accept: that same wipe
 * defeats every client-side identity anyway. The extension keeps the flag in
 * extension storage (shared by its popup, overlays, and background); the
 * website keeps it in localStorage. */
const SIGNED_IN_BEFORE_KEY = "cn:signedInBefore";

export const getSignedInBefore = () => readBrowserFlag(SIGNED_IN_BEFORE_KEY, "local");

/** Stamps the browser as having held a real account whenever one is seen.
 *  The session store below calls this on every session it observes, which
 *  covers code verifies, OAuth returns, and restored sessions on later
 *  visits. */
function noteRealSession(session: Session | null): void {
  if (session && !session.user.is_anonymous) setBrowserFlag(SIGNED_IN_BEFORE_KEY, "local");
}

/** The current session, as one store per JavaScript context. `ready` turns
 *  true once the stored session has been read. `event` is the last auth
 *  transition, which lets a consumer tell an actual SIGNED_IN apart from
 *  INITIAL_SESSION, a returning user's persisted session on page load. */
export interface SessionState {
  session: Session | null;
  ready: boolean;
  event: AuthChangeEvent | null;
}

let sessionState: SessionState = { session: null, ready: false, event: null };
const sessionListeners = new Set<() => void>();
let watchingSession = false;

function publishSession(next: Partial<SessionState>, label: string) {
  sessionState = { ...sessionState, ...next };
  noteRealSession(sessionState.session);
  // These diagnostics are for the extension only. The website's console stays
  // clean.
  if (extensionStorage()) {
    const s = sessionState.session;
    console.debug(`[common-notes] session (${label}): ${s ? s.user.email ?? s.user.id : "none"}`);
  }
  sessionListeners.forEach((listener) => listener());
}

/** Starts following the session the first time anyone subscribes. The popup,
 *  the content scripts and the background each run their own supabase-js
 *  instance, and all of them share one session in chrome.storage.local.
 *  onAuthStateChange only fires in the context that made the change, so the
 *  shared storage is watched as well, and a login in the popup then reaches
 *  every open page. */
function watchSession() {
  watchingSession = true;
  void supabase.auth.getSession().then(({ data, error }) => {
    publishSession({ session: data.session, ready: true }, "mount");
    if (error) console.debug(`[common-notes] getSession error: ${error.message}`);
  });
  supabase.auth.onAuthStateChange((event, session) => publishSession({ session, event }, `event ${event}`));
  extensionStorage()?.onChanged.addListener((changes, area) => {
    const authKeyChanged = Object.keys(changes).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    if (area !== "local" || !authKeyChanged) return;
    void supabase.auth.getSession().then(({ data }) => publishSession({ session: data.session }, "storage change"));
  });
}

/** Subscribes to session changes, in the shape React's useSyncExternalStore
 *  expects. The returned function unsubscribes. */
export function subscribeToSession(listener: () => void): () => void {
  if (!watchingSession) watchSession();
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

export const currentSessionState = (): SessionState => sessionState;

/** The signed-in user, read from the stored session, or null. Reading it this
 *  way refreshes an expired token on demand, which the extension relies on
 *  because its service worker keeps no timers. */
export async function signedInUser(): Promise<User | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

/** How long to wait before asking again when a sign-in could not be renewed
 *  because the server did not answer. */
const RENEWAL_RETRY_DELAYS_MS = [500, 2_000];

/** Thrown when a stored sign-in exists but could not be renewed because the
 *  server did not answer. The reader is still signed in, so this must never
 *  lead to the sign-in form. */
export class SignInUnreachableError extends Error {
  constructor() {
    super("could not renew the sign-in: the server did not answer");
  }
}

/** The signed-in user, like signedInUser, for a reader who is about to act.
 *  An expired access token is renewed inside getSession. When that renewal
 *  fails because the server did not answer, supabase-js keeps the stored
 *  sign-in, so the page still shows the reader as signed in, but answers
 *  this one call with no session. Treating that as signed out opened the
 *  sign-in form for a signed-in reader. So the renewal is tried again twice,
 *  and if the server still does not answer this throws instead. */
async function userForAction(): Promise<User | null> {
  for (const delay of [0, ...RENEWAL_RETRY_DELAYS_MS]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    const { data, error } = await supabase.auth.getSession();
    if (!isAuthRetryableFetchError(error)) return data.session?.user ?? null;
  }
  throw new SignInUnreachableError();
}

/** Returns the signed-in user, creating an invisible anonymous account when
 *  there is none. Voting and writing notes call this instead of demanding a
 *  sign-in, so a reader can act right away. The anonymous account lives in
 *  this browser's stored session like any other, and a later email or X
 *  sign-in upgrades it in place, keeping the votes and notes. Returns null
 *  when no account may be minted: the browser has signed in before (see
 *  SIGNED_IN_BEFORE_KEY) or the backend refuses; the caller then falls back
 *  to the sign-in form. Throws SignInUnreachableError when a stored sign-in
 *  could not be renewed. */
export async function ensureUser(): Promise<User | null> {
  const user = await userForAction();
  if (user) return user;
  if (await getSignedInBefore()) {
    console.info("[common-notes] not minting an anonymous account: this browser has signed in before");
    return null;
  }
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

/** Starts X sign-in. With an anonymous session held, the X identity is linked
 *  onto that account instead, which keeps its votes and notes. Linking fails
 *  before the redirect when manual linking is disabled on the backend; we fall
 *  back to the ordinary sign-in then. An X identity that already belongs to
 *  another account fails after the redirect, and the reader simply stays
 *  anonymous and can try again. */
async function startXSignIn(options: { redirectTo: string; skipBrowserRedirect?: boolean }) {
  if ((await signedInUser())?.is_anonymous) {
    const linked = await supabase.auth.linkIdentity({ provider: "twitter", options });
    if (!linked.error) return linked;
    console.warn(`[common-notes] X identity link failed, falling back to sign-in: ${linked.error.message}`);
  }
  return supabase.auth.signInWithOAuth({ provider: "twitter", options });
}

/** The website's X sign-in. The browser leaves for X and comes back to the
 *  page it left, which must be on the project's redirect allow-list. */
export const signInWithTwitter = () => startXSignIn({ redirectTo: window.location.href });

/** The extension's X sign-in, run from the background script. Supabase builds
 *  the provider URL but does not open it, because `skipBrowserRedirect` is set.
 *  `openPopup` runs the OAuth exchange in a popup window; in the extension that
 *  is launchWebAuthFlow. This is the implicit flow, so the tokens come back in
 *  the hash of the redirect URL, and we hand them to setSession. `redirectTo`
 *  must be on the Supabase redirect allow-list. */
export async function signInWithTwitterInPopup(
  redirectTo: string,
  openPopup: (url: string) => Promise<string | undefined>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await startXSignIn({ redirectTo, skipBrowserRedirect: true });
    if (error || !data?.url) return { ok: false, error: error?.message ?? "could not start OAuth" };
    const resultUrl = await openPopup(data.url);
    if (!resultUrl) return { ok: false, error: "sign-in window closed" };
    const params = new URLSearchParams(new URL(resultUrl).hash.slice(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (!access_token || !refresh_token) {
      return { ok: false, error: params.get("error_description") ?? "no tokens in OAuth redirect" };
    }
    const { error: sessionError } = await supabase.auth.setSession({ access_token, refresh_token });
    return sessionError ? { ok: false, error: sessionError.message } : { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function signOut() {
  return supabase.auth.signOut();
}
