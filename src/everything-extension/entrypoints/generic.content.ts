import "../assets/tailwind.css";
import { defineContentScript } from "#imports";
import { mountInlineNotes } from "../utils/mountInlineNotes";
import { registerDevReloadHook } from "../utils/devReload";
import { initUiAnalytics } from "../utils/analytics";

// The background's sync registers this script at runtime for every covered
// hostname. It is also injected directly by the sync's pass over open tabs, by
// the popup, and by the write-menu click. The flag it sets on `window` makes
// whichever copy arrives second do nothing.
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
