export const COMMONNOTES_ORIGIN = "https://commonnotes.net";

/** Builds a deep link to a single note on the public site. This is the URL the
 *  extension's Share action copies. The site's addresses are described in
 *  everything-web/src/lib/routing.ts. */
export function noteShareUrl(projectSlug: string | null, noteId: string): string {
  const project = projectSlug ? `/${encodeURIComponent(projectSlug)}` : "";
  return `${COMMONNOTES_ORIGIN}/notes${project}?note=${encodeURIComponent(noteId)}`;
}
