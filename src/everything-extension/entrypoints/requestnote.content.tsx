import "../assets/tailwind.css";
import { defineContentScript, createShadowRootUi } from "#imports";
import { browser } from "#imports";
import { createRoot, type Root } from "react-dom/client";
import { RequestNotePopover, type RequestState } from "../components/RequestNotePopover";
import { registerDevReloadHook } from "../utils/devReload";
import { isPageDark, observePageTheme } from "../utils/pageTheme";

// Injected on demand by the background when the user clicks "Request a Common
// Note" on a selection — registration: "runtime" makes WXT emit
// /content-scripts/requestnote.js without registering it on any site; the menu
// click's activeTab grant authorizes the injection on whatever page the user
// is on.
export default defineContentScript({
  registration: "runtime",
  cssInjectionMode: "ui",
  async main(ctx) {
    // Repeat clicks re-run this file; only the first evaluation wires up. Set
    // synchronously so a fast second click can't double-mount.
    const w = window as { __cnRequestNoteMounted?: boolean };
    if (w.__cnRequestNoteMounted) return;
    w.__cnRequestNoteMounted = true;

    let reactRoot: Root | null = null;
    let themeRoot: HTMLElement | null = null;
    let visible = false;
    let selection = "";
    let state: RequestState = "saving";
    let error: string | null = null;

    const render = () => {
      reactRoot?.render(
        visible ? (
          <RequestNotePopover
            selection={selection}
            state={state}
            error={error}
            onClose={() => {
              visible = false;
              render();
            }}
          />
        ) : null,
      );
    };

    // Lazy: the shadow root exists only once the first request arrives.
    let uiReady: Promise<void> | null = null;
    const ensureUi = () =>
      (uiReady ??= (async () => {
        const ui = await createShadowRootUi(ctx, {
          name: "common-notes-requestnote",
          position: "inline",
          anchor: "body",
          onMount(uiContainer) {
            // Host geometry lives in assets/tailwind.css
            // (`:host(common-notes-requestnote)`) — see the note there.
            uiContainer.classList.add("cn-theme-root");
            uiContainer.classList.toggle("dark", isPageDark());
            themeRoot = uiContainer;
            reactRoot = createRoot(uiContainer);
            render();
            return reactRoot;
          },
          onRemove(root) {
            root?.unmount();
          },
        });
        ui.mount();
        observePageTheme((dark) => themeRoot?.classList.toggle("dark", dark));
      })());

    // Stale-response guard: a second request while one is in flight wins.
    let requestId = 0;

    browser.runtime.onMessage.addListener((message: unknown) => {
      if ((message as { type?: string })?.type !== "cn-request-note") return;
      const requested = (message as { selection?: string }).selection ?? "";
      const id = ++requestId;
      void (async () => {
        await ensureUi();
        selection = requested;
        state = "saving";
        error = null;
        visible = true;
        render();
        const response = (await browser.runtime
          .sendMessage({ type: "cn-request-note-run", selection: requested, pageTitle: document.title, pageUrl: location.href })
          .catch(() => null)) as { ok: boolean; error?: string } | null;
        if (id !== requestId) return;
        if (response?.ok) state = "saved";
        else {
          state = "error";
          error = response?.error ?? "Could not save the request (try reloading the page)";
        }
        render();
      })();
    });

    registerDevReloadHook(ctx);
  },
});
