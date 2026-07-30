import "../assets/tailwind.css";
import { defineContentScript } from "#imports";
import { mountInlineNotes } from "../utils/mountInlineNotes";
import { registerDevReloadHook } from "../utils/devReload";

// First-class text sites, injected by the static manifest (keep in sync with
// utils/staticSites.ts). Custom-domain newsletters and other text sites get
// the generic script registered by the background's noted-sites sync.
export default defineContentScript({
  matches: ["*://*.substack.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    registerDevReloadHook(ctx);
    await mountInlineNotes(ctx);
  },
});
