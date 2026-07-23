/**
 * Shared streaming reader for X's public Community Notes dump TSVs
 * (multi-GB; never slurped). Same logic as the dated journal scripts'
 * forEachTsvRow, lifted here so the daily exporters share one copy.
 */

import { readdirSync } from "node:fs";

export async function forEachTsvRow(
  dataDir: string,
  prefix: string,
  cb: (cols: string[], header: string[]) => void,
): Promise<void> {
  const paths = readdirSync(dataDir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(".tsv"))
    .sort();
  if (!paths.length) throw new Error(`no ${prefix}*.tsv in ${dataDir} — download the dump first`);
  let header: string[] | null = null;
  for (const p of paths) {
    let carry = "";
    const decoder = new TextDecoder();
    const reader = Bun.file(`${dataDir}/${p}`).stream().getReader();
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      const text = carry + decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");
      carry = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        const cols = line.split("\t");
        if (!header) { header = cols; continue; }
        if (cols[0] === header[0]) continue; // repeated header in later partitions
        cb(cols, header);
      }
    }
    if (carry && header) cb(carry.split("\t"), header);
  }
}
