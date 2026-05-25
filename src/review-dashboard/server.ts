import { serve } from "bun";
import { readFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";
import { injectSupabaseConfig, resolveSupabaseCredentials } from "./supabaseInjection";

dotenv.config({ path: join(process.cwd(), ".env") });

const useLocal = process.argv.includes("--local");
const creds = resolveSupabaseCredentials(process.env, useLocal);

const PORT = 8001;

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

    // Serve index.html with injected credentials (main route + SPA fallback)
    const html = injectSupabaseConfig(
      readFileSync(join(import.meta.dir, "dist/index.html"), "utf-8"),
      creds,
    );
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});

console.log(`Review dashboard running at http://localhost:${PORT} (${useLocal ? "local" : "prod"} Supabase)`);
