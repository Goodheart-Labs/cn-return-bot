// Deep-linking via query params on the static Pages path (no server rewrites,
// no clash with Supabase's auth hash): ?project=<slug>&note=<id>&episode=<item-id>.

export function readRoute(): { project: string | null; note: string | null; episode: string | null } {
  const q = new URLSearchParams(window.location.search);
  return { project: q.get("project"), note: q.get("note"), episode: q.get("episode") };
}

/** Push a project selection into the URL (keeps the path, so Pages still serves index.html). */
export function pushProject(slug: string): void {
  window.history.pushState(null, "", `${window.location.pathname}?project=${slug}`);
}

/** Push an episode filter within the current project (null clears it). */
export function pushEpisode(slug: string, itemId: string | null): void {
  const suffix = itemId ? `&episode=${itemId}` : "";
  window.history.pushState(null, "", `${window.location.pathname}?project=${slug}${suffix}`);
}

/** A shareable link straight to one note. */
export function noteUrl(slug: string, noteId: string): string {
  return `${window.location.origin}${window.location.pathname}?project=${slug}&note=${noteId}`;
}
