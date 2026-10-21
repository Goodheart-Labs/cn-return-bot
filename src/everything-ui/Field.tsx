import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { cn } from "./cn";

const FIELD = "rounded-control border border-line-input bg-surface px-3 py-1.5 text-sm text-fg placeholder:text-fg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus";

/** A one-line text field. */
export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(FIELD, className)} {...props} />;
}

/** A drop-down list of choices, styled like the text fields. */
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(FIELD, className)} {...props} />;
}

/** A phone keyboard has no Shift key to hold, so on a touch screen Enter
 *  starts a new line and the send button sends, as in most chat apps. */
const TOUCH_SCREEN = "(pointer: coarse)";

/** Enter sends a text field's form, and Shift+Enter starts a new line, the way
 *  chat apps behave. Enter goes through the form's first submit button, the
 *  same way Enter in a one-line field does. So while that button is disabled,
 *  for example because the text is too short or a post is in flight, Enter
 *  does nothing. Enter that confirms a word in an input method such as a
 *  Japanese keyboard is left alone, and so is Enter on a touch screen. */
function sendFormOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || window.matchMedia(TOUCH_SCREEN).matches) return;
  const form = event.currentTarget.form;
  if (!form) return;
  event.preventDefault();
  const submitButton = form.querySelector<HTMLButtonElement>("button:not([type]), button[type=submit]");
  if (submitButton && !submitButton.disabled) form.requestSubmit(submitButton);
}

/** A multi-line text field. Put it inside a form: Enter sends the form and
 *  Shift+Enter starts a new line, except on a touch screen. With `autoGrow` it grows with its text
 *  instead of scrolling, which suits the short composers under a note.
 *  The height is measured on every render. A field that is not displayed yet,
 *  such as one inside a dialog that opens right after this render, measures
 *  zero. Setting that would collapse the field to nothing, so it then keeps
 *  the height its `rows` give it until the next render measures for real. */
export function Textarea({ autoGrow, className, ...props }: ComponentProps<"textarea"> & { autoGrow?: boolean }) {
  return (
    <textarea
      onKeyDown={sendFormOnEnter}
      ref={autoGrow ? (el) => {
        if (!el) return;
        el.style.height = "auto";
        if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
      } : undefined}
      className={cn(FIELD, "w-full", autoGrow && "resize-none overflow-hidden", className)}
      {...props}
    />
  );
}

/** A checkbox with its label. */
export function Checkbox({ checked, onChange, disabled, className, children }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("flex items-center gap-2 cursor-pointer", className)}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-primary"
      />
      {children}
    </label>
  );
}
