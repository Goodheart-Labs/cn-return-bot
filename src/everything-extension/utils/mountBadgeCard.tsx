import { createRoot, type Root } from "react-dom/client";
import type { ContentScriptContext } from "#imports";
import { BadgeCard, type BadgeMark } from "../components/BadgeCard";
import { isPageDark } from "./pageTheme";
import { createOverlayUi } from "./overlayUi";

/* The card hangs below the badge it explains. It lines up with the badge's
 * right edge, or with its left edge when the badge sits in the left half of
 * the window, as it does on YouTube's thumbnails. Pinning that edge lets the
 * card be as wide as its sentence. The host element is fixed to the viewport,
 * so its place is computed once from the badge's box when it opens. It never
 * drifts away from the badge, because a scroll moves the badge out from under
 * the mouse and that closes the card. The coordinates are CSS variables
 * set on the host element, because WXT's own :host reset would win over plain
 * inline styles. */
const HOST_STYLE = `
:host(common-notes-badge-card) {
  position: fixed !important;
  top: var(--cn-badge-card-top) !important;
  left: var(--cn-badge-card-left) !important;
  right: var(--cn-badge-card-right) !important;
  z-index: 2147483001 !important;
}`;

const GAP_BELOW_BADGE_PX = 6;
const VIEWPORT_MARGIN_PX = 8;

export interface BadgeCardHandle {
  toggle: (badge: HTMLElement, mark: BadgeMark, noun: "post" | "video") => void;
  teardown: () => void;
}

/** Mounts one shadow root for the listing badges' explanation card. It stays
 *  mounted and empty until a badge is clicked. The card closes in two ways
 *  only: a second click on the same badge, or the mouse leaving the badge. */
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

  let openFor: HTMLElement | null = null;
  const close = () => {
    openFor = null;
    root?.render(null);
  };

  const toggle = (badge: HTMLElement, mark: BadgeMark, noun: "post" | "video") => {
    if (openFor === badge) return close();
    openFor = badge;
    const box = badge.getBoundingClientRect();
    const inLeftHalf = box.left < innerWidth / 2;
    const host = ui.shadowHost.style;
    host.setProperty("--cn-badge-card-top", `${box.bottom + GAP_BELOW_BADGE_PX}px`);
    host.setProperty("--cn-badge-card-left", inLeftHalf ? `${Math.max(VIEWPORT_MARGIN_PX, box.left)}px` : "auto");
    host.setProperty("--cn-badge-card-right", inLeftHalf ? "auto" : `${Math.max(VIEWPORT_MARGIN_PX, innerWidth - box.right)}px`);
    ui.uiContainer.classList.toggle("dark", isPageDark());
    root?.render(<BadgeCard mark={mark} noun={noun} />);
    badge.addEventListener("mouseleave", () => openFor === badge && close(), { once: true });
  };

  return {
    toggle,
    teardown: () => {
      close();
      ui.remove();
    },
  };
}
