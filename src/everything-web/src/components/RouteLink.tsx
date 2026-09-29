import type { MouseEvent, ReactNode } from "react";
import { routeHref, type Route } from "../lib/routing";

/** A link that moves inside the app. It is a real link, so it can be opened
 *  in a new tab, but a plain click navigates without reloading the page. */
export function RouteLink({ to, navigate, className, current, children }: {
  to: Route;
  navigate: (route: Route) => void;
  className?: string;
  current?: boolean;
  children: ReactNode;
}) {
  const onClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  return (
    <a href={routeHref(to)} onClick={onClick} aria-current={current ? "page" : undefined} className={className}>
      {children}
    </a>
  );
}
