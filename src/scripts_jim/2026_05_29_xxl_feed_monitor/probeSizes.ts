/** Probe LOCAL_X_* across feed sizes with test_mode=false to find the max real feed it can read. */
import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";

process.env.X_API_KEY = process.env.LOCAL_X_API_KEY;
process.env.X_API_KEY_SECRET = process.env.LOCAL_X_API_KEY_SECRET;
process.env.X_ACCESS_TOKEN = process.env.LOCAL_X_ACCESS_TOKEN;
process.env.X_ACCESS_TOKEN_SECRET = process.env.LOCAL_X_ACCESS_TOKEN_SECRET;

async function probe(size: string, testMode: string) {
  const params = new URLSearchParams({
    "tweet.fields": "created_at",
    test_mode: testMode,
    max_results: "20",
    post_selection: `feed_size: ${size}, feed_lang: en`,
  });
  const url = `${API_URL}?${params.toString().replace(/\+/g, "%20")}`;
  try {
    const res = await axios.get(url, { headers: { ...getOAuth1Headers(url, "GET"), "Content-Type": "application/json" }, timeout: 20000 });
    console.log(`  ${size} test_mode=${testMode}: ${res.data?.data?.length ?? 0} posts, next_token=${res.data?.meta?.next_token ? "yes" : "no"}`);
  } catch (e: any) {
    console.log(`  ${size} test_mode=${testMode}: FAIL ${e?.response?.status} ${e?.response?.data?.detail ?? e?.message}`);
  }
}

async function main() {
  console.log("LOCAL_X_* feed-size matrix:");
  for (const tm of ["false", "true"]) {
    for (const size of ["small", "large", "xl", "xxl"]) {
      await probe(size, tm);
    }
  }
}
main();
