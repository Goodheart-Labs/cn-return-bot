import type { Jim } from "./types";

export function parseResults(results: string): Map<string, Jim> {
  const jim = new Map<string, Jim>();
  let section = 0, cur: Jim | null = null;
  for (const line of results.split("\n")) {
    const sec = line.match(/^## (\d)\./);
    if (sec) { section = Number(sec[1]); cur = null; continue; }
    const id = line.match(/note=([0-9a-f-]{36})/)?.[1];
    if ((section === 1 || section === 2) && line.startsWith("- Link:") && id) {
      cur = { ...jim.get(id), bucket: section === 1 ? "send" : "uncertain" }; jim.set(id, cur);
    } else if (cur && line.startsWith("- Jim:")) cur.comment = line.slice(6).trim();
    else if (cur && line.startsWith("**Send instead:**")) cur.sendInstead = line.slice(17).trim();
    else if (section === 3 && line.startsWith("|") && id) {
      const pick = line.split("|")[2]?.trim();
      jim.set(id, { ...jim.get(id), pick });
    }
  }
  return jim;
}
