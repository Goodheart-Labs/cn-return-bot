/* Takes one post for the Claude note writer (GOO-507): writes its text where
 * the note-finding agents read it and logs the take. The command line and the
 * runner on ai-box both use it. */

import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { fetchAndStoreItemText } from "../everything/worker";
import { isVideo, logEvent, nathanNotedItem, postDir, readItem, skipItem } from "./store";

/** Nathan's own fact-checks are not redone. */
const NATHAN_SKIP_REASON = "Nathan already fact-checked this post by hand";

export type Take = { kind: "taken"; dir: string } | { kind: "skipped"; reason: string };

/** A post without stored text, such as a new video or a requested page, is
 *  read first the way the pipeline reads it. If that read fails, this throws,
 *  and the item should be handed back. */
export async function take(itemId: string): Promise<Take> {
  if (await nathanNotedItem(itemId)) {
    await skipItem(itemId, NATHAN_SKIP_REASON);
    return { kind: "skipped", reason: NATHAN_SKIP_REASON };
  }
  const before = await readItem(itemId);
  // A video is always read, even with stored text, because its caption cues
  // are what give each note its time in the video.
  const read = before.full_text && !isVideo(before.url) ? null : await fetchAndStoreItemText(itemId, { keepText: Boolean(before.full_text) });
  const item = await readItem(itemId);
  const dir = postDir(item.url);
  mkdirSync(dir, { recursive: true });
  if (read?.cues) writeFileSync(path.join(dir, "cues.json"), JSON.stringify(read.cues));
  const creator = item.project?.name ?? "unknown";
  writeFileSync(path.join(dir, "post.md"), `# ${item.title ?? item.url}\n\nBy ${creator}, published ${item.published_at}\n${item.url}\n\n${item.full_text ?? ""}`);
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ itemId: item.id, url: item.url, title: item.title, creator, publishedAt: item.published_at }, null, 2));
  await logEvent({ actor: "claude", type: "item_taken", itemId });
  return { kind: "taken", dir };
}
