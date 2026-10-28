/* Typefully, the paid service Nathan schedules his X posts with, through its
 * v2 API. A draft holds the tweet with its picture and the reply below it.
 * Typefully publishes it in the next free slot of the account's posting
 * queue, or at once. The tool reads each draft back later to learn whether
 * it went out. Ported from Nathan's PR #528. */

import type { TypefullyDraftState } from "../everything-core/xMarks";

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

/** A draft as Typefully's API returns it, with the fields the tool reads. */
interface TypefullyDraft {
  status: "draft" | "planned" | "scheduled" | "publishing" | "published" | "error";
  scheduled_date: string | null;
  published_at: string | null;
  x_published_url: string | null;
}

const HTTP_NOT_FOUND = 404;

/** Reads a draft back. A draft that was deleted in Typefully answers 404. A
 *  draft that was taken off the schedule, or is still a plain draft, counts as
 *  scheduled without a time, because it can still go out. */
async function draftState(account: Settings, draftId: string): Promise<TypefullyDraftState> {
  const response = await fetch(`${account.api}/drafts/${encodeURIComponent(draftId)}`, { headers: account.headers });
  if (response.status === HTTP_NOT_FOUND) return { state: "deleted" };
  const draft = await json<TypefullyDraft>(response, "draft");
  if (draft.status === "published") return { state: "published", publishedAt: draft.published_at, tweetUrl: draft.x_published_url };
  if (draft.status === "error") return { state: "failed" };
  return { state: "scheduled", scheduledFor: draft.scheduled_date };
}

/** What Typefully says about each of these drafts, by draft id. */
export async function draftStates(draftIds: string[]): Promise<Record<string, TypefullyDraftState>> {
  const account = settings();
  const states: Record<string, TypefullyDraftState> = {};
  for (const draftId of draftIds) states[draftId] = await draftState(account, draftId);
  return states;
}
