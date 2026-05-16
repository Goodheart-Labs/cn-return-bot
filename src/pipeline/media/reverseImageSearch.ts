/**
 * Reverse Image Search + DINO Similarity (A/B-gated)
 *
 * For each image (and 5 random video frames), do a reverse search via
 * Yandex Images (Google Lens served /sorry CAPTCHA to headless Chromium,
 * Yandex is permissive and OSINT-grade) and score each visual match by
 * cosine similarity against a hosted DINO embedding (Modal-deployed).
 *
 * The enriched context is passed transparently to the description LVLM as
 * additional, fallible signal — the prompt asks the model to verify and
 * use its own judgment.
 *
 * For video frames the local jpg bytes are uploaded to litterbox (1h TTL
 * anonymous host) so Yandex can fetch them. Tweet/photo URLs are public
 * already (pbs.twimg.com) and used directly.
 */

import { chromium, type Browser, type Page } from "playwright";

const MODAL_EMBED_URL =
  process.env.MODAL_DINO_EMBED_URL ??
  "https://jimmaar1--dino-embed-embedder-web-embed.modal.run";
const YANDEX_BY_URL =
  "https://yandex.com/images/search?rpt=imageview&url=";
const LITTERBOX_URL =
  "https://litterbox.catbox.moe/resources/internals/api.php";
const LITTERBOX_TTL = "1h";

const NAV_TIMEOUT_MS = 45_000;
const MATCH_WAIT_MS = 20_000;
const EMBED_TIMEOUT_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 30_000;

const DEFAULT_TOP_N = 5;

export interface ReverseSearchMatch {
  thumb_url: string | null;
  page_url: string;
  page_title: string;
  snippet: string | null;
  source_domain: string | null;
  /** Cosine similarity to the query image; null if the thumbnail could not be embedded. */
  similarity: number | null;
}

export interface ReverseSearchResult {
  query_image_url: string;
  /** Yandex's own "what is this" summary (often non-English; LVLMs handle it). */
  object_summary: string | null;
  matches: ReverseSearchMatch[];
}

// --- Modal embedding ---

type EmbedInput = { url: string } | { b64: string };

