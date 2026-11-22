/**
 * Can a copy of Jina Reader that we run ourselves read what the hosted Jina
 * read for us? Jina publishes its reader as a Docker image under the Apache
 * licence. This asks such a copy for the EA Forum and for the pages that only
 * the hosted Jina could read last week (the pages file that
 * jinaRescuedPages.ts wrote), and judges each answer the way the page reader
 * judges Jina's. It writes self_hosted_jina_<label>.json next to that file.
 *
 *   sudo docker run --rm -p 127.0.0.1:18081:8081 ghcr.io/jina-ai/reader:oss
 *   bun run src/scripts_jim/2026_11_20_ea_forum_without_jina/selfHostedJina.ts <label> <pages file> [--through-box]
 *
 * To test the copy as if it ran on the services box, its whole traffic has
 * to leave from the box's address. Jina's own proxy option (the x-proxy-url
 * header, --through-box here) does not do that: it sends only the page and
 * its data requests through the proxy, and the page's scripts still go out
 * directly. Vercel's check then sees two addresses and fails. So start the
 * container with https_proxy, HTTPS_PROXY, http_proxy and HTTP_PROXY set to
 * http://127.0.0.1:1082 (Chrome and curl both honour them) and run the SSH
 * forward and pproxy inside the container's own network. The devbox's
 * firewall drops a container's connections to the devbox itself.
 *   cpid=$(sudo docker inspect -f '{{.State.Pid}}' <container>)
 *   sudo nsenter -t $cpid -n -- sudo -u jim ssh -f -N -D 127.0.0.1:1081 root@<services box>
 *   sudo nsenter -t $cpid -n -- sudo -u jim uv run --python 3.12 --with pproxy pproxy -l http://127.0.0.1:1082 -r socks5://127.0.0.1:1081
 * Check where each engine leaves from first, with https://api.ipify.org.
 *
 * A page gets two tries: Jina's default engine, which prefers a plain request
 * that imitates Chrome, and then its browser engine.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { classifyMarkdown } from "../../pipeline/fetch/fetchLadder";

const READER = "http://127.0.0.1:18081/";
const BOX_PROXY = "socks5://127.0.0.1:1081";
const PAGES_AT_ONCE = 4;
const READ_TIMEOUT_MS = 60_000;

const EA_FORUM = "https://forum.effectivealtruism.org";
const EA_FORUM_READS = [
  { host: "EA Forum, the GraphQL API", url: `${EA_FORUM}/graphql?query=${encodeURIComponent('{ posts(input:{terms:{view:"new",limit:2}}){results{_id title}}}')}` },
  { host: "EA Forum, a post page", url: `${EA_FORUM}/posts/JadwtSNrdsSaF6Ciq/intrasolar-and-extrasolar-space-governance` },
  { host: "EA Forum, a topic page", url: `${EA_FORUM}/topics/ai-safety` },
];

const [label, pagesFile] = process.argv.slice(2);
if (!label || !pagesFile) throw new Error("usage: selfHostedJina.ts <label> <pages file> [--through-box]");
const throughBox = process.argv.includes("--through-box");
const pages: { host: string; url: string }[] = [...EA_FORUM_READS, ...JSON.parse(readFileSync(pagesFile, "utf8"))];

type Engine = "auto" | "browser";
interface Attempt {
  good: boolean;
  chars: number;
  outcome: string;
}

async function ask(url: string, engine: Engine): Promise<Attempt> {
  try {
    const response = await fetch(`${READER}${url}`, {
      headers: { Accept: "application/json", "x-engine": engine, ...(throughBox && { "x-proxy-url": BOX_PROXY }) },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    const body = await response.text();
    if (!response.ok) return { good: false, chars: 0, outcome: `HTTP ${response.status}: ${body.slice(0, 120).replace(/\s+/g, " ")}` };
    const data = JSON.parse(body).data ?? {};
    const markdown = `${data.title ? `# ${data.title}\n\n` : ""}${data.content ?? data.text ?? ""}`;
    if (data.warning?.startsWith("Target URL returned error")) return { good: false, chars: markdown.length, outcome: data.warning.slice(0, 80) };
    // An API answer is short JSON, so it is judged by being JSON with data.
    const isApiAnswer = url.includes("/graphql?") && markdown.includes('"data"');
    const judged = isApiAnswer ? "good" : classifyMarkdown(markdown);
    return { good: judged === "good", chars: markdown.length, outcome: judged === "good" ? "read" : `${judged}${data.warning ? ` (${data.warning.slice(0, 60)})` : ""}` };
  } catch (err) {
    return { good: false, chars: 0, outcome: `error: ${(err as Error).message.slice(0, 80)}` };
  }
}

const results: { host: string; url: string; good: boolean; engine: Engine | null; chars: number; outcome: string; ms: number }[] = [];
const waiting = [...pages];
async function worker(): Promise<void> {
  for (let page = waiting.shift(); page; page = waiting.shift()) {
    const startedAt = Date.now();
    const first = await ask(page.url, "auto");
    const attempt = first.good ? first : await ask(page.url, "browser");
    const result = { ...page, good: attempt.good, engine: attempt.good ? (first.good ? ("auto" as const) : ("browser" as const)) : null, chars: attempt.chars, outcome: attempt.good ? "read" : `${first.outcome} | browser engine: ${attempt.outcome}`, ms: Date.now() - startedAt };
    results.push(result);
    console.log(`${results.length}/${pages.length} ${result.host}: ${result.good ? `read by the ${result.engine} engine, ${result.chars} characters` : result.outcome} (${result.ms} ms)`);
  }
}
await Promise.all(Array.from({ length: PAGES_AT_ONCE }, worker));

writeFileSync(`${dirname(pagesFile)}/self_hosted_jina_${label}.json`, JSON.stringify(results, null, 2));
const sample = results.filter((result) => !result.host.startsWith("EA Forum"));
console.log(`\n${label}: our own copy of Jina Reader read ${sample.filter((result) => result.good).length} of ${sample.length} sampled pages`);
for (const result of results.filter((r) => r.host.startsWith("EA Forum"))) console.log(`  ${result.host}: ${result.good ? "read" : result.outcome}`);
