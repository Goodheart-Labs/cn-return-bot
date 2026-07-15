// Deep-linking via query params on the static Pages path (no server rewrites,
// no clash with Supabase's auth hash): ?project=<slug>&note=<id>&item=<item-id>.

export function readRoute(): { project: string | null; note: string | null; item: string | null } {
  const q = new URLSearchParams(window.location.search);
  // `episode` is the pre-generalization param name — still honored for old links.
  return { project: q.get("project"), note: q.get("note"), item: q.get("item") ?? q.get("episode") };
}

/** Push a project selection into the URL (keeps the path, so Pages still serves index.html). */
export function pushProject(slug: string): void {
  window.history.pushState(null, "", `${window.location.pathname}?project=${slug}`);
}

/** Push an item filter within the current project (null clears it). */
export function pushItem(slug: string, itemId: string | null): void {
  const suffix = itemId ? `&item=${itemId}` : "";
  window.history.pushState(null, "", `${window.location.pathname}?project=${slug}${suffix}`);
}

/** A shareable link straight to one note. */
export function noteUrl(slug: string, noteId: string): string {
  return `${window.location.origin}${window.location.pathname}?project=${slug}&note=${noteId}`;
}
