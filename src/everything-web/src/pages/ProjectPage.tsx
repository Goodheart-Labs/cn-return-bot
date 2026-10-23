import { useEffect, useRef, useState, type ReactNode } from "react";
import { track } from "@cn/core/analytics";
import { NO_FILTERS } from "@cn/core/feedPages";
import { creatorPlatform } from "@cn/core/projects";
import type { FeedItemRow, ProjectHeader } from "@cn/core/types";
import { Button } from "@cn/ui/Button";
import { cn } from "@cn/ui/cn";
import { ChevronIcon } from "@cn/ui/icons";
import { ResizablePanel } from "@cn/ui/ResizablePanel";
import { BackToProjects } from "../components/BackToProjects";
import { ItemList } from "../components/ItemList";
import { NoteFeed } from "../components/NoteFeed";
import { ProjectAvatar } from "../components/ProjectAvatar";
import { RouteLink } from "../components/RouteLink";
import { WriteNoteModal } from "../components/WriteNoteModal";
import { BAND_LABELS, bandTotal } from "../lib/feed";
import { useFeedItem, useNoteCount, useNoteFeed, useProjectItems, useProjectRealtime, useSharedNote } from "../lib/feedQueries";
import { noteUrl, type Route } from "../lib/routing";

/** When the scroll to a shared note runs, in milliseconds after its card
 *  first renders. */
const SCROLL_TO_NOTE_RETRIES_MS = [0, 400, 1000, 1800];

/** Scrolls to a shared note once its card has rendered. It scrolls again a few
 *  times over the next two seconds, because the YouTube iframes load late and
 *  shift the layout underneath it. */
function useScrollToNote(noteId: string | null, ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready || !noteId || !document.getElementById(`note-${noteId}`)) return;
    done.current = true;
    for (const ms of SCROLL_TO_NOTE_RETRIES_MS) {
      setTimeout(() => document.getElementById(`note-${noteId}`)?.scrollIntoView({ block: "start" }), ms);
    }
  });
}

/** How wide the list of posts and videos starts, and how far it can be
 *  dragged. Titles are long, so readers can widen it. */
const ITEM_LIST_WIDTH = { default: 300, min: 220, max: 560 };

/** The top of the notes column. For the whole project it names the project,
 *  with the creator's picture and a link to their own page. For one item it
 *  names the item under the project's name, and the item's title links to the
 *  original. */
function PageHeading({ project, item, navigate }: { project: ProjectHeader; item: FeedItemRow | null; navigate: (route: Route) => void }) {
  const platform = project.feed_url ? creatorPlatform(project.feed_url) : null;
  if (item) {
    return (
      <div className="min-w-0">
        <RouteLink
          to={{ view: "notes", project: project.slug, item: null, note: null }}
          navigate={navigate}
          className="inline-flex items-center gap-2 text-sm font-medium text-fg-secondary hover:text-fg"
        >
          <ProjectAvatar project={project} size={22} />
          {project.name}
        </RouteLink>
        {/* The title is the link to the original post or video. It reads as a
            plain title and turns blue under the pointer. */}
        <h1 className="mt-2 font-title text-2xl font-bold text-fg text-balance">
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="rounded-control hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus">
            {item.title ?? "Untitled"}
          </a>
        </h1>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-3">
      <ProjectAvatar project={project} size={48} />
      <div className="min-w-0">
        <h1 className="font-title text-2xl font-bold leading-tight text-fg text-balance">
          {/* Like an item's title, the project's name is the link to the
              creator's own page. It reads as a plain title and turns blue
              under the pointer. */}
          {project.feed_url ? (
            <a
              href={project.feed_url}
              target="_blank"
              rel="noopener noreferrer"
              title={platform ? `${project.name} on ${platform}` : undefined}
              className="rounded-control hover:text-link focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              {project.name}
            </a>
          ) : (
            project.name
          )}
        </h1>
      </div>
    </div>
  );
}


/** The list of posts on a phone: a button that names the post shown, or all
 *  of them, and opens the list below it. Picking a post closes it again. */
function PhoneItemMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-control border border-line-strong bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-base text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronIcon size={16} aria-hidden className={cn("shrink-0 text-fg-muted", open ? "-rotate-90" : "rotate-90")} />
      </button>
      {open && <div className="border-t border-line px-1 py-2">{children(() => setOpen(false))}</div>}
    </div>
  );
}

