import { serve } from "bun";
import { readFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";

dotenv.config({ path: join(process.cwd(), ".env") });

const useLocal = process.argv.includes("--local");
const supabaseUrl = useLocal ? process.env.LOCAL_SUPABASE_URL : process.env.SUPABASE_URL;
const supabaseKey = useLocal ? process.env.LOCAL_SUPABASE_SERVICE_KEY : process.env.SUPABASE_SERVICE_KEY;

const PORT = 8001;

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
    const html = injectCredentials(readFileSync(join(import.meta.dir, "dist/index.html"), "utf-8"));
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});

console.log(`Review dashboard running at http://localhost:${PORT} (${useLocal ? "local" : "prod"} Supabase)`);
