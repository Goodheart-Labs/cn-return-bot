import { createRoot } from "react-dom/client";
import type { ContentScriptContext } from "#imports";
import { browser } from "#imports";
import { Modal } from "@cn/ui/Modal";
import { Quote } from "@cn/ui/typography";
import { RequestReasonForm } from "@cn/features/notes/RequestReasonForm";
import { isPageDark } from "./pageTheme";
import { createOverlayUi } from "./overlayUi";

/** Opens the card that asks why the selected words need a note. The
 *  background sends cn-passage-request-ask when the reader picks "Check these
 *  words with Common Notes". The card sends the answer back as
 *  cn-passage-request-send, and the background submits the request.
 *  Registered once per content script, whatever else is mounted on the page. */
export function listenForPassageRequests(ctx: ContentScriptContext): void {
  let close: (() => void) | null = null;
  const listener = (message: unknown) => {
    const { type, selection } = (message as { type?: string; selection?: string }) ?? {};
    if (type !== "cn-passage-request-ask" || !selection?.trim()) return;
    close?.();
    void mountPassageRequest(ctx, selection.trim()).then((teardown) => (close = teardown));
  };
  browser.runtime.onMessage.addListener(listener);
  ctx.onInvalidated(() => {
    browser.runtime.onMessage.removeListener(listener);
    close?.();
  });
}

async function mountPassageRequest(ctx: ContentScriptContext, selection: string): Promise<() => void> {
  const ui = await createOverlayUi(ctx, {
    name: "common-notes-request",
    position: "inline",
    anchor: "body",
    onMount(container) {
      container.classList.add("cn-theme-root");
      container.classList.toggle("dark", isPageDark());
      const root = createRoot(container);
      const send = (reason: string) => {
        ui.remove();
        void browser.runtime.sendMessage({ type: "cn-passage-request-send", selection, steer: reason });
      };
      root.render(
        <Modal title="Check these words" onClose={() => ui.remove()} widthClassName="max-w-[35rem]">
          <Quote>“{selection}”</Quote>
          <RequestReasonForm onSend={send} onCancel={() => ui.remove()} />
        </Modal>,
      );
      return root;
    },
    onRemove(mounted) {
      mounted?.unmount();
    },
  });
  ui.mount();
  return () => ui.remove();
}
