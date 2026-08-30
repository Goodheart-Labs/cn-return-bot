import "../assets/tailwind.css";
import { defineContentScript } from "#imports";
import { mountInlineNotes } from "../utils/mountInlineNotes";
import { registerDevReloadHook } from "../utils/devReload";
import { initUiAnalytics } from "../utils/analytics";

// These are the text sites the static manifest injects into. Keep the matches
// below in sync with utils/staticSites.ts. Newsletters on custom domains and
// every other text site get the generic script instead, which the background's
// noted-sites sync registers.
export default defineContentScript({
  matches: ["*://*.substack.com/*"],
  cssInjectionMode: "ui",
  async main(ctx) {
    initUiAnalytics();
    registerDevReloadHook(ctx);
    await mountInlineNotes(ctx);
  },
});
