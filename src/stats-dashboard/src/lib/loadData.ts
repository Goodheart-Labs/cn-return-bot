import type { StatsSnapshot } from "./types";

export async function loadStatsSnapshot(): Promise<StatsSnapshot> {
  const url = `${import.meta.env.BASE_URL}stats-data.json`;
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) {
    throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}. Run "bun run build-stats-data" to generate it.`);
  }
  return res.json();
}
