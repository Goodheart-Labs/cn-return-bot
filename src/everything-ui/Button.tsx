import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/** The button styles. `primary` is the one main action of a view, `secondary`
 *  an outlined alternative, `link` a text-only action and `quiet` a
 *  low-emphasis text action. The text-only variants take their size from the
 *  surrounding text. The two boxed variants come in two sizes: `md` for
 *  controls inside the product, and `lg` for the main action of a whole page. A link that should look like a button uses these too:
 *  `<a className={buttonVariants({ variant: "secondary" })}>`. */
export const buttonVariants = cva(
  "cn-button inline-flex items-center justify-center gap-1 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
  {
    variants: {
      variant: {
        primary: "cn-button-primary rounded-control font-medium bg-primary text-on-primary hover:bg-primary-hover",
        secondary: "cn-button-secondary rounded-control font-medium border border-line-strong text-fg hover:bg-surface-hover",
        link: "text-link hover:underline",
        quiet: "text-fg-muted hover:underline",
      },
      size: { md: "", lg: "" },
    },
    compoundVariants: [
      { variant: ["primary", "secondary"], size: "md", class: "px-3 py-1.5 text-sm" },
      { variant: ["primary", "secondary"], size: "lg", class: "px-5 py-2.5 text-base font-semibold" },
    ],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({ variant, size, className, type = "button", ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
