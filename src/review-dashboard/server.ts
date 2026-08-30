import { serve } from "bun";
import { readFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";

dotenv.config({ path: join(process.cwd(), ".env") });

const useLocal = process.argv.includes("--local");
const supabaseUrl = useLocal ? process.env.LOCAL_SUPABASE_URL : process.env.SUPABASE_URL;
const supabaseKey = useLocal ? process.env.LOCAL_SUPABASE_SERVICE_KEY : process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !supabaseKey) {
  const which = useLocal ? "LOCAL_SUPABASE_URL / LOCAL_SUPABASE_SERVICE_KEY" : "SUPABASE_URL / SUPABASE_SERVICE_KEY";
  throw new Error(`Missing ${which} — run from a directory whose .env defines them (cwd: ${process.cwd()})`);
}

const PORT = 8001;

// WARNING: This injects the Supabase service role key into the page. That key has
// full access to the database. So this server must only ever run on localhost.
// Never expose it to the network and never deploy it.
function injectCredentials(html: string): string {
  const script = `
    <script>
      window.__SUPABASE_CONFIG__ = {
        url: "${supabaseUrl}",
        key: "${supabaseKey}"
      };
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

    const html = injectCredentials(readFileSync(join(import.meta.dir, "dist/index.html"), "utf-8"));
    // The HTML must never be cached. It points at JavaScript and CSS files whose
    // names contain a hash of their contents. A plain refresh therefore has to
    // re-read index.html to learn the file names a new build produced.
    return new Response(html, {
      headers: { "Content-Type": "text/html", "Cache-Control": "no-store, must-revalidate" },
    });
  },
});

console.log(`Review dashboard running at http://localhost:${PORT} (${useLocal ? "local" : "prod"} Supabase)`);
