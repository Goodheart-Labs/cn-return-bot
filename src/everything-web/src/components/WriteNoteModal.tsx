import { Modal } from "@cn/ui/Modal";
import { browserById, canInstallExtensions, detectBrowser, isListed } from "../lib/extensionStores";
import { StoreButton } from "./StoreButton";

/** Writing a note happens in the browser extension, on the page itself, so the
 *  note is anchored to the text the writer selected. The website's "Write a
 *  note" button explains that and offers the extension for the reader's
 *  browser. */
export function WriteNoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  const browser = browserById(detectBrowser());
  return (
    <Modal title="Write a note" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-fg-secondary">
          Writing a note happens in the extension. Select a sentence on the page you're reading, right-click it, and choose "Write a
          Common Note on this".
        </p>
        {!canInstallExtensions() ? (
          <p className="text-sm text-fg-secondary">The extension runs in Chrome, Firefox and Edge on a computer.</p>
        ) : isListed(browser) ? (
          <StoreButton browser={browser} size="md">
            Add to {browser.name}, it's free
          </StoreButton>
        ) : (
          <p className="text-sm text-fg-secondary">A {browser.name} version is coming soon. It works in Chrome, Firefox and Edge today.</p>
        )}
      </div>
    </Modal>
  );
}
