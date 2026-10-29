import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "./cn";

/** The frame of a page's content below the header: centred, with the same
 *  side and top spacing everywhere. A `form` page holds one narrow column, a
 *  `content` page cards and tables, and a `wide` page a feed with a margin
 *  beside it. A `full` page uses the whole window, because its note cards
 *  lay out their own columns or its controls need the room. A page with a
 *  sidebar has its own frame (SidebarLayout). */
export const pageVariants = cva("mx-auto w-full px-4 py-8 md:px-8", {
  variants: { width: { form: "max-w-xl", content: "max-w-5xl", wide: "max-w-6xl", full: "" } },
  defaultVariants: { width: "content" },
});

export function Page({ width, className, ...props }: ComponentProps<"main"> & VariantProps<typeof pageVariants>) {
  return <main className={cn(pageVariants({ width }), className)} {...props} />;
}
