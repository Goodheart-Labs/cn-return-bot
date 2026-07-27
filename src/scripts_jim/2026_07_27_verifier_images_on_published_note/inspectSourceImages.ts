/**
 * Show the FULL image URLs the verifier pulls from a cited source, and whether
 * each one can actually be downloaded.
 *
 * The run log truncates every image URL to 80 chars (sourceVerifier.imageLog),
 * which is shorter than a CMS image path — so distinct images can look like the
 * same URL repeated. This refetches the source, re-runs the real extractor, and
 * reports each URL's fetch outcome.
 *
 *   bun run src/scripts_jim/2026_07_27_verifier_images_on_published_note/inspectSourceImages.ts <source-url>
 */

import "dotenv/config";
import { handleWebFetch } from "../../pipeline/tool-calling/tools";
import { extractSourceImageUrls, sourceImageGroup, buildVerifierContent } from "../../pipeline/verify/verifierImages";

/** Mirrors IMAGE_FETCH_TIMEOUT_MS in verifierImages.ts, which isn't exported —
 *  a different timeout here would misreport what the verifier can fetch. */
const IMAGE_FETCH_TIMEOUT_MS = 8_000;
const BYTES_PER_KIB = 1024;

interface FetchProbe {
  url: string;
  status: string;
  contentType: string;
  kib: number | null;
}

/** Mirrors toInlineImage's fetch, but reports why an image would be dropped
 *  instead of collapsing every failure to null. */
async function probe(url: string): Promise<FetchProbe> {
  try {
    const response = await fetch(url, {
      headers: { Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      redirect: "follow",
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    });
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim();
    const bytes = response.ok ? (await response.arrayBuffer()).byteLength : 0;
    return {
      url,
      status: `HTTP ${response.status}`,
      contentType,
      kib: response.ok ? Number((bytes / BYTES_PER_KIB).toFixed(1)) : null,
    };
  } catch (err) {
    return { url, status: `threw: ${(err as Error).message}`, contentType: "-", kib: null };
  }
}

async function main(): Promise<void> {
  const sourceUrl = process.argv[2];
  if (!sourceUrl) throw new Error("usage: inspectSourceImages.ts <source-url>");

  const result = await handleWebFetch(sourceUrl);
  const markdown = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
  console.log(`fetched ${markdown.length} chars of markdown from ${sourceUrl}\n`);

  const allMatches = [...markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]);
  const extracted = extractSourceImageUrls(markdown, sourceUrl);
  console.log(`markdown image tags: ${allMatches.length}`);
  console.log(`kept by extractor:   ${extracted.length} (cap 3/source, drops svg + logo/icon/avatar/etc.)\n`);

  for (const [i, url] of extracted.entries()) {
    const p = await probe(url);
    console.log(`[${i}] ${url}`);
    console.log(`    ${p.status}  ${p.contentType}  ${p.kib === null ? "-" : p.kib + " KiB"}`);
  }

  // The real path: whatever survives here is what the verifier actually saw.
  const { attached } = await buildVerifierContent("probe", [sourceImageGroup(sourceUrl, extracted)]);
  const usable = attached[0]?.urls ?? [];
  console.log(`\ninlined for the verifier: ${usable.length}/${extracted.length}`);
  for (const url of extracted) {
    if (!usable.includes(url)) console.log(`  DROPPED: ${url}`);
  }
}

await main();
