/* Typefully, the paid service Nathan schedules his X posts with, through its
 * v2 API. A draft holds the tweet with its picture and the reply below it.
 * Typefully publishes it in the next free slot of the account's posting
 * queue, or at once. The API cannot delete a draft, so a mistake is removed
 * in the Typefully app. Ported from Nathan's PR #528. */

/** How long Typefully may take to process an uploaded picture. */
const MEDIA_READY_TIMEOUT_MS = 30_000;
const MEDIA_POLL_MS = 1_000;

/** The account's settings, read at every send, so the tool runs without them
 *  and only sending says what is missing. */
function settings(): { api: string; headers: Record<string, string> } {
  const key = process.env.TYPEFULLY_API_KEY;
  const socialSet = process.env.TYPEFULLY_SOCIAL_SET_ID;
  if (!key || !socialSet) throw new Error("Typefully is not set up. Put TYPEFULLY_API_KEY and TYPEFULLY_SOCIAL_SET_ID into the repository's .env and start the tool again.");
  return { api: `https://api.typefully.com/v2/social-sets/${socialSet}`, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}

export interface TweetDraft {
  text: string;
  reply: string;
  image: ArrayBuffer;
  title: string;
  timing: "next_free_slot" | "now";
}

type Settings = ReturnType<typeof settings>;

async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) throw new Error(`Typefully ${what} answered ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

async function uploadImage({ api, headers }: Settings, image: ArrayBuffer, fileName: string): Promise<string> {
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

/** Creates a draft for the X account of the social set in
 *  TYPEFULLY_SOCIAL_SET_ID, and returns its id and when Typefully schedules
 *  it. */
export async function createDraft(draft: TweetDraft): Promise<{ draftId: string; scheduledFor: string | null }> {
  const account = settings();
  const mediaId = await uploadImage(account, draft.image, `${draft.title}.png`);
  const posts = [{ text: draft.text, media_ids: [mediaId] }, ...(draft.reply.trim() ? [{ text: draft.reply.trim() }] : [])];
  const created = await json<{ id: string | number; scheduled_date?: string; publish_at?: string }>(
    await fetch(`${account.api}/drafts`, {
      method: "POST",
      headers: account.headers,
      body: JSON.stringify({
        platforms: { x: { enabled: true, posts, settings: {} } },
        draft_title: draft.title,
        publish_at: draft.timing === "now" ? "now" : "next-free-slot",
      }),
    }),
    "draft",
  );
  return { draftId: String(created.id), scheduledFor: created.scheduled_date ?? created.publish_at ?? null };
}
