import { STATE_DIR } from "./paths";
import { DEFAULT_REPLY } from "./tweetText";
import type { FeedData, Staged } from "./types";

const STAGING = `${STATE_DIR}/staging.json`;
export const loadStaging = async (): Promise<Record<string, Staged>> => {
  const s: Record<string, Staged> = (await Bun.file(STAGING).exists()) ? await Bun.file(STAGING).json() : {};
  const feed: FeedData = await Bun.file(`${STATE_DIR}/feed-data.json`).json().catch(() => ({}));
  for (const x of Object.values(s)) { x.reply ??= DEFAULT_REPLY; x.timing ??= "slot"; if (x.published === undefined) x.published = feed[x.id]?.published_at ?? null; }
  return s;
};
export const saveStaging = (s: Record<string, Staged>) => Bun.write(STAGING, JSON.stringify(s, null, 2));
