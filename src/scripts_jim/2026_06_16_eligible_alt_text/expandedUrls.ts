/**
 * Find eligible posts whose entities.urls contain a real (non-media)
 * expanded_url, and print: link, text, note_tweet.text, and the t.co→expanded
 * mapping. Also shows the text with t.co stubs replaced. Read-only.
 */

import "dotenv/config";
import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";

const params = new URLSearchParams({
  "tweet.fields": "text,note_tweet,entities,author_id",
  expansions: "author_id",
  "user.fields": "username",
  max_results: "100",
  test_mode: "true",
});

type UrlEntity = { url: string; expanded_url?: string; display_url?: string; media_key?: string };

// Swap every non-media t.co stub for its real destination.
function expandStubs(text: string, urls: UrlEntity[]): string {
  let out = text;
  for (const u of urls) {
    if (u.expanded_url && !u.media_key) out = out.split(u.url).join(u.expanded_url);
  }
  return out;
}

async function main() {
  const fullUrl = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
  const resp = await axios.get(fullUrl, {
    headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
    timeout: 30_000,
  });
  const posts: any[] = resp.data.data ?? [];
  const userById = new Map<string, any>();
  for (const u of resp.data.includes?.users ?? []) userById.set(u.id, u);

  const realLinkPosts = posts.filter((p) =>
    (p.entities?.urls ?? []).some((u: UrlEntity) => u.expanded_url && !u.media_key),
  );
  console.log(`posts=${posts.length}  with real expanded_url=${realLinkPosts.length}\n`);

  for (const p of realLinkPosts.slice(0, 6)) {
    const username = userById.get(p.author_id)?.username;
    const link = username ? `https://x.com/${username}/status/${p.id}` : `https://x.com/i/web/status/${p.id}`;
    const urls: UrlEntity[] = p.entities?.urls ?? [];
    const realLinks = urls.filter((u) => u.expanded_url && !u.media_key);

    console.log("=".repeat(80));
    console.log(link);
    console.log(`\n  text:\n    ${JSON.stringify(p.text)}`);
    if (p.note_tweet?.text) console.log(`\n  note_tweet.text:\n    ${JSON.stringify(p.note_tweet.text)}`);
    console.log(`\n  expanded_urls (real, non-media):`);
    for (const u of realLinks) console.log(`    ${u.url}  ->  ${u.expanded_url}   (${u.display_url})`);
    const mediaLinks = urls.filter((u) => u.media_key);
    if (mediaLinks.length) console.log(`  (+${mediaLinks.length} media stub(s) skipped: ${mediaLinks.map((u) => u.display_url).join(", ")})`);
    console.log(`\n  text with stubs expanded:\n    ${JSON.stringify(expandStubs(p.note_tweet?.text ?? p.text, urls))}`);
    console.log("");
  }
}

main().catch((err: any) => {
  console.error(`FAILED status=${err.response?.status} ${err.response?.statusText ?? err.message}`);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
