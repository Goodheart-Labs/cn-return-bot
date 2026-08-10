/* Deep links use query parameters on the static GitHub Pages path. That needs no
 * server rewrites, and it does not clash with the hash Supabase's auth flow
 * uses. The note feed reads ?project=<slug>&note=<id>&item=<item-id>. The
 * leaderboard is ?view=leaderboard. */

/** Which top-level view the app is showing. */
export type View = "notes" | "leaderboard";

export function readRoute(): { project: string | null; note: string | null; item: string | null; view: View } {
  const q = new URLSearchParams(window.location.search);
  // `episode` is the old name for `item`. Links made before the rename still use it.
  return {
    project: q.get("project"),
    note: q.get("note"),
    item: q.get("item") ?? q.get("episode"),
    view: q.get("view") === "leaderboard" ? "leaderboard" : "notes",
  };
}

/** Put a project selection into the URL. The path is left alone, so GitHub
 *  Pages still serves index.html. */
export function pushProject(slug: string): void {
  window.history.pushState(null, "", `${window.location.pathname}?project=${slug}`);
}

/** Put an item filter for the current project into the URL. Passing null clears
 *  the filter. */
export function pushItem(slug: string, itemId: string | null): void {
  const suffix = itemId ? `&item=${itemId}` : "";
  window.history.pushState(null, "", `${window.location.pathname}?project=${slug}${suffix}`);
}

/** Show the leaderboard. It is a global view, so it drops any project or item
 *  selection. */
export function pushLeaderboard(): void {
  window.history.pushState(null, "", `${window.location.pathname}?view=leaderboard`);
}

/** A shareable link straight to one note. */
export function noteUrl(slug: string, noteId: string): string {
  return `${window.location.origin}${window.location.pathname}?project=${slug}&note=${noteId}`;
}
