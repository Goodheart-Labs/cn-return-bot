import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/** A card. A flat card sits in the page with a border. A floating card also
 *  casts a shadow: popovers, overlay cards, modals and menus. */
export const cardVariants = cva("cn-card bg-surface rounded-card border border-line", {
  variants: { elevation: { flat: "", floating: "shadow-floating" } },
  defaultVariants: { elevation: "flat" },
});

export function Card({ elevation, className, ...props }: ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ elevation }), className)} {...props} />;
}
