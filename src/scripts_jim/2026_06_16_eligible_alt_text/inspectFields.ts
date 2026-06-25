/**
 * Inspect note_tweet vs text, and the API `entities` field vs the
 * context_annotations we currently use. Read-only GET (test_mode=true).
 */

import "dotenv/config";
import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";

const params = new URLSearchParams({
  "tweet.fields": "created_at,author_id,text,note_tweet,entities,context_annotations,lang",
  expansions: "author_id,entities.mentions.username",
  "user.fields": "username",
  max_results: "100",
  test_mode: "true",
});

async function main() {
  const fullUrl = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
  const resp = await axios.get(fullUrl, {
    headers: { ...getOAuth1Headers(fullUrl, "GET"), "Content-Type": "application/json" },
    timeout: 30_000,
  });
  const posts: any[] = resp.data.data ?? [];

  const withNoteTweet = posts.filter((p) => p.note_tweet);
  const withEntities = posts.filter((p) => p.entities);
  const withContext = posts.filter((p) => p.context_annotations);

  console.log(`\nposts=${posts.length}  note_tweet=${withNoteTweet.length}  entities=${withEntities.length}  context_annotations=${withContext.length}\n`);

  console.log("===== note_tweet vs text =====");
  for (const p of withNoteTweet.slice(0, 2)) {
    console.log(`\ntweet ${p.id}`);
    console.log(`  text (${(p.text ?? "").length} chars): ${JSON.stringify(p.text)}`);
    console.log(`  note_tweet.text (${(p.note_tweet.text ?? "").length} chars): ${JSON.stringify(p.note_tweet.text)}`);
    console.log(`  note_tweet keys: ${Object.keys(p.note_tweet)}`);
  }
  if (!withNoteTweet.length) console.log("  (no long-form posts in this sample)");

  console.log("\n\n===== API `entities` (in-text spans) vs `context_annotations` (topic tags) =====");
  const sample = withEntities.find((p) => p.context_annotations) ?? withEntities[0] ?? withContext[0];
  if (sample) {
    console.log(`\ntweet ${sample.id}`);
    console.log(`  text: ${JSON.stringify((sample.text ?? "").slice(0, 160))}`);
    console.log(`\n  entities (what we DON'T use):`);
    console.log("  " + JSON.stringify(sample.entities, null, 2).replace(/\n/g, "\n  "));
    console.log(`\n  context_annotations (what Post.entities is derived from):`);
    console.log("  " + JSON.stringify(sample.context_annotations, null, 2).replace(/\n/g, "\n  "));
  }
}

main().catch((err: any) => {
  console.error(`FAILED status=${err.response?.status} ${err.response?.statusText ?? err.message}`);
  if (err.response?.data) console.error(JSON.stringify(err.response.data, null, 2));
  process.exit(1);
});
