/**
 * Test whether yt-dlp gives us tweet author name + tweet date.
 *
 * Run: bun run src/scripts_jim/2026_04_16_tweet_metadata/test_ytdlp.ts
 */

import { execSync } from "child_process";

const TEST_URLS = [
  "https://x.com/fbgcon/status/2044748543634677892",
];

for (const url of TEST_URLS) {
  console.log(`\n=== ${url} ===`);
  const output = execSync(`yt-dlp -J --skip-download "${url}"`, { encoding: "utf8" });
  const meta = JSON.parse(output);

  const createdAt = meta.timestamp ? new Date(meta.timestamp * 1000).toISOString() : null;

  console.log({
    author_handle: meta.uploader_id,
    author_name: meta.uploader,
    author_numeric_id: meta.channel_id,
    uploader_url: meta.uploader_url,
    tweet_created_at: createdAt,
    tweet_upload_date: meta.upload_date,
    tweet_id: meta.id,
  });
}
