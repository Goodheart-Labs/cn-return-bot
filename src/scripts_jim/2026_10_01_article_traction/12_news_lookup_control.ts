/**
 * Experiment 12: the lookup of the panel story answered 503. Retry it as the app
 * and as the user, and look up a story id that search returned earlier, as a
 * control. Three requests at most, $0.015.
 */
import { xGet } from "./x";

const PANEL_STORY = "2105813967801070019";
const KNOWN_STORY = "2105801185953296699";

for (const [id, auth] of [[PANEL_STORY, "app"], [PANEL_STORY, "user"], [KNOWN_STORY, "user"]] as const) {
  const result = await xGet(`/2/news/${id}`, { "news.fields": "name,category,updated_at,cluster_posts_results" }, auth, `12_${id}_${auth}`);
  console.log(`${id} as ${auth}: ${result.status} ${result.body.data ? `found, ${result.body.data.cluster_posts_results?.length} posts` : ""}`);
}
