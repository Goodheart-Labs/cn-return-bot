import { itemDate, type ProjectItemRow } from "@cn/core/items";
import { cn } from "@cn/ui/cn";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { PagedListEnd } from "@cn/features/query/PagedListEnd";
import type { PagedList } from "@cn/features/query/usePagedList";
import type { Route } from "../lib/routing";
import { RouteLink } from "./RouteLink";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

const noteCount = (n: number) => `${n} ${n === 1 ? "note" : "notes"}`;

/** A project's items, the posts, videos and pages it has notes on, with "All"
 *  first. The items come newest first and load a page at a time as the reader
 *  scrolls. Each entry is a link, so one item's feed can be shared. `total`
 *  counts the project's notes, once it has loaded. `onPick` runs when the
 *  reader follows a link. */
export function ItemList({ projectSlug, list, total, selected, navigate, onPick }: {
  projectSlug: string;
  list: PagedList<ProjectItemRow[]>;
  total: number | undefined;
  selected: string | null;
  navigate: (route: Route) => void;
  onPick?: () => void;
}) {
  const go = (route: Route) => {
    onPick?.();
    navigate(route);
  };
  const entry = (active: boolean) =>
    cn(
      "block rounded-control px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
      active ? "bg-tint text-fg" : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
    );
  return (
    <nav aria-label="Posts and videos">
      <ul className="space-y-0.5">
        <li>
          <RouteLink to={{ view: "notes", project: projectSlug, item: null, note: null }} navigate={go} current={selected === null} className={entry(selected === null)}>
            <span className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">All</span>
              {total !== undefined && <span className="text-xs text-fg-muted">{noteCount(total)}</span>}
            </span>
          </RouteLink>
        </li>
        {list.pages?.flat().map((item) => (
          <li key={item.id}>
            <RouteLink
              to={{ view: "notes", project: projectSlug, item: item.id, note: null }}
              navigate={go}
              current={selected === item.id}
              className={entry(selected === item.id)}
            >
              <span className={cn("line-clamp-3 text-sm leading-snug", selected === item.id && "font-medium")}>{item.title ?? "Untitled"}</span>
              <span className="mt-0.5 block text-xs text-fg-muted">
                {DATE.format(new Date(itemDate(item)))} · {noteCount(item.note_count)}
              </span>
            </RouteLink>
          </li>
        ))}
      </ul>
      {list.failed ? <LoadFailed what="The posts" onRetry={list.retry} className="px-3 pt-3" /> : <PagedListEnd list={list} className="px-3 py-2" />}
    </nav>
  );
}
