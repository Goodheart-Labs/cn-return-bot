import { supabase } from "./supabase";

/** The longest email address the database accepts (migration 161). */
export const MAX_EMAIL_LENGTH = 254;

/** Puts an address on the list of people who get one email when the Safari
 *  extension is out (migration 161). An address that is already on the list
 *  succeeds too, so the caller cannot tell whether it was there before. */
export async function joinSafariWaitlist(email: string): Promise<void> {
  const { error } = await supabase.rpc("everything_join_safari_waitlist", { p_email: email });
  if (error) throw new Error(error.message);
}
