export const COMMONNOTES_ORIGIN = "https://commonnotes.net";

/** Builds a deep link to a single note on the public site. This is the URL the
 *  extension's Share action copies. */
export function noteShareUrl(projectSlug: string | null, noteId: string): string {
  const params = new URLSearchParams();
  if (projectSlug) params.set("project", projectSlug);
  params.set("note", noteId);
  return `${COMMONNOTES_ORIGIN}/?${params.toString()}`;
}
