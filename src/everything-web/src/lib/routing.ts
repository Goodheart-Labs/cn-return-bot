import { useEffect, useState } from "react";
import { capturePageview } from "./analytics";

/* Deep links use query parameters on the static GitHub Pages path. That needs
 * no server rewrites, and it does not clash with the hash Supabase's auth flow
 * uses. The note feed reads ?project=<slug>&item=<item-id>&note=<id>. The
 * leaderboard is ?view=leaderboard. */

/** Where the reader is. A null project means the first project in the list,
 *  and a null item means every item of the project. `note` names a shared note
 *  the feed scrolls to. */
export type Route =
  | { view: "notes"; project: string | null; item: string | null; note: string | null }
  | { view: "leaderboard" };

function readRoute(): Route {
  const q = new URLSearchParams(window.location.search);
  if (q.get("view") === "leaderboard") return { view: "leaderboard" };
  // `episode` is the old name for `item`. Links made before the rename still use it.
  return { view: "notes", project: q.get("project"), item: q.get("item") ?? q.get("episode"), note: q.get("note") };
}

function routeSearch(route: Route): string {
  if (route.view === "leaderboard") return "?view=leaderboard";
  const q = new URLSearchParams();
  if (route.project) q.set("project", route.project);
  if (route.item) q.set("item", route.item);
  if (route.note) q.set("note", route.note);
  return q.size ? `?${q}` : "";
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
    capturePageview();
  };
  return [route, navigate];
}

/** A shareable link straight to one note. */
export function noteUrl(slug: string, noteId: string): string {
  return `${window.location.origin}${window.location.pathname}${routeSearch({ view: "notes", project: slug, item: null, note: noteId })}`;
}
