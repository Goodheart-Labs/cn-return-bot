/* The preparer (GOO-724). A notewriter gets only a post whose text is
 * stored, and a video only with its caption timings, because reading a post
 * needs the services machine: its proxy for YouTube and its sandboxed fetcher
 * for other pages. So the intake service reads every queued post that lacks
 * them, as soon as it is queued. A post it cannot read is marked failed the
 * way the pipeline marks one, so the walk tries it again after its rest time.
 * A young video without captions yet keeps that exception without a red run.
 * Every other failure is recorded for the next feed run, which goes red. */

import { fetchItemsToPrepare, recordReadFailure, storeCaptionCues } from "../../everything/db";
import { clip } from "../../everything/logFormat";
import { fetchAndStoreItemText, recordItemFailure } from "../../everything/worker";

export async function prepareQueuedItems(): Promise<void> {
  for (const item of await fetchItemsToPrepare()) {
    try {
      const read = await fetchAndStoreItemText(item.id, { keepText: item.full_text !== null });
      if (item.source === "youtube") await storeCaptionCues(item.id, read.cues ?? []);
      console.log(`[intake] prepared [${item.source}] ${clip(item.title ?? item.url, 60)}`);
    } catch (err) {
      const error = err as Error;
      console.error(`[intake] could not read ${item.url}: ${error.message}`);
      if ((await recordItemFailure(item, error)) === "error") await recordReadFailure(item.id, error.message);
    }
  }
}
