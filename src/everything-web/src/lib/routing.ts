import { useEffect, useState } from "react";
import { capturePageview } from "./analytics";

/* Deep links use query parameters on the static GitHub Pages path. That needs
 * no server rewrites, and it does not clash with the hash Supabase's auth flow
 * uses. The bare address is the homepage, and ?section=install opens it at the
 * install section. The note feed is ?view=notes, and a link into it reads
 * ?project=<slug>&item=<item-id>&note=<id>. The leaderboard is
 * ?view=leaderboard. */

/** Where the reader is. On the homepage, `section` names the part the page
 *  scrolls to. In the notes, a null project means the overview of all
 *  projects, and a null item means every item of the project. `note` names a
 *  shared note the feed scrolls to. */
export type Route =
  | { view: "home"; section: "install" | null }
  | { view: "notes"; project: string | null; item: string | null; note: string | null }
  | { view: "leaderboard" };

export const HOME: Route = { view: "home", section: null };
export const INSTALL: Route = { view: "home", section: "install" };
export const NOTES: Route = { view: "notes", project: null, item: null, note: null };

function readRoute(): Route {
  const q = new URLSearchParams(window.location.search);
  if (q.get("view") === "leaderboard") return { view: "leaderboard" };
  // `episode` is the old name for `item`. Links made before the rename still use it.
  const project = q.get("project");
  const item = q.get("item") ?? q.get("episode");
  const note = q.get("note");
  if (q.get("view") === "notes" || project || item || note) return { view: "notes", project, item, note };
  return { view: "home", section: q.get("section") === "install" ? "install" : null };
}

function routeSearch(route: Route): string {
  if (route.view === "leaderboard") return "?view=leaderboard";
  if (route.view === "home") return route.section ? `?section=${route.section}` : "";
  const q = new URLSearchParams();
  if (route.project) q.set("project", route.project);
  if (route.item) q.set("item", route.item);
  if (route.note) q.set("note", route.note);
  return q.size ? `?${q}` : "?view=notes";
}

/** The current route and the function that moves to another one. Moving
 *  pushes a history entry, so Back and Forward work, and counts a pageview.
 *  Routing lives entirely in query parameters, so these manual captures are
 *  the only way navigation inside the app gets counted; each runs after the
 *  URL changed so the event carries the new URL. The path is left alone, so
 *  GitHub Pages keeps serving index.html. */
export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onPop = () => {
      setRoute(readRoute());
      capturePageview();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (next: Route) => {
    window.history.pushState(null, "", `${window.location.pathname}${routeSearch(next)}`);
    setRoute(next);
    // A new page starts at the top, as it does after following any link. Back
    // and Forward are left alone, so the browser's own scroll restoration puts
    // the reader where they were.
    window.scrollTo(0, 0);
    capturePageview();
  };
  return [route, navigate];
}

/** The address of a route, for the href of a link that navigates in-app. */
export const routeHref = (route: Route): string => `${window.location.pathname}${routeSearch(route)}`;

/** A shareable link straight to one note. */
export function noteUrl(slug: string, noteId: string): string {
  return `${window.location.origin}${window.location.pathname}${routeSearch({ view: "notes", project: slug, item: null, note: noteId })}`;
}
