/* Tries an empirical Bayes creator score (GOO-549). Each visited post's
 * readers beyond the first are modelled as Poisson with a creator's own rate,
 * and the rates as Gamma across creators. The posterior mean shrinks a
 * creator with few posts toward the average creator. The Gamma is fitted by
 * the method of moments, allowing for each creator's own Poisson noise. */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const LAST_POSTS = 10;
const { data, error } = await db.rpc("everything_creator_visit_scores", { last_posts: LAST_POSTS });
if (error) throw error;
const creators = (data as { feed_url: string; visitors_per_post: number; posts: number }[]).map((c) => ({ ...c, excess: c.posts * (c.visitors_per_post - 1) }));
const totalPosts = creators.reduce((s, c) => s + c.posts, 0);
const mu = creators.reduce((s, c) => s + c.excess, 0) / totalPosts;
// Variance of the creators' means around mu, minus what Poisson noise alone
// would give, is the spread of the true rates.
const spread = creators.reduce((s, c) => s + (c.excess / c.posts - mu) ** 2 - mu / c.posts, 0) / creators.length;
const beta = mu / spread;
const alpha = mu * beta;
console.log(`${creators.length} visited creators, ${totalPosts} posts. Mean extra readers per post ${mu.toFixed(3)}, spread of true rates ${spread.toFixed(3)}.`);
console.log(`Prior: Gamma(alpha ${alpha.toFixed(3)}, beta ${beta.toFixed(3)}), so a creator's own posts outweigh the prior after ${beta.toFixed(1)} posts.\n`);
const shrunk = (c: (typeof creators)[number]) => 1 + (alpha + c.excess) / (beta + c.posts);
const byRaw = [...creators].sort((a, b) => b.visitors_per_post - a.visitors_per_post);
const byShrunk = [...creators].sort((a, b) => shrunk(b) - shrunk(a));
console.log("rank  current score (posts)                         | shrunk score (posts)");
for (let i = 0; i < 25; i++) {
  const a = byRaw[i]!, b = byShrunk[i]!;
  const name = (c: typeof a) => c.feed_url.replace(/^https:\/\/(www\.)?/, "").slice(0, 32).padEnd(32);
  console.log(`${String(i + 1).padStart(3)}  ${name(a)} ${a.visitors_per_post.toFixed(2)} (${a.posts})   | ${name(b)} ${shrunk(b).toFixed(2)} (${b.posts}, was ${b.visitors_per_post.toFixed(2)})`);
}
const MIN_SCORE_TO_WALK = 1.5;
console.log(`\nwalked by score today (>= ${MIN_SCORE_TO_WALK} over >= 2 posts): ${creators.filter((c) => c.visitors_per_post >= MIN_SCORE_TO_WALK && c.posts >= 2).length}; shrunk score >= ${MIN_SCORE_TO_WALK}: ${creators.filter((c) => shrunk(c) >= MIN_SCORE_TO_WALK).length}`);
