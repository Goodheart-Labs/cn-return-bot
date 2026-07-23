import type { Session } from "@supabase/supabase-js";

/** Best public-facing name for the signed-in user (X handle, name, or email
 *  local part — never the full email). */
export function displayName(session: Session): string {
  const meta = session.user.user_metadata ?? {};
  return meta.user_name ?? meta.full_name ?? session.user.email?.split("@")[0] ?? "anonymous";
}
