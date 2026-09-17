/** Runs the caption command the way ytDlpDownload.ts does, through
 *  spawnSync, and prints everything yt-dlp wrote, to compare with the same
 *  command run from a shell in the same minute. */
import { spawnSync } from "child_process";
import { mkdtempSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const url = process.argv[2]!;
const dir = mkdtempSync(join(tmpdir(), "cn-yt-debug-"));
const startedAt = Date.now();
const result = spawnSync(
  "yt-dlp",
  ["--proxy", process.env.YTDLP_PROXY_URL!, "--extractor-args", "youtube:player_client=web", "--write-subs", "--write-auto-subs", "--sub-lang", "en.*", "--skip-download", "--ignore-no-formats-error", "-v", "-o", join(dir, "%(id)s.%(ext)s"), url],
  { timeout: 90_000, encoding: "utf8" },
);
console.log(`spawnSync: status ${result.status} signal ${result.signal} error ${result.error?.message ?? "-"} in ${Math.round((Date.now() - startedAt) / 1000)}s, files: ${readdirSync(dir).join(", ") || "none"}`);
console.log("PATH has deno:", (process.env.PATH ?? "").includes("deno"));
console.log("---- stderr tail\n" + (result.stderr ?? "").split("\n").filter((l) => !/Loaded|Optional lib|exe versions|Python/.test(l)).slice(-25).join("\n"));
console.log("---- stdout tail\n" + (result.stdout ?? "").split("\n").slice(-8).join("\n"));
