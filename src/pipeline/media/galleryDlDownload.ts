/**
 * gallery-dl Download
 *
 * gallery-dl complements yt-dlp and is focused on images. The source verifier
 * falls back to it when yt-dlp fails on a media-host URL. It is also the first
 * choice for hosts that only serve galleries, such as Reddit, Tumblr and Imgur.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const GALLERY_DL_TIMEOUT_MS = 120_000;

function quote(s: string): string {
  return s.replace(/(["\\$`])/g, "\\$1");
}

/**
 * gallery-dl's FacebookSetExtractor crashes on a post URL that carries a slug,
 * meaning the `/posts/<slug>-<id>/` form. Rewriting such a URL to `/posts/<id>`
 * makes gallery-dl use its PhotoExtractor instead, which works. This function
 * only touches Facebook URLs and returns everything else unchanged.
 */
export function normalizeUrlForGalleryDl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "facebook.com" || host.endsWith(".facebook.com")) {
      // Turn /<user>/posts/<slug>-<digits>/ with any query string it has into
      // /<user>/posts/<digits>.
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
 * Downloads with gallery-dl and returns the first file it produced. A gallery can
 * yield several files, but one is enough to feed Gemini. This throws when
 * gallery-dl fails and when it produces no files at all.
 */
export function downloadWithGalleryDl(url: string, outputDir: string): string {
  const normalizedUrl = normalizeUrlForGalleryDl(url);
  try {
    execSync(
      // Flatten the output so gallery-dl creates no nested platform or user
      // directories. Files land straight in outputDir as <number>.<extension>.
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
  // Sorting makes "the first file" mean the same thing on every run.
  files.sort();
  return path.join(outputDir, files[0]!);
}
