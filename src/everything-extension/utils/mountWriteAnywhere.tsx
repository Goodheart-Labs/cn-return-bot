import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { useSession } from "../../everything-shared/auth";
import { WriteNoteOverlay } from "../components/WriteNoteOverlay";
import { isPageDark } from "./pageTheme";

/** The write-anywhere shell for UNCOVERED pages: nothing renders until the
 *  background forwards a "Write a Common Note on this" click, then the
 *  standard overlay opens with a lazily-created item. */
function WriteAnywhereApp({ pageUrl, onPosted }: { pageUrl: string; onPosted: () => void }) {
  const { session } = useSession();
  const [selection, setSelection] = useState<string | null>(null);

  useEffect(() => {
    const listener = (message: unknown) => {
      const { type, selection: selected } = (message as { type?: string; selection?: string }) ?? {};
      if (type === "cn-write-note" && selected?.trim()) setSelection(selected.trim());
    };
    const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
    runtime?.onMessage.addListener(listener);
    return () => runtime?.onMessage.removeListener(listener);
  }, []);

  if (!selection) return null;
  return (
    <WriteNoteOverlay
      item={null}
      pageForItem={{ url: pageUrl, title: document.title }}
      selection={selection}
      session={session}
      onClose={() => setSelection(null)}
      onPosted={() => {
        setSelection(null);
        onPosted();
      }}
    />
  );
}

/** Mounted instead of the notes UI when the local coverage check says this
 *  page has no item — costs no backend traffic until the user actually
 *  writes. After a successful post the page IS covered: sync the background
 *  (so the covered list includes it) and hand control back via
 *  `onCoverageChanged`, which remounts the full notes flow — the fresh note
 *  appears without a reload. */
export async function mountWriteAnywhere(
  ctx: ContentScriptContext,
  pageUrl: string,
  onCoverageChanged: () => void,
): Promise<() => void> {
  const runtime = (globalThis as any).browser?.runtime ?? (globalThis as any).chrome?.runtime;
  const handlePosted = async () => {
    await runtime?.sendMessage({ type: "cn-sync-noted-sites" })?.catch?.(() => {});
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
      root.render(<WriteAnywhereApp pageUrl={pageUrl} onPosted={() => void handlePosted()} />);
      return root;
    },
    onRemove(mounted) {
      mounted?.unmount();
    },
  });
  ui.mount();
  return () => ui.remove();
}
