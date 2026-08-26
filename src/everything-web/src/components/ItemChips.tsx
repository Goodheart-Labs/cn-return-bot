import type { FeedItemRow } from "../../../everything-shared/types";
import { CHIP } from "../../../everything-shared/ui";

/** Filter chips for a project's items, which are its episodes, posts or pages.
 *  They show only when the project has more than one item with notes. The "All"
 *  chip restores the unfiltered feed. */
export function ItemChips({ items, noteCounts, selected, onSelect }: {
  items: FeedItemRow[];
  noteCounts: Map<string, number>;
  selected: string | null;
  onSelect: (itemId: string | null) => void;
}) {
  if (items.length < 2) return null;
  const chipClass = (active: boolean) =>
    `${CHIP} shrink-0 transition-colors ${
      active
        ? "bg-blue-600 border-blue-600 text-white"
        : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400"
    }`;
  return (
    <div className="flex gap-2 mb-6 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button className={chipClass(selected === null)} onClick={() => onSelect(null)}>
        All
      </button>
      {items.map((item) => (
        <button
          key={item.id}
          className={chipClass(selected === item.id)}
          onClick={() => onSelect(selected === item.id ? null : item.id)}
          title={item.title ?? item.url}
        >
          {item.title ?? "Untitled"}
          <span className={selected === item.id ? "text-blue-200" : "text-gray-400 dark:text-gray-500"}>
            {noteCounts.get(item.id) ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}
