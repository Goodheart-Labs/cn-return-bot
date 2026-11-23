/* Runs the image screen on the images of a few recent Claude tweets and posts, to see that downloads and OpenAI's answers work on real hosts (GOO-815). */
import { getSupabaseClient } from "../../api/supabaseClient";
import { imageLinksIn, screenImages } from "../../claude-notes/imageScreen";

const db = getSupabaseClient();
const { data: tweets } = await db.from("pipeline_runs").select("id, input:logs->claude->>input").eq("bot_name", "claude-code").order("created_at", { ascending: false }).limit(40);
const { data: posts } = await db.from("everything_items").select("id, url, full_text").not("full_text", "is", null).order("created_at", { ascending: false }).limit(40);
const texts = [
  ...(process.argv[2] === "posts" ? [] : tweets ?? []).map((t) => ({ what: `tweet run ${t.id}`, text: String(t.input ?? "") })),
  ...(posts ?? []).map((p) => ({ what: p.url, text: p.full_text ?? "" })),
].filter((t) => imageLinksIn(t.text).length > 0).slice(0, 8);
for (const t of texts) {
  const started = Date.now();
  console.log(`${t.what}: ${imageLinksIn(t.text).length} images ->`, JSON.stringify(await screenImages(t.text, { sexualContent: true })), `${Date.now() - started} ms`);
}
