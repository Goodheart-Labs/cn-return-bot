import type { ItemRow } from "../../../everything-shared/types";

/** Filter chips for a project's items, which are its episodes, posts or pages.
 *  They show only when the project has more than one item with notes. The "All"
 *  chip restores the unfiltered feed. */
export function ItemChips({ items, noteCounts, selected, onSelect }: {
  items: ItemRow[];
  noteCounts: Map<string, number>;
  selected: string | null;
  onSelect: (itemId: string | null) => void;
}) {
  if (items.length < 2) return null;
  const chipClass = (active: boolean) =>
    `rounded-full border px-3 py-1 text-sm shrink-0 transition-colors ${
      active
        ? "bg-blue-600 border-blue-600 text-white"
        : "border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600"
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
          <span className={selected === item.id ? "ml-1.5 text-blue-200" : "ml-1.5 text-gray-400"}>
            {noteCounts.get(item.id) ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}
