const MAX_QUOTE_CHARS = 250;

export type RequestState = "saving" | "saved" | "error";

/** Confirmation card for "Request a Common Note": the request row is already
 *  being written when this renders — the card just tells the reader what
 *  happened and that the inline-notes-everywhere feature is still being built. */
export function RequestNotePopover({ selection, state, error, onClose }: {
  selection: string;
  state: RequestState;
  error: string | null;
  onClose: () => void;
}) {
  const quote = selection.length > MAX_QUOTE_CHARS ? `${selection.slice(0, MAX_QUOTE_CHARS)}…` : selection;

  return (
    <div className="w-[380px] max-w-[calc(100vw-32px)] max-h-[70vh] overflow-y-auto bg-white dark:bg-gray-900 dark:border dark:border-gray-700 rounded-xl p-4 space-y-3 shadow-2xl">
      <div className="flex justify-between items-center">
        <h2 className="text-base font-extrabold text-gray-900 dark:text-gray-100">Request a Common Note</h2>
        <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">✕</button>
      </div>
      <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-3 text-gray-600 dark:text-gray-300 italic text-sm">
        “{quote}”
      </blockquote>
      {state === "saving" ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span className="inline-block w-4 h-4 border-2 border-gray-300 dark:border-gray-600 border-t-blue-600 rounded-full animate-spin" />
          Saving your request…
        </div>
      ) : state === "error" ? (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      ) : (
        <p className="text-sm text-gray-800 dark:text-gray-200">
          ✓ Thanks for requesting a note — this helps us figure out which platforms to run Common Notes on.
        </p>
      )}
    </div>
  );
}
