/** Whether a page was ever read in full. Only such a page refuses a new
 *  "check this page" request. An item that exists because a reader wrote a
 *  note, or because one paragraph was checked, is not a checked page.
 *  first_checked_at is set once, the first time the page finishes as a whole
 *  page (migration 133), and never cleared. So a checked page stays checked
 *  while it waits in the queue again because a reader asked about a passage
 *  in it. */
export function isWholePageChecked(item: { checked_scope: "page" | "paragraph" | null; first_checked_at: string | null } | null): boolean {
  return item?.checked_scope === "page" && item.first_checked_at !== null;
}
