/**
 * Pull the real eligible-posts feed with media `alt_text` requested, and print
 * a tweet link + each media's alt_text. Read-only GET (allowed with prod read
 * keys per CLAUDE.md).
 */

import "dotenv/config";
import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";

const params = new URLSearchParams({
  "tweet.fields": "created_at,author_id,attachments,text,lang",
  "media.fields": "type,alt_text,url,preview_image_url,width,height",
  "user.fields": "username,name",
  expansions: "attachments.media_keys,author_id",
  max_results: "100",
  test_mode: "true",
});

function tweetLink(username: string | undefined, id: string): string {
  return username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`;
}

async function main() {
  const fullUrl = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
  const resp = await axios.get(fullUrl, {
    headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
    timeout: 30_000,
  });

  const data = resp.data;
  const mediaByKey = new Map<string, any>();
  for (const m of data.includes?.media ?? []) mediaByKey.set(m.media_key, m);
  const userById = new Map<string, any>();
  for (const u of data.includes?.users ?? []) userById.set(u.id, u);

  const posts = data.data ?? [];
  const withMedia = posts.filter((t: any) => t.attachments?.media_keys?.length);

  let altTextCount = 0;
  console.log(`\nTotal posts: ${posts.length} | with media: ${withMedia.length}\n`);

  for (const t of withMedia) {
    const username = userById.get(t.author_id)?.username;
    const media = (t.attachments.media_keys as string[])
      .map((k) => mediaByKey.get(k))
      .filter(Boolean);

    const lines = media.map((m: any) => {
      const alt = m.alt_text ?? null;
      if (alt) altTextCount++;
      return `    - [${m.type}] alt_text: ${alt ? JSON.stringify(alt) : "(none)"}`;
    });

    console.log(tweetLink(username, t.id));
    console.log(`    text: ${JSON.stringify((t.text ?? "").slice(0, 120))}`);
    console.log(lines.join("\n"));
    console.log("");
  }

  const totalMedia = withMedia.reduce(
    (n: number, t: any) => n + (t.attachments?.media_keys?.length ?? 0),
    0
  );
  console.log(`\nMedia objects: ${totalMedia} | with alt_text: ${altTextCount}`);
}

main().catch((err: any) => {
  console.error(`FAILED status=${err.response?.status} ${err.response?.statusText ?? err.message}`);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
