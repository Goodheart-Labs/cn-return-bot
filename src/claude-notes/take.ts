/* Takes one post the notewriter protocol handed to the Claude note writer
 * (GOO-507, GOO-724): screens its images (GOO-815) and writes its text where
 * the note-finding agents read it. The intake service already stored the
 * text, and a video's caption timings, before the post was handed out. */

import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { openPassageRequests, type PassageRequest } from "../everything/passageRequests";
import { isWholePageChecked } from "../everything-core/wholePageChecked";
import { tellSlack } from "./alerts";
import { screenImages } from "./imageScreen";
import { draftedPassages, nathanNotedItem, postDir, readItem } from "./store";

/** Nathan's own fact-checks are not redone. */
const NATHAN_SKIP_REASON = "Nathan already fact-checked this post by hand";
const FLAGGED_IMAGE_SKIP_REASON = "An image on this post was flagged by the image screen";

/** The passages readers asked about. `onlyThese` is true when the post was
 *  already checked in full, so Claude checks these passages and nothing else.
 *  `alreadyChecked` holds the passages earlier Claude runs saved a draft on:
 *  a post that is checked again (a recheck, or a new attempt after a failed
 *  one) would otherwise get a second note on the same passage in new words. */
export type AskedPassages = { requests: PassageRequest[]; onlyThese: boolean; alreadyChecked?: string[] };

export type Take = { kind: "taken"; dir: string; asked: AskedPassages } | { kind: "skipped"; reason: string };

/** The post as the note writer reads it: its title, creator, day and address,
 *  then its text. */
export function postMarkdown(item: Awaited<ReturnType<typeof readItem>>): string {
  return `# ${item.title ?? item.url}\n\nBy ${item.project?.name ?? "unknown"}, published ${item.published_at}\n${item.url}\n\n${item.full_text ?? ""}`;
}


/** A skipped post gets no Claude, and the caller finishes it with the reason.
 *  A post whose images cannot be screened throws, so it gets no Claude either. */
export async function take(itemId: string): Promise<Take> {
  // A reader's question about a passage is answered even on a post Nathan
  // fact-checked, because the reader asked for it.
  const requests = await openPassageRequests(itemId);
  if (!requests.length && (await nathanNotedItem(itemId))) return { kind: "skipped", reason: NATHAN_SKIP_REASON };
  const item = await readItem(itemId);
  const screen = await screenImages(item.full_text ?? "");
  if (screen.kind === "flagged") {
    await tellSlack(`The image screen stopped the post ${item.id}: one of its images scored ${screen.sexualScore.toFixed(2)} for sexual content. No Claude saw it.`);
    return { kind: "skipped", reason: FLAGGED_IMAGE_SKIP_REASON };
  }
  const dir = postDir(item.url);
  mkdirSync(dir, { recursive: true });
  if (item.caption_cues) writeFileSync(path.join(dir, "cues.json"), JSON.stringify(item.caption_cues));
  const creator = item.project?.name ?? "unknown";
  writeFileSync(path.join(dir, "post.md"), postMarkdown(item));
  writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ itemId: item.id, url: item.url, title: item.title, creator, publishedAt: item.published_at }, null, 2));
  return { kind: "taken", dir, asked: { requests, onlyThese: requests.length > 0 && isWholePageChecked(item), alreadyChecked: await draftedPassages(itemId) } };
}
