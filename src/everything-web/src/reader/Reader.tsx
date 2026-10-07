import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PageItem } from "@cn/core/items";
import type { FeatureId } from "@cn/core/minisiteFeatures";
import type { PassageHighlight } from "@cn/core/passageHighlights";
import { fetchPassageHighlights, subscribeToPassages } from "@cn/core/passages";
import { anchorForSelection, mapQuotesToBlocks, parseReaderText, withoutRepeatedHeader, type ReaderBlock } from "@cn/core/readerText";
import type { NoteRow } from "@cn/core/types";
import { BlockContent, type MarkKind } from "./Blocks";
import { ReaderContext, UNANCHORED, useReader, type AskingState, type ReaderAction, type ReaderApi, type ReaderDialog } from "./context";
import { READER_MODULES } from "./features";
import { highlightCardId } from "./features/highlights";
import { noteCardId, useReaderNoteSet } from "./features/notes";
import { SelectionToolbar } from "./SelectionToolbar";
import { useMarginLayout } from "./useMarginLayout";
import "./reader.css";

/** Wide screens have room for the margin beside the article. */
const WIDE_QUERY = "(min-width: 900px)";
/** Reading speed for the "N min read" estimate, in words per minute. */
const WORDS_PER_MINUTE = 230;
/** How long a message stays at the bottom of the screen. */
const NOTICE_MS = 4000;
/** How long a revealed card stays outlined. */
const FLASH_MS = 1600;
/** How long a reveal waits for its card to appear, for example while a new
 *  note arrives from the database. */
const REVEAL_TIMEOUT_MS = 8000;

/** The outline starts after this long even when the browser never reports
 *  the end of the scroll (Safari before 18 has no scrollend event). */
const SCROLL_SETTLE_FALLBACK_MS = 900;
/** How many times a jump scrolls again because the page grew under it. */
const MAX_RESCROLLS = 3;

/** Scrolls an element into the middle of the screen and outlines it briefly
 *  once the scroll has stopped, so a long jump does not use up the outline.
 *  The article's pictures load lazily and have no reserved height, so the
 *  ones a long jump passes grow while it runs and push the element down; a
 *  shared note link stopped a whole section short (October 2026). When the
 *  page's height changed during the scroll, it scrolls again. */
function flash(element: HTMLElement, attempt = 0) {
  const heightBefore = document.documentElement.scrollHeight;
  let settled = false;
  const onSettled = () => {
    if (settled) return;
    settled = true;
    window.removeEventListener("scrollend", onSettled);
    if (document.documentElement.scrollHeight !== heightBefore && attempt < MAX_RESCROLLS) return flash(element, attempt + 1);
    element.classList.add("reader-flash");
    setTimeout(() => element.classList.remove("reader-flash"), FLASH_MS);
  };
  window.addEventListener("scrollend", onSettled, { once: true });
  setTimeout(onSettled, SCROLL_SETTLE_FALLBACK_MS);
  element.scrollIntoView({ block: "center", behavior: "smooth" });
}

/** Flashes the element with this id as soon as it is in the page. */
function revealWhenRendered(elementId: string) {
  const found = document.getElementById(elementId);
  if (found) return flash(found);
  const watcher = new MutationObserver(() => {
    const element = document.getElementById(elementId);
    if (!element) return;
    watcher.disconnect();
    flash(element);
  });
  watcher.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => watcher.disconnect(), REVEAL_TIMEOUT_MS);
}

/** What the reader shows above the article. */
export interface ReaderHeader {
  title: string;
  description?: string | null;
  byline?: string | null;
  publishedAt?: string | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(WIDE_QUERY);
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return wide;
}

