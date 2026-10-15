import { cn } from "./cn";

/** The turning ring that shows work is still running. The unfilled part of
 *  the ring is transparent rather than grey, so a reader sees one turning arc
 *  instead of an arc drawn on top of a second circle. */
export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-transparent border-t-link", className)} />;
}
