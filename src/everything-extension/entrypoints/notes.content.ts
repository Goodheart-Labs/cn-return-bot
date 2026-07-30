import "../assets/tailwind.css";
import { defineContentScript } from "#imports";
import { mountInlineNotes } from "../utils/mountInlineNotes";
import { registerDevReloadHook } from "../utils/devReload";

// First-class text sites, injected by the static manifest (keep in sync with
// background.ts STATIC_TEXT_SITES + the popup's DEFAULT_SITE). Custom-domain
// newsletters and other text sites go through the opt-in generic script
// instead.
export default defineContentScript({
  matches: ["*://*.substack.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    registerDevReloadHook(ctx);
    await mountInlineNotes(ctx);
  },
});
