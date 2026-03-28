import { serve } from "bun";
import { readFileSync } from "fs";
import { join } from "path";
import dotenv from "dotenv";

dotenv.config({ path: join(process.cwd(), ".env") });

const PORT = 8001;

serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Serve the main HTML with injected credentials
    if (url.pathname === "/" || url.pathname === "/index.html") {
      let html = readFileSync(join(import.meta.dir, "dist/index.html"), "utf-8");

      const credentialsScript = `
        <script>
          window.__SUPABASE_CONFIG__ = {
            url: "${process.env.SUPABASE_URL}",
            key: "${process.env.SUPABASE_SERVICE_KEY}"
          };
        </script>
      `;

      html = html.replace("</head>", credentialsScript + "</head>");

      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    // Serve static files from dist
    const filePath = join(import.meta.dir, "dist", url.pathname);
    try {
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
    } catch {
      // File not found
    }

    // SPA fallback — serve index.html for non-file routes
    let html = readFileSync(join(import.meta.dir, "dist/index.html"), "utf-8");
    const credentialsScript = `
      <script>
        window.__SUPABASE_CONFIG__ = {
          url: "${process.env.SUPABASE_URL}",
          key: "${process.env.SUPABASE_SERVICE_KEY}"
        };
      </script>
    `;
    html = html.replace("</head>", credentialsScript + "</head>");
    return new Response(html, { headers: { "Content-Type": "text/html" } });
  },
});

console.log(`Review dashboard running at http://localhost:${PORT}`);
