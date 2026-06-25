/** Probe: confirm JSON sub-path select works and gauge row volume. */
import { getSupabaseClient } from "../../api/supabaseClient";

const supabase = getSupabaseClient();

async function main() {
  const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();

  // 1) total run count over the window
  const { count, error: cErr } = await supabase
    .from("pipeline_runs")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (cErr) throw cErr;
  console.log("total pipeline_runs in last 10 days:", count);

  // 2) sample the media sub-path select shape
  const { data, error } = await supabase
    .from("pipeline_runs")
    .select(
      "id, created_at, error_message, media:logs->tweet->post->media, qmedia:logs->tweet->post->referenced_tweet_data->media",
    )
    .gte("created_at", since)
    .limit(5);
  if (error) throw error;
  for (const r of data ?? []) {
    console.log(JSON.stringify({
      created_at: r.created_at,
      media_len: Array.isArray(r.media) ? r.media.length : r.media,
      qmedia_len: Array.isArray(r.qmedia) ? r.qmedia.length : r.qmedia,
      err: r.error_message?.slice(0, 80) ?? null,
    }));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
