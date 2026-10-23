/**
 * Draws claims uniformly at random from the claims that production fact-checked
 * after the claim rater went live (PR #452, merged 2026-09-09 14:16 UTC), and
 * saves them with the item they come from in realisticSample.json. Claims that
 * rest on an image are left out, because the judges read text only. Claims that
 * are already datapoints are left out too.
 *
 *   bun run src/scripts_jim/2026_09_29_claimchecker_microsite/dataset/sampleRealistic.ts [count]
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "fs";
import { join } from "path";
import { LAB_DIR } from "../runStore";
import { DATAPOINTS } from "./datapoints";

const RATER_LIVE_AT = "2026-09-09T14:16:20Z";
const PAGE = 1000;
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

async function checkedClaimIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("everything_claims")
      .select("id, image_urls")
      .in("status", ["note", "no_note"])
      .gte("created_at", RATER_LIVE_AT)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    ids.push(...data.filter((c) => ((c.image_urls as string[] | null) ?? []).length === 0).map((c) => c.id));
    if (data.length < PAGE) return ids;
  }
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

const count = Number(process.argv[2] ?? 20);
const taken = new Set(DATAPOINTS.flatMap((d) => ("claimSource" in d ? [d.claimSource.from === "production" ? d.claimSource.claimId : d.claimSource.productionClaimId] : [])));
const all = (await checkedClaimIds()).filter((id) => !taken.has(id));
console.log(`${all.length} checked claims since ${RATER_LIVE_AT}`);
const chosen = shuffled(all).slice(0, count);
const { data: claims, error } = await db
  .from("everything_claims")
  .select("id, claim, context_quote, context_paragraph, status, judgement, created_at, everything_items(id, title, url, source, everything_projects(slug))")
  .in("id", chosen);
if (error) throw error;
writeFileSync(join(LAB_DIR, "dataset", "realisticSample.json"), JSON.stringify({ drawnAt: new Date().toISOString(), poolSize: all.length, claims }, null, 1));
for (const c of claims) console.log(c.id, c.status, "|", c.claim.slice(0, 100));
