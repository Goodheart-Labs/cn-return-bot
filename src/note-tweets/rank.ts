import { supabaseConfig } from "./config";
import { ensureState, STATE_DIR } from "./paths";
import { loadNotes } from "./loadNotes";
import { rankNotes } from "./ranking";
import { feedPage } from "./feedPage";
import { host, noteText } from "./markup";
import { buildStyles } from "./styles";
import type { FeedData, Staged } from "./types";

const config = supabaseConfig();
await ensureState();
const { rows, jim, articles, helpfulAt, extra } = await loadNotes(config.url, config.serviceKey, Bun.argv.slice(2));
const scored = rankNotes(rows);
const staging: Record<string, Staged> = await Bun.file(`${STATE_DIR}/staging.json`).json().catch(() => ({}));
const html = feedPage(scored, jim, articles, helpfulAt, staging, config.url, config.anonKey);
await buildStyles();
await Bun.write(`${STATE_DIR}/ranked.html`, html);
const feedData: FeedData = Object.fromEntries(scored.map(n => {
  const c = n.everything_claims, pr = c?.everything_items?.everything_projects;
  return [n.id, {
    id: n.id, slug: pr?.slug, project: pr?.name, host: host(c?.everything_items?.url),
    url: `https://commonnotes.net/?project=${pr?.slug}&note=${n.id}`,
    quote: c?.context_quote ?? c?.claim ?? "", note: noteText(n),
    title: c?.everything_items?.title ?? "", published_at: c?.everything_items?.published_at ?? null,
    helpful: n.helpful_count, updated_quote: c?.updated_quote ?? null, jim: jim.get(n.id) ?? null,
  }];
}));
await Bun.write(`${STATE_DIR}/feed-data.json`, JSON.stringify(feedData, null, 2));
console.log(jim.size, "notes on Jim's list,", extra.length, "fetched without votes");

console.log(scored.filter(n => n.everything_claims?.updated_quote).length, "flagged since-corrected");
console.log(scored.length, "notes");
for (const n of scored.slice(0, 5)) console.log(n.p.toFixed(2), n.status, n.helpful_count, n.somewhat_helpful_count, n.not_helpful_count, n.everything_claims?.everything_items?.everything_projects?.slug);
