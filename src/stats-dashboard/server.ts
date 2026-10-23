import "dotenv/config";
import { resolve, sep } from "node:path";
import { createHealthClient, loadPipelineHealth } from "./health-data";
import type { PipelineHealth } from "./src/lib/health";

const root = resolve(import.meta.dir, "dist");
if (!await Bun.file(resolve(root, "index.html")).exists()) throw new Error("Build the stats dashboard before serving it.");
const client = createHealthClient();
const port = Number(process.env.STATS_PORT ?? 8002);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("STATS_PORT must be a valid port.");
let cached: PipelineHealth | null = null;
let cachedAt = 0;
let pending: Promise<PipelineHealth> | null = null;

async function health(): Promise<PipelineHealth> {
  if (cached && Date.now() - cachedAt < 60_000) return cached;
  if (!pending) {
    pending = loadPipelineHealth(client).then((data) => {
      cachedAt = Date.now();
      return (cached = { ...data, mode: "live" });
    })
      .finally(() => { pending = null; });
  }
  return pending;
}

const server = Bun.serve({
  hostname: "127.0.0.1", port,
  idleTimeout: 60,
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const url = new URL(request.url);
    if (url.pathname === "/pipeline-health.json") {
      try {
        return Response.json(await health(), { headers: { "Cache-Control": "no-store" } });
      } catch {
        return Response.json({ error: "Pipeline health is temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "no-store" } });
      }
    }
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return new Response("Bad request", { status: 400 }); }
    const path = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!path.startsWith(`${root}${sep}`)) return new Response("Not found", { status: 404 });
    const file = Bun.file(path);
    if (!await file.exists()) return new Response("Not found", { status: 404 });
    return new Response(request.method === "HEAD" ? null : file, {
      headers: { "Content-Type": file.type, "Cache-Control": "no-cache" },
    });
  },
});
console.log(`Stats dashboard: http://${server.hostname}:${server.port}/`);
console.log(`Developer health: http://${server.hostname}:${server.port}/?view=developer`);
