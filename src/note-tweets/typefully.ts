/* Typefully, the paid service Nathan schedules his X posts with, through its
 * v2 API. A draft holds the tweet with its picture and the reply below it.
 * Typefully publishes it in the next free slot of the account's posting
 * queue, or at once. The API cannot delete a draft, so a mistake is removed
 * in the Typefully app. Ported from Nathan's PR #528. */

/** How long Typefully may take to process an uploaded picture. */
const MEDIA_READY_TIMEOUT_MS = 30_000;
const MEDIA_POLL_MS = 1_000;

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} in the repository's .env`);
  return value;
}

export interface TweetDraft {
  text: string;
  reply: string;
  image: ArrayBuffer;
  title: string;
  timing: "next_free_slot" | "now";
}

/** The Typefully client for the social set (one X account) in
 *  TYPEFULLY_SOCIAL_SET_ID. It reads its settings at once, so a missing key
 *  stops the server before anything else happens. */
export function typefully() {
  const api = `https://api.typefully.com/v2/social-sets/${requiredEnv("TYPEFULLY_SOCIAL_SET_ID")}`;
  const headers = { Authorization: `Bearer ${requiredEnv("TYPEFULLY_API_KEY")}`, "Content-Type": "application/json" };

  async function json<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) throw new Error(`Typefully ${what} answered ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  async function uploadImage(image: ArrayBuffer, fileName: string): Promise<string> {
    const { media_id, upload_url } = await json<{ media_id: string; upload_url: string }>(
      await fetch(`${api}/media/upload`, { method: "POST", headers, body: JSON.stringify({ file_name: fileName }) }),
      "media upload",
    );
    // The upload address is signed for a body without a content type, so the
    // picture goes as raw bytes.
    const put = await fetch(upload_url, { method: "PUT", body: image });
    if (!put.ok) throw new Error(`The picture's upload answered ${put.status}`);
    for (let waited = 0; waited < MEDIA_READY_TIMEOUT_MS; waited += MEDIA_POLL_MS) {
      const { status } = await json<{ status: string }>(await fetch(`${api}/media/${media_id}`, { headers }), "media status");
      if (status === "ready") return media_id;
      if (status === "failed") throw new Error("Typefully could not process the picture");
      await Bun.sleep(MEDIA_POLL_MS);
    }
    throw new Error("Typefully had not processed the picture after 30 seconds");
  }

  /** Creates the draft and returns its id and when Typefully schedules it. */
  return async function createDraft(draft: TweetDraft): Promise<{ draftId: string; scheduledFor: string | null }> {
    const mediaId = await uploadImage(draft.image, `${draft.title}.png`);
    const posts = [{ text: draft.text, media_ids: [mediaId] }, ...(draft.reply.trim() ? [{ text: draft.reply.trim() }] : [])];
    const created = await json<{ id: string | number; scheduled_date?: string; publish_at?: string }>(
      await fetch(`${api}/drafts`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          platforms: { x: { enabled: true, posts, settings: {} } },
          draft_title: draft.title,
          publish_at: draft.timing === "now" ? "now" : "next-free-slot",
        }),
      }),
      "draft",
    );
    return { draftId: String(created.id), scheduledFor: created.scheduled_date ?? created.publish_at ?? null };
  };
}
