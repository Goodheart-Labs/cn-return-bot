import { useRef } from "react";

/** Writing notes moved to the browser extension (you write on the page
 *  itself, anchored to your selection) — the website's "Write a note" button
 *  stays as a teaser pointing there. */
export function WriteNoteModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const backdropPress = useRef(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onMouseDown={(e) => { backdropPress.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (backdropPress.current && e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl p-6 w-full max-w-sm space-y-4">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-extrabold">Write a note</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-gray-600">Common Notes Browser Extension Coming Soon!</p>
      </div>
    </div>
  );
}