async function embedImage(input: EmbedInput): Promise<number[] | null> {
  const body = "url" in input ? { image_url: input.url } : { image_b64: input.b64 };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMBED_TIMEOUT_MS);
  try {
    const resp = await fetch(MODAL_EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { embedding?: number[]; error?: string };
    return data.embedding ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function cosine(a: number[], b: number[]): number {
  // Embeddings are L2-normalized server-side; dot product == cosine.
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

// --- Litterbox ephemeral upload (for video frame bytes that need a public URL) ---

async function uploadEphemeral(bytes: Buffer, filename: string): Promise<string | null> {
  const form = new FormData();
  form.append("reqtype", "fileupload");
  form.append("time", LITTERBOX_TTL);
  form.append(
    "fileToUpload",
    new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
    filename,
  );
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const resp = await fetch(LITTERBOX_URL, { method: "POST", body: form, signal: ctrl.signal });
    if (!resp.ok) return null;
    const text = (await resp.text()).trim();
    return text.startsWith("http") ? text : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// --- Yandex Images reverse search ---

async function runYandexSearch(
  page: Page,
  imageUrl: string,
  topN: number,
): Promise<{ object_summary: string | null; matches: Omit<ReverseSearchMatch, "similarity">[] }> {
  const target = YANDEX_BY_URL + encodeURIComponent(imageUrl);
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await page
    .waitForSelector("li.CbirSites-Item, .CbirObjectResponse-Title", { timeout: MATCH_WAIT_MS })
    .catch(() => {});
  await page.waitForTimeout(800);

  return page.evaluate((n) => {
    const items = Array.from(document.querySelectorAll("li.CbirSites-Item"));
    const matches: any[] = [];
    for (const li of items.slice(0, n)) {
      const thumbImg = li.querySelector(".CbirSites-ItemThumb img") as HTMLImageElement | null;
      const titleA = li.querySelector(".CbirSites-ItemTitle a") as HTMLAnchorElement | null;
      const thumbA = li.querySelector(".CbirSites-ItemThumb a") as HTMLAnchorElement | null;
      const domainA = li.querySelector(".CbirSites-ItemDomain") as HTMLAnchorElement | null;
      const descD = li.querySelector(".CbirSites-ItemDescription") as HTMLElement | null;
      matches.push({
        thumb_url: thumbImg ? thumbImg.src || null : null,
        page_url: (titleA && titleA.href) || (thumbA && thumbA.href) || "",
        page_title: titleA ? (titleA.textContent || "").trim() : "",
        snippet: descD ? (descD.textContent || "").trim() || null : null,
        source_domain: domainA ? (domainA.textContent || "").trim() : null,
      });
    }
    const objTitle = document.querySelector(".CbirObjectResponse-Title");
    const objDesc = document.querySelector(".CbirObjectResponse-Description");
    const parts: string[] = [];
    if (objTitle?.textContent) parts.push(objTitle.textContent.trim());
    if (objDesc?.textContent) parts.push(objDesc.textContent.trim());
    return { object_summary: parts.join(" — ") || null, matches };
  }, topN);
}

// --- Public API ---

/**
 * Either a public URL Yandex can fetch directly (typical for tweet media on
 * pbs.twimg.com), or raw JPEG bytes that we first stash on litterbox so
 * Yandex has a URL to crawl (used for video frames extracted via ffmpeg).
 */
export type QueryInput =
  | { kind: "url"; url: string; topN?: number }
  | { kind: "bytes"; bytes: Buffer; topN?: number };

export async function reverseSearchAndScore(input: QueryInput): Promise<ReverseSearchResult | null> {
  const topN = input.topN ?? DEFAULT_TOP_N;

  // Resolve a public URL Yandex can fetch.
  const queryUrl =
    input.kind === "url"
      ? input.url
      : await uploadEphemeral(input.bytes, `frame-${Date.now()}.jpg`);
  if (!queryUrl) return null;

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      locale: "en-US",
      viewport: { width: 1366, height: 900 },
    });
    const page = await ctx.newPage();

    // Run query embedding + Yandex search in parallel — bytes-mode embeds
    // straight from memory; url-mode lets Modal fetch the same URL.
    const queryEmbedP =
      input.kind === "bytes"
        ? embedImage({ b64: input.bytes.toString("base64") })
        : embedImage({ url: queryUrl });

    const [yandex, queryEmbed] = await Promise.all([
      runYandexSearch(page, queryUrl, topN).catch((err) => {
        console.error("[reverseImageSearch] Yandex search failed:", err.message);
        return { object_summary: null, matches: [] as Omit<ReverseSearchMatch, "similarity">[] };
      }),
      queryEmbedP,
    ]);

    await ctx.close();

    // Score every match's thumbnail in parallel.
    const scored: ReverseSearchMatch[] = await Promise.all(
      yandex.matches.map(async (m) => {
        if (!m.thumb_url || !queryEmbed) return { ...m, similarity: null };
        const emb = await embedImage({ url: m.thumb_url });
        return { ...m, similarity: emb ? cosine(queryEmbed, emb) : null };
      }),
    );
    scored.sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1));

    return { query_image_url: queryUrl, object_summary: yandex.object_summary, matches: scored };
  } catch (err: any) {
    console.error("[reverseImageSearch] Failed:", err.message);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}

// --- Prompt formatting helpers ---

function fmtMatch(m: ReverseSearchMatch): string {
  const sim = m.similarity != null ? `sim=${m.similarity.toFixed(3)}` : "sim=?";
  const domain = m.source_domain ?? "?";
  const title = m.page_title || "(no title)";
  const snippet = m.snippet ? ` — ${m.snippet}` : "";
  return `  - ${sim}  [${domain}]  ${title}${snippet}`;
}

export function formatReverseSearchContextForImage(rs: ReverseSearchResult | null): string {
  if (!rs || (rs.matches.length === 0 && !rs.object_summary)) return "";
  const lines: string[] = ["Reverse-image-search context (a separate tool; may be misleading — verify against the image itself):"];
  if (rs.object_summary) lines.push(`Subject guess: ${rs.object_summary}`);
  if (rs.matches.length) {
    lines.push("Top visual matches (cosine similarity to this image, 1.0 = identical, ~0.85 = same subject different photo, <0.7 = unrelated):");
    for (const m of rs.matches) lines.push(fmtMatch(m));
  }
  return lines.join("\n");
}

export function formatReverseSearchContextForVideoFrames(
  perFrame: ReverseSearchResult[],
): string {
  if (!perFrame.length) return "";
  const lines: string[] = [
    `Reverse-image-search context across ${perFrame.length} random frames (separate tool; may be misleading — verify against the video):`,
  ];
  perFrame.forEach((rs, i) => {
    lines.push(`Frame ${i + 1}:`);
    if (rs.object_summary) lines.push(`  Subject guess: ${rs.object_summary}`);
    for (const m of rs.matches.slice(0, 3)) lines.push("  " + fmtMatch(m));
  });
  return lines.join("\n");
}
