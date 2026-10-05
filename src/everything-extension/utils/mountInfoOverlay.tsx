import { createRoot } from "react-dom/client";
import type { ContentScriptContext } from "#imports";
import { StatusOverlay } from "../components/StatusOverlay";
import { isPageDark } from "./pageTheme";
import { createOverlayUi } from "./overlayUi";

/** Mounts a headline-only card in its own shadow root, used to say how a note
 *  request went. The card hides itself after a few seconds; the
 *  returned teardown removes its shadow root. */
export async function mountInfoOverlay(ctx: ContentScriptContext, headline: string): Promise<() => void> {
  const ui = await createOverlayUi(ctx, {
    name: "common-notes-status",
    position: "inline",
    anchor: "body",
    onMount(container) {
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      const root = createRoot(container);
      root.render(<StatusOverlay headline={headline} />);
      return root;
    },
    onRemove(mounted) {
      mounted?.unmount();
    },
  });
  ui.mount();
  return () => ui.remove();
}
