import { buttonVariants } from "@cn/ui/Button";
import { Modal } from "@cn/ui/Modal";
import { INSTALL, type Route } from "../lib/routing";
import { RouteLink } from "./RouteLink";

/** Writing a note happens in the browser extension, on the page itself, so the
 *  note is anchored to the text the writer selected. The website's "Write a
 *  note" button explains how, and leads to the install section. */
export function WriteNoteModal({ open, onClose, navigate }: { open: boolean; onClose: () => void; navigate: (route: Route) => void }) {
  if (!open) return null;
  return (
    <Modal title="Write a note" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-fg-secondary">
          Get the browser extension, open the original page, select the text your note is about, right-click it, and choose "Write a
          Common Note on this".
        </p>
        <RouteLink
          to={INSTALL}
          navigate={(route) => {
            onClose();
            navigate(route);
          }}
          className={buttonVariants({ variant: "primary" })}
        >
          Get the extension
        </RouteLink>
      </div>
    </Modal>
  );
}
