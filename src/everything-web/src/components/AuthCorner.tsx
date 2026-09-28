import { signOut } from "@cn/core/auth";
import { useSession } from "@cn/features/auth/useSession";
import { BUTTON, LINK } from "@cn/ui/classes";

/** The sign-in button, or the signed-in reader's name with a sign-out link.
 *  An anonymous session is invisible to the reader: it exists only so their
 *  votes have an account to live on. The corner keeps offering the real
 *  sign-in for it, which upgrades that account in place. */
export function AuthCorner({ onSignIn }: { onSignIn: () => void }) {
  const { session } = useSession();
  if (!session || session.user.is_anonymous) {
    return (
      <button onClick={onSignIn} className={`${BUTTON} shrink-0`}>
        Sign in
      </button>
    );
  }
  const who = session.user.email ?? session.user.user_metadata?.user_name ?? "signed in";
  return (
    <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-3 shrink-0 min-w-0">
      <span className="truncate max-w-[16rem]" title={who}>{who}</span>
      <button onClick={() => void signOut()} className={LINK}>Sign out</button>
    </div>
  );
}
