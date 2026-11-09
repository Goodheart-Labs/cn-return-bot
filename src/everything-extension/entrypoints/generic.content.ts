import "../assets/tailwind.css";
import { defineContentScript } from "#imports";
import { mountInlineNotes } from "../utils/mountInlineNotes";
import { registerDevReloadHook } from "../utils/devReload";
import { initUiAnalytics } from "../utils/analytics";
import { listenForLiveRequests } from "../utils/requestLive";

// The background's sync registers this script at runtime for every covered
// hostname. It is also injected directly by the sync's pass over open tabs, by
// the popup, and by the write-menu click. So a tab can get a second copy while
// the first one still runs. WXT then retires the older copy: its context is
// invalidated, and everything it started is torn down through that context.
// The newest copy takes over.
export default defineContentScript({
  registration: "runtime",
  cssInjectionMode: "ui",
  async main(ctx) {
    initUiAnalytics();
    registerDevReloadHook(ctx);
    listenForLiveRequests(ctx);
    await mountInlineNotes(ctx);
  },
});
