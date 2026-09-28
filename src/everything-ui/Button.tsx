import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/** The button styles. `primary` is the one main action of a view, `secondary`
 *  an outlined alternative, `link` a text-only action and `quiet` a
 *  low-emphasis text action. The text-only variants take their size from the
 *  surrounding text. A link that should look like a button uses these too:
 *  `<a className={buttonVariants({ variant: "secondary" })}>`. */
export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
  {
    variants: {
      variant: {
        primary: "rounded-control px-3 py-1.5 text-sm font-medium bg-primary text-on-primary hover:bg-primary-hover",
        secondary: "rounded-control px-3 py-1.5 text-sm font-medium border border-line-strong text-fg hover:bg-surface-hover",
        link: "text-link hover:underline",
        quiet: "text-fg-muted hover:underline",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export function Button({ variant, className, type = "button", ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />;
}
