import type { TypefullyDraftState, TypefullyPost } from "@cn/core/xMarks";

/* The local posting tool's server (src/note-tweets/server.ts). It runs on the
 * admin's own computer, because it holds the Typefully key, and only
 * `bun run note-tweets` sets its address. On commonnotes.net the address is
 * missing and nothing here is called. */

/** The server's address, or undefined outside the local posting tool. */
export const TWEET_SERVER = import.meta.env.VITE_TWEET_SERVER;

/** When Typefully publishes the tweet: in the next free slot of the account's
 *  posting queue, or at once. */
export type TweetTiming = "next_free_slot" | "now";

async function call<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${TWEET_SERVER}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

/** Takes a picture of the note's card and returns its address on the server. */
export const fetchNoteImage = (noteId: string) => call<{ url: string }>("/image", { noteId }).then(({ url }) => `${TWEET_SERVER}${url}`);

/** Creates a Typefully draft of the tweet, with the note's picture and the
 *  reply below it. */
export const sendTweet = (tweet: { noteId: string; text: string; reply: string; timing: TweetTiming }) => call<TypefullyPost>("/send", tweet);

/** What Typefully says about each of these drafts, by draft id. */
export const fetchDraftStates = (draftIds: string[]) => call<Record<string, TypefullyDraftState>>("/drafts", { draftIds });
