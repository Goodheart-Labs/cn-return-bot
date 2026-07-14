import type { ItemRow } from "../lib/types";

/** Filter chips for a project's episodes — shown only when the project has
 *  more than one episode with notes. "All" restores the unfiltered feed. */
export function EpisodeChips({ episodes, noteCounts, selected, onSelect }: {
  episodes: ItemRow[];
  noteCounts: Map<string, number>;
  selected: string | null;
  onSelect: (itemId: string | null) => void;
}) {
  if (episodes.length < 2) return null;
  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm shrink-0 transition-colors ${
      active
        ? "bg-blue-600 border-blue-600 text-white"
        : "border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600"
    }`;
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      <button className={chipClass(selected === null)} onClick={() => onSelect(null)}>
        All
      </button>
      {episodes.map((ep) => (
        <button
          key={ep.id}
          className={chipClass(selected === ep.id)}
          onClick={() => onSelect(selected === ep.id ? null : ep.id)}
          title={ep.title ?? ep.url}
        >
          {ep.title ?? "Untitled"}
          <span className={selected === ep.id ? "ml-1.5 text-blue-200" : "ml-1.5 text-gray-400"}>
            {noteCounts.get(ep.id) ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}
