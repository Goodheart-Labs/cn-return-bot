import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchItemForUrl, fetchNotesForItem, type PageItem } from "../../everything-shared/notesQuery";
import type { NoteRow } from "../../everything-shared/types";
import { ReaderExtensionLink } from "./components/ReaderExtensionLink";
import { ReaderNoteCard, ReaderNotesProvider } from "./components/ReaderNotes";
import { ReaderWriteNote, type ReaderAnchor } from "./components/ReaderWriteNote";
import { SystemTheme } from "./components/SystemTheme";
import { anchorForSelection, mapNotesToBlocks, parseReaderText, promoteHeadings, stripLeadingBlocks, type ReaderBlock } from "./lib/readerText";
import "./reader.css";

export const FRONTIER_SOURCE = "https://darioamodei.com/post/we-must-pace-the-frontier";
const TITLE = "We Must Pace the Frontier";
const DATE = "September 2026";
/* The stored text opens with the title and date, which the masthead shows,
 * and carries no heading markup, so the page names the sections itself. */
const SECTION_TITLES = ["Why Pace?", "Embedded Evaluators", "Pacing Within Democracies", "Global Pacing", "Bottom Line"];

export function isFrontierReaderPath(pathname: string): boolean {
  return /\/pacing-the-frontier(?:\/|\/index\.html)?$/.test(pathname);
}

function BlockText({ block }: { block: ReaderBlock }) {
  if (block.kind === "heading") return <h2>{block.text}</h2>;
  if (block.kind === "list") {
    const List = block.ordered ? "ol" : "ul";
    return <List>{block.items?.map((text, index) => <li key={index}>{text}</li>)}</List>;
  }
  return <p>{block.text}</p>;
}

/** The passage the live text selection sits in, with the selected words. Null
 *  when nothing is selected or the selection reaches outside one passage. */
function selectionInPassage(): { blockId: string; text: string } | null {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const node = selection.getRangeAt(0).commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const passage = element?.closest<HTMLElement>(".reader-passage");
  return passage ? { blockId: passage.id, text: selection.toString() } : null;
}

/** Brings a note card into view. In the margin the sticky column scrolls,
 *  not the page, so the reader's place in the essay is kept. */
function scrollNoteIntoView(noteId: string) {
  const card = document.getElementById(`note-${noteId}`);
  const margin = card?.closest(".reader-margin-sticky");
  if (card && margin) margin.scrollTop += card.getBoundingClientRect().top - margin.getBoundingClientRect().top;
  else card?.scrollIntoView({ block: "nearest" });
}

