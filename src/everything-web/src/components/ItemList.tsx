import type { FeedItemRow } from "@cn/core/types";
import { cn } from "@cn/ui/cn";
import type { Route } from "../lib/routing";
import { RouteLink } from "./RouteLink";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const itemDate = (item: FeedItemRow) => DATE.format(new Date(item.published_at ?? item.created_at));
const noteCount = (n: number) => `${n} ${n === 1 ? "note" : "notes"}`;

/** A project's items, the posts, videos and pages it has notes on, with "All"
 *  first. The items come newest first. Each entry is a link, so one item's
 *  feed can be shared. */
export function ItemList({ projectSlug, items, noteCounts, selected, navigate }: {
  projectSlug: string;
  items: FeedItemRow[];
  noteCounts: ReadonlyMap<string, number>;
  selected: string | null;
  navigate: (route: Route) => void;
}) {
  const total = [...noteCounts.values()].reduce((sum, n) => sum + n, 0);
  const entry = (active: boolean) =>
    cn(
      "block rounded-control px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
      active ? "bg-tint text-fg" : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
    );
  return (
    <nav aria-label="Posts and videos">
      <ul className="space-y-0.5">
        <li>
          <RouteLink to={{ view: "notes", project: projectSlug, item: null, note: null }} navigate={navigate} current={selected === null} className={entry(selected === null)}>
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">All</span>
              <span className="text-xs text-fg-muted">{noteCount(total)}</span>
            </span>
          </RouteLink>
        </li>
        {items.map((item) => (
          <li key={item.id}>
            <RouteLink
              to={{ view: "notes", project: projectSlug, item: item.id, note: null }}
              navigate={navigate}
              current={selected === item.id}
              className={entry(selected === item.id)}
            >
              <span className={cn("line-clamp-3 text-sm leading-snug", selected === item.id && "font-medium")}>{item.title ?? "Untitled"}</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                {itemDate(item)} · {noteCount(noteCounts.get(item.id) ?? 0)}
              </span>
            </RouteLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
