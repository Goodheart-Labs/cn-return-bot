import { Fragment, memo, useMemo, type ReactNode } from "react";
import type { FeedItemRow, NnnRow, NoteRow, ProjectHeader } from "@cn/core/types";
import { LoadFailed } from "@cn/features/query/LoadFailed";
import { PagedListEnd } from "@cn/features/query/PagedListEnd";
import type { PagedList } from "@cn/features/query/usePagedList";
import { entriesByClaim, improvementsByOriginal, sectionsOf } from "../lib/feed";
import { noteUrl } from "../lib/routing";
import type { CardPage } from "../lib/feedQueries";
import { FeedNoteCard } from "./FeedNoteCard";

const NO_NOTES: NoteRow[] = [];
const NO_ENTRIES: NnnRow[] = [];
const NO_PAGES: never[] = [];

/** One card of a list of notes: the list's row for it, the note, and the post
 *  and project the note is on. */
export interface FeedCard<TEntry> {
  entry: TEntry;
  note: NoteRow;
  post: FeedItemRow | undefined;
  project: ProjectHeader | undefined;
}

/** The cards of one page. They are kept per page, so a page that is already
 *  loaded gives the same card objects every time, and its cards need not
 *  render again when a later page arrives. A note that was deleted since its
 *  page loaded is left out. */
const cardsByPage = new WeakMap<object, FeedCard<{ noteId: string }>[]>();
function cardsOfPage<TEntry extends { noteId: string }>(page: CardPage<TEntry>): FeedCard<TEntry>[] {
  const known = cardsByPage.get(page) as FeedCard<TEntry>[] | undefined;
  if (known) return known;
  const cards = page.entries.flatMap((entry) => {
    const note = page.notes.get(entry.noteId);
    if (!note) return [];
    const post = page.items.get(note.claim.item_id);
    return [{ entry, note, post, project: post?.project_id ? page.projects.get(post.project_id) : undefined }];
  });
  cardsByPage.set(page, cards);
  return cards;
}

/** The cards of the loaded pages, in order. A note shown twice keeps only its
 *  first card, which happens when a note that leads the list also comes up in
 *  a page. */
function cardsOf<TEntry extends { noteId: string }>(pages: CardPage<TEntry>[]): FeedCard<TEntry>[] {
  const seen = new Set<string>();
  return pages.flatMap(cardsOfPage).filter((card) => {
    if (seen.has(card.note.id)) return false;
    seen.add(card.note.id);
    return true;
  });
}

/** The divider above a labelled band of the feed. It names the band and says
 *  how many notes the whole band holds, when that is known. */
function SectionDivider({ label, total }: { label: string; total: number | null }) {
  return (
    <div className="flex items-center gap-3 py-2 max-w-[40rem] mx-auto w-full" role="separator">
      <span className="flex-1 border-t-2 border-dotted border-line-strong" />
      <span className="text-xs text-fg-muted">
        {label}
        {total !== null && ` (${total === 1 ? "1 note" : `${total} notes`})`}
      </span>
      <span className="flex-1 border-t-2 border-dotted border-line-strong" />
    </div>
  );
}

/** One card of the list. It is memoised, so when a page arrives only that
 *  page's cards render, and not every card loaded before them. That keeps
 *  each page as fast as the first however far the reader has scrolled. The
 *  caller must therefore pass a `byline` function that keeps its identity
 *  between renders. */
function FeedCardItemUnmemoised<TEntry>({ card, index, byline, showPost, improvements, nnnEntries }: {
  card: FeedCard<TEntry>;
  index: number;
  byline?: (card: FeedCard<TEntry>, index: number) => ReactNode;
  showPost: boolean;
  improvements: NoteRow[];
  nnnEntries: NnnRow[];
}) {
  return (
    <FeedNoteCard
      note={card.note}
      byline={byline?.(card, index)}
      post={showPost ? card.post : undefined}
      improvements={improvements}
      nnnEntries={nnnEntries}
      shareUrl={card.project ? noteUrl(card.project.slug, card.note.id) : window.location.href}
    />
  );
}
const FeedCardItem = memo(FeedCardItemUnmemoised) as typeof FeedCardItemUnmemoised;

/** A list of note cards that loads page by page as the reader scrolls. Every
 *  list of notes on the website renders through it: All notes, a project's
 *  notes and the admins' curation.
 *
 *  `lead` pages come before the list's own pages, such as the note a shared
 *  link points at. `labelOf` puts the cards into bands: cards next to each
 *  other with the same label share a band, and a band with a label sits below
 *  a divider. `totalOf` says how many notes a labelled band holds in all.
 *  `byline` renders the top of each card, and `showPost` whether each card
 *  names its post. `byline` must keep its identity between renders, for
 *  example through useCallback, or every card renders again. */
export function NoteFeed<TEntry extends { noteId: string }>({
  list,
  lead = NO_PAGES,
  labelOf = () => null,
  totalOf = () => null,
  byline,
  showPost = true,
  emptyText,
}: {
  list: PagedList<CardPage<TEntry>>;
  lead?: CardPage<TEntry>[];
  labelOf?: (card: FeedCard<TEntry>) => string | null;
  totalOf?: (label: string) => number | null;
  byline?: (card: FeedCard<TEntry>, index: number) => ReactNode;
  showPost?: boolean;
  emptyText: string;
}) {
  const pages = useMemo(() => list.pages && [...lead, ...list.pages], [lead, list.pages]);
  const cards = useMemo(() => (pages ? cardsOf(pages) : []), [pages]);
  const improvements = useMemo(() => improvementsByOriginal(cards.map((card) => card.note)), [cards]);
  const entries = useMemo(() => entriesByClaim(pages?.flatMap((page) => [...page.nnn.values()]) ?? []), [pages]);

  if (list.failed) return <LoadFailed what="These notes" onRetry={list.retry} className="mx-auto max-w-[40rem]" />;
  if (!pages) return <p className="mx-auto max-w-[40rem] text-sm text-fg-muted">Loading…</p>;
  if (cards.length === 0) return <p className="mx-auto max-w-[40rem] py-12 text-center text-sm text-fg-muted">{emptyText}</p>;

  let index = 0;
  return (
    <div className="space-y-4">
      {sectionsOf(cards, labelOf, totalOf).map(({ label, total, entries: sectionCards }, sectionIndex) => (
        <Fragment key={sectionIndex}>
          {label && <SectionDivider label={label} total={total} />}
          {sectionCards.map((card) => (
            <FeedCardItem
              key={card.note.id}
              card={card}
              index={index++}
              byline={byline}
              showPost={showPost}
              improvements={improvements.get(card.note.id) ?? NO_NOTES}
              nnnEntries={entries.get(card.note.claim_id) ?? NO_ENTRIES}
            />
          ))}
        </Fragment>
      ))}
      <PagedListEnd list={list} className="mx-auto max-w-[40rem]" />
    </div>
  );
}
