import type { Session } from "@supabase/supabase-js";

/** Picks the best public-facing name for the signed-in user. It prefers their X
 *  handle, then their full name, then the part of their email address before the
 *  @ sign. The full email address is never shown. */
export function displayName(session: Session): string {
  const meta = session.user.user_metadata ?? {};
  return meta.user_name ?? meta.full_name ?? session.user.email?.split("@")[0] ?? "anonymous";
}
