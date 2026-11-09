import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { browser } from "#imports";
import type { ContentScriptContext } from "#imports";
import { queryClient } from "@cn/features/query/queryClient";
import { Quote } from "@cn/ui/typography";
import { WriteNoteOverlay } from "../components/WriteNoteOverlay";
import { TAB_CREATOR_MESSAGE_TYPE } from "./authorFeed";
import { addCoveredPageUrl } from "./coveredPages";
import { isPageDark } from "./pageTheme";
import { createOverlayUi } from "./overlayUi";

/** The write-anywhere shell for pages we do not cover. It renders nothing until the
 *  background forwards a click on "Write a Common Note on this". Then the standard
 *  overlay opens, and the page's item is only created at that point.
 *  When the overlay opens we also ask the background who the page's creator is,
 *  so the new item lands in that creator's project. The question starts while
 *  the reader types, and posting waits for its answer. A failed lookup answers
 *  null, and the page then goes to "Around the web". */
function WriteAnywhereApp({ pageUrl, onPosted }: { pageUrl: string; onPosted: () => void }) {
  const [selection, setSelection] = useState<string | null>(null);
  const [creatorFeedUrl, setCreatorFeedUrl] = useState<Promise<string | null>>();

  useEffect(() => {
    const listener = (message: unknown) => {
      const { type, selection: selected } = (message as { type?: string; selection?: string }) ?? {};
      if (type !== "cn-write-note" || !selected?.trim()) return;
      setSelection(selected.trim());
      setCreatorFeedUrl(
        browser.runtime.sendMessage({ type: TAB_CREATOR_MESSAGE_TYPE }).then(
          (feedUrl: string | null) => feedUrl,
          () => null,
        ),
      );
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  if (!selection) return null;
  return (
    <WriteNoteOverlay
      item={null}
      pageForItem={{ url: pageUrl, title: document.title, creatorFeedUrl }}
      anchor={{ kind: "text", text: selection }}
      onClose={() => setSelection(null)}
      onPosted={() => {
        setSelection(null);
        onPosted();
      }}
    >
      <Quote>“{selection}”</Quote>
    </WriteNoteOverlay>
  );
}

/** Makes a page whose first note was just posted show its notes at once. The
 *  page goes into the local covered list, and `onCoverageChanged` remounts the
 *  full notes flow, which then finds the page covered. The background's sync,
 *  which also registers the generic script for a new site, runs without being
 *  waited for. Waiting for it held the new note back for about 7 seconds. */
export async function showNotesAfterFirstNote(pageUrl: string, onCoverageChanged: () => void): Promise<void> {
  void browser.runtime.sendMessage({ type: "cn-sync-noted-sites" }).catch(() => {});
  await addCoveredPageUrl(pageUrl).catch((err) => console.warn("[common-notes] could not cache the newly covered page:", err));
  onCoverageChanged();
}

/** Mounted in place of the notes UI when the local coverage check says this page has
 *  no item. It causes no backend traffic until the user actually writes something.
 *  Once a note is posted the page is covered, and the full notes flow takes over
 *  without a reload. */
export async function mountWriteAnywhere(
  ctx: ContentScriptContext,
  pageUrl: string,
  onCoverageChanged: () => void,
): Promise<() => void> {
  let root: Root | null = null;
  const ui = await createOverlayUi(ctx, {
    name: "common-notes-ui",
    position: "inline",
    anchor: "body",
    onMount(container) {
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <WriteAnywhereApp pageUrl={pageUrl} onPosted={() => void showNotesAfterFirstNote(pageUrl, onCoverageChanged)} />
        </QueryClientProvider>,
      );
      return root;
    },
    onRemove(mounted) {
      mounted?.unmount();
    },
  });
  ui.mount();
  return () => ui.remove();
}
