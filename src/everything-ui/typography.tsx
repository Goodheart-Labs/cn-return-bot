import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/** The small uppercase label that marks a section. */
export const eyebrowVariants = cva("text-xs font-semibold uppercase tracking-wide text-fg-subtle");

/** Quoted material: a source quote, a claim's context, a selected passage. It
 *  hangs off a rail on the left. */
export function Quote({ className, ...props }: ComponentProps<"blockquote">) {
  return <blockquote className={cn("border-l-4 border-line-strong pl-3 text-sm italic text-fg-secondary", className)} {...props} />;
}
