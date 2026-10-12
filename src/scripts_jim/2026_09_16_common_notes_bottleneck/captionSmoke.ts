/** End-to-end check of the YouTube fetch the worker uses: details from the
 *  Data API, captions through yt-dlp, the proxy and the PO token provider.
 *  Only meaningful where the proxy and the provider exist, so it runs in the
 *  probe workflow. */
import "dotenv/config";
import { fetchYoutubeContent } from "../../everything/sources/youtube";

for (const url of process.argv.slice(2)) {
  const startedAt = Date.now();
  try {
    const content = await fetchYoutubeContent(url);
    if (content.kind !== "youtube") throw new Error("unexpected content kind");
    console.log(`OK   ${url} · "${content.title}" by ${content.authorName} (${content.publishedAt}) · ${content.cues.length} cues · ${Math.round((Date.now() - startedAt) / 1000)}s`);
  } catch (err: any) {
    console.log(`FAIL ${url} · ${err?.name}: ${err?.message} · ${Math.round((Date.now() - startedAt) / 1000)}s`);
  }
}
