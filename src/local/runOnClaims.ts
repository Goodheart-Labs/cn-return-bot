/**
 * Run On Claims
 *
 * Runs the production note-writing pipeline over factual claims taken from a
 * podcast transcript, or from any other long-form transcript. Each claim is
 * treated as if it were a standalone tweet. No X API access is needed. Each
 * claim becomes a synthetic Post whose text is the claim rewritten as a tweet,
 * and whose author is the speaker who said it. The pipeline then searches,
 * writes a note when one is warranted, verifies the source and scores the
 * result, exactly as it does for a real tweet.
 *
 * Input: a JSON file
 *   {
 *     "episode": "...", "date": "YYYY-MM-DD", "youtube_id": "...",
 *     "claims": [ { "id", "speaker", "section", "type", "text", "verbatim" }, ... ]
 *   }
 * The `text` field is the claim rewritten as a tweet, and that is what the
 * pipeline sees. The `verbatim` field is what the speaker actually said. It is
 * the ground truth and it is only carried through to the dossier.
 *
 * Usage:
 *   bun run src/local/runOnClaims.ts [flags] <claims.json>
 *
 * Flags:
 *   --bot <id>         Force a bot. The default is opus-direct-grok, which
 *                      searches with Perplexity and Grok and writes and
 *                      verifies with Opus. It needs both OPENROUTER_API_KEY
 *                      and XAI_API_KEY.
 *   --pick test=var    Force an A/B test variant. Repeatable. For example
 *                      --pick note_prefilter=off makes every claim get the full
 *                      search and write treatment instead of being killed early.
 *   --ids C1,C5        Only run these claim ids.
 *   --exclude C1,C2    Skip these claim ids, for example ones already run.
 *   --max <n>          Limit the number of claims.
 *   --concurrency <n>  How many workers run in parallel. The default is 3.
 *   --name <label>     The name the run gets in the dashboard.
 */

import "dotenv/config";
import { captureProdSupabaseCreds } from "./prodSupabaseCreds";
captureProdSupabaseCreds();

// Route Supabase to a local instance when one is configured. runOnVideos and
// tryoutNotes do the same thing. This has to happen before anything imports
// Supabase.
const localUrl = process.env.LOCAL_SUPABASE_URL;
const localKey = process.env.LOCAL_SUPABASE_SERVICE_KEY;
if (localUrl && localKey) {
  process.env.SUPABASE_URL = localUrl;
  process.env.SUPABASE_SERVICE_KEY = localKey;
}

import * as fs from "fs";
import type { Post } from "../api/fetchEligiblePosts";
import { getBotById, getEnabledBots } from "../bots/index";
import { runPipeline, type InputRow, type PostFetcher } from "./localPipelineRunner";

const DEFAULT_BOT = "opus-direct-grok";

interface Claim {
  id: string;
  speaker: string;
  section?: string;
  type?: string;
  text: string;
  verbatim?: string;
}

interface ClaimsFile {
  episode?: string;
  date?: string;
  youtube_id?: string;
  claims: Claim[];
}

function takeFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`${flag} requires a value`);
    process.exit(1);
  }
  args.splice(i, 2);
  return v;
}

function takeAllFlagValues(args: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; ) {
    if (args[i] !== flag) { i++; continue; }
    const v = args[i + 1];
    if (!v || v.startsWith("--")) {
      console.error(`${flag} requires a value`);
      process.exit(1);
    }
    out.push(v);
    args.splice(i, 2);
  }
  return out;
}

function parsePositiveInt(label: string, raw: string): number {
  const n = parseInt(raw, 10);
  if (!n || n < 1) {
    console.error(`${label} requires a positive number (got "${raw}")`);
    process.exit(1);
  }
  return n;
}

async function main() {
  const args = process.argv.slice(2);

  const botId = takeFlag(args, "--bot") ?? DEFAULT_BOT;
  const pickFlags = takeAllFlagValues(args, "--pick");
  const idsFlag = takeFlag(args, "--ids");
  const excludeFlag = takeFlag(args, "--exclude");
  const maxFlag = takeFlag(args, "--max");
  const concFlag = takeFlag(args, "--concurrency");
  const runName = takeFlag(args, "--name");

  if (!getBotById(botId)) {
    console.error(`Unknown bot: ${botId}`);
    console.error("Available bots:", getEnabledBots().map((b) => b.id).join(", "));
    process.exit(1);
  }

  const forcedPicks: Record<string, string> = { bot: botId };
  for (const pick of pickFlags) {
    const eq = pick.indexOf("=");
    if (eq < 1 || eq === pick.length - 1) {
      console.error(`--pick value must be test=variant (got "${pick}")`);
      process.exit(1);
    }
    forcedPicks[pick.slice(0, eq)] = pick.slice(eq + 1);
  }

  const filePath = args.find((a) => !a.startsWith("--"));
  if (!filePath || !fs.existsSync(filePath)) {
    console.error("Usage: bun run src/local/runOnClaims.ts [flags] <claims.json>");
    console.error(`  claims.json not found: ${filePath ?? "(none given)"}`);
    process.exit(1);
  }

  const data: ClaimsFile = JSON.parse(fs.readFileSync(filePath, "utf8"));
  let claims = data.claims ?? [];

  if (idsFlag) {
    const wanted = new Set(idsFlag.split(",").map((s) => s.trim()));
    claims = claims.filter((c) => wanted.has(c.id));
  }
  if (excludeFlag) {
    const skip = new Set(excludeFlag.split(",").map((s) => s.trim()));
    claims = claims.filter((c) => !skip.has(c.id));
  }
  if (maxFlag) claims = claims.slice(0, parsePositiveInt("--max", maxFlag));

  if (claims.length === 0) {
    console.error("No claims to run (after filters).");
    process.exit(1);
  }

  // The post's created_at is the episode's date. We pin it to noon UTC so that
  // a timezone offset cannot push it onto the previous or the next day.
  const createdAt = data.date
    ? new Date(`${data.date}T12:00:00Z`).toISOString()
    : new Date().toISOString();

  // There are no real URLs here, so each input's url is really a claim id. The
  // fetcher looks the claim up by that id to build the Post.
  const byId = new Map<string, Claim>(claims.map((c) => [c.id, c]));
  const inputs: InputRow[] = claims.map((c) => ({ url: c.id }));

  const fetchPost: PostFetcher = async (input) => {
    const claim = byId.get(input.url);
    if (!claim) throw new Error(`No claim for id ${input.url}`);
    const post: Post = {
      id: `${data.youtube_id ?? "claim"}-${claim.id}`,
      author_id: claim.speaker,
      author_name: claim.speaker,
      created_at: createdAt,
      text: claim.text,
      media: [],
    };
    return { post, title: `[${claim.id}] ${claim.speaker}: ${claim.text.slice(0, 60)}` };
  };

  console.log(
    `[runOnClaims] ${claims.length} claim(s) from "${data.episode ?? filePath}", bot=${botId}`,
  );

  await runPipeline({
    scriptName: "runOnClaims",
    folderPrefix: "claims",
    inputs,
    fetchPost,
    forcedPicks,
    datasetName: data.youtube_id ?? "claims",
    concurrency: concFlag ? parsePositiveInt("--concurrency", concFlag) : 3,
    runName,
  });
}

main().catch((err) => {
  console.error("[runOnClaims] Fatal error:", err);
  process.exit(1);
});
