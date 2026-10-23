import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@cn/ui/Button";
import { cardVariants } from "@cn/ui/Card";
import { cn } from "@cn/ui/cn";
import { useOutsidePress } from "@cn/ui/useOutsidePress";

/* The pieces both dashboard tables are built from. */

export const CELL = "border-b border-line px-3 py-2.5 align-top";
export const NUMBER_CELL = cn(CELL, "whitespace-nowrap text-right tabular-nums");
export const SUBLINE = "mt-0.5 text-xs text-fg-muted";

/** A column of a dashboard table: its heading and what the heading's
 *  explanation says. */
export interface Column {
  label: string;
  explanation: string;
  align: "left" | "right";
}

/** A column heading whose explanation opens on click, in a small card below
 *  it. A second click, a press outside the card, or Escape closes it. */
function ColumnHeading({ column }: { column: Column }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLTableCellElement>(null);
  useOutsidePress(ref, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <th ref={ref} scope="col" className={cn(CELL, "relative whitespace-nowrap font-medium text-fg-muted", column.align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="rounded-control underline decoration-dotted underline-offset-4 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {column.label}
      </button>
      {open && (
        <div
          role="note"
          className={cn(
            cardVariants({ elevation: "floating" }),
            "absolute top-full z-10 mt-1 w-72 whitespace-normal p-3 text-left text-xs font-normal text-fg-secondary",
            column.align === "right" ? "right-0" : "left-0",
          )}
        >
          {column.explanation}
        </div>
      )}
    </th>
  );
}

/** A table with explained column headings, which scrolls sideways on a
 *  narrow screen instead of squeezing its columns. */
export function DashboardTable({ columns, children }: { columns: readonly Column[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <ColumnHeading key={column.label} column={column} />
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** Reveals the next rows of a table that holds more than it shows. */
export function ShowMore({ shown, total, step, onMore }: { shown: number; total: number; step: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <Button variant="secondary" className="mt-3" onClick={onMore}>
      Show {Math.min(step, total - shown)} more
    </Button>
  );
}

/** What a section shows while its data loads or after it failed. */
export function LoadState({ error, onRetry }: { error: Error | null; onRetry: () => void }) {
  if (!error) return <p className="text-sm text-fg-muted">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-negative">{error.message}</p>
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export const postCount = (n: number) => (n === 1 ? "1 post" : `${n} posts`);
