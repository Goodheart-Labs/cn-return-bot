import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchItemForUrl } from "@cn/core/items";
import { readRoute } from "./lib/routing";
import { fetchCheckedClaimsForItem, type CheckedClaim } from "@cn/core/claims";
import type { NoteRow } from "@cn/core/types";
import { buttonVariants } from "@cn/ui/Button";
import { eyebrowVariants } from "@cn/ui/typography";
import { ReaderNoteCard, ReaderNotesProvider, useReaderNoteSet } from "./components/ReaderNotes";
import { ReaderWriteNote, type ReaderAnchor } from "./components/ReaderWriteNote";
import { highlightedTextParts, anchorForSelection, mapNotesToBlocks, parseReaderText, type ReaderBlock } from "./lib/readerText";
import { fetchPassageHighlights, subscribeToPassages } from "@cn/core/passages";
import type { HighlightDraft, PassageHighlight } from "@cn/core/passageHighlights";
import { ReaderHighlightForm, ReaderHighlights, ReaderPassageQuestions } from "./components/ReaderPassages";
import "./reader.css";

export function articleUrl(value: string | null): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function OriginalLink({ url }: { url: string }) {
  return <a className={buttonVariants()} href={url} target="_blank" rel="noopener noreferrer">Read the original on {new URL(url).host.replace(/^www\./, "")} ↗</a>;
}

// Government texts have no copyright to disclaim, so the reader names who issued them instead.
// The Super Intelligence Accord has no whitehouse.gov page; its signed original is this Truth Social post.
const WHITE_HOUSE_TEXTS = new Set(["https://truthsocial.com/@realDonaldTrump/117356435739432952"]);

