import type { ReactNode } from "react";
import { useAdminStatus } from "../lib/useIsAdmin";

/** An admin page's content, which shows only to admins. While the answer
 *  loads it says so, and anyone else gets a short message instead. Hiding the
 *  page is only cosmetic: the database refuses every admin read and write
 *  from anyone else. */
export function AdminOnly({ children }: { children: ReactNode }) {
  const status = useAdminStatus();
  if (status === "loading") return <p className="px-8 py-10 text-sm text-fg-muted">Loading…</p>;
  if (status === "not_admin") {
    return <p className="mx-auto max-w-xl px-4 py-10 text-sm text-fg-secondary">This page is for admins. Sign in with an admin account to see it.</p>;
  }
  return children;
}
