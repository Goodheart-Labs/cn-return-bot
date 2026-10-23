/* Prints the walk's ranking as the next run would compute it, read-only. */
import "dotenv/config";
import { rankCreators } from "../../everything/creatorRanking";
const ranked = await rankCreators();
console.log(`${ranked.length} ranked, ${ranked.filter((c) => c.prioritized).length} by priority`);
for (const [i, c] of ranked.slice(0, 25).entries())
  console.log(String(i + 1).padStart(3), c.project_slug.padEnd(28), c.prioritized ? "priority" : "        ", c.walkScore.toFixed(2), `(${c.score.visitors_per_post.toFixed(2)} over ${c.score.posts})`);
