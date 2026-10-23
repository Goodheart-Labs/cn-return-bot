import type { ProjectOrder } from "@cn/core/creators";
import { creatorPlatform } from "@cn/core/projects";
import type { FeedProjectRow } from "@cn/core/types";
import { ExternalLinkIcon, NoteStackIcon } from "@cn/ui/icons";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { PagedListEnd } from "@cn/features/query/PagedListEnd";
import { ProjectAvatar } from "../components/ProjectAvatar";
import { RouteLink } from "../components/RouteLink";
import { useNoteCount, useProjectsList } from "../lib/feedQueries";
import { ALL_NOTES, type Route } from "../lib/routing";
import { useStoredChoice } from "../lib/useStoredValue";

const ORDERS: { id: ProjectOrder; label: string }[] = [
  { id: "votes", label: "Most votes" },
  { id: "name", label: "A to Z" },
];

/** The order the reader picked last time, remembered on this device. */
const ORDER_KEY = "cn:projectsOrder";

const noteCount = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "note" : "notes"}`;

const CARD = "relative flex items-center gap-4 rounded-card border border-line bg-surface p-4 transition-colors hover:border-line-strong";

/** The card's main link. It covers the whole card, so the card is one big
 *  target. */
const CARD_LINK =
  "line-clamp-2 after:absolute after:inset-0 after:rounded-card focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-focus";

/** How large the cards' pictures are, and how much of the circle the All
 *  creators card's icon fills. */
const AVATAR_SIZE = 56;
const ICON_SCALE = 0.5;

/** The whole site, as the scope of a note count. */
const EVERY_PROJECT = { projectId: null, itemId: null };

/** The first card of the grid. It leads to every note of every creator in one
 *  feed, and it counts all of them. */
function AllCreatorsCard({ navigate }: { navigate: (route: Route) => void }) {
  const noteTotal = useNoteCount(EVERY_PROJECT).data;
  return (
    <li className={CARD}>
      <span
        aria-hidden="true"
        className="grid shrink-0 place-items-center rounded-full border border-line bg-surface-muted text-fg-secondary"
        style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
      >
        <NoteStackIcon size={AVATAR_SIZE * ICON_SCALE} />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-title text-lg font-bold leading-snug text-fg">
          <RouteLink to={ALL_NOTES} navigate={navigate} className={CARD_LINK}>
            All creators
          </RouteLink>
        </h2>
        {noteTotal !== undefined && <p className="mt-1 text-sm text-fg-muted">{noteCount(noteTotal)}</p>}
      </div>
    </li>
  );
}

function ProjectCard({ project, navigate }: { project: FeedProjectRow; navigate: (route: Route) => void }) {
  const platform = project.feed_url ? creatorPlatform(project.feed_url) : null;
  return (
    <li className={CARD}>
      <ProjectAvatar project={project} size={AVATAR_SIZE} />
      <div className="min-w-0 flex-1">
        <h2 className="font-title text-lg font-bold leading-snug text-fg">
          {/* The link to the creator's own site sits above the card's link. */}
          <RouteLink to={{ view: "notes", project: project.slug, item: null, note: null }} navigate={navigate} className={CARD_LINK}>
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
 *  link to its notes here, and a link to the creator's own page. The projects
 *  load a page at a time as the reader scrolls, in the order the reader
 *  picked. The first card, whatever the order, leads to the notes of every
 *  project in one feed. */
export function ProjectsPage({ navigate }: { navigate: (route: Route) => void }) {
  const [order, setOrder] = useStoredChoice(ORDER_KEY, ORDERS.map((o) => o.id), "votes");
  const projects = useProjectsList(order);

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 md:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-title text-3xl font-bold text-fg">Notes</h1>
          <p className="mt-1 max-w-xl text-base text-fg-muted">The creators we check, and the notes readers are rating on their posts and videos.</p>
        </div>
        <SegmentedControl label="Order" options={ORDERS} value={order} onChange={setOrder} />
      </div>

      {projects.failed ? (
        <LoadFailed what="The projects" onRetry={projects.retry} className="mt-8" />
      ) : !projects.pages ? (
        <p className="mt-8 text-sm text-fg-muted">Loading…</p>
      ) : (
        <>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AllCreatorsCard navigate={navigate} />
            {projects.pages.flat().map((project) => (
              <ProjectCard key={project.id} project={project} navigate={navigate} />
            ))}
          </ul>
          <PagedListEnd list={projects} className="mt-4" />
        </>
      )}
    </main>
  );
}
