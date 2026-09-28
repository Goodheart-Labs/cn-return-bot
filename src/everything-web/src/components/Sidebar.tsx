import type { FeedProjectRow } from "@cn/core/types";
import { eyebrowVariants } from "@cn/ui/typography";

export function Sidebar({ projects, selectedId, onSelect, leaderboardSelected, onSelectLeaderboard }: {
  projects: FeedProjectRow[];
  selectedId: string | null;
  onSelect: (slug: string) => void;
  leaderboardSelected: boolean;
  onSelectLeaderboard: () => void;
}) {
  return (
    // 3.5rem is the height of the site header, which stays on top of the page.
    <aside className="w-full md:w-64 md:shrink-0 md:h-[calc(100vh-3.5rem)] md:sticky md:top-14 border-b md:border-b-0 md:border-r border-line p-6 flex flex-col gap-6">
      {/* On wide screens the sidebar fills the screen below the header and stays put
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
