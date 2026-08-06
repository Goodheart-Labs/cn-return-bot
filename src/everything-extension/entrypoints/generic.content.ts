import "../assets/tailwind.css";
import { defineContentScript } from "#imports";
import { mountInlineNotes } from "../utils/mountInlineNotes";
import { registerDevReloadHook } from "../utils/devReload";
import { initUiAnalytics } from "../utils/analytics";

// Registered at runtime (scripting.registerContentScripts) for covered
// hostnames by the background's sync, and ALSO injected directly
// (executeScript) by the sync's open-tab pass, the popup, and the write-menu
// click — the window flag makes whichever copy arrives second a no-op.
export default defineContentScript({
  registration: "runtime",
  cssInjectionMode: "ui",
  async main(ctx) {
    const flagged = window as unknown as { __cnNotesMounted?: boolean };
    if (flagged.__cnNotesMounted) return;
    flagged.__cnNotesMounted = true;
    initUiAnalytics();
    registerDevReloadHook(ctx);
    await mountInlineNotes(ctx);
  },
});
