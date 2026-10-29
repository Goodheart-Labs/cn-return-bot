import { useCallback, useEffect, useState } from "react";
import { DASHBOARD_SECTIONS, isDashboardSection, type DashboardSection } from "../pages/dashboard/sections";
import { JUDGE_SECTIONS, type JudgeSection } from "../pages/judgeExperiment/sections";
import { capturePageview } from "./analytics";

/* Every page has its own path.
 *   /                     the homepage
 *   /install              the homepage, scrolled to the install section
 *   /notes                the overview of all projects
 *   /notes/all            every note of every project in one feed
 *   /notes/<slug>         one project
 *   /notes/<slug>/<item>  one post or video of a project
 *   /minisites            every minisite
 *   /minisites/new        an admin creates a minisite from a pasted link
 *   /minisites/<slug>     one minisite: an article with the reader features it switched on
 *   /leaderboard          the rating leaderboard
 *   /x-notewriter         our AI-written notes on X: the numbers, the chart and
 *                         the notes; its filters and sorts are query parameters
 *   /x-notewriter/ab-tests  the A/B comparison of the X bot, in developer mode
 *   /admin/notes          admins review the Claude note writer's notes; the
 *                         filters, sorts and display options are query
 *                         parameters (lib/useFieldQuery.ts)
 *   /admin/best           the admins' leaderboard of the best notes
 *   /admin/best/<slug>    the same, narrowed to one creator
 *   /admin/dashboard      admins see how the extension is used; each other
 *   /admin/dashboard/<section>  section of the dashboard has its own path:
 *                         the notes, the A/B tests, the order of the next
 *                         walk, Claude's usage, the posts checked last and the
 *                         clicks towards the extension
 *   /admin/judge-experiment/<section>  the labelled notes of the note judge
 *                         experiment, only on the development server
 *   /note-image/<note>    one note's card alone, which the local posting tool
 *                         takes a picture of; only in that tool
 * The old article reader at /read?url=… is gone (GOO-374); its articles are
 * minisites now, and its old links show the homepage like any unknown path.
 * The path /notes/all wins over a project whose slug is "all".
 * A link to one note adds ?note=<id> to its project's path. The static pages
 * /privacy/ and /terms/ sit beside the app.
 *
 * Cloudflare Pages answers a path it has no file for with the app, because
 * the build has no 404.html.
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
  | { view: "allNotes" }
  | { view: "leaderboard" }
  | { view: "minisites"; slug: string | null }
  | { view: "newMinisite" }
  | { view: "noteReview" }
  | { view: "bestNotes"; project: string | null }
  | { view: "xNotewriter"; page: "overview" | "abTests" }
  | { view: "dashboard"; section: DashboardSection }
  | { view: "judgeExperiment"; section: JudgeSection }
  | { view: "noteImage"; note: string };

export const HOME: Route = { view: "home", section: null };
export const INSTALL: Route = { view: "home", section: "install" };
export const NOTES: Route = { view: "notes", project: null, item: null, note: null };
export const ALL_NOTES: Route = { view: "allNotes" };
export const MINISITES: Route = { view: "minisites", slug: null };
export const NOTE_REVIEW: Route = { view: "noteReview" };
export const BEST_NOTES: Route = { view: "bestNotes", project: null };
export const DASHBOARD: Route = { view: "dashboard", section: DASHBOARD_SECTIONS[0].id };
export const X_NOTEWRITER: Route = { view: "xNotewriter", page: "overview" };
export const X_AB_TESTS: Route = { view: "xNotewriter", page: "abTests" };

/** The sections the best-notes page had until GOO-597, which its old links
 *  name before the creator. */
const OLD_CURATION_SECTIONS: readonly (string | undefined)[] = ["recommendations", "leaderboard", "removed"];
const isJudgeSection = (value: string | undefined): value is JudgeSection => (JUDGE_SECTIONS as readonly (string | undefined)[]).includes(value);

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
  const [page, project, item, creator] = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (page === "leaderboard") return { view: "leaderboard" };
  if (page === "minisites") return project === "new" ? { view: "newMinisite" } : { view: "minisites", slug: project ?? null };
  if (page === "install") return INSTALL;
  if (page === "admin" && project === "best") return { view: "bestNotes", project: (OLD_CURATION_SECTIONS.includes(item) ? creator : item) ?? null };
  if (page === "admin" && project === "dashboard") return isDashboardSection(item) ? { view: "dashboard", section: item } : DASHBOARD;
  if (page === "x-notewriter") return project === "ab-tests" ? X_AB_TESTS : X_NOTEWRITER;
  if (import.meta.env.DEV && page === "admin" && project === "judge-experiment") return { view: "judgeExperiment", section: isJudgeSection(item) ? item : JUDGE_SECTIONS[0] };
  // Links from before GOO-623 name a section after it, which is now a filter.
  if (page === "admin" && project === "notes") return NOTE_REVIEW;
  if (import.meta.env.VITE_TWEET_SERVER && page === "note-image" && project) return { view: "noteImage", note: project };
  if (page === "notes" && project === "all") return ALL_NOTES;
  if (page === "notes") return { view: "notes", project: project ?? null, item: item ?? null, note: q.get("note") };
  return HOME;
}

/** The address of a route, for the href of a link that navigates in-app. */
export function routeHref(route: Route): string {
  if (route.view === "leaderboard") return "/leaderboard";
  if (route.view === "allNotes") return "/notes/all";
  if (route.view === "newMinisite") return "/minisites/new";
  if (route.view === "dashboard") return route.section === DASHBOARD_SECTIONS[0].id ? "/admin/dashboard" : `/admin/dashboard/${route.section}`;
  if (route.view === "xNotewriter") return route.page === "abTests" ? "/x-notewriter/ab-tests" : "/x-notewriter";
  if (route.view === "noteReview") return "/admin/notes";
  if (route.view === "noteImage") return `/note-image/${encodeURIComponent(route.note)}`;
  if (route.view === "judgeExperiment") return `/admin/judge-experiment/${route.section}`;
  if (route.view === "bestNotes") return "/admin/best" + (route.project ? `/${encodeURIComponent(route.project)}` : "");
  if (route.view === "minisites") return route.slug ? `/minisites/${encodeURIComponent(route.slug)}` : "/minisites";
  if (route.view === "home") return route.section ? `/${route.section}` : "/";
  const segments = ["notes", route.project, route.project && route.item].filter((segment) => !!segment) as string[];
  const note = route.note ? `?note=${encodeURIComponent(route.note)}` : "";
  return "/" + segments.map(encodeURIComponent).join("/") + note;
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
  const navigate = useCallback((next: Route) => {
    window.history.pushState(null, "", routeHref(next));
    setRoute(next);
    // A new page starts at the top, as it does after following any link. Back
    // and Forward are left alone, so the browser's own scroll restoration puts
    // the reader where they were.
    window.scrollTo(0, 0);
    capturePageview();
  }, []);
  return [route, navigate];
}

/** A shareable link straight to one note. */
export function noteUrl(slug: string, noteId: string): string {
  return window.location.origin + routeHref({ view: "notes", project: slug, item: null, note: noteId });
}
