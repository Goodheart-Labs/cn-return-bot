import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { byPromotion } from "../../everything-shared/noteScore";
import { fetchItemForUrl, fetchNotesForItem, normalizePageUrl } from "../../everything-shared/notesQuery";
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

/** Group an item's notes per claim, promoted order (shared byPromotion). */
function groupByClaim(notes: NoteRow[]): { claimId: string; notes: NoteRow[] }[] {
  const byId = new Map<string, NoteRow[]>();
  for (const note of notes) {
    if (!note.claim) continue;
    const list = byId.get(note.claim_id);
    if (list) list.push(note);
    else byId.set(note.claim_id, [note]);
  }
  return [...byId.entries()].map(([claimId, group]) => ({ claimId, notes: [...group].sort(byPromotion) }));
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

/** Entry for both the Substack/static and the opt-in generic content scripts:
 *  resolve the page to an ingested item, anchor its claims, mount the overlay. */
export async function mountInlineNotes(ctx: ContentScriptContext): Promise<void> {
  const pageUrl = normalizePageUrl(location.href, document);
  const item = await fetchItemForUrl(pageUrl);
  if (!item) return;
  // Mount even with zero notes: the write-from-selection flow works on any
  // ingested page, and its first note appears via refresh().
  let groups = groupByClaim(await fetchNotesForItem(item.id));

  const container = findContainer();
  let reactRoot: Root | null = null;

  const render = () => {
    const anchored = anchorGroups(container, groups);
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
    onMount(uiContainer, _shadow, shadowHost) {
      // Zero-footprint overlay: children are positioned in page coordinates.
      shadowHost.style.position = "absolute";
      shadowHost.style.top = "0";
      shadowHost.style.left = "0";
      shadowHost.style.width = "0";
      shadowHost.style.height = "0";
      shadowHost.style.zIndex = "2147483000";
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

  // Host pages hydrate/lazy-load; re-anchor after the dust settles. Our own
  // UI lives outside `container`, so observing it can't self-trigger.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(render, REANCHOR_DEBOUNCE_MS);
  });
  observer.observe(container, { childList: true, subtree: true, characterData: true });
  ctx.onInvalidated(() => {
    observer.disconnect();
    clearTimeout(timer);
  });
}
