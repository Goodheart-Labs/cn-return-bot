import { useQuery } from "@tanstack/react-query";
import { fetchIsAdmin } from "@cn/core/minisites";
import { useSession } from "@cn/features/auth/useSession";

/** Whether the signed-in reader is an admin. Hiding admin buttons is only
 *  cosmetic: the database refuses every admin write from anyone else. */
export function useIsAdmin(): boolean {
  const { session } = useSession();
  const signedIn = !!session && !session.user.is_anonymous;
  const query = useQuery({ queryKey: ["isAdmin", session?.user.id], queryFn: fetchIsAdmin, enabled: signedIn });
  return signedIn && query.data === true;
}
