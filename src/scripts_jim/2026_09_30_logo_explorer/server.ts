/** Serves the logo explorer and keeps the snapshots Jim saves from it.
 *
 *    bun run src/scripts_jim/2026_09_30_logo_explorer/server.ts 8007
 *
 *  A snapshot is one logo with all its slider values. The page posts it here
 *  and it lands in snapshots/ as a JSON file and an SVG file, so a chosen logo
 *  is on disk in the repo and not only in one browser's storage. */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = import.meta.dir;
const SNAPSHOT_DIR = path.join(ROOT, "snapshots");
const DEFAULT_PORT = 8007;
const port = Number(process.argv[2] ?? DEFAULT_PORT);

interface Snapshot {
  name: string;
  candidate: string;
  values: Record<string, unknown>;
  svg: string;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function saveSnapshot(snapshot: Snapshot) {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const savedAt = new Date().toISOString();
  const file = `${savedAt.slice(0, 19).replace(/[:T]/g, "-")}-${slug(snapshot.name) || slug(snapshot.candidate)}`;
  writeFileSync(path.join(SNAPSHOT_DIR, `${file}.json`), JSON.stringify({ name: snapshot.name, candidate: snapshot.candidate, savedAt, values: snapshot.values }, null, 2));
  writeFileSync(path.join(SNAPSHOT_DIR, `${file}.svg`), snapshot.svg);
  return file;
}

/** Every saved snapshot, newest first. */
function listSnapshots() {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  return readdirSync(SNAPSHOT_DIR)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .reverse()
    .map((file) => ({ file: file.slice(0, -".json".length), ...JSON.parse(readFileSync(path.join(SNAPSHOT_DIR, file), "utf8")) }));
}

// The two logo pull requests the page compares. Their icon files are read from
// the pushed branches, so the comparison shows what each PR would ship, also
// after the PR changes. The branches are fetched at start and then once a
// minute.
const PULL_REQUEST_BRANCHES: Record<string, string> = {
  "532": "feature/stacked-notes-logo",
  "533": "fix/logo-rating-order",
};
const FETCH_INTERVAL_MS = 60_000;
const CONTENT_TYPES: Record<string, string> = { ".png": "image/png", ".svg": "image/svg+xml" };

async function fetchPullRequestBranches() {
  const fetch = Bun.spawn(["git", "fetch", "--quiet", "origin", ...Object.values(PULL_REQUEST_BRANCHES)], { cwd: ROOT });
  if ((await fetch.exited) !== 0) throw new Error("git fetch of the pull request branches failed");
}

/** A file as it is on a pull request's branch: /shipped/532/<path in the repo>. */
async function shippedFile(pathname: string) {
  const [, , number, ...repoPath] = pathname.split("/");
  const branch = PULL_REQUEST_BRANCHES[number];
  const contentType = CONTENT_TYPES[path.extname(pathname)];
  if (!branch || !contentType) return new Response("Not found", { status: 404 });
  const show = Bun.spawn(["git", "show", `origin/${branch}:${repoPath.join("/")}`], { cwd: ROOT, stdout: "pipe", stderr: "ignore" });
  const bytes = await new Response(show.stdout).arrayBuffer();
  if ((await show.exited) !== 0) return new Response("Not found", { status: 404 });
  return new Response(bytes, { headers: { "Content-Type": contentType, "Cache-Control": "no-store" } });
}

await fetchPullRequestBranches();
// A later fetch that fails, for example while the network is down, should not
// end the server. The page keeps showing the branches as last fetched.
setInterval(() => fetchPullRequestBranches().catch((error) => console.error(error.message)), FETCH_INTERVAL_MS);

/** The file a request path names, or null when the path leaves this folder. */
function resolveStaticFile(pathname: string) {
  const filePath = path.join(ROOT, pathname === "/" ? "index.html" : decodeURIComponent(pathname));
  return filePath.startsWith(ROOT + path.sep) ? filePath : null;
}

Bun.serve({
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/snapshots" && request.method === "POST") {
      return Response.json({ file: saveSnapshot((await request.json()) as Snapshot) });
    }
    if (pathname === "/api/snapshots") return Response.json(listSnapshots());
    if (pathname.startsWith("/shipped/")) return shippedFile(pathname);
    const filePath = resolveStaticFile(pathname);
    const file = filePath && Bun.file(filePath);
    if (!file || !(await file.exists())) return new Response("Not found", { status: 404 });
    // The page is being edited while Jim looks at it, so nothing is cached.
    return new Response(file, { headers: { "Cache-Control": "no-store" } });
  },
});

console.log(`Logo explorer on http://localhost:${port}/`);
