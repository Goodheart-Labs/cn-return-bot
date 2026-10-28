import type { ReactNode } from "react";
import { cn } from "@cn/ui/cn";
import { ResizablePanel } from "@cn/ui/ResizablePanel";

/** How wide a sidebar starts, and how far it can be dragged. */
const SIDEBAR_WIDTH = { default: 280, min: 220, max: 420 };

/** A page with a sidebar on the left that the reader can widen by dragging,
 *  and the page's content beside it. The sidebar stays in place while the
 *  content scrolls. On a phone the sidebar is hidden, so the page shows its
 *  own way of choosing above the content. */
export function SidebarLayout({ storageKey, label = "sidebar", width = SIDEBAR_WIDTH, sidebar, children }: {
  /** Where the sidebar's width is remembered on this device. */
  storageKey: string;
  /** What the drag handle names, for screen readers. */
  label?: string;
  width?: { default: number; min: number; max: number };
  sidebar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="md:flex">
      <ResizablePanel
        storageKey={storageKey}
        label={label}
        defaultWidth={width.default}
        minWidth={width.min}
        maxWidth={width.max}
        className="hidden bg-surface md:block md:sticky md:top-14 md:h-[calc(100vh-3.5rem)]"
      >
        {sidebar}
      </ResizablePanel>
      <main className="min-w-0 flex-1 px-4 py-8 md:px-8">{children}</main>
    </div>
  );
}

/** The look of one link in a sidebar list, highlighted when it leads to the
 *  page shown. */
export const sidebarEntry = (active: boolean) =>
  cn(
    "flex items-center gap-2 rounded-control px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
    active ? "bg-tint font-medium text-fg" : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
  );
