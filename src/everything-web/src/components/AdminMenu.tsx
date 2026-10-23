import { useEffect, useRef, useState } from "react";
import { cn } from "@cn/ui/cn";
import { ChevronIcon } from "@cn/ui/icons";
import { Menu, menuItemClass } from "@cn/ui/Menu";
import { useOutsidePress } from "@cn/ui/useOutsidePress";
import { BEST_NOTES, DASHBOARD, NOTE_REVIEW, type Route } from "../lib/routing";
import { RouteLink } from "./RouteLink";

const ADMIN_PAGES: readonly { route: Route; label: string }[] = [
  { route: NOTE_REVIEW, label: "Review" },
  { route: BEST_NOTES, label: "Best notes" },
  { route: DASHBOARD, label: "Dashboard" },
];

const isOnPage = (route: Route, page: Route) => route.view === page.view;

/** The header's Admin entry. A click opens a menu of the admin pages under
 *  it. Picking a page, a second click, a press outside the menu, or Escape
 *  closes it. The entry reads as the current page while an admin page is
 *  open. */
export function AdminMenu({ route, navigate, className }: { route: Route; navigate: (route: Route) => void; className: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  useOutsidePress(ref, open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  const openPage = (page: Route) => {
    setOpen(false);
    navigate(page);
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-current={ADMIN_PAGES.some((page) => isOnPage(route, page.route)) ? "page" : undefined}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className={cn(className, "inline-flex items-center gap-0.5", open && "text-fg")}
      >
        Admin
        <ChevronIcon size={16} aria-hidden className={cn("transition-transform", open ? "-rotate-90" : "rotate-90")} />
      </button>
      {open && (
        <Menu className="absolute left-0 top-full z-30 mt-2 w-44">
          <nav aria-label="Admin pages">
            {ADMIN_PAGES.map((page) => {
              const current = isOnPage(route, page.route);
              return (
                <RouteLink
                  key={page.label}
                  to={page.route}
                  navigate={openPage}
                  current={current}
                  className={cn(menuItemClass, current ? "text-link" : "text-fg-secondary hover:bg-surface-hover")}
                >
                  {page.label}
                </RouteLink>
              );
            })}
          </nav>
        </Menu>
      )}
    </div>
  );
}
