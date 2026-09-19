/**
 * Serves the blind rating page and records one rater's answers.
 *
 * The outcome of every note in the sample is already known and sits in
 * sample.json, which is what lets the exercise score itself the moment both
 * raters finish. It is therefore stripped here and never crosses the wire: the
 * page cannot leak what it never receives.
 *
 * Each rater writes to their own file, so neither can see the other's answers
 * while rating. Answers are saved one at a time, so closing the tab loses
 * nothing and reopening resumes where it stopped.
 *
 *   bun run server.ts            then open http://127.0.0.1:8012/?rater=nathan
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const HERE = import.meta.dir;
const DATA = join(HERE, "data");
const PORT = 8012;

if (!existsSync(DATA)) mkdirSync(DATA);

interface Rating {
  note_id: string;
  p_helpful: number;
  accept: string | null;
  checkable: string | null;
  target: string | null;
  comment: string | null;
  seconds: number;
  at: string;
}

const sample = JSON.parse(readFileSync(join(DATA, "sample.json"), "utf-8")) as any[];

/** The sample minus anything that reveals the answer. */
const blind = sample.map((r) => ({
  idx: r.idx,
  note_id: r.note_id,
  tweet_id: r.tweet_id,
  tweet_text: r.tweet_text,
  author_handle: r.author_handle,
  note_text: r.note_text,
  sources: r.sources,
  context: r.context,
}));

function ratingsPath(rater: string): string {
  const safe = rater.replace(/[^a-z0-9_-]/gi, "").toLowerCase() || "anon";
  return join(DATA, `ratings_${safe}.json`);
}

function loadRatings(rater: string): Record<string, Rating> {
  const path = ratingsPath(rater);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf-8"));
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/items") {
      const rater = url.searchParams.get("rater") ?? "anon";
      const done = loadRatings(rater);
      return Response.json({
        items: blind,
        done: Object.keys(done),
        total: blind.length,
        // Disclosed on purpose: the sample is stratified, so a rater who
        // assumed the live 11% base rate would be miscalibrated by design.
        disclosure: "This set is deliberately enriched: 50 of the 150 were rated helpful, 13 not helpful, 87 never rated.",
      });
    }

    if (url.pathname === "/api/rate" && request.method === "POST") {
      const body = (await request.json()) as Rating & { rater: string };
      const rater = body.rater ?? "anon";
      const ratings = loadRatings(rater);
      ratings[body.note_id] = {
        note_id: body.note_id,
        p_helpful: body.p_helpful,
        accept: body.accept ?? null,
        checkable: body.checkable ?? null,
        target: body.target ?? null,
        comment: body.comment ?? null,
        seconds: body.seconds ?? 0,
        at: new Date().toISOString(),
      };
      writeFileSync(ratingsPath(rater), JSON.stringify(ratings, null, 1));
      return Response.json({ ok: true, count: Object.keys(ratings).length });
    }

    return new Response(readFileSync(join(HERE, "index.html")), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  },
});

console.log(`blind rating on http://127.0.0.1:${PORT}/?rater=nathan   (${blind.length} notes)`);
