import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { Readable } from "node:stream";
import { VIDEO_PROXY_PATH, fetchProxiedVideo } from "../dashboard-shared/videoProxy";

// Dev-server-only: same-origin proxy for tweet videos (see videoProxy.ts).
// The deployed Pages site has no server; there the shared TweetVideo component
// falls back to a poster thumbnail linking out to the post.
function videoProxyPlugin(): Plugin {
  return {
    name: "video-proxy",
    configureServer(server) {
      server.middlewares.use(VIDEO_PROXY_PATH, async (req, res) => {
        const query = new URL(req.url ?? "", "http://localhost").searchParams;
        const upstream = await fetchProxiedVideo(query.get("url"), req.headers.range ?? null);
        const headers: Record<string, string> = {};
        upstream.headers.forEach((value, name) => { headers[name] = value; });
        res.writeHead(upstream.status, headers);
        if (upstream.body) {
          Readable.fromWeb(upstream.body as unknown as import("node:stream/web").ReadableStream).pipe(res);
        } else {
          res.end();
        }
      });
    },
  };
}

// BASE_PATH is set by the GitHub Pages workflow to "/cn-return-bot/" so all
// asset URLs are correctly prefixed for the project-pages domain. Local dev
// and the bun-served dist preview both use "/".
export default defineConfig({
  plugins: [react(), videoProxyPlugin()],
  base: process.env.BASE_PATH ?? "/",
});
