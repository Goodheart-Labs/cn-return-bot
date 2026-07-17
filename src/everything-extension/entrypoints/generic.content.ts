import "../assets/tailwind.css";
import { defineContentScript } from "#imports";
import { mountInlineNotes } from "../utils/mountInlineNotes";

// Registered at runtime (scripting.registerContentScripts) for origins the
// user enables from the popup — no blanket <all_urls> injection.
export default defineContentScript({
  registration: "runtime",
  cssInjectionMode: "ui",
  async main(ctx) {
    await mountInlineNotes(ctx);
  },
});
