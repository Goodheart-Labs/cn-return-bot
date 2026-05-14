/**
 * gallery-dl Download
 *
 * Image-focused complement to yt-dlp. Used by the source verifier when
 * yt-dlp fails on a media-host URL, and as the primary tool for
 * gallery-only hosts (Reddit / Tumblr / Imgur).
 *
 * gallery-dl's metadata is per-extractor and shallow; we project a small
 * subset onto the YtDlpMetadata shape so downstream code (verifier
 * formatting) can be agnostic to which tool produced the result.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

import type { YtDlpMetadata } from "./ytDlpDownload";

export interface GalleryDlResult {
  meta: YtDlpMetadata;
  filePath: string | null;
}

const GALLERY_DL_TIMEOUT_MS = 120_000;

function quote(s: string): string {
  return s.replace(/(["\\$`])/g, "\\$1");
}

/**
 * gallery-dl's FacebookSetExtractor crashes on slug-form post URLs (the
 * `/posts/<slug>-<id>/` form). Normalizing to `/posts/<id>` triggers the
 * working PhotoExtractor path. Conservative: only touches Facebook URLs.
 */
export function normalizeUrlForGalleryDl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "facebook.com" || host.endsWith(".facebook.com")) {
      // /<user>/posts/<slug>-<digits>/?...  →  /<user>/posts/<digits>
      const m = u.pathname.match(/^(\/[^/]+\/posts\/)(?:[^/]*?-)?(\d+)\/?$/);
      if (m) {
        u.pathname = `${m[1]}${m[2]}`;
        u.search = "";
        return u.toString();
      }
    }
    return url;
  } catch {
    return url;
  }
}

/**
 * Download with gallery-dl. Returns the first downloaded file (gallery-dl
 * may produce several for a gallery; we only need one to feed Gemini).
 * Throws if gallery-dl errors or produces no files.
 */
export function downloadWithGalleryDl(url: string, outputDir: string): GalleryDlResult {
  const normalizedUrl = normalizeUrlForGalleryDl(url);
  try {
    execSync(
      // Flatten output: no nested platform/user directories; just <id>.<ext>.
      `gallery-dl -D "${quote(outputDir)}" -o directory="[]" -o filename="{num}.{extension}" --no-mtime "${quote(normalizedUrl)}"`,
      { timeout: GALLERY_DL_TIMEOUT_MS, stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (err: any) {
    throw new Error(`gallery-dl failed for ${normalizedUrl}: ${err?.message}`);
  }

  const files = fs.readdirSync(outputDir).filter((f) => !f.startsWith("."));
  if (!files.length) {
    throw new Error(`gallery-dl produced no files for ${normalizedUrl}`);
  }
  // Sort to make the "first" stable across runs.
  files.sort();
  const filePath = path.join(outputDir, files[0]!);

  // gallery-dl doesn't write rich metadata by default. The verifier uses
  // these fields when present (title, uploader, description, timestamp); we
  // set what we can from the URL.
  const meta: YtDlpMetadata = {
    id: path.basename(filePath, path.extname(filePath)),
    title: "",
    webpage_url: normalizedUrl,
  };
  return { meta, filePath };
}
