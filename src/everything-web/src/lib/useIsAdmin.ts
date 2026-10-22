import { useQuery } from "@tanstack/react-query";
import { fetchIsAdmin } from "@cn/core/minisites";
import { useSession } from "@cn/features/auth/useSession";

/** Whether the signed-in reader is an admin, or "loading" while the session or
 *  the answer is still on its way. Hiding admin pages and buttons is only
 *  cosmetic: the database refuses every admin read and write from anyone
 *  else. */
export function useAdminStatus(): "loading" | "admin" | "not_admin" {
  const { session, ready } = useSession();
  const signedIn = !!session && !session.user.is_anonymous;
  const query = useQuery({ queryKey: ["isAdmin", session?.user.id], queryFn: fetchIsAdmin, enabled: signedIn });
  if (!ready || (signedIn && query.isPending)) return "loading";
  return signedIn && query.data === true ? "admin" : "not_admin";
}

export const useIsAdmin = (): boolean => useAdminStatus() === "admin";
