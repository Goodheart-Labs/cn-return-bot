import { useState, type ReactNode } from "react";

/** A quote longer than this many characters starts clamped to four lines. */
const LONG_QUOTE_CHARS = 280;

/** The words a dialog is about, the same way in every reader dialog. A long
 *  passage starts clamped, with a button that shows all of it. */
export function DialogQuote({ text, label }: { text: string; label: string }) {
  const long = text.length > LONG_QUOTE_CHARS;
  const [open, setOpen] = useState(!long);
  return <figure className="reader-dialog-quote">
    <figcaption>{label}</figcaption>
    <blockquote className={open ? "" : "reader-dialog-quote-clamped"}>“{text.trim()}”</blockquote>
    {long && <button type="button" className="reader-text-button" onClick={() => setOpen((value) => !value)}>{open ? "Show less" : "Show all"}</button>}
  </figure>;
}

/** The footer every reader dialog shares: an optional helper action on the
 *  left, then Cancel and the main action on the right. On a phone the row
 *  stacks, main action first. */
export function DialogFooter({ helper, children }: { helper?: ReactNode; children: ReactNode }) {
  return <div className="reader-dialog-footer">
    {helper && <div className="reader-dialog-helper">{helper}</div>}
    <div className="reader-dialog-actions">{children}</div>
  </div>;
}
