/* Step 6: downloads the pictures attached to Nathan's posts that do not link
 * to one note, to see whether the picture shows a specific note. Writes
 * media/<post id>_<n>.jpg. A post costs $0.005.
 *   bun run src/scripts_jim/2026_11_05_nathan_posted_notes/06_post_media.ts <post id> ... */
import { mkdir, writeFile } from "node:fs/promises";
import { xGet } from "../2026_10_01_article_traction/x";

const MEDIA_DIR = new URL("./media/", import.meta.url).pathname;
await mkdir(MEDIA_DIR, { recursive: true });
const result = await xGet("/2/tweets", { ids: process.argv.slice(2).join(","), expansions: "attachments.media_keys", "media.fields": "url,type,preview_image_url" }, "app");
const mediaByKey = new Map((result.body.includes?.media ?? []).map((m: any) => [m.media_key, m]));
for (const post of result.body.data ?? []) {
  for (const [index, key] of (post.attachments?.media_keys ?? []).entries()) {
    const media: any = mediaByKey.get(key);
    const url = media?.url ?? media?.preview_image_url;
    if (!url) continue;
    const path = `${MEDIA_DIR}${post.id}_${index}.jpg`;
    await writeFile(path, Buffer.from(await (await fetch(url)).arrayBuffer()));
    console.log(`${post.id} ${media.type} ${path}`);
  }
}
