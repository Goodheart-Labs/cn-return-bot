/** One-off: test whether the credentials in T_* env vars can read the real feed. */
import axios from "axios";
import { getOAuth1Headers } from "../../api/getOAuthToken";

process.env.X_API_KEY = process.env.T_API_KEY;
process.env.X_API_KEY_SECRET = process.env.T_API_SECRET;
process.env.X_ACCESS_TOKEN = process.env.T_ACCESS;
process.env.X_ACCESS_TOKEN_SECRET = process.env.T_ACCESS_SECRET;

const API_URL = "https://api.x.com/2/notes/search/posts_eligible_for_notes";

async function whoami() {
  const url = "https://api.twitter.com/2/users/me";
  try {
    const res = await axios.get(url, { headers: { ...getOAuth1Headers(url, "GET") }, timeout: 15000 });
    console.log(`whoami: @${res.data?.data?.username} (${res.data?.data?.name})`);
  } catch (e: any) {
    console.log(`whoami FAIL: ${e?.response?.status} ${e?.response?.data?.detail ?? e?.message}`);
  }
}

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
  await whoami();
  for (const size of ["large", "xl", "xxl", "small"]) await probe(size, "false");
}
main();
