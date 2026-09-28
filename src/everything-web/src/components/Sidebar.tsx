import type { FeedProjectRow } from "@cn/core/types";
import { eyebrowVariants } from "@cn/ui/typography";

const DESCRIPTION =
  "Common Notes is an attempt to bring Community Notes everywhere: podcasts, newsletters, and beyond. This is in alpha, but voting works.";

export function Sidebar({ projects, selectedId, onSelect, leaderboardSelected, onSelectLeaderboard }: {
  projects: FeedProjectRow[];
  selectedId: string | null;
  onSelect: (slug: string) => void;
  leaderboardSelected: boolean;
  onSelectLeaderboard: () => void;
}) {
  return (
    <aside className="w-full md:w-64 md:shrink-0 md:h-screen md:sticky md:top-0 border-b md:border-b-0 md:border-r border-line p-6 flex flex-col gap-6">
      <div className="space-y-3">
        <h1 className="text-xl font-extrabold">Common Notes</h1>
        <p className="text-sm text-fg-muted leading-relaxed">{DESCRIPTION}</p>
      </div>

      {/* On wide screens the sidebar is exactly one screen tall and stays put
          while the feed scrolls, so the project list scrolls on its own.
          Without that, every project past the bottom edge was unreachable. */}
      <nav className="flex flex-col gap-2 md:min-h-0 md:flex-1">
        <div className={eyebrowVariants()}>Projects</div>
        <div className="flex flex-col gap-2 md:min-h-0 md:overflow-y-auto">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.slug)}
              className={`shrink-0 text-left text-sm hover:underline hover:text-link ${
                p.id === selectedId ? "text-link font-medium" : "text-fg-secondary"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </nav>

      <nav className="flex flex-col gap-2">
        <button
          onClick={onSelectLeaderboard}
          className={`text-left text-sm hover:underline hover:text-link ${
            leaderboardSelected ? "text-link font-medium" : "text-fg-secondary"
          }`}
        >
          Rating leaderboard
        </button>
      </nav>
    </aside>
  );
}
