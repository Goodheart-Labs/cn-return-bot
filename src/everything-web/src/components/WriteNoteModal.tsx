import { Modal } from "./Modal";

/** Writing notes has moved to the browser extension. There you write on the
 *  page itself, and the note is anchored to the text you selected. The
 *  website's "Write a note" button stays as a teaser that points at it. */
export function WriteNoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <Modal title="Write a note" onClose={onClose}>
      <p className="text-sm text-gray-600 dark:text-gray-300">Common Notes Browser Extension Coming Soon!</p>
    </Modal>
  );
}
