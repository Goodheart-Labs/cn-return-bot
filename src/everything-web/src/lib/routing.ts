import { useEffect, useState } from "react";
import { capturePageview } from "./analytics";

/* Every page has its own path under the site's base address. The base is "/"
 * on commonnotes.net and localhost, and "/cn-return-bot/notes/" on GitHub
 * Pages.
 *   /                     the homepage
 *   /install              the homepage, scrolled to the install section
 *   /notes                the overview of all projects
 *   /notes/<slug>         one project
 *   /notes/<slug>/<item>  one post or video of a project
 *   /leaderboard          the rating leaderboard
 *   /read?url=<article>   one article with its notes in the margin; &full=<url>
 *                         adds the article's full text below it
 * A link to one note adds ?note=<id> to its project's path. The static pages
 * /privacy/ and /terms/ sit beside the app.
 *
 * Both hosts answer a path they have no file for with the app. Cloudflare
 * Pages does that for any build without a 404.html. On GitHub Pages the deploy
 * workflow copies index.html to 404.html.
 *
 * Links made before the paths existed carried the page in query parameters
 * (?view=notes, ?project=…&item=…&note=…, ?section=install). The app still
 * reads them and swaps the address for the path. The fragment is never
 * touched, because Supabase's sign-in returns its tokens there. */

/** Where the reader is. On the homepage, `section` names the part the page
 *  scrolls to. In the notes, a null project means the overview of all
 *  projects, and a null item means every item of the project. `note` names a
 *  shared note the feed scrolls to. */
export type Route =
  | { view: "home"; section: "install" | null }
  | { view: "notes"; project: string | null; item: string | null; note: string | null }
  | { view: "leaderboard" }
  | { view: "read"; url: string | null; full: string | null };

export const HOME: Route = { view: "home", section: null };
export const INSTALL: Route = { view: "home", section: "install" };
export const NOTES: Route = { view: "notes", project: null, item: null, note: null };

const BASE = import.meta.env.BASE_URL;

/** The query parameters of the old addresses. `episode` is the old name for `item`. */
const LEGACY_PARAMS = ["view", "project", "item", "episode", "section"];

function readLegacyRoute(q: URLSearchParams): Route {
  if (q.get("view") === "leaderboard") return { view: "leaderboard" };
  const project = q.get("project");
  const item = q.get("item") ?? q.get("episode");
  const note = q.get("note");
  if (q.get("view") === "notes" || project || item || note) return { view: "notes", project, item, note };
  return { view: "home", section: q.get("section") === "install" ? "install" : null };
}

/** Reads the route from the address. A path the app does not know shows the
 *  homepage. */
export function readRoute(pathname: string, search: string): Route {
  const q = new URLSearchParams(search);
  if (LEGACY_PARAMS.some((name) => q.has(name))) return readLegacyRoute(q);
  const within = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : "";
  const [page, project, item] = within.split("/").filter(Boolean).map(decodeURIComponent);
  if (page === "leaderboard") return { view: "leaderboard" };
  if (page === "read") return { view: "read", url: q.get("url"), full: q.get("full") };
  if (page === "install") return INSTALL;
  if (page === "notes") return { view: "notes", project: project ?? null, item: item ?? null, note: q.get("note") };
  return HOME;
}

/** The address of a route, for the href of a link that navigates in-app. */
export function routeHref(route: Route): string {
  if (route.view === "leaderboard") return `${BASE}leaderboard`;
  if (route.view === "read") {
    const q = new URLSearchParams();
    if (route.url) q.set("url", route.url);
    if (route.full) q.set("full", route.full);
    return `${BASE}read${q.size ? `?${q}` : ""}`;
  }
  if (route.view === "home") return route.section ? `${BASE}${route.section}` : BASE;
  const segments = ["notes", route.project, route.project && route.item].filter((segment) => !!segment) as string[];
  const note = route.note ? `?note=${encodeURIComponent(route.note)}` : "";
  return BASE + segments.map(encodeURIComponent).join("/") + note;
}

/** Swaps an old query-parameter address for its path, without a new history
 *  entry. It runs once, before the app renders and counts its first pageview. */
export function upgradeLegacyAddress() {
  const { search, hash } = window.location;
  if (!LEGACY_PARAMS.some((name) => new URLSearchParams(search).has(name))) return;
  window.history.replaceState(null, "", routeHref(readRoute(window.location.pathname, search)) + hash);
}

const currentRoute = () => readRoute(window.location.pathname, window.location.search);

/** The current route and the function that moves to another one. Moving
 *  pushes a history entry, so Back and Forward work, and counts a pageview.
 *  Each capture runs after the address changed, so the event carries the new
 *  address. */
export function useRoute(): [Route, (next: Route) => void] {
  const [route, setRoute] = useState(currentRoute);
  useEffect(() => {
    const onPop = () => {
      setRoute(currentRoute());
      capturePageview();
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (next: Route) => {
    window.history.pushState(null, "", routeHref(next));
    setRoute(next);
    // A new page starts at the top, as it does after following any link. Back
    // and Forward are left alone, so the browser's own scroll restoration puts
    // the reader where they were.
    window.scrollTo(0, 0);
    capturePageview();
  };
  return [route, navigate];
}

/** A shareable link straight to one note. */
export function noteUrl(slug: string, noteId: string): string {
  return window.location.origin + routeHref({ view: "notes", project: slug, item: null, note: noteId });
}
