export const COMMONNOTES_ORIGIN = "https://commonnotes.net";

/** Deep link to a note on the public site (the extension's share target). */
export function noteShareUrl(projectSlug: string | null, noteId: string): string {
  const params = new URLSearchParams();
  if (projectSlug) params.set("project", projectSlug);
  params.set("note", noteId);
  return `${COMMONNOTES_ORIGIN}/?${params.toString()}`;
}
