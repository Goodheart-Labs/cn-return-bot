import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { browser, createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { queryClient } from "@cn/features/query/queryClient";
import { WriteNoteOverlay } from "../components/WriteNoteOverlay";
import { isPageDark } from "./pageTheme";

/** The write-anywhere shell for pages we do not cover. It renders nothing until the
 *  background forwards a click on "Write a Common Note on this". Then the standard
 *  overlay opens, and the page's item is only created at that point. */
function WriteAnywhereApp({ pageUrl, onPosted }: { pageUrl: string; onPosted: () => void }) {
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    const listener = (message: unknown) => {
      const { type, selection: selected } = (message as { type?: string; selection?: string }) ?? {};
      if (type === "cn-write-note" && selected?.trim()) setSelection(selected.trim());
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  if (!selection) return null;
  return (
    <WriteNoteOverlay
      item={null}
      pageForItem={{ url: pageUrl, title: document.title }}
      selection={selection}
      onClose={() => setSelection(null)}
      onPosted={() => {
        setSelection(null);
        onPosted();
      }}
    />
  );
}

/** Mounted in place of the notes UI when the local coverage check says this page has
 *  no item. It causes no backend traffic until the user actually writes something.
 *  Once a note is posted the page is covered. We then ask the background to sync, so
 *  that the covered list includes this page, and we call `onCoverageChanged`. The
 *  caller remounts the full notes flow, so the new note appears without a reload. */
export async function mountWriteAnywhere(
  ctx: ContentScriptContext,
  pageUrl: string,
  onCoverageChanged: () => void,
): Promise<() => void> {
  const handlePosted = async () => {
    await browser.runtime.sendMessage({ type: "cn-sync-noted-sites" }).catch(() => {});
    onCoverageChanged();
  };
  let root: Root | null = null;
  const ui = await createShadowRootUi(ctx, {
    name: "common-notes-ui",
    position: "inline",
    anchor: "body",
    onMount(container) {
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      root = createRoot(container);
      root.render(
        <QueryClientProvider client={queryClient}>
          <WriteAnywhereApp pageUrl={pageUrl} onPosted={() => void handlePosted()} />
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