/** The selected words, if they lie inside one passage of this edition. */
function useSelectionInPassage(blocks: readonly ReaderBlock[]): { block: ReaderBlock; quote: string; range: Range } | null {
  const [selection, setSelection] = useState<{ block: ReaderBlock; quote: string; range: Range } | null>(null);
  useEffect(() => {
    const update = () => {
      const current = document.getSelection();
      if (!current || current.isCollapsed || current.rangeCount === 0) return setSelection(null);
      const range = current.getRangeAt(0);
      const node = range.commonAncestorContainer;
      const passage = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(".reader-passage");
      const block = passage && blocks.find((b) => b.id === passage.id);
      const quote = block && anchorForSelection(block, current.toString());
      setSelection(block && quote ? { block, quote, range } : null);
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, [blocks]);
  return selection;
}

const noteQuote = (note: NoteRow) => (note.claim ? { context_quote: note.claim.context_quote, context_paragraph: note.claim.context_paragraph, updated_quote: note.claim.updated_quote } : null);
const highlightQuote = (highlight: PassageHighlight) => ({ context_quote: highlight.quote, context_paragraph: highlight.context_paragraph });

function highlightShown(features: ReadonlySet<FeatureId>, highlight: PassageHighlight): boolean {
  return highlight.kind === "forecast" ? features.has("highlight.forecast") : features.has("highlight.keyPoint");
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** The words of the count pill a narrow screen shows under a passage. */
function countLabel(notes: NoteRow[], highlights: PassageHighlight[]): string {
  const forecasts = highlights.filter((h) => h.kind === "forecast").length;
  const keyPoints = highlights.length - forecasts;
  return [notes.length && plural(notes.length, "note"), keyPoints && plural(keyPoints, "key point"), forecasts && plural(forecasts, "forecast")].filter(Boolean).join(" · ");
}

function OriginalLink({ url }: { url: string }) {
  return <a className="reader-original" href={url} target="_blank" rel="noopener noreferrer">Open the original on {new URL(url).hostname.replace(/^www\./, "")} ↗</a>;
}

function JumpButton({ count, onJump }: { count: number; onJump: () => void }) {
  return <button type="button" className="reader-jump" onClick={onJump}>
    <span className="reader-jump-arrow" aria-hidden="true">↓</span>
    <span>Jump to the notes</span>
    <span className="reader-jump-count" aria-label={`${count} on this article`}>{count}</span>
  </button>;
}

function Passage({ block, quotes, actions, entryCount, label, open, onToggle, children }: {
  block: ReaderBlock;
  quotes: { quote: string; kind: MarkKind }[];
  actions: ReaderAction[];
  entryCount: number;
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const { scope, wide } = useReader();
  // On a phone, tapping a passage shows its buttons. Keyboard users on wide
  // screens reach the same buttons with Tab, because they are always in the page.
  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
  return <section id={block.id} className={`reader-passage reader-passage-${block.kind}${entryCount ? " reader-passage-noted" : ""}${open ? " reader-passage-open" : ""}`}
    onClick={(event) => { if (!wide && actions.length && !(event.target as HTMLElement).closest("a, button")) onToggle(); }}>
    <BlockContent block={block} quotes={quotes} scope={scope} />
    {actions.length > 0 && <div className="reader-passage-actions">
      {actions.map((action) => <button key={action.key} type="button" aria-label={action.accessibleName} onClick={action.onSelect}>{action.label}</button>)}
    </div>}
    {!wide && label && <button type="button" className="reader-count-pill" aria-expanded={open} onClick={onToggle}>{label}</button>}
    {entryCount > 0 && (wide || open) && <div className="reader-margin-group" data-margin-group={wide ? "" : undefined}>{children}</div>}
  </section>;
}

/** The article reader: the article with every switched-on feature beside it.
 *  `content` is reader text; for older articles it is their plain full_text. */
export function Reader({ item, content, header, features, scope }: {
  item: PageItem;
  content: string | null;
  header: ReaderHeader;
  features: ReadonlySet<FeatureId>;
  scope: string;
}) {
  const wide = useWide();
  const [asking, setAsking] = useState<AskingState | null>(null);
  const [dialog, setDialog] = useState<ReaderDialog | null>(null);
  const [openBlock, setOpenBlock] = useState<string | null>(null);
  const [collapsed, setCollapsedSet] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState("");

  const blocks = useMemo(() => withoutRepeatedHeader(
    parseReaderText(content).map((block) => ({ ...block, id: `${scope}-${block.id}` })),
    [header.title, header.description, header.byline],
  ), [content, scope, header.title, header.description, header.byline]);

  const noteQuery = useReaderNoteSet(item.id);
  const notes = useMemo(() => (features.has("notes") ? [...(noteQuery.data?.notes.values() ?? [])] : []), [noteQuery.data, features]);
  const nnnEntries = useMemo(() => [...(noteQuery.data?.nnn.values() ?? [])], [noteQuery.data]);
  const highlightQuery = useQuery({ queryKey: ["passageHighlights", item.id], queryFn: () => fetchPassageHighlights(item.id) });
  const { refetch: refetchHighlightQuery } = highlightQuery;
  useEffect(() => subscribeToPassages(item.id, () => { void refetchHighlightQuery(); }), [item.id, refetchHighlightQuery]);
  const highlights = useMemo(() => (highlightQuery.data ?? []).filter((h) => highlightShown(features, h)), [highlightQuery.data, features]);

  const placedNotes = useMemo(() => mapQuotesToBlocks(blocks, notes, noteQuote), [blocks, notes]);
  const placedHighlights = useMemo(() => mapQuotesToBlocks(blocks, highlights, highlightQuote), [blocks, highlights]);
  const notesByBlock = useMemo(() => new Map([...placedNotes.byBlock, ...(placedNotes.unanchored.length ? [[UNANCHORED, placedNotes.unanchored] as const] : [])]), [placedNotes]);
  const highlightsByBlock = useMemo(() => new Map([...placedHighlights.byBlock, ...(placedHighlights.unanchored.length ? [[UNANCHORED, placedHighlights.unanchored] as const] : [])]), [placedHighlights]);

  // Every margin card in reading order: by passage, notes before key points
  // and forecasts, and the unanchored ones last. The "N of M" buttons walk it.
  const entryOrder = useMemo(() => [...blocks.map((block) => block.id), UNANCHORED].flatMap((blockId) => [
    ...(notesByBlock.get(blockId) ?? []).map((note) => ({ elementId: noteCardId(scope, note.id), blockId })),
    ...(highlightsByBlock.get(blockId) ?? []).map((highlight) => ({ elementId: highlightCardId(scope, highlight.id), blockId })),
  ]), [blocks, notesByBlock, highlightsByBlock, scope]);

  const notify = useCallback((message: string) => setNotice(message), []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const api: ReaderApi = {
    item, scope, blocks, features, wide, notesByBlock, nnnEntries, highlightsByBlock,
    refetchHighlights: () => void refetchHighlightQuery(),
    asking,
    openAsk: (block, quote) => { setAsking({ blockId: block.id, quote }); setOpenBlock(block.id); document.getSelection()?.removeAllRanges(); },
    closeAsk: () => setAsking(null),
    dialog,
    openDialog: (next) => { setDialog(next); document.getSelection()?.removeAllRanges(); },
    closeDialog: () => setDialog(null),
    notify,
    reveal: (elementId, blockId) => { if (blockId) setOpenBlock(blockId); revealWhenRendered(elementId); },
    entryNavigation: (elementId) => {
      const index = entryOrder.findIndex((entry) => entry.elementId === elementId);
      if (index < 0 || entryOrder.length <= 1) return null;
      const next = entryOrder[(index + 1) % entryOrder.length]!;
      return { position: index + 1, total: entryOrder.length, onNext: () => { api.setCollapsed(next.elementId, false); api.reveal(next.elementId, next.blockId); } };
    },
    isCollapsed: (elementId) => collapsed.has(elementId),
    setCollapsed: (elementId, closed) => setCollapsedSet((current) => {
      const next = new Set(current);
      if (closed) next.add(elementId); else next.delete(elementId);
      return next;
    }),
  };

  const quotesByBlock = useMemo(() => {
    const quotes = new Map<string, { quote: string; kind: MarkKind }[]>();
    const add = (blockId: string, quote: string | null | undefined, kind: MarkKind) => {
      if (quote?.trim()) quotes.set(blockId, [...(quotes.get(blockId) ?? []), { quote, kind }]);
    };
    for (const [blockId, group] of placedNotes.byBlock) for (const note of group) add(blockId, note.claim?.updated_quote ?? note.claim?.context_quote, "note");
    for (const [blockId, group] of placedHighlights.byBlock) for (const highlight of group) add(blockId, highlight.quote, "highlight");
    return quotes;
  }, [placedNotes, placedHighlights]);

  const marginCount = (blockId: string) => READER_MODULES.reduce((sum, module) => sum + (module.marginCount?.(api, blockId) ?? 0), 0);
  const totalEntries = notes.length + highlights.length;
  const selection = useSelectionInPassage(blocks);
  const selectionActions = selection
    ? READER_MODULES.flatMap((module) => module.selectionActions?.(api, selection.block, selection.quote) ?? []).filter((action) => features.has(action.feature))
    : [];

  const article = useMarginLayout(wide && blocks.length > 0);

  // A shared link to a note (?note=…&edition=…) or a passage (#passage-…)
  // opens the page scrolled to it, once the notes have loaded.
  const appliedLink = useRef(false);
  useEffect(() => {
    if (appliedLink.current || noteQuery.isPending) return;
    appliedLink.current = true;
    const query = new URLSearchParams(window.location.search);
    if ((query.get("edition") ?? "main") !== scope) return;
    const noteId = query.get("note");
    const fragment = window.location.hash.slice(1);
    if (noteId) {
      const blockId = [...notesByBlock].find(([, group]) => group.some((note) => note.id === noteId))?.[0];
      api.reveal(noteCardId(scope, noteId), blockId);
    } else if (fragment && blocks.some((block) => block.id === fragment)) {
      requestAnimationFrame(() => document.getElementById(fragment)?.scrollIntoView({ block: "start" }));
    }
  });

  function jumpToFirst() {
    const first = blocks.find((block) => marginCount(block.id) > 0)?.id ?? (marginCount(UNANCHORED) ? UNANCHORED : null);
    if (!first) return;
    setOpenBlock(first);
    const target = first === UNANCHORED ? `${scope}-${UNANCHORED}` : first;
    requestAnimationFrame(() => {
      const group = document.getElementById(target)?.querySelector<HTMLElement>(".reader-entry") ?? document.getElementById(target);
      if (group) flash(group);
    });
  }

  const host = new URL(item.url).hostname.replace(/^www\./, "");
  const words = blocks.reduce((sum, block) => sum + block.text.split(/\s+/).filter(Boolean).length, 0);
  const minutes = Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
  const bylineParts = [header.byline, header.byline?.toLowerCase().includes(host) ? null : host, header.publishedAt && formatDate(header.publishedAt), blocks.length > 0 && `${minutes} min read`].filter(Boolean);
  const firstFootnote = blocks.find((block) => block.kind === "footnote")?.id;
  const unanchoredCount = marginCount(UNANCHORED);
  const entries = (blockId: string) => READER_MODULES.map((module) => module.MarginEntries && <module.MarginEntries key={module.name} blockId={blockId} />);

  const headerElement = <header className="reader-header">
    <h1>{header.title}</h1>
    {header.description && <p className="reader-subtitle">{header.description}</p>}
    <p className="reader-byline">{bylineParts.join(" · ")}</p>
    {!wide && <div className="reader-header-links"><OriginalLink url={item.url} />{totalEntries > 0 && <JumpButton count={totalEntries} onJump={jumpToFirst} />}</div>}
  </header>;

  return <ReaderContext.Provider value={api}>
    <div className="reader" data-scope={scope}>
      {noteQuery.isError && <p className="reader-load-error" role="alert">The notes couldn’t load. <button type="button" onClick={() => void noteQuery.refetch()}>Try again</button></p>}
      {highlightQuery.isError && <p className="reader-load-error" role="alert">Key points and forecasts couldn’t load. <button type="button" onClick={() => void highlightQuery.refetch()}>Try again</button></p>}

      {blocks.length === 0 ? <div className="reader-layout">{headerElement}<div className="reader-notice" style={{ gridArea: "article" }}><h2>The article text isn't available yet.</h2><OriginalLink url={item.url} /></div></div>
        : <div className="reader-layout">
          {headerElement}
          {wide && <aside className="reader-margin-column" aria-label="About this article">
            <OriginalLink url={item.url} />
            {totalEntries > 0 && <JumpButton count={totalEntries} onJump={jumpToFirst} />}
          </aside>}
          <aside className="reader-rail">{READER_MODULES.map((module) => module.Rail && <module.Rail key={module.name} />)}</aside>
          <article ref={article} className="reader-article" aria-label={header.title}>
            {blocks.map((block) => {
              const count = marginCount(block.id);
              const actions = READER_MODULES.flatMap((module) => module.passageActions?.(api, block) ?? []).filter((action) => features.has(action.feature));
              return <div key={block.id} className="reader-block">
                {block.id === firstFootnote && <h2 className="reader-footnotes-heading">Footnotes</h2>}
                <Passage block={block} quotes={quotesByBlock.get(block.id) ?? []} actions={actions} entryCount={count}
                  label={countLabel(notesByBlock.get(block.id) ?? [], highlightsByBlock.get(block.id) ?? [])}
                  open={openBlock === block.id} onToggle={() => setOpenBlock((current) => (current === block.id ? null : block.id))}>
                  {entries(block.id)}
                </Passage>
              </div>;
            })}
            {unanchoredCount > 0 && <section id={`${scope}-${UNANCHORED}`} className="reader-passage reader-unanchored">
              <h2>More on this article</h2>
              <div className="reader-margin-group" data-margin-group={wide ? "" : undefined}>{entries(UNANCHORED)}</div>
            </section>}
            <footer className="reader-end">
              <OriginalLink url={item.url} />
            </footer>
          </article>
        </div>}

      {selection && selectionActions.length > 0 && <SelectionToolbar range={selection.range} actions={selectionActions} />}
      {READER_MODULES.map((module) => module.Dialogs && <module.Dialogs key={module.name} />)}
      <p className="reader-status" role="status" aria-live="polite">{notice}</p>
    </div>
  </ReaderContext.Provider>;
}
