/**
 * Experiment 7: is the "Scott Alexander Compares AI Safety Critics to Early
 * Christian Persecutors" story from Jim's panel in the News API at all, and
 * what does it look like? About 20 stories at $0.005 each.
 */
import { xGet } from "./x";

const FIELDS = "name,summary,hook,category,contexts,keywords,cluster_posts_results,updated_at";

for (const query of ["Scott Alexander AI safety critics early Christian persecutors", "Astral Codex Ten", "AI safety"]) {
  const result = await xGet("/2/news/search", { query, max_results: 10, max_age_hours: 48, "news.fields": FIELDS }, "user", `07_${query.replace(/\W+/g, "_")}`);
  console.log(`\n[${query}]: ${result.body.data?.length ?? 0} stories`);
  for (const story of result.body.data ?? []) {
    console.log(`  ${story.id} ${story.name} (${story.cluster_posts_results?.length} posts) updated ${story.updated_at}`);
  }
}
