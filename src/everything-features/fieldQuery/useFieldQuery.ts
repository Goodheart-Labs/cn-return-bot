import { useEffect, useState } from "react";
import { readQuery, writeQuery, type FieldDef, type FieldQuery } from "@cn/core/fieldQuery";

/* Where a page's filters, sorts and display options live. The page address
 * always carries them, so a link shows exactly what its sender saw. The
 * browser also remembers the last ones under the page's storage key, so a
 * visit without them in the address, such as a click on the page's link in
 * the menu, starts where the reader left off. That works the same on
 * commonnotes.net and on a local server, because the browser keeps storage
 * per address. Without storage, the page starts from its defaults. */

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Without storage the query lasts until the page reloads.
  }
}

/** The query's parameters written into the current address, keeping the
 *  path, the other parameters and the fragment. No history entry is added,
 *  so Back still leaves the page instead of undoing a filter. */
function showInAddress(query: FieldQuery) {
  const params = new URLSearchParams(window.location.search);
  writeQuery(query, params);
  const { pathname, hash } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}?${params.toString()}${hash}`);
}

/** The query alone as address parameters, as it is stored. */
function queryText(query: FieldQuery): string {
  const params = new URLSearchParams();
  writeQuery(query, params);
  return params.toString();
}

export function useFieldQuery({ storageKey, fields, displayOptions, defaults }: {
  storageKey: string;
  fields: readonly FieldDef[];
  displayOptions: readonly string[];
  defaults: FieldQuery;
}): [FieldQuery, (query: FieldQuery) => void] {
  const [query, setQuery] = useState<FieldQuery>(
    () =>
      readQuery(fields, displayOptions, new URLSearchParams(window.location.search)) ??
      readQuery(fields, displayOptions, new URLSearchParams(readStored(storageKey) ?? "")) ??
      defaults,
  );
  // The address shows the query from the first render on, also when it came
  // from storage or the defaults.
  useEffect(() => {
    showInAddress(query);
    // Only the first query needs this; every later one is written by `change`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const change = (next: FieldQuery) => {
    setQuery(next);
    showInAddress(next);
    store(storageKey, queryText(next));
  };
  return [query, change];
}
