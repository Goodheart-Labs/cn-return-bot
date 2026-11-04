import type { ReactNode } from "react";
import { cn } from "@cn/ui/cn";
import { focusRing } from "@cn/ui/focusRing";
import { ResizablePanel } from "@cn/ui/ResizablePanel";
import { SegmentedControl } from "@cn/ui/SegmentedControl";
import type { Route } from "../lib/routing";
import { RouteLink } from "./RouteLink";

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
    "flex items-center gap-2 rounded-control px-3 py-2 text-sm",
    focusRing,
    active ? "bg-tint font-medium text-fg" : "text-fg-secondary hover:bg-surface-hover hover:text-fg",
  );

/** One of the pages a sidebar lists. */
export interface SidebarPage<T extends string> {
  id: T;
  label: string;
  route: Route;
}

/** A page of a group of pages, such as the dashboard's sections: the sidebar
 *  lists every page of the group with the shown one highlighted. A phone
 *  hides the sidebar, so there the pages are a switch above the content. */
export function SidebarPagesLayout<T extends string>({ storageKey, label, pages, current, navigate, children }: {
  storageKey: string;
  /** What the group of pages is called, for screen readers. */
  label: string;
  pages: readonly SidebarPage<T>[];
  current: T;
  navigate: (route: Route) => void;
  children: ReactNode;
}) {
  return (
    <SidebarLayout
      storageKey={storageKey}
      label={label}
      sidebar={
        <nav aria-label={label} className="space-y-0.5 px-3 py-5">
          {pages.map((page) => (
            <RouteLink key={page.id} to={page.route} navigate={navigate} current={page.id === current} className={sidebarEntry(page.id === current)}>
              {page.label}
            </RouteLink>
          ))}
        </nav>
      }
    >
      <div className="mb-6 overflow-x-auto md:hidden">
        <SegmentedControl label={label} value={current} onChange={(id) => navigate(pages.find((page) => page.id === id)!.route)} options={pages} />
      </div>
      {children}
    </SidebarLayout>
  );
}
