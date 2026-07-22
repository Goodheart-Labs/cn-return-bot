import "../assets/tailwind.css";
import { defineContentScript } from "#imports";
import { mountInlineNotes } from "../utils/mountInlineNotes";
import { registerDevReloadHook } from "../utils/devReload";

// Substack is injected by default (items store substack.com canonical URLs).
// Custom-domain newsletters and other text sites go through the opt-in
// generic script instead.
export default defineContentScript({
  matches: ["*://*.substack.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    registerDevReloadHook(ctx);
    await mountInlineNotes(ctx);
  },
});
