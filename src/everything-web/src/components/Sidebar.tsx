import type { ProjectRow } from "../../../everything-shared/types";

const DESCRIPTION =
  "Common Notes is an attempt to bring Community Notes everywhere: podcasts, newsletters, and beyond. This is in alpha, but voting works.";

export function Sidebar({ projects, selectedId, onSelect }: {
  projects: ProjectRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <aside className="w-full md:w-64 md:shrink-0 md:h-screen md:sticky md:top-0 border-b md:border-b-0 md:border-r border-gray-200 p-6 flex flex-col gap-6">
      <div className="space-y-3">
        <h1 className="text-xl font-extrabold">Common Notes</h1>
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
    </aside>
  );
}
