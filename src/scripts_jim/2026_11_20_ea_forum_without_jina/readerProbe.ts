/**
 * Runs the page reader's own code against the EA Forum: the newest posts, an
 * author's listing, a post, and a page that is not a post, which goes down
 * the fetch ladder. Jina is never asked, because JINA_API_KEY is taken away.
 *
 *   bun run src/scripts_jim/2026_11_20_ea_forum_without_jina/readerProbe.ts
 *
 * To leave through the services box's address, start
 *   ssh -N -D 127.0.0.1:1081 root@<services box>
 *   uv run --python 3.12 --with pproxy pproxy -l http://127.0.0.1:1082 -r socks5://127.0.0.1:1081
 * and run this with HTTPS_PROXY=http://127.0.0.1:1082 and https_proxy set to
 * the same. Bun's fetch reads the first and Chromium the second.
 */
import { fetchPageWithLadder } from "../../pipeline/fetch/fetchLadder";
import { readPage } from "../../pipeline/fetch/readPage";
import { readForumAuthor, readForumNewest } from "../../pipeline/fetch/sites/forum";
import { closeBrowser } from "../../pipeline/utils/browserManager";

delete process.env.JINA_API_KEY;

const EA_FORUM = "https://forum.effectivealtruism.org";
const POST = `${EA_FORUM}/posts/JadwtSNrdsSaF6Ciq/intrasolar-and-extrasolar-space-governance`;
const TOPIC_PAGE = `${EA_FORUM}/topics/ai-safety`;

async function timed(label: string, read: () => Promise<string>): Promise<void> {
  const startedAt = Date.now();
  const outcome = await read().catch((err: Error) => `FAILED: ${err.message.slice(0, 200)}`);
  console.log(`${label.padEnd(34)} ${String(Date.now() - startedAt).padStart(6)} ms  ${outcome}`);
}

const newest = async () => {
  const posts = await readForumNewest(EA_FORUM, 50);
  return `${posts.length} posts, newest: ${posts[0]?.title}`;
};

console.log(`leaving from ${await (await fetch("https://api.ipify.org")).text()}`);
await timed("newest posts, first request", newest);
await timed("newest posts, second request", newest);
await timed("newest posts, third request", newest);
await timed("an author's listing", async () => {
  const listing = await readForumAuthor({ origin: EA_FORUM, slug: "toby-tremlett" }, 3);
  return `${listing.authorName}: ${listing.posts.length} posts`;
});
await timed("a post, through readPage", async () => {
  const read = await readPage(POST);
  return read.type === "page" ? `${read.page.text.length} characters by ${read.page.authorName}, read by "${read.page.source.kind}"` : JSON.stringify(read);
});
await timed("a topic page, through the ladder", async () => {
  const ladder = await fetchPageWithLadder(TOPIC_PAGE);
  return ladder.ok ? `${ladder.markdown.length} characters via ${ladder.via ?? "a plain request"}: ${ladder.markdown.slice(0, 70).replace(/\n/g, " ")}` : ladder.diagnostic;
});
await closeBrowser();
