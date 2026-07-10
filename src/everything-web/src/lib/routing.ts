// Deep-linking via query params on the static Pages path (no server rewrites,
// no clash with Supabase's auth hash): ?project=<slug>&note=<id>.

export function readRoute(): { project: string | null; note: string | null } {
  const q = new URLSearchParams(window.location.search);
  return { project: q.get("project"), note: q.get("note") };
}

/** Push a project selection into the URL (keeps the path, so Pages still serves index.html). */
export function pushProject(slug: string): void {
  window.history.pushState(null, "", `${window.location.pathname}?project=${slug}`);
}

/** A shareable link straight to one note. */
export function noteUrl(slug: string, noteId: string): string {
  return `${window.location.origin}${window.location.pathname}?project=${slug}&note=${noteId}`;
}
