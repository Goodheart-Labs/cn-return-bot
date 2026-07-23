/**
 * Refresh the local public-dump copy in ./cn-data — the files the
 * dashboard exporters (notes/landscape/precedents) stream.
 *
 * Mirrors src/production/updateNoteFeedback.ts downloadCNFile (7-day
 * walk-back until partition 00000 exists, then fetch partitions until the
 * first 404), for `notes` and `noteStatusHistory` only — the ratings
 * partitions belong to fill_ratings.py's pipeline, not this one.
 *
 * Download-then-swap: everything lands in a temp dir first and replaces the
 * old TSVs only after partition 00000 of a file type is in hand. A mid-fetch
 * network failure must never leave cn-data empty — the dump-reading
 * exporters degrade gracefully on missing files and would emit
 * plausible-looking JSON with silently absent dump data.
 *
 *   bun run src/scripts_rob/dashboard_exports/refresh_dump.ts
 */

import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";

const CN_DATA_BASE_URL = "https://ton.twimg.com/birdwatch-public-data";
const DATA_DIR = "./cn-data";
const TMP_DIR = "./cn-data-tmp";
const MAX_DAYS_BACK = 7;
const MAX_PARTITIONS = 100;
const FILE_TYPES = ["notes", "noteStatusHistory"] as const;

const dateForUrl = (d: Date) =>
  `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;

async function download(url: string, outPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

/** Fetch every partition of one file type into TMP_DIR; return TSV paths. */
async function fetchFileType(fileType: (typeof FILE_TYPES)[number]): Promise<string[] | null> {
  for (let daysBack = 0; daysBack < MAX_DAYS_BACK; daysBack++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - daysBack);
    const dateStr = dateForUrl(date);
    const partitionUrl = (p: string) => `${CN_DATA_BASE_URL}/${dateStr}/${fileType}/${fileType}-${p}.zip`;

    try {
      // Partition 00000 must exist; its absence means this day isn't published.
      const paths: string[] = [];
      for (let i = 0; i < MAX_PARTITIONS; i++) {
        const partition = String(i).padStart(5, "0");
        const zipPath = `${TMP_DIR}/${fileType}-${partition}.zip`;
        const tsvPath = `${TMP_DIR}/${fileType}-${partition}.tsv`;
        try {
          await download(partitionUrl(partition), zipPath);
        } catch (err) {
          if (i === 0) throw err; // day not published — walk back
          break; // no more partitions
        }
        execSync(`unzip -o "${zipPath}" -d "${TMP_DIR}"`, { stdio: "pipe" });
        unlinkSync(zipPath);
        paths.push(tsvPath);
        console.log(`[dump] ${fileType}-${partition} ← ${dateStr}`);
      }
      console.log(`[dump] ${fileType}: ${paths.length} partition(s) from ${dateStr}`);
      return paths;
    } catch {
      console.log(`[dump] no ${fileType} for ${dateStr}, trying earlier...`);
    }
  }
  console.error(`[dump] could not find ${fileType} within ${MAX_DAYS_BACK} days`);
  return null;
}

rmSync(TMP_DIR, { recursive: true, force: true });
mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

let ok = true;
for (const fileType of FILE_TYPES) {
  const fetched = await fetchFileType(fileType);
  if (!fetched) {
    ok = false;
    continue;
  }
  // Swap: old partitions out (count may have changed), new ones in.
  for (const f of readdirSync(DATA_DIR).filter((f) => f.startsWith(`${fileType}-`) && f.endsWith(".tsv"))) {
    unlinkSync(`${DATA_DIR}/${f}`);
  }
  for (const p of fetched) {
    renameSync(p, `${DATA_DIR}/${p.split("/").pop()}`);
  }
}
rmSync(TMP_DIR, { recursive: true, force: true });

if (!ok) process.exit(1);
console.log(`[dump] cn-data refreshed: ${readdirSync(DATA_DIR).filter((f) => f.endsWith(".tsv")).join(", ")}`);
