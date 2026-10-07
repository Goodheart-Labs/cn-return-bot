import { createRoot, type Root } from "react-dom/client";
import type { ContentScriptContext } from "#imports";
import { BADGE_CARD_WIDTH_PX, BadgeCard, type BadgeMark } from "../components/BadgeCard";
import { isPageDark } from "./pageTheme";
import { createOverlayUi } from "./overlayUi";

/* The card hangs below the badge it explains. It lines up with the badge's
 * right edge, or with its left edge when the badge sits in the left half of
 * the window, as it does on YouTube's thumbnails. The host
 * element is fixed to the viewport, so its place is computed once from the
 * badge's box when it opens, and the card closes as soon as the page scrolls.
 * The coordinates are CSS variables set on the host element, because WXT's
 * own :host reset would win over plain inline styles. */
const HOST_STYLE = `
:host(common-notes-badge-card) {
  position: fixed !important;
  top: var(--cn-badge-card-top) !important;
  left: var(--cn-badge-card-left) !important;
  z-index: 2147483001 !important;
}`;

const GAP_BELOW_BADGE_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

export interface BadgeCardHandle {
  open: (badge: HTMLElement, mark: BadgeMark, noun: "post" | "video") => void;
  teardown: () => void;
}

/** Mounts one shadow root for the listing badges' explanation card. It stays
 *  mounted and empty until a badge is clicked. Opening it for another badge
 *  moves the one card there. */
export async function mountBadgeCard(ctx: ContentScriptContext): Promise<BadgeCardHandle> {
  let root: Root | null = null;
  const ui = await createOverlayUi(ctx, {
    name: "common-notes-badge-card",
    position: "inline",
    anchor: "body",
    onMount(container, shadow) {
      const style = document.createElement("style");
      style.textContent = HOST_STYLE;
      shadow.appendChild(style);
      container.classList.add("cn-theme-root");
      root = createRoot(container);
      return root;
    },
    onRemove(mounted) {
      mounted?.unmount();
    },
  });
  ui.mount();

  const close = () => {
    root?.render(null);
    window.removeEventListener("scroll", close, { capture: true });
  };

  const open = (badge: HTMLElement, mark: BadgeMark, noun: "post" | "video") => {
    const box = badge.getBoundingClientRect();
    const aligned = box.left < innerWidth / 2 ? box.left : box.right - BADGE_CARD_WIDTH_PX;
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(aligned, innerWidth - BADGE_CARD_WIDTH_PX - VIEWPORT_MARGIN_PX));
    ui.shadowHost.style.setProperty("--cn-badge-card-top", `${box.bottom + GAP_BELOW_BADGE_PX}px`);
    ui.shadowHost.style.setProperty("--cn-badge-card-left", `${left}px`);
    ui.uiContainer.classList.toggle("dark", isPageDark());
    root?.render(<BadgeCard mark={mark} noun={noun} onClose={close} />);
    // Scroll events do not bubble, but a capture listener on the window sees
    // the scrolling of every element, including Substack's inner scroll panes.
    window.addEventListener("scroll", close, { capture: true, passive: true });
  };

  return {
    open,
    teardown: () => {
      close();
      ui.remove();
    },
  };
}
