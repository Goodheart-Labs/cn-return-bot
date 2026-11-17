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

/** The one title of a page. */
export function PageTitle({ className, children, ...props }: ComponentProps<"h1">) {
  return <h1 className={cn("font-title text-3xl font-bold text-fg text-balance", className)} {...props}>{children}</h1>;
}

/** The title of a section inside a page. */
export function SectionTitle({ className, children, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("font-title text-xl font-bold text-fg text-balance", className)} {...props}>{children}</h2>;
}
