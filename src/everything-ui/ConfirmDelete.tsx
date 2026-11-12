import { useRef, useState } from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { TrashIcon } from "./icons";
import { useOutsidePress } from "./useOutsidePress";

/** A quiet trash button that asks once before it deletes. The first press
 *  swaps the icon in place for a red Delete and a Cancel, in the text size of
 *  the row around it, so asking takes no box and moves nothing else. A press
 *  outside, or Escape, takes the question back. */
export function ConfirmDelete({ label, iconSize, onDelete }: {
  /** The trash button's accessible name and tooltip, such as "Delete note". */
  label: string;
  iconSize: string | number;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useOutsidePress(ref, confirming, () => setConfirming(false));
  // Only the two buttons can hold focus while asking, so they listen for Escape.
  const cancelOnEscape = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") setConfirming(false);
  };

  if (!confirming) {
    return (
      <IconButton label={label} onClick={() => setConfirming(true)} className="hover:bg-negative-soft hover:text-negative">
        <TrashIcon size={iconSize} aria-hidden />
      </IconButton>
    );
  }
  return (
    <span
      ref={ref}
      role="group"
      aria-label={label}
      className="inline-flex h-6 items-center gap-2"
    >
      <Button
        variant="danger"
        autoFocus
        onKeyDown={cancelOnEscape}
        onClick={() => {
          setConfirming(false);
          onDelete();
        }}
      >
        Delete
      </Button>
      <Button variant="quiet" onKeyDown={cancelOnEscape} onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}