/** One project: its posts and videos listed on the left, newest first, and
 *  beside them the ranked notes of the one picked, or of all of them. Both
 *  load a page at a time as the reader scrolls. On a phone the list of posts
 *  opens from a button above the notes. A shared link to one note shows that
 *  note first, because the feed may hold it on a page far below. */
export function ProjectPage({ project, itemId, noteId, navigate }: {
  project: ProjectHeader;
  itemId: string | null;
  noteId: string | null;
  navigate: (route: Route) => void;
}) {
  const itemQuery = useFeedItem(itemId);
  // An item link that is stale or belongs to another project shows the whole
  // project, which beats an empty feed.
  const activeItem = itemQuery.data?.project_id === project.id ? itemQuery.data : null;
  const waitingForItem = !!itemId && itemQuery.isPending;
  const { list, summary } = useNoteFeed({ projectId: project.id, itemId: activeItem?.id ?? null }, "mixed", NO_FILTERS);
  const items = useProjectItems(project.id);
  // While the whole project shows, its feed's own summary has the count.
  const projectCount = useNoteCount({ projectId: project.id, itemId: null }, !!activeItem).data;
  const total = activeItem ? projectCount : summary.data?.matching;
  const shared = useSharedNote(noteId).data;
  const [writeOpen, setWriteOpen] = useState(false);
  useProjectRealtime(project.id);
  useScrollToNote(noteId, !!shared);

  const itemList = (onPick?: () => void) => (
    <ItemList projectSlug={project.slug} list={items} total={total} selected={activeItem?.id ?? null} navigate={navigate} onPick={onPick} />
  );

  return (
    <div className="md:flex">
      <ResizablePanel
        storageKey="cn:itemListWidth"
        label="list of posts and videos"
        defaultWidth={ITEM_LIST_WIDTH.default}
        minWidth={ITEM_LIST_WIDTH.min}
        maxWidth={ITEM_LIST_WIDTH.max}
        className="hidden bg-surface md:block md:sticky md:top-14 md:h-[calc(100vh-3.5rem)]"
      >
        <div className="h-full space-y-5 overflow-y-auto px-3 py-5">
          <div className="px-3">
            <BackToProjects navigate={navigate} />
          </div>
          {itemList()}
        </div>
      </ResizablePanel>

      <main className="min-w-0 flex-1 px-4 py-8 md:px-8">
        <div className="mb-5 md:hidden">
          <BackToProjects navigate={navigate} />
        </div>
        <div className="mx-auto mb-6 flex max-w-[40rem] flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <PageHeading project={project} item={activeItem} navigate={navigate} />
          <Button
            variant="link"
            className="shrink-0 pt-1.5 text-sm font-medium"
            onClick={() => {
              setWriteOpen(true);
              // The modal is a "get the extension" teaser. Each open is a
              // reader asking for a write flow, which is extension demand.
              track("write_note_teaser_shown");
            }}
          >
            Write a note
          </Button>
        </div>
        <div className="mx-auto mb-6 max-w-[40rem] md:hidden">
          <PhoneItemMenu label={activeItem?.title ?? "All posts and videos"}>{(close) => itemList(close)}</PhoneItemMenu>
        </div>
        {waitingForItem ? (
          <p className="mx-auto max-w-[40rem] text-sm text-fg-muted">Loading…</p>
        ) : (
          <NoteFeed
            list={list}
            lead={shared ? [shared] : undefined}
            labelOf={({ entry }) => BAND_LABELS[entry.band]}
            totalOf={(label) => bandTotal(summary.data, label)}
            showPost={!activeItem}
            shareUrl={({ note }) => noteUrl(project.slug, note.id)}
            emptyText="No notes yet for this project."
          />
        )}
      </main>

      <WriteNoteModal open={writeOpen} onClose={() => setWriteOpen(false)} navigate={navigate} />
    </div>
  );
}
