import { createRoot, type Root } from "react-dom/client";
import { createShadowRootUi } from "#imports";
import type { ContentScriptContext } from "#imports";
import type { RequestProgress } from "../../everything-shared/requestProgress";
import { RequestProgressCard } from "../components/RequestProgressCard";
import { isPageDark } from "./pageTheme";

/* The shared stylesheet only carries host rules for the elements it names, so
 * this mount injects its own. It sits in the same corner as the transient
 * status card, one notch higher so the two never cover each other while the
 * status card is still fading out. The rule is written as
 * :host(common-notes-progress) rather than a bare :host, because the argument
 * raises its specificity above WXT's own :host reset. */
const HOST_STYLE = `
:host(common-notes-progress) {
  position: fixed !important;
  bottom: 72px !important;
  right: 16px !important;
  z-index: 2147483001 !important;
}`;

/** The mounted card's handle: re-render it with the next state, or remove it.
 *  Re-rendering keeps the component's own state, so an opened readout and the
 *  fade timer survive an update. */
export interface RequestProgressHandle {
  update: (progress: RequestProgress) => void;
  teardown: () => void;
}

export async function mountRequestProgress(
  ctx: ContentScriptContext,
  params: { onJump?: () => void; onDismiss: () => void },
): Promise<RequestProgressHandle> {
  let root: Root | null = null;
  let progress: RequestProgress = { kind: "saved" };
  const render = () =>
    root?.render(<RequestProgressCard progress={progress} onJump={params.onJump} onDismiss={params.onDismiss} />);
  const ui = await createShadowRootUi(ctx, {
    name: "common-notes-progress",
    position: "inline",
    anchor: "body",
    onMount(container, shadow) {
      const style = document.createElement("style");
      style.textContent = HOST_STYLE;
      shadow.appendChild(style);
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      root = createRoot(container);
      render();
      return root;
    },
    onRemove(mounted) {
      mounted?.unmount();
    },
  });
  ui.mount();
  return {
    update: (next) => {
      progress = next;
      render();
    },
    teardown: () => ui.remove(),
  };
}
