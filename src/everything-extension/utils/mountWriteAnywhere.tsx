import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import { useSession } from "../../everything-shared/auth";
import { WriteNoteOverlay } from "../components/WriteNoteOverlay";
import { isPageDark } from "./pageTheme";

// Keeps write-anywhere item bodies bounded; items store full transcripts
// anyway, so this is generous.
const FULL_TEXT_CAP = 200_000;

function pageFullText(): string {
  const container = document.querySelector("article") ?? document.querySelector("main") ?? document.body;
  return ((container as HTMLElement).innerText ?? "").slice(0, FULL_TEXT_CAP);
}

/** The write-anywhere shell for UNCOVERED pages: nothing renders until the
 *  background forwards a "Write a Common Note on this" click, then the
 *  standard overlay opens with a lazily-created item. */
function WriteAnywhereApp({ pageUrl }: { pageUrl: string }) {
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
      pageForItem={{ url: pageUrl, title: document.title, fullText: pageFullText() }}
      selection={selection}
      session={session}
      onClose={() => setSelection(null)}
      onPosted={() => setSelection(null)}
    />
  );
}

/** Mounted instead of the notes UI when the local coverage check says this
 *  page has no item — costs no backend traffic until the user actually
 *  writes. */
export async function mountWriteAnywhere(ctx: ContentScriptContext, pageUrl: string): Promise<() => void> {
  let root: Root | null = null;
  const ui = await createShadowRootUi(ctx, {
    name: "common-notes-ui",
    position: "inline",
    anchor: "body",
    onMount(container) {
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      root = createRoot(container);
      root.render(<WriteAnywhereApp pageUrl={pageUrl} />);
      return root;
    },
    onRemove(mounted) {
      mounted?.unmount();
    },
  });
  ui.mount();
  return () => ui.remove();
}
