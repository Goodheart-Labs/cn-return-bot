import { cva } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/** The small label that marks a section, in sentence case like all our text. */
export const eyebrowVariants = cva("text-xs font-semibold text-fg-muted");

/** Quoted material: a source quote, a claim's context, a selected passage. It
 *  hangs off a rail on the left. */
export function Quote({ className, ...props }: ComponentProps<"blockquote">) {
  return <blockquote className={cn("border-l-2 border-line-strong pl-3 text-sm italic text-fg-secondary", className)} {...props} />;
}