export function FrontierReader() {
  const [item, setItem] = useState<PageItem | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [notesFailed, setNotesFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [showNotes, setShowNotes] = useState(true);
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [wide, setWide] = useState(() => window.matchMedia("(min-width: 900px)").matches);
  // The words a reader has highlighted inside one passage, if any.
  const [selection, setSelection] = useState<{ blockId: string; text: string } | null>(null);
  // The passage a note is being written on, while the composer is open.
  const [composer, setComposer] = useState<ReaderAnchor | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const appliedLink = useRef<string | null>(null);
  // A just-posted note, scrolled into view once the refreshed list renders it.
  const reveal = useRef<string | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 900px)");
    const update = () => setWide(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const found = await fetchItemForUrl(FRONTIER_SOURCE)
          ?? await fetchItemForUrl(FRONTIER_SOURCE.replace("://", "://www."));
        if (cancelled) return;
        setItem(found);
        const foundNotes = found ? await fetchNotesForItem(found.id) : [];
        if (cancelled) return;
        setNotes(foundNotes ?? []);
        setNotesFailed(foundNotes === null);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [retry]);

  const refreshNotes = useCallback(async () => {
    if (!item) return;
    const fresh = await fetchNotesForItem(item.id);
    setNotesFailed(fresh === null);
    if (fresh) setNotes(fresh);
  }, [item]);
  // A check of a selected paragraph can store only that selection. It must not
  // be presented as the complete essay.
  const articleText = item?.checked_scope === "paragraph" ? null : item?.full_text;
  const blocks = useMemo(
    () => promoteHeadings(stripLeadingBlocks(parseReaderText(articleText), [TITLE, DATE]), SECTION_TITLES),
    [articleText],
  );
  const { byBlock, unanchored } = useMemo(() => mapNotesToBlocks(blocks, notes), [blocks, notes]);
  // A passage too short to anchor a note, such as a section title, gets no
  // "Add a note" button: the note would only ever land in the unmatched list.
  const noteable = useMemo(() => new Set(blocks.filter((block) => anchorForSelection(block, block.text)).map((block) => block.id)), [blocks]);
  const headings = blocks.filter((block) => block.kind === "heading");
  const minutes = Math.max(1, Math.ceil((articleText?.split(/\s+/).length ?? 0) / 230));
  const activeNotes = selectedBlock === "unanchored" ? unanchored : byBlock.get(selectedBlock ?? "") ?? [];

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
      if (loading || failed) return;
      const link = window.location.search + window.location.hash;
      // Refreshing a rating must not move the reader or reopen a closed note.
      if (appliedLink.current === link) return;
      appliedLink.current = link;
      const query = new URLSearchParams(window.location.search);
      const fragment = window.location.hash.slice(1);
      const fragmentBlock = blocks.some((block) => block.id === fragment) ? fragment : null;
      if (fragment && !fragmentBlock) return; // Extension/auth/skip links keep their own target.
      const noteId = fragmentBlock ? null : query.get("note");
      const target = fragmentBlock ?? (noteId
        ? [...byBlock].find(([, group]) => group.some((note) => note.id === noteId))?.[0]
          ?? (unanchored.some((note) => note.id === noteId) ? "unanchored" : null)
        : query.get("passage"));
      setSelectedBlock(target);
      if (!target) return;
      setShowNotes(true);
      requestAnimationFrame(() => {
        document.getElementById(target)?.scrollIntoView({ block: "start" });
        if (noteId) scrollNoteIntoView(noteId);
      });
    };
    syncLink();
    window.addEventListener("popstate", syncLink);
    window.addEventListener("hashchange", syncLink);
    return () => {
      window.removeEventListener("popstate", syncLink);
      window.removeEventListener("hashchange", syncLink);
    };
  }, [blocks, byBlock, unanchored, loading, failed]);

  useEffect(() => {
    const noteId = reveal.current;
    if (!noteId || !notes.some((note) => note.id === noteId)) return;
    reveal.current = null;
    requestAnimationFrame(() => scrollNoteIntoView(noteId));
  }, [notes]);

  useEffect(() => {
    if (!shareStatus) return;
    const timer = setTimeout(() => setShareStatus(""), 4000);
    return () => clearTimeout(timer);
  }, [shareStatus]);

  useEffect(() => {
    const measure = () => {
      const article = articleRef.current;
      if (!article) return;
      const { top, height } = article.getBoundingClientRect();
      const distance = Math.max(1, height - window.innerHeight + 130);
      setProgress(Math.max(0, Math.min(100, ((130 - top) / distance) * 100)));
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [blocks, selectedBlock, showNotes]);

  async function sharePassage(blockId: string) {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("passage", blockId);
    window.history.replaceState(null, "", url);
    appliedLink.current = url.search;
    try {
      await navigator.clipboard.writeText(url.href);
      setShareStatus("Passage link copied.");
    } catch {
      setShareStatus("The address bar now links to this passage. Copy it to share.");
    }
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
    setShareStatus("Your note is posted. It shows as “Needs more ratings” until other readers rate it.");
  }

  const howToAdd = <p className="reader-margin-hint">Highlight any words in the essay, or choose <kbd>Add a note</kbd> under a passage, to write your own.</p>;

  const renderNotes = (group: NoteRow[]) => group.map((note) => (
    <ReaderNoteCard key={note.id} note={note} projectSlug={item?.projectSlug ?? "web"} />
  ));

  return (
    <ReaderNotesProvider notes={notes} onRefresh={refreshNotes}>
      <div className="frontier-reader">
        <SystemTheme />
        <a className="reader-skip" href="#essay">Skip to essay</a>
        <header className="reader-header">
          <a className="reader-brand" href={import.meta.env.BASE_URL} aria-label="Common Notes home">
            <svg width="25" height="25" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"/><path d="M8 8h8M8 12h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"/></svg>
            Common Notes
          </a>
          <ReaderExtensionLink />
          {blocks.length > 0 && <div className="reader-progress" style={{ width: `${progress}%` }} aria-hidden="true" />}
        </header>

        <main className="reader-shell">
          <div className="reader-intro">
            <p className="reader-eyebrow">An essay with Common Notes</p>
            <h1>{TITLE}</h1>
            <p className="reader-byline">Dario Amodei <span aria-hidden="true">·</span> {DATE}{blocks.length > 0 && <> <span aria-hidden="true">·</span> {minutes} min read</>}</p>
            <p className="reader-deck">Read the essay. Add a note to any passage. Rate the notes other readers leave.</p>
            <div className="reader-toolbar">
              <a href={FRONTIER_SOURCE} target="_blank" rel="noopener noreferrer">Read the original <span aria-hidden="true">↗</span></a>
              {blocks.length > 0 && <button type="button" className="reader-toggle" aria-pressed={showNotes} onClick={() => setShowNotes((value) => !value)}>
                {showNotes ? "Hide notes" : "Show notes"}<span className="reader-count">{notes.length}</span>
              </button>}
            </div>
          </div>

          {loading ? <div className="reader-notice" id="essay" tabIndex={-1} role="status">Loading the reading edition…</div>
            : failed ? <div className="reader-notice" id="essay" tabIndex={-1} role="alert"><h2>The reading edition couldn’t load.</h2><p>Please try again, or follow the link above to read the original.</p><button className="reader-action" onClick={() => setRetry((value) => value + 1)}>Try again</button></div>
            : blocks.length === 0 ? <div className="reader-notice" id="essay"><span className="reader-eyebrow">The reading edition</span><h2>This essay is being prepared.</h2><p>You can read the complete essay on Dario Amodei’s website. This page will show the text and its Common Notes when they’re available.</p><a className="reader-action" href={FRONTIER_SOURCE} target="_blank" rel="noopener noreferrer">Read on Dario’s website <span aria-hidden="true">↗</span></a></div>
            : <>
              {notesFailed && <div className="reader-note-error" role="alert">The notes couldn’t load. You can still read the essay. <button onClick={() => void refreshNotes()}>Retry notes</button></div>}
              {!wide && showNotes && !notesFailed && notes.length === 0 && <p className="reader-note-error">No notes on this essay yet. Tap “Add a note” under any passage to write the first.</p>}
              <div className={`reader-layout ${showNotes ? "" : "reader-layout-quiet"}`}>
                <nav className="reader-contents" aria-label="Essay contents"><p>In this essay</p><a href="#essay">Introduction</a>{headings.map((heading) => <a key={heading.id} href={`#${heading.id}`}>{heading.text}</a>)}</nav>
                <article id="essay" ref={articleRef} className="reader-essay" aria-label={TITLE}>
                  {blocks.map((block) => {
                    const group = byBlock.get(block.id) ?? [];
                    const open = selectedBlock === block.id;
                    const partial = selection?.blockId === block.id ? anchorForSelection(block, selection.text) : null;
                    return <section id={block.id} key={block.id} className={`reader-passage ${showNotes && group.length ? "reader-passage-noted" : ""} ${open ? "reader-passage-active" : ""}`}>
                      <BlockText block={block} />
                      <div className="reader-passage-actions">
                        {showNotes && group.length > 0 && <button className="reader-note-trigger" onClick={() => setSelectedBlock(open ? null : block.id)} aria-expanded={open} aria-controls={wide ? "reader-margin" : `inline-${block.id}`}>
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
                        <button className="reader-passage-link" aria-label={`Copy link to passage: ${block.text.slice(0, 60)}`} onClick={() => void sharePassage(block.id)}>Link <span aria-hidden="true">↗</span></button>
                      </div>
                      {!wide && showNotes && open && group.length > 0 && <div id={`inline-${block.id}`} className="reader-inline-notes">{renderNotes(group)}</div>}
                    </section>;
                  })}
                  {showNotes && unanchored.length > 0 && <section id="unanchored" className="reader-unanchored"><h2>More notes on this essay</h2><p>These notes refer to passages we couldn’t match to this copy of the text.</p><button className="reader-note-trigger" aria-expanded={selectedBlock === "unanchored"} onClick={() => setSelectedBlock(selectedBlock === "unanchored" ? null : "unanchored")}>View {unanchored.length} {unanchored.length === 1 ? "note" : "notes"}</button>{!wide && selectedBlock === "unanchored" && <div className="reader-inline-notes">{renderNotes(unanchored)}</div>}</section>}
                  <p className="reader-source-credit">Essay by Dario Amodei. <a href={FRONTIER_SOURCE} target="_blank" rel="noopener noreferrer">View the original and its links ↗</a></p>
                </article>
                {wide && showNotes && <aside id="reader-margin" className="reader-margin" aria-label="Common Notes on the selected passage"><div className="reader-margin-sticky"><div className="reader-margin-heading"><h2>Common Notes</h2>{activeNotes.length > 0 && <button aria-label="Close passage notes" onClick={() => setSelectedBlock(null)}>×</button>}</div>{activeNotes.length > 0 ? <div className="reader-margin-cards">{renderNotes(activeNotes)}</div> : <div className="reader-margin-about"><span className="reader-note-symbol" aria-hidden="true">✳</span><p>{notes.length ? "A little more context, right where you need it." : "An open invitation to add context."}</p><p>{notes.length ? "Select a note beside a passage to see its sources and community ratings." : notesFailed ? "Notes are temporarily unavailable." : "There are no notes on this essay yet. Be the first."}</p>{!notesFailed && howToAdd}<p className="reader-rating-explanation">A note’s rating is about whether it adds useful context, not whether you agree with the essay.</p></div>}</div></aside>}
              </div>
            </>}

          {!loading && !failed && blocks.length === 0 && notes.length > 0 && <section className="reader-pending-notes" id="unanchored" aria-label="Notes on the original essay"><h2>Notes on the original essay</h2>{renderNotes(notes)}</section>}

          <div className="reader-extension-footer"><ReaderExtensionLink variant="card" /></div>
          <footer className="reader-footer"><a href={import.meta.env.BASE_URL}>Common Notes</a><span>Context worth reading.</span><a href={`${import.meta.env.BASE_URL}privacy/`}>Privacy</a></footer>
        </main>
        {composer && item && <ReaderWriteNote item={item} anchor={composer} onClose={() => setComposer(null)} onPosted={onPosted} />}
        <p className="reader-share-status" role="status" aria-live="polite">{shareStatus}</p>
      </div>
    </ReaderNotesProvider>
  );
}
