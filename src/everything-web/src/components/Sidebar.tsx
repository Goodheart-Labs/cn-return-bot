import type { Session } from "@supabase/supabase-js";
import type { ProjectRow } from "../lib/types";

const DESCRIPTION =
  "Common Notes is an attempt to bring Community Notes everywhere — podcasts, newsletters, and beyond. …";

function AuthFooter({ session, onSignIn, onSignOut }: {
  session: Session | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  if (!session) {
    return (
      <button onClick={onSignIn} className="text-sm text-blue-600 hover:underline">
        Sign in to vote
      </button>
    );
  }
  const who = session.user.email ?? session.user.user_metadata?.user_name ?? "signed in";
  return (
    <div className="text-sm text-gray-500 space-y-1">
      <div className="truncate" title={who}>Signed in as {who}</div>
      <button onClick={onSignOut} className="text-blue-600 hover:underline">Sign out</button>
    </div>
  );
}

export function Sidebar({ projects, selectedId, onSelect, session, onSignIn, onSignOut }: {
  projects: ProjectRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  session: Session | null;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  return (
    <aside className="w-full md:w-64 md:shrink-0 md:h-screen md:sticky md:top-0 border-b md:border-b-0 md:border-r border-gray-200 p-6 flex flex-col gap-6">
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Common Notes</h1>
        <p className="text-sm text-gray-500 leading-relaxed">{DESCRIPTION}</p>
      </div>

      <nav className="flex flex-col gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">Projects</div>
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`text-left text-sm underline underline-offset-2 hover:text-blue-600 ${
              p.id === selectedId ? "text-blue-600 font-medium" : "text-gray-700"
            }`}
          >
            {p.name}
          </button>
        ))}
      </nav>

      <div className="mt-auto pt-4 border-t border-gray-100">
        <AuthFooter session={session} onSignIn={onSignIn} onSignOut={onSignOut} />
      </div>
    </aside>
  );
}
