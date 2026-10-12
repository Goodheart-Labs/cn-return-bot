import { useState } from "react";
import { creatorPlatform } from "@cn/core/projects";
import type { FeedProjectRow } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { ExternalLinkIcon } from "@cn/ui/icons";
import { ProjectAvatar } from "../components/ProjectAvatar";
import { RouteLink } from "../components/RouteLink";
import { useProjects } from "../lib/feedQueries";
import type { Route } from "../lib/routing";

type Order = "votes" | "name";

const ORDERS: { id: Order; label: string }[] = [
  { id: "votes", label: "Most votes" },
  { id: "name", label: "A to Z" },
];

/** The order the reader picked last time, remembered on this device. */
const ORDER_KEY = "cn:projectsOrder";

function readOrder(): Order {
  try {
    return window.localStorage.getItem(ORDER_KEY) === "name" ? "name" : "votes";
  } catch {
    return "votes";
  }
}

function useOrder(): [Order, (order: Order) => void] {
  const [order, setOrder] = useState(readOrder);
  const choose = (next: Order) => {
    setOrder(next);
    try {
      window.localStorage.setItem(ORDER_KEY, next);
    } catch {
      // Without storage the choice lasts until the page reloads.
    }
  };
  return [order, choose];
}

/** The projects arrive ordered by the votes on their notes (migration 094). */
const byName = (a: FeedProjectRow, b: FeedProjectRow) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

const noteCount = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "note" : "notes"}`;

function ProjectCard({ project, navigate }: { project: FeedProjectRow; navigate: (route: Route) => void }) {
  const platform = project.feed_url ? creatorPlatform(project.feed_url) : null;
  return (
    <li className="relative flex items-center gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong">
      <ProjectAvatar project={project} size={56} />
      <div className="min-w-0 flex-1">
        <h2 className="font-title text-lg font-bold leading-snug text-fg">
          {/* The name's link covers the whole card, so the card is one big
            * target. The link to the creator's own site sits above it. */}
          <RouteLink
            to={{ view: "notes", project: project.slug, item: null, note: null }}
            navigate={navigate}
            className="line-clamp-2 after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus"
          >
            {project.name}
          </RouteLink>
        </h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
          {noteCount(project.note_count)}
          {platform && project.feed_url && (
            <a
              href={project.feed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="relative z-10 inline-flex items-center gap-1 rounded-control font-medium text-fg-secondary hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {platform}
              <ExternalLinkIcon size={13} aria-hidden="true" />
              <span className="sr-only">(opens {project.name} on {platform})</span>
            </a>
          )}
        </p>
      </div>
    </li>
  );
}

/** Every project with notes: the creator's picture, how many notes it has, a
 *  link to its notes here, and a link to the creator's own page. */
export function ProjectsPage({ navigate }: { navigate: (route: Route) => void }) {
  const projects = useProjects();
  const [order, setOrder] = useOrder();
  // A project whose items have no notes yet has nothing to show here.
  const withNotes = (projects.data ?? []).filter((p) => p.note_count > 0);
  const shown = order === "name" ? [...withNotes].sort(byName) : withNotes;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-title text-3xl font-bold text-fg">Notes</h1>
          <p className="mt-1 max-w-xl text-base text-fg-muted">The creators we check, and the notes readers are rating on their posts and videos.</p>
        </div>
        <div className="flex items-center gap-4">
          <div role="radiogroup" aria-label="Order" className="flex rounded-control border border-line bg-surface-muted p-0.5">
            {ORDERS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={order === id}
                onClick={() => setOrder(id)}
                className={cn(
                  "whitespace-nowrap rounded-[calc(var(--cn-radius-control)-2px)] px-3 py-1 text-sm font-medium text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  order === id ? "bg-surface text-fg shadow-raised" : "hover:text-fg",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {projects.isError ? (
        <div className="mt-8 space-y-3">
          <p className="text-sm text-fg-secondary">The projects could not be loaded. The connection to our server failed.</p>
          <Button onClick={() => void projects.refetch()}>Try again</Button>
        </div>
      ) : !projects.data ? (
        <p className="mt-8 text-sm text-fg-muted">Loading…</p>
      ) : (
        <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((project) => (
            <ProjectCard key={project.id} project={project} navigate={navigate} />
          ))}
        </ul>
      )}
    </main>
  );
}