function governmentIssuer(url: string): string | null {
  const host = new URL(url).hostname;
  if (WHITE_HOUSE_TEXTS.has(url) || host === "whitehouse.gov" || host.endsWith(".whitehouse.gov")) return "A White House document.";
  return host.endsWith(".gov") ? "A US government document." : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Why a checked article has no notes, so an empty margin reads as a result rather than a gap.
function noNoteReason(claims: CheckedClaim[]): string {
  const checked = claims.filter((claim) => claim.status !== "skipped").length;
  if (!claims.length) return "";
  if (!checked) return `All ${plural(claims.length, "claim")} we found looked right, so none needed a fact-check. `;
  return `We fact-checked ${checked} of ${plural(claims.length, "claim")} and none needed a note. `;
}

// Skipped claims were rated true before any search, so they count as found but not as fact-checked.
function countLine(claims: CheckedClaim[], notes: number): string {
  const checked = claims.filter((claim) => claim.status !== "skipped").length;
  return `${plural(claims.length, "claim")} found · ${checked} fact-checked · ${plural(notes, "note")}`;
}

export function ArticleReader() {
  const [search, setSearch] = useState(window.location.search);
  const route = readRoute(window.location.pathname, search);
  const source = articleUrl(route.view === "read" ? route.url : null);
  const fullParam = route.view === "read" ? route.full : null;
  const full = articleUrl(fullParam);

  useEffect(() => {
    const sync = () => setSearch(window.location.search);
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return (
    <div className="article-reader">
      <main className="reader-shell">
        {source ? <ArticleEdition key={source} source={source} scope="main" /> : <div className="reader-notice"><h1>Choose an article to read</h1><p>Add a valid article URL with ?url= to this page’s address.</p></div>}
        {fullParam !== null && <section className="reader-full" aria-label="The full text">
          {full ? <ArticleEdition key={full} source={full} scope="full" /> : <p className="reader-notice">The full text URL must be an HTTP or HTTPS address.</p>}
        </section>}
      </main>
    </div>
  );
}

function HighlightedText({ text, highlights }: { text: string; highlights: PassageHighlight[] }) {
  return <>{highlightedTextParts(text, highlights.map((h) => h.quote)).map((part, index) => part.highlighted
    ? <mark className="reader-highlight-quote" key={index}>{part.text}</mark> : part.text)}</>;
}

function BlockText({ block, highlights }: { block: ReaderBlock; highlights: PassageHighlight[] }) {
  if (block.kind === "heading") return <h2><HighlightedText text={block.text} highlights={highlights} /></h2>;
  if (block.kind === "list") {
    const List = block.ordered ? "ol" : "ul";
    return <List>{block.items?.map((text, index) => <li key={index}><HighlightedText text={text} highlights={highlights} /></li>)}</List>;
  }
  return <p><HighlightedText text={block.text} highlights={highlights} /></p>;
}

function selectionInPassage(): { blockId: string; text: string } | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const passage = element?.closest<HTMLElement>(".reader-passage");
  return passage ? { blockId: passage.id, text: selection.toString() } : null;
}

function scrollNoteIntoView(noteId: string, scope: string) {
  document.getElementById(`${scope}-note-${noteId}`)?.scrollIntoView({ block: "nearest" });
}

function ArticleEdition({ source, scope }: { source: string; scope: string }) {
  const itemQuery = useQuery({ queryKey: ["readerItem", source], queryFn: () => fetchItemForUrl(source) });
  const item = itemQuery.data;
  const noteQuery = useReaderNoteSet(item?.id);
  const notes = useMemo(() => [...(noteQuery.data?.notes.values() ?? [])], [noteQuery.data]);
  const claimsQuery = useQuery({
    queryKey: ["readerClaims", item?.id],
    queryFn: () => fetchCheckedClaimsForItem(item!.id),
    enabled: !!item,
  });
  const loading = itemQuery.isPending;
  const failed = itemQuery.isError;
  const notesFailed = noteQuery.isError;
  const original = articleUrl(item?.url ?? source) ?? source;
  const host = new URL(original).host.replace(/^www\./, "");
  const title = item?.title || host;
  const articleId = `${scope}-article`;
  const unanchoredId = `${scope}-unanchored`;
  const marginId = `${scope}-margin`;
  const [showNotes, setShowNotes] = useState(true);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [asking, setAsking] = useState<{ blockId: string; quote: string | null } | null>(null);
  const [highlightForm, setHighlightForm] = useState<{ anchor: ReaderAnchor; kind: HighlightDraft["kind"]; draft?: HighlightDraft } | null>(null);
  const highlightQuery = useQuery({ queryKey: ["passageHighlights", item?.id], queryFn: () => fetchPassageHighlights(item!.id), enabled: !!item });
  const itemId = item?.id;
  const { refetch: refetchHighlights } = highlightQuery;
  useEffect(() => {
    if (!itemId) return;
    return subscribeToPassages(itemId, () => { void refetchHighlights(); });
  }, [itemId, refetchHighlights]);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 900px)").matches);
  const [selection, setSelection] = useState<{ blockId: string; text: string } | null>(null);
  const [composer, setComposer] = useState<ReaderAnchor | null>(null);
  const appliedLink = useRef<string | null>(null);
  const marginRef = useRef<HTMLElement>(null);
  const marginObserver = useRef<ResizeObserver | null>(null);
  const reveal = useRef<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const articleText = item?.checked_scope === "paragraph" ? null : item?.full_text;
  const blocks = useMemo(
    () => parseReaderText(articleText).map((block) => ({ ...block, id: `${scope}-${block.id}` })),
    [articleText, scope],
  );
  const { byBlock, unanchored } = useMemo(() => mapNotesToBlocks(blocks, notes), [blocks, notes]);
  const highlightBlocks = useMemo(() => mapNotesToBlocks(blocks, (highlightQuery.data ?? []).map((highlight) => ({ ...highlight, claim: { context_quote: highlight.quote, context_paragraph: highlight.context_paragraph, updated_quote: null } }))), [blocks, highlightQuery.data]);
  const checkedByBlock = useMemo(() => {
    const notedClaims = new Set(notes.map((note) => note.claim_id));
    const claims = (claimsQuery.data ?? []).filter((claim) => claim.status === "no_note" && !notedClaims.has(claim.id));
    return mapNotesToBlocks(blocks, claims.map((claim) => ({ claim }))).byBlock;
  }, [blocks, claimsQuery.data, notes]);
  const noteable = useMemo(() => new Set(blocks.filter((block) => anchorForSelection(block, block.text)).map((block) => block.id)), [blocks]);
  const headings = blocks.filter((block) => block.kind === "heading");
  const minutes = Math.max(1, Math.ceil((articleText?.split(/\s+/).length ?? 0) / 230));
  const marginGroups = useMemo(() => {
    const ids = blocks.map((block) => block.id).filter((id) => byBlock.get(id)?.length || highlightBlocks.byBlock.get(id)?.length || asking?.blockId === id);
    if (unanchored.length || highlightBlocks.unanchored.length) ids.push("unanchored");
    return ids;
  }, [blocks, byBlock, highlightBlocks, unanchored, asking]);

  // Every passage's notes sit level with the passage, as margin comments do, and a group that would
  // overlap the one above moves down below it. Positions are written straight to the DOM because they
  // depend on rendered heights, which change as fonts load, cards expand or answers arrive.
  const layoutMargin = useCallback(() => {
    const margin = marginRef.current;
    if (!margin) return;
    const base = margin.getBoundingClientRect().top;
    let floor = 0;
    for (const group of Array.from(margin.querySelectorAll<HTMLElement>("[data-margin-for]"))) {
      const passage = document.getElementById(group.dataset.marginFor ?? "");
      const top = Math.max(passage ? passage.getBoundingClientRect().top - base : floor, floor);
      group.style.top = `${top}px`;
      floor = top + group.offsetHeight + 16;
    }
    margin.style.minHeight = `${floor}px`;
  }, []);

  useLayoutEffect(() => {
    layoutMargin();
    const observer = marginObserver.current ??= new ResizeObserver(() => layoutMargin());
    const article = document.getElementById(articleId);
    if (article) observer.observe(article);
    marginRef.current?.querySelectorAll("[data-margin-for]").forEach((group) => observer.observe(group));
  });

  useEffect(() => {
    window.addEventListener("resize", layoutMargin);
    return () => {
      window.removeEventListener("resize", layoutMargin);
      marginObserver.current?.disconnect();
    };
  }, [layoutMargin]);

  useEffect(() => {
    const update = () => {
      const next = selectionInPassage();
      setSelection((prev) => (prev?.blockId === next?.blockId && prev?.text === next?.text ? prev : next));
    };
    document.addEventListener("selectionchange", update);
    return () => document.removeEventListener("selectionchange", update);
  }, []);

  useEffect(() => {
    const syncLink = () => {
      if (loading || failed || noteQuery.isPending) return;
      const link = window.location.search + window.location.hash;
      // Refreshing a rating must not move the reader or reopen a closed note.
      if (appliedLink.current === link) return;
      appliedLink.current = link;
      const query = new URLSearchParams(window.location.search);
      if ((query.get("edition") ?? "main") !== scope) return;
      const fragment = window.location.hash.slice(1);
      const fragmentBlock = blocks.some((block) => block.id === fragment) ? fragment : null;
      if (fragment && !fragmentBlock) return;
      const noteId = fragmentBlock ? null : query.get("note");
      const target = fragmentBlock ?? (noteId
        ? [...byBlock].find(([, group]) => group.some((note) => note.id === noteId))?.[0]
          ?? (unanchored.some((note) => note.id === noteId) ? "unanchored" : null)
        : query.get("passage"));
      setSelectedBlock(target);
      if (!target) return;
      setShowNotes(true);
      requestAnimationFrame(() => {
        document.getElementById(target === "unanchored" ? unanchoredId : target)?.scrollIntoView({ block: "start" });
        if (noteId) scrollNoteIntoView(noteId, scope);
      });
    };
    syncLink();
    window.addEventListener("popstate", syncLink);
    window.addEventListener("hashchange", syncLink);
    return () => {
      window.removeEventListener("popstate", syncLink);
      window.removeEventListener("hashchange", syncLink);
    };
  }, [blocks, byBlock, unanchored, loading, failed, noteQuery.isPending, scope, unanchoredId]);

  useEffect(() => {
    const noteId = reveal.current;
    if (!noteId || !notes.some((note) => note.id === noteId)) return;
    reveal.current = null;
    requestAnimationFrame(() => scrollNoteIntoView(noteId, scope));
  }, [notes, composer, selectedBlock, scope]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  function openHighlight(block: ReaderBlock, text: string, kind: HighlightDraft["kind"], draft?: HighlightDraft) {
    setHighlightForm({ anchor: { blockId: block.id, text, paragraph: block.text, partial: text !== block.text }, kind, draft });
  }

  const renderPassageExtras = (blockId: string) => {
    const block = blocks.find((b) => b.id === blockId);
    return <>
      <ReaderHighlights highlights={blockId === "unanchored" ? highlightBlocks.unanchored : highlightBlocks.byBlock.get(blockId) ?? []} onChanged={() => void highlightQuery.refetch()} />
      {asking?.blockId === blockId && block && item && <ReaderPassageQuestions key={`${blockId}-${asking.quote ?? ""}`} item={item} passage={block.text} quote={asking.quote} onDraft={(draft) => openHighlight(block, block.text, draft.kind, draft)} />}
    </>;
  };

  function openQuestions(block: ReaderBlock, quote: string | null) {
    setSelectedBlock(block.id);
    setAsking({ blockId: block.id, quote });
    setShowNotes(true);
  }

  function openComposer(block: ReaderBlock, partial: string | null) {
    setComposer({ blockId: block.id, text: partial ?? block.text, paragraph: block.text, partial: partial !== null });
  }

  function onPosted(noteId: string) {
    const blockId = composer?.blockId ?? null;
    setComposer(null);
    document.getSelection()?.removeAllRanges();
    setShowNotes(true);
    setSelectedBlock(blockId);
    reveal.current = noteId;
    setNotice("Your note is posted. It shows as “Needs more ratings” until other readers rate it.");
  }

  const marginMessage = notesFailed ? "The notes couldn't load."
    : noteQuery.isPending ? "Loading notes…"
    : notes.length ? `${plural(notes.length, "note")} on this article. Choose a marked passage to read ${notes.length === 1 ? "it" : "them"}.`
    : `No notes yet. ${claimsQuery.data ? noNoteReason(claimsQuery.data) : ""}Highlight any passage to add a note.`;

  const renderNotes = (group: NoteRow[]) => group.map((note) => (
    <ReaderNoteCard key={note.id} note={note} scope={scope} />
  ));

  return (
    <ReaderNotesProvider noteSet={noteQuery.data}>
      <section className="reader-edition" aria-label={title}>
          <div className="reader-intro">
            <p className={eyebrowVariants()}>{scope === "full" ? "The full text" : "An article with Common Notes"}</p>
            <h1>{title}</h1>
            <p className="reader-byline">{host}{item?.published_at && <> <span aria-hidden="true">·</span> <time dateTime={item.published_at}>{new Date(item.published_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })}</time></>}{blocks.length > 0 && <> <span aria-hidden="true">·</span> {minutes} min read</>}</p>
            {claimsQuery.isSuccess && noteQuery.isSuccess && <p className="reader-checked-count">{countLine(claimsQuery.data, notes.length)}</p>}
            {item && (scope === "full"
              ? <p className="reader-full-original"><OriginalLink url={original} /></p>
              : <aside className="reader-attribution"><p>{governmentIssuer(original) ?? `This text belongs to ${host}. Common Notes shows it here only so notes can sit beside it, and claims no copyright in it.`}</p><OriginalLink url={original} /></aside>)}
            <div className="reader-toolbar">
              {blocks.length > 0 && <button type="button" className="reader-toggle" aria-pressed={showNotes} onClick={() => setShowNotes((value) => !value)}>
                {showNotes ? "Hide notes" : "Show notes"}<span className="reader-count">{notes.length}</span>
              </button>}
            </div>
          </div>

          {loading ? <div className="reader-notice" id={articleId} tabIndex={-1} role="status">Loading the reading edition…</div>
            : failed ? <div className="reader-notice" id={articleId} tabIndex={-1} role="alert"><h2>The reading edition couldn’t load.</h2><p>Please try again, or read the original.</p><button className={buttonVariants({ variant: "secondary" })} onClick={() => void itemQuery.refetch()}>Try again</button> <OriginalLink url={original} /></div>
            : !item || item.checked_scope === "paragraph" ? <div className="reader-notice" id={articleId}><h2>Common Notes hasn't checked this page yet</h2>{item?.checked_scope === "paragraph" && <p>Only a selected paragraph was checked. It is not presented here as the full article.</p>}<OriginalLink url={original} /></div>
            : blocks.length === 0 ? <div className="reader-notice" id={articleId}><h2>The article text isn't available yet.</h2><OriginalLink url={original} /></div>
            : <>
              {claimsQuery.isError && <div className="reader-note-error" role="alert">The checked claims couldn’t load. <button onClick={() => void claimsQuery.refetch()}>Retry checked claims</button></div>}
              {highlightQuery.isError && <p className="reader-note-error" role="alert">Highlights could not load. <button onClick={() => void highlightQuery.refetch()}>Retry highlights</button></p>}
              {notesFailed && <div className="reader-note-error" role="alert">The notes couldn’t load. You can still read the article. <button onClick={() => void noteQuery.refetch()}>Retry notes</button></div>}
              {!wide && showNotes && noteQuery.isSuccess && notes.length === 0 && <p className="reader-note-error">{marginMessage}</p>}
              <div className={`reader-layout ${showNotes ? "" : "reader-layout-quiet"}`}>
                <nav className="reader-contents" aria-label="Article contents"><p>In this article</p><a href={`#${articleId}`}>Introduction</a>{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`}>{heading.text}</a>)}</nav>
                <article id={articleId} className="reader-article" aria-label={title}>
                  {blocks.map((block) => {
                    const group = byBlock.get(block.id) ?? [];
                    const highlights = highlightBlocks.byBlock.get(block.id) ?? [];
                    const open = selectedBlock === block.id;
                    const partial = selection?.blockId === block.id ? anchorForSelection(block, selection.text) : null;
                    return <section id={block.id} key={block.id} className={`reader-passage ${showNotes && (group.length || highlights.length) ? "reader-passage-noted" : ""} ${open ? "reader-passage-active" : ""}`}>
                      <BlockText block={block} highlights={showNotes ? highlights : []} />
                      {showNotes && noteQuery.isSuccess && checkedByBlock.has(block.id) && <span className="reader-checked-marker">Checked, no note needed</span>}
                      <div className="reader-passage-actions">
                        {showNotes && group.length > 0 && <button className="reader-note-trigger" onClick={() => setSelectedBlock(open ? null : block.id)} aria-expanded={open} aria-controls={wide ? marginId : `inline-${block.id}`}>
                          <span aria-hidden="true">✳</span> {group.length} {group.length === 1 ? "note" : "notes"} <span aria-hidden="true">{open ? "−" : "+"}</span>
                        </button>}
                        {item && noteable.has(block.id) && <button
                          type="button"
                          className={`reader-note-add ${partial ? "reader-note-add-selection" : ""}`}
                          // Pressing the button must not clear the highlight it is about to use.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => openComposer(block, partial)}
                          aria-label={partial ? "Add a note on the highlighted words" : `Add a note on this passage: ${block.text.slice(0, 60)}`}
                        >
                          <span aria-hidden="true">✎</span> {partial ? "Note the highlighted words" : "Add a note"}
                        </button>}
                        {partial && <>
                          <button className="reader-note-add reader-note-add-selection" onMouseDown={(event) => event.preventDefault()} onClick={() => openHighlight(block, partial, "forecast")}>Forecast</button>
                          <button className="reader-note-add reader-note-add-selection" onMouseDown={(event) => event.preventDefault()} onClick={() => openHighlight(block, partial, "key_point")}>Key point</button>
                          <button className="reader-note-add reader-note-add-selection" onMouseDown={(event) => event.preventDefault()} onClick={() => openQuestions(block, partial)}>Ask Opus 5.5</button>
                        </>}
                        {showNotes && highlights.length > 0 && <button className="reader-note-trigger" aria-expanded={open} onClick={() => setSelectedBlock(open ? null : block.id)}>{plural(highlights.length, "highlight")}</button>}
                        {!partial && <button className="reader-passage-ask" onClick={() => openQuestions(block, null)}>Ask Opus 5.5</button>}
                      </div>
                      {!wide && showNotes && open && <div id={`inline-${block.id}`} className="reader-inline-notes">{renderNotes(group)}{renderPassageExtras(block.id)}</div>}
                    </section>;
                  })}
                  {showNotes && (unanchored.length > 0 || highlightBlocks.unanchored.length > 0) && <section id={unanchoredId} className="reader-unanchored"><h2>More on this article</h2><p>These entries refer to passages we couldn’t match to this copy of the text.</p><button className="reader-note-trigger" aria-expanded={selectedBlock === "unanchored"} onClick={() => setSelectedBlock(selectedBlock === "unanchored" ? null : "unanchored")}>View {plural(unanchored.length, "note")} and {plural(highlightBlocks.unanchored.length, "highlight")}</button>{!wide && selectedBlock === "unanchored" && <div className="reader-inline-notes">{renderNotes(unanchored)}{renderPassageExtras("unanchored")}</div>}</section>}
                  <div className="reader-source-credit"><OriginalLink url={original} /></div>
                </article>
                {wide && showNotes && <aside id={marginId} ref={marginRef} className="reader-margin" aria-label="Common Notes beside the article">
                  {marginGroups.length === 0 && <p className="reader-margin-empty">{marginMessage}</p>}
                  {marginGroups.map((id) => <div key={id} data-margin-for={id === "unanchored" ? unanchoredId : id} className="reader-margin-group">
                    {renderNotes(id === "unanchored" ? unanchored : byBlock.get(id) ?? [])}{renderPassageExtras(id)}
                  </div>)}
                </aside>}
              </div>
            </>}

          {!loading && !failed && blocks.length === 0 && notes.length > 0 && <section className="reader-pending-notes" id={unanchoredId} aria-label="Notes on the original article"><h2>Notes on the original article</h2>{renderNotes(notes)}</section>}

        {composer && item && <ReaderWriteNote item={item} anchor={composer} onClose={() => setComposer(null)} onPosted={onPosted} />}
        {highlightForm && item && <ReaderHighlightForm key={`${highlightForm.anchor.blockId}-${highlightForm.kind}`} item={item} {...highlightForm} onClose={() => setHighlightForm(null)} onPosted={() => {
          setSelectedBlock(highlightForm.anchor.blockId); setShowNotes(true); setHighlightForm(null); document.getSelection()?.removeAllRanges(); void highlightQuery.refetch();
        }} />}
        <p className="reader-status" role="status" aria-live="polite">{notice}</p>
      </section>
    </ReaderNotesProvider>
  );
}
