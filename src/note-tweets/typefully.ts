import { requiredEnv } from "./config";
import { STATE_DIR } from "./paths";
import type { Staged } from "./types";

export function typefullySender() {
  const socialSet = requiredEnv("TYPEFULLY_SOCIAL_SET_ID");
  if (!/^\d+$/.test(socialSet)) throw new Error("TYPEFULLY_SOCIAL_SET_ID must be numeric");
  const API = `https://api.typefully.com/v2/social-sets/${socialSet}`;
  const auth = { Authorization: `Bearer ${requiredEnv("TYPEFULLY_API_KEY")}`, "Content-Type": "application/json" };
  async function uploadShot(id: string) {
    const r = await fetch(`${API}/media/upload`, { method: "POST", headers: auth, body: JSON.stringify({ file_name: `${id}.png` }) });
    if (!r.ok) throw new Error(`upload init ${r.status}: ${await r.text()}`);
    const { media_id, upload_url } = await r.json();
    // A Bun.file body adds Content-Type, invalidating the presigned upload signature.
    const put = await fetch(upload_url, { method: "PUT", body: await Bun.file(`${STATE_DIR}/shots/${id}.png`).arrayBuffer() });
    if (!put.ok) throw new Error(`s3 put ${put.status}`);
    for (let i = 0; i < 30; i++) {
      const s = await (await fetch(`${API}/media/${media_id}`, { headers: auth })).json();
      if (s.status === "ready") return media_id;
      if (s.status === "failed") throw new Error("media processing failed");
      await Bun.sleep(1000);
    }
    throw new Error("media not ready after 30s");
  }
  async function sendOne(s: Staged) {
    const media_id = await uploadShot(s.id);
    const body = {
      platforms: { x: { enabled: true, posts: [{ text: s.text, media_ids: [media_id] }, ...(s.reply?.trim() ? [{ text: s.reply.trim() }] : [])], settings: {} } },
      draft_title: `CN: ${s.author}`,
      publish_at: s.timing === "now" ? "now" : "next-free-slot",
    };
    const r = await fetch(`${API}/drafts`, { method: "POST", headers: auth, body: JSON.stringify(body) });
    const out = await r.json();
    if (!r.ok) throw new Error(`draft ${r.status}: ${JSON.stringify(out)}`);
    return { draft_id: String(out.id), scheduled: out.scheduled_date ?? out.publish_at ?? null };
  }

  return sendOne;
}
