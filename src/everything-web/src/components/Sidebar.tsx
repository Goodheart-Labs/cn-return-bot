import type { FeedProjectRow } from "../../../everything-shared/types";
import type { View } from "../lib/routing";
import { EYEBROW } from "../../../everything-shared/ui";

const DESCRIPTION =
  "Common Notes is an attempt to bring Community Notes everywhere: podcasts, newsletters, and beyond. This is in alpha, but voting works.";

export function Sidebar({ projects, selectedId, view, onSelect, onSelectLeaderboard }: {
  projects: FeedProjectRow[];
  selectedId: string | null;
  view: View;
  onSelect: (id: string) => void;
  onSelectLeaderboard: () => void;
}) {
  return (
    <aside className="w-full md:w-64 md:shrink-0 md:h-screen md:sticky md:top-0 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-800 p-6 flex flex-col gap-6">
      <div className="space-y-3">
        <h1 className="text-xl font-extrabold">Common Notes</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{DESCRIPTION}</p>
      </div>

      <nav className="flex flex-col gap-2">
        <div className={EYEBROW}>Projects</div>
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className={`text-left text-sm hover:underline hover:text-blue-600 dark:hover:text-blue-400 ${
              p.id === selectedId && view === "notes" ? "text-blue-600 dark:text-blue-400 font-medium" : "text-gray-700 dark:text-gray-300"
            }`}
          >
            {p.name}
          </button>
        ))}
      </nav>

      <nav className="flex flex-col gap-2">
        <button
          onClick={onSelectLeaderboard}
          className={`text-left text-sm hover:underline hover:text-blue-600 dark:hover:text-blue-400 ${
            view === "leaderboard" ? "text-blue-600 dark:text-blue-400 font-medium" : "text-gray-700 dark:text-gray-300"
          }`}
        >
          Rating leaderboard
        </button>
      </nav>
    </aside>
  );
}
