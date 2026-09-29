import type { User } from "@supabase/supabase-js";
import { ensureUser } from "@cn/core/auth";
import { useLoginPrompt } from "./loginPrompt";

/** Returns a function that resolves the account an action runs as. A reader
 *  without an account gets an invisible anonymous one, so voting and writing
 *  just work. When that is refused, the surface's sign-in form opens and the
 *  function resolves to null. When the reader's sign-in could not be renewed
 *  because the server did not answer, it throws SignInUnreachableError and
 *  opens nothing: the reader is signed in, and the action simply failed. */
export function useActingUser(): () => Promise<User | null> {
  const openLogin = useLoginPrompt();
  return async () => {
    const user = await ensureUser();
    if (!user) openLogin();
    return user;
  };
}
