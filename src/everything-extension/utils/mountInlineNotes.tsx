import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { originalsFirst } from "../../everything-shared/noteScore";
import { fetchItemForUrl, fetchNotesForItem, fetchReaderCanonical, isSubstackReaderUrl, normalizePageUrl } from "../../everything-shared/notesQuery";
import type { NoteRow } from "../../everything-shared/types";
import { indexContainer, findQuoteRange } from "./anchor";
import { InlineNotesApp, type AnchoredGroup } from "../components/InlineNotes";

const HIGHLIGHT_NAME = "common-note";
const REANCHOR_DEBOUNCE_MS = 600;

/** The element holding the readable text: Substack's article body when
 *  present, else the page's main/article, else body. */
function findContainer(): Element {
  return (
    document.querySelector("article .available-content") ??
    document.querySelector("article") ??
    document.querySelector("main") ??
    document.body
  );
}

/** Group an item's notes per claim, originals before improvements. */
function groupByClaim(notes: NoteRow[]): { claimId: string; notes: NoteRow[] }[] {
  const byId = new Map<string, NoteRow[]>();
  for (const note of notes) {
    if (!note.claim) continue;
    const list = byId.get(note.claim_id);
    if (list) list.push(note);
    else byId.set(note.claim_id, [note]);
  }
  return [...byId.entries()].map(([claimId, group]) => ({ claimId, notes: [...group].sort(originalsFirst) }));
}

/** Anchor every claim group to a Range. Candidates in reliability order:
 *  healed live wording, captured quote, wider paragraph. */
function anchorGroups(container: Element, groups: { claimId: string; notes: NoteRow[] }[]): AnchoredGroup[] {
  const index = indexContainer(container);
  const anchored: AnchoredGroup[] = [];
  for (const { claimId, notes } of groups) {
    const claim = notes[0]!.claim!;
    const candidates = [claim.updated_quote, claim.context_quote, claim.context_paragraph];
    let range: Range | null = null;
    for (const candidate of candidates) {
      if (candidate) range = findQuoteRange(index, candidate);
      if (range) break;
    }
    if (range) anchored.push({ claimId, primary: notes[0]!, alternatives: notes.slice(1), range });
  }
  console.info(`[common-notes] anchored ${anchored.length}/${groups.length} claims on this page`);
  return anchored;
}

/** Tint the anchored passages via the CSS Custom Highlight API — no host-DOM
 *  mutation, so host-page frameworks never notice us. The ::highlight rule
 *  must live in the DOCUMENT (the highlighted text is light DOM). */
function applyHighlights(ranges: Range[]) {
  const highlights = (CSS as any).highlights;
  if (!highlights) return; // old Firefox ESR: badges only, no tint
  if (!document.getElementById("common-notes-highlight-style")) {
    const style = document.createElement("style");
    style.id = "common-notes-highlight-style";
    style.textContent = `::highlight(${HIGHLIGHT_NAME}) { background-color: rgba(59, 130, 246, 0.16); }`;
    document.head.appendChild(style);
  }
  if (ranges.length === 0) highlights.delete(HIGHLIGHT_NAME);
  else highlights.set(HIGHLIGHT_NAME, new (globalThis as any).Highlight(...ranges));
}

/** Resolve `href` to an ingested item, anchor its claims, mount the overlay.
 *  Returns a teardown for the mounted overlay, or null when the page isn't
 *  ingested. */
async function mountForUrl(ctx: ContentScriptContext, href: string): Promise<(() => void) | null> {
  const readerCanonical = isSubstackReaderUrl(href) ? await fetchReaderCanonical(href) : null;
  const pageUrl = readerCanonical ? normalizePageUrl(readerCanonical) : normalizePageUrl(href, document);
  const item = await fetchItemForUrl(pageUrl);
  console.info(`[common-notes] ${pageUrl} → ${item ? `item "${item.title ?? item.id}"` : "no ingested item"}`);
  if (!item) return null;
  // Mount even with zero notes: the write-from-selection flow works on any
  // ingested page, and its first note appears via refresh().
  let groups = groupByClaim(await fetchNotesForItem(item.id));

  let reactRoot: Root | null = null;

  // Re-query the container every render: SPA navigations can replace the
  // article element after we mount, and anchoring against a detached node
  // finds nothing forever.
  const render = () => {
    const anchored = anchorGroups(findContainer(), groups);
    applyHighlights(anchored.map((g) => g.range));
    reactRoot?.render(<InlineNotesApp groups={anchored} item={item} onPosted={refresh} />);
  };

  const refresh = async () => {
    groups = groupByClaim(await fetchNotesForItem(item.id));
    render();
  };

  const ui = await createShadowRootUi(ctx, {
    name: "common-notes-ui",
    position: "inline",
    anchor: "body",
    onMount(uiContainer, _shadow, _shadowHost) {
      // Host geometry lives in assets/tailwind.css (`:host(common-notes-ui)`)
      // — inline styles set here are dead on arrival, WXT's shadow reset
      // (`:host{all:initial !important}`) overrides them.
      uiContainer.style.position = "relative";
      reactRoot = createRoot(uiContainer);
      render();
      return reactRoot;
    },
    onRemove(root) {
      root?.unmount();
      (CSS as any).highlights?.delete(HIGHLIGHT_NAME);
    },
  });
  ui.mount();

  // Host pages hydrate/lazy-load/swap the article; re-anchor after the dust
  // settles. Observe documentElement, not body — SPAs can replace the body
  // node, which would orphan the observer. Safe from self-triggering: our UI
  // renders into a shadow root, which light-DOM observers don't see into.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(render, REANCHOR_DEBOUNCE_MS);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  return () => {
    observer.disconnect();
    clearTimeout(timer);
    ui.remove();
  };
}

/** Entry for both the Substack/static and the opt-in generic content scripts.
 *  Substack and other Substack-like readers are SPAs: the content script is
 *  injected once, but in-app navigation swaps the article via pushState with no
 *  reload. Re-resolve the item + re-anchor on every URL change so notes appear
 *  on posts reached by clicking through, not just on hard loads. */
export async function mountInlineNotes(ctx: ContentScriptContext): Promise<void> {
  let cleanup: (() => void) | null = null;
  let seq = 0;
  const remount = async (href: string) => {
    const mine = ++seq;
    cleanup?.();
    cleanup = null;
    const teardown = await mountForUrl(ctx, href);
    // A newer navigation superseded this one mid-resolve: drop the stale mount.
    if (mine !== seq) return teardown?.();
    cleanup = teardown;
  };
  await remount(location.href);
  // On Navigation-API browsers this event fires BEFORE the navigation commits
  // — location.href may still be the PREVIOUS page — so resolve the item from
  // the event's destination URL, never from location.
  ctx.addEventListener(window, "wxt:locationchange", (event) => void remount(String(event.newUrl)));
  ctx.onInvalidated(() => cleanup?.());
}
