import { useEffect, useRef, type ReactNode } from "react";
import { FLOATING_CARD } from "./classes";
import { IconButton } from "./IconButton";

/** The one modal shell: a centred card with a title row and a close button,
 *  over a dimmed page. It is the browser's own <dialog> element opened with
 *  showModal(), so the browser handles the Escape key, keeps keyboard focus
 *  inside, and lays the card above everything else on the page, including a
 *  host page's own layers when the extension shows it. The modal is open for
 *  as long as it is mounted.
 *
 *  A click that both starts and ends on the dimmed area closes it, so a text
 *  selection dragged out of the card does not. */
export function Modal({ title, onClose, widthClassName = "max-w-sm", children }: {
  title: string;
  onClose: () => void;
  widthClassName?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    // The dialog element itself only receives clicks on the dimmed area around
    // the card. Keyboard users close the modal with Escape instead, which the
    // browser handles and reports through onClose.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialog}
      aria-label={title}
      onClose={onClose}
      onMouseDown={(e) => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (pressedOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
      className={`w-full bg-transparent p-4 backdrop:bg-black/40 ${widthClassName}`}
    >
      <div className={`${FLOATING_CARD} max-h-[85vh] space-y-3 overflow-y-auto p-6`}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <span className="text-xl leading-none">×</span>
          </IconButton>
        </div>
        {children}
      </div>
    </dialog>
  );
}
