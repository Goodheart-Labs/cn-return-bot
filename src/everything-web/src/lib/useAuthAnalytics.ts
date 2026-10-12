import { useEffect, useRef } from "react";
import { identifyUser, resetAnalytics, track } from "@cn/core/analytics";
import { useSession } from "@cn/features/auth/useSession";

/** Ties analytics events to the signed-in account and counts real sign-ins.
 *
 *  Once the user signs in, events carry their account, and the link is dropped
 *  again when they sign out. Only a real sign-out resets. The session is also
 *  null on every anonymous page load and briefly on a signed-in reload, and
 *  resetting then would mint a fresh anonymous id each time. That would
 *  inflate the visitor count and break the merge of a visitor's anonymous
 *  history into their account. An anonymous session is not a signed-in user
 *  either: attaching analytics to it would count every voter as signed in. */
export function useAuthAnalytics() {
  const { session, event } = useSession();
  const userId = session?.user.id;
  const anonymous = !!session?.user.is_anonymous;
  const provider = session?.user.app_metadata?.provider;
  const signedInFor = useRef<string | null>(null);
  const identifiedAs = useRef<string | null>(null);
  const wasAnonymous = useRef(false);

  // `anonymous` is a dependency because the email upgrade of an anonymous
  // account keeps the user id and only flips that flag.
  useEffect(() => {
    if (userId && !anonymous) {
      identifiedAs.current = userId;
      identifyUser(userId, { auth_provider: provider });
    } else if (identifiedAs.current) {
      identifiedAs.current = null;
      resetAnalytics();
      signedInFor.current = null; // Let a later sign-in count as a fresh one.
    }
  }, [userId, anonymous, provider]);

  // This is the sign-in step of the funnel. SIGNED_IN fires on a real sign-in,
  // meaning an email code or a return from OAuth. A returning user's restored
  // session arrives as INITIAL_SESSION and does not count. The silent
  // anonymous sign-in also arrives as SIGNED_IN and is not the funnel's step,
  // while the email upgrade of an anonymous account arrives as USER_UPDATED on
  // the same user id, so that flip counts. The per-user guard drops the
  // duplicate SIGNED_IN that supabase-js emits when the tab regains focus.
  useEffect(() => {
    const signedIn = event === "SIGNED_IN" || (event === "USER_UPDATED" && wasAnonymous.current);
    if (signedIn && userId && !anonymous && signedInFor.current !== userId) {
      signedInFor.current = userId;
      track("signed_in", { provider });
    }
    wasAnonymous.current = anonymous;
  }, [event, userId, anonymous, provider]);
}
