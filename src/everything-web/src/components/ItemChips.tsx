import type { FeedItemRow } from "@cn/core/types";
import { chipVariants } from "@cn/ui/Chip";
import { cn } from "@cn/ui/cn";

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
    cn(
      chipVariants(),
      "shrink-0",
      active ? "bg-primary border-primary text-on-primary" : "border-line-strong text-fg-secondary hover:border-focus hover:text-link",
    );
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
          <span className={selected === item.id ? "opacity-70" : "text-fg-subtle"}>
            {noteCounts.get(item.id) ?? 0}
          </span>
        </button>
      ))}
    </div>
  );
}
