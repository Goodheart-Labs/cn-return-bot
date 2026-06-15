import { serve } from "bun";
import { readFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";

dotenv.config({ path: join(process.cwd(), ".env") });

const useLocal = process.argv.includes("--local");
const supabaseUrl = useLocal ? process.env.LOCAL_SUPABASE_URL : process.env.SUPABASE_URL;
const supabaseKey = useLocal ? process.env.LOCAL_SUPABASE_SERVICE_KEY : process.env.SUPABASE_SERVICE_KEY;

const PORT = 8001;

// ─── Server-side default-view prefetch ───────────────────────────────────────
// The client's first paint is the default review view: the newest rated-unhelpful
// notes. Fetching that from the browser costs a cold connection + two round-trips
// (~1.3–3.8s). Instead the server fetches it once at startup (paying the one cold
// hit before the page is ever opened) and injects it into the HTML, so the page
// paints from data already in the document — zero client round-trips. The client's
// phase-2 load then refreshes everything live, so a slightly stale snapshot here
// only ever affects the first instant of the first paint.
//
// Column lists and the default status mirror data.ts (CANONICAL_LIST_COLUMNS etc.)
// and App.tsx (DEFAULT_VIEW_STATUSES) — keep them in sync if those change.
const DEFAULT_VIEW_STATUSES = ["CURRENTLY_RATED_NOT_HELPFUL"];
const DEFAULT_VIEW_LIMIT = 1000; // load the whole default category; it's small
const CANONICAL_COLS = "note_id,tweet_id,note_text,source_url,submitted_at,first_seen_at,cn_status,view_count,rating_count,helpful_count,not_helpful_count";
const TWEET_COLS = "tweet_id,text,media,referenced_tweet_data,author_handle,has_photo,has_video,media_count";
const RATING_COLS = "note_id,helpful_count,somewhat_helpful_count,not_helpful_count,helpful_tag_counts,not_helpful_tag_counts,dump_date";

async function sb(path: string): Promise<any[]> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: { apikey: supabaseKey!, Authorization: `Bearer ${supabaseKey}` },
  });
  if (!res.ok) throw new Error(`${res.status} on ${path}`);
  return res.json();
}

function inList(values: string[]): string {
  return `(${values.map((v) => `"${v}"`).join(",")})`;
}

// Returns a DashboardData-shaped object (competing/runs empty — same as the
// client's fetchRecentNotesLight), or null if the prefetch fails (client falls
// back to fetching for itself).
async function fetchDefaultView(): Promise<any | null> {
  if (!supabaseUrl || !supabaseKey) return null;
  try {
    const statusList = inList(DEFAULT_VIEW_STATUSES);
    const canonical = await sb(
      `notes?select=${CANONICAL_COLS}&cn_status=in.${encodeURIComponent(statusList)}&order=submitted_at.desc.nullslast&limit=${DEFAULT_VIEW_LIMIT}`,
    );
    const noteIds = canonical.map((n) => n.note_id);
    const tweetIds = [...new Set(canonical.map((n) => n.tweet_id).filter(Boolean))] as string[];
    if (noteIds.length === 0) {
      return { canonical, competing: [], submittedRuns: [], missedRuns: [], lowEvalRuns: [], lowEvalScores: [], annotations: [], tweets: [], publicDumpRatings: [] };
    }
    const [tweets, publicDumpRatings, annotations] = await Promise.all([
      tweetIds.length ? sb(`tweets?select=${TWEET_COLS}&tweet_id=in.${encodeURIComponent(inList(tweetIds))}`) : Promise.resolve([]),
      sb(`note_ratings_from_public_dump?select=${RATING_COLS}&note_id=in.${encodeURIComponent(inList(noteIds))}`),
      sb(`review_dashboard_annotations?select=*&source=eq.production&target_id=in.${encodeURIComponent(inList(noteIds))}`).catch(() => []),
    ]);
    return { canonical, competing: [], submittedRuns: [], missedRuns: [], lowEvalRuns: [], lowEvalScores: [], annotations, tweets, publicDumpRatings };
  } catch (e) {
    console.warn("[server] default-view prefetch failed:", (e as Error).message);
    return null;
  }
}

let defaultView: any | null = null;

// WARNING: This injects the Supabase service role key (full DB access) into the page.
// This server must only run on localhost. Never expose it to the network or deploy it.
function injectCredentials(html: string): string {
  // Escape `<` so note/tweet text can't break out of the <script> tag.
  const dvJson = defaultView ? JSON.stringify(defaultView).replace(/</g, "\\u003c") : "null";
  const script = `
    <script>
      window.__SUPABASE_CONFIG__ = {
        url: "${supabaseUrl}",
        key: "${supabaseKey}"
      };
      window.__DEFAULT_VIEW__ = ${dvJson};
    </script>
  `;
  return html.replace("</head>", script + "</head>");
}

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve static files from dist
    if (url.pathname !== "/" && url.pathname !== "/index.html") {
      const filePath = join(import.meta.dir, "dist", url.pathname);
      try {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }
      } catch {}
    }

    // Serve index.html with injected credentials + prefetched default view.
    // Refresh the snapshot in the background so the next load is current; this
    // request still serves the snapshot already in hand (instant).
    fetchDefaultView().then((dv) => { if (dv) defaultView = dv; });
    const html = injectCredentials(readFileSync(join(import.meta.dir, "dist/index.html"), "utf-8"));
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});

// Pay the one cold Supabase hit at startup, before the page is opened, so the
// first paint comes from data already in the HTML.
console.log("Prefetching default view…");
defaultView = await fetchDefaultView();
console.log(
  `Review dashboard running at http://localhost:${PORT} (${useLocal ? "local" : "prod"} Supabase)` +
    (defaultView ? ` — default view prefetched (${defaultView.canonical.length} notes)` : " — prefetch unavailable, client will fetch"),
);
