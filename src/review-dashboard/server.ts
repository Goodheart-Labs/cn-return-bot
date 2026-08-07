import { serve } from "bun";
import { readFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";
import {
  DEFAULT_VIEW_STATUSES,
  DEFAULT_VIEW_LIMIT,
  CANONICAL_LIST_COLS,
  TWEET_LIST_COLS,
  PUBLIC_DUMP_RATING_COLS,
} from "../dashboard-shared/productionView";

dotenv.config({ path: join(process.cwd(), ".env") });

const useLocal = process.argv.includes("--local");
const supabaseUrl = useLocal ? process.env.LOCAL_SUPABASE_URL : process.env.SUPABASE_URL;
const supabaseKey = useLocal ? process.env.LOCAL_SUPABASE_SERVICE_KEY : process.env.SUPABASE_SERVICE_KEY;

const PORT = 8001;

// ─── Server-side default-view prefetch ───────────────────────────────────────
// The first thing the client paints is the default review view. That view holds every
// note in the default statuses, which today means the notes rated unhelpful, with no
// date window. Fetching it from the browser costs a cold connection and a couple of
// round-trips, which takes one to four seconds. So the server fetches it once at
// startup instead and injects it into the HTML. The page then paints from data that is
// already in the document and makes no request of its own. The client afterwards
// reloads the full default set, this time including ab_test_picks, along with the
// windowed rest, and replaces this snapshot. So a snapshot that is slightly stale and
// carries no A/B picks only shows for the first instant.
//
// The status list and the column lists come from productionView, which the client
// loader also uses. That way the prefetch cannot drift from what the client renders.
const CANONICAL_COLS = CANONICAL_LIST_COLS.join(",");
const TWEET_COLS = TWEET_LIST_COLS.join(",");
const RATING_COLS = PUBLIC_DUMP_RATING_COLS.join(",");

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

// This returns an object shaped like DashboardData. The competing notes and the
// pipeline runs are left empty, because the client's windowed load fills them in when
// it replaces this snapshot. It returns null when the prefetch fails, and the client
// then fetches the window for itself.
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
      return { canonical, competing: [], submittedRuns: [], missedRuns: [], lowEvalRuns: [], lowEvalScores: [], annotations: [], tweets: [], publicDumpRatings: [], sightings: [] };
    }
    const [tweets, publicDumpRatings, annotations, sightings] = await Promise.all([
      tweetIds.length ? sb(`tweets?select=${TWEET_COLS}&tweet_id=in.${encodeURIComponent(inList(tweetIds))}`) : Promise.resolve([]),
      sb(`note_ratings_from_public_dump?select=${RATING_COLS}&note_id=in.${encodeURIComponent(inList(noteIds))}`),
      sb(`review_dashboard_annotations?select=*&source=eq.production&target_id=in.${encodeURIComponent(inList(noteIds))}`).catch(() => []),
      tweetIds.length ? sb(`misinfo_monitoring_sightings?select=tweet_id,topic_id&tweet_id=in.${encodeURIComponent(inList(tweetIds))}`).catch(() => []) : Promise.resolve([]),
    ]);
    return { canonical, competing: [], submittedRuns: [], missedRuns: [], lowEvalRuns: [], lowEvalScores: [], annotations, tweets, publicDumpRatings, sightings };
  } catch (e) {
    console.warn("[server] default-view prefetch failed:", (e as Error).message);
    return null;
  }
}

let defaultView: any | null = null;

// WARNING: This injects the Supabase service role key (full DB access) into the page.
// This server must only run on localhost. Never expose it to the network or deploy it.
function injectCredentials(html: string): string {
  // Every `<` is escaped so that text from a note or a tweet cannot break out of the
  // script tag.
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

    if (url.pathname !== "/" && url.pathname !== "/index.html") {
      const filePath = join(import.meta.dir, "dist", url.pathname);
      try {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }
      } catch {}
    }

    // The snapshot is refreshed in the background so that the next load is current.
    // This request does not wait for it. It serves the snapshot already in hand, which
    // makes the response instant.
    fetchDefaultView().then((dv) => { if (dv) defaultView = dv; });
    const html = injectCredentials(readFileSync(join(import.meta.dir, "dist/index.html"), "utf-8"));
    // The HTML must never be cached. It points at JavaScript and CSS files whose names
    // contain a content hash. A plain refresh therefore has to re-read index.html to
    // learn the hashes a new build produced.
    return new Response(html, {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store, must-revalidate" },
    });
  },
});

// The one slow Supabase request happens here at startup, before anyone opens the page.
// The first paint then comes from data that is already in the HTML.
console.log("Prefetching default view…");
defaultView = await fetchDefaultView();
console.log(
  `Review dashboard running at http://localhost:${PORT} (${useLocal ? "local" : "prod"} Supabase)` +
    (defaultView ? ` — default view prefetched (${defaultView.canonical.length} notes)` : " — prefetch unavailable, client will fetch"),
);
