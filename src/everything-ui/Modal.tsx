import { useLayoutEffect, useRef, type ReactNode } from "react";
import { cardVariants } from "./Card";
import { cn } from "./cn";
import { IconButton } from "./IconButton";
import { CloseIcon } from "./icons";

/** The browser's own <dialog> element opened with showModal(), over a dimmed
 *  page. The browser handles the Escape key, keeps keyboard focus inside, and
 *  lays the dialog above everything else on the page, including a host page's
 *  own layers when the extension shows it. It is open for as long as it is
 *  mounted.
 *
 *  A click that both starts and ends on the dimmed area closes it, so a text
 *  selection dragged out of the dialog does not. */
function ModalDialog({ label, onClose, className, children }: {
  label: string;
  onClose: () => void;
  className: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressedOnBackdrop = useRef(false);
  // showModal() moves focus to the first button inside. It runs before the
  // content's own effects, so a field that focuses itself on opening wins.
  useLayoutEffect(() => {
    dialog.current?.showModal();
  }, []);

  return (
    // The dialog element itself only receives clicks on the dimmed area around
    // its content. Keyboard users close it with Escape instead, which the
    // browser handles and reports through onClose. React passes a close event
    // up through the components, so a modal opened inside this one, such as
    // the sign-in form over a note, would close this one too. So only this
    // dialog's own close counts.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onMouseDown={(e) => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (pressedOnBackdrop.current && e.target === e.currentTarget) onClose(); }}
      // The dim is stronger on a dark page, where a light one disappears.
      className={cn("bg-transparent backdrop:bg-black/50 dark:backdrop:bg-black/75", className)}
    >
      {children}
    </dialog>
  );
}

/** The one modal shell: a centred card with a title row and a close button. */
export function Modal({ title, onClose, widthClassName = "max-w-sm", children }: {
  title: string;
  onClose: () => void;
  widthClassName?: string;
  children: ReactNode;
}) {
  return (
    <ModalDialog label={title} onClose={onClose} className={cn("w-full p-4", widthClassName)}>
      <div className={cn(cardVariants({ elevation: "floating" }), "max-h-[85vh] space-y-3 overflow-y-auto p-6")}>
        {/* A long title wraps, so the close button sits level with its first
          * line rather than halfway down the whole title. */}
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-lg font-extrabold text-fg">{title}</h2>
          <IconButton label="Close" onClick={onClose} className="mt-0.5">
            <CloseIcon size={16} aria-hidden />
          </IconButton>
        </div>
        {children}
      </div>
    </ModalDialog>
  );
}

/** A panel that rises from the bottom edge of a phone screen, as wide as the
 *  screen and at most 85% as tall. Its content brings its own title
 *  row and close button, and scrolls itself, so a part of it such as a reply
 *  box can stay in view. */
export function Sheet({ label, onClose, className, children }: {
  label: string;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ModalDialog label={label} onClose={onClose} className="mb-0 mt-auto w-full max-w-none p-0">
      <div className={cn(cardVariants({ elevation: "floating" }), "flex max-h-[85dvh] flex-col overflow-hidden rounded-b-none border-b-0", className)}>
        {children}
      </div>
    </ModalDialog>
  );
}
