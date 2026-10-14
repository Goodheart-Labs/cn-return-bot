import { INPUT_DIR, STATE_DIR, ensureState } from "./paths";
import { loadStaging, saveStaging } from "./staging";
import { stagingPage } from "./stagingPage";
import { shootPending } from "./screenshots";
import { typefullySender } from "./typefully";
import { DEFAULT_REPLY, tweetText } from "./tweetText";
import type { FeedData } from "./types";

await ensureState();
const sendOne = typefullySender();

Bun.serve({
  hostname: "127.0.0.1",
  port: 8003,
  idleTimeout: 255,
  async fetch(req) {
    const u = new URL(req.url), path = u.pathname;
    if (path === "/") return new Response(Bun.file(`${STATE_DIR}/ranked.html`), { headers: { "content-type": "text/html" } });
    if (path === "/feed.css") return new Response(Bun.file(`${STATE_DIR}/feed.css`));
    if (/^\/shots\/[0-9a-f-]{36}\.png$/.test(path)) return new Response(Bun.file(`${STATE_DIR}${path}`));
    if (path === "/staging") return new Response(stagingPage(Object.values(await loadStaging())), { headers: { "content-type": "text/html" } });

    if (path === "/api/stage" && req.method === "POST") {
      const { ids } = await req.json() as { ids: string[] };
      const feed: FeedData = await Bun.file(`${STATE_DIR}/feed-data.json`).json();
      const handles: Record<string, string> = await Bun.file(`${INPUT_DIR}/handles.json`).json();
      const staging = await loadStaging();
      for (const id of ids) {
        const d = feed[id];
        if (!d || staging[id]) continue;
        const j = d.jim;
        staging[id] = {
          id, author: d.slug === "web" ? d.host : d.project ?? "", text: tweetText(d, handles), reply: DEFAULT_REPLY, published: d.published_at, timing: "slot", shot: "pending", status: "staged",
          jim: j ? [j.bucket ? `Jim: ${j.bucket}` : "", j.pick ? `picked: ${j.pick}` : ""].filter(Boolean).join(" · ") : "",
        };
      }
      await saveStaging(staging);
      void shootPending();
      return Response.json({ staged: Object.keys(staging).length });
    }
    const m = path.match(/^\/api\/staging\/([0-9a-f-]{36})$/);
    if (m && req.method === "PATCH") {
      const staging = await loadStaging();
      const item = staging[m[1]!];
      if (item && item.status !== "sent") {
        const b = await req.json();
        if (typeof b.text === "string") item.text = b.text;
        if (typeof b.reply === "string") item.reply = b.reply;
        if (b.timing === "slot" || b.timing === "now") item.timing = b.timing;
        await saveStaging(staging);
      }
      return new Response("ok");
    }
    if (m && req.method === "DELETE") {
      const staging = await loadStaging();
      if (staging[m[1]!]?.status !== "sent") delete staging[m[1]!];
      await saveStaging(staging);
      return new Response("ok");
    }
    if (path === "/api/send" && req.method === "POST") {
      const staging = await loadStaging();
      let sent = 0, failed = 0;
      for (const s of Object.values(staging)) {
        if (s.status === "sent" || s.shot !== "ready" || s.text.includes("@???")) continue;
        try { Object.assign(s, await sendOne(s), { status: "sent", error: undefined }); sent++; }
        catch (e) { Object.assign(s, { status: "error", error: String(e).slice(0, 200) }); failed++; }
        await saveStaging(staging);
      }
      return new Response(`${sent} sent to Typefully${failed ? `, ${failed} failed` : ""}`);
    }
    return new Response("not found", { status: 404 });
  },
});
void shootPending();
console.log("http://localhost:8003  (feed)  ·  /staging");
