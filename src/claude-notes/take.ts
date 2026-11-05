/* Takes one post the notewriter protocol handed to the Claude note writer
 * (GOO-507, GOO-724): writes its text where the note-finding agents read it.
 * The intake service already stored the text, and a video's caption
 * timings, before the post was handed out. */

import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { openPassageRequests, type PassageRequest } from "../everything/passageRequests";
import { isWholePageChecked } from "../everything-core/wholePageChecked";
import { nathanNotedItem, postDir, readItem } from "./store";

/** Nathan's own fact-checks are not redone. */
const NATHAN_SKIP_REASON = "Nathan already fact-checked this post by hand";

/** The passages readers asked about. `onlyThese` is true when the post was
 *  already checked in full, so Claude checks these passages and nothing else. */
export type AskedPassages = { requests: PassageRequest[]; onlyThese: boolean };

export type Take = { kind: "taken"; dir: string; asked: AskedPassages } | { kind: "skipped"; reason: string };

/** A skipped post gets no Claude, and the caller finishes it with the reason. */
export async function take(itemId: string): Promise<Take> {
  // A reader's question about a passage is answered even on a post Nathan
  // fact-checked, because the reader asked for it.
  const requests = await openPassageRequests(itemId);
  if (!requests.length && (await nathanNotedItem(itemId))) return { kind: "skipped", reason: NATHAN_SKIP_REASON };
  const item = await readItem(itemId);
  const dir = postDir(item.url);
  mkdirSync(dir, { recursive: true });
  if (item.caption_cues) writeFileSync(path.join(dir, "cues.json"), JSON.stringify(item.caption_cues));
  const creator = item.project?.name ?? "unknown";
  writeFileSync(path.join(dir, "post.md"), `# ${item.title ?? item.url}\n\nBy ${creator}, published ${item.published_at}\n${item.url}\n\n${item.full_text ?? ""}`);
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ itemId: item.id, url: item.url, title: item.title, creator, publishedAt: item.published_at }, null, 2));
  return { kind: "taken", dir, asked: { requests, onlyThese: requests.length > 0 && isWholePageChecked(item) } };
}
