import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

async function fetchAndExtract(url: string) {
  console.log(`\nFetching: ${url}\n${"=".repeat(60)}`);

  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CommunityNotesBot/1.0)" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });

  console.log(`Status: ${response.status}`);
  console.log(`Content-Type: ${response.headers.get("content-type")}`);

  const html = await response.text();
  console.log(`HTML length: ${html.length} chars`);

  // Readability extraction
  const { document } = parseHTML(html);
  const article = new Readability(document).parse();

  if (article) {
    const titleLine = article.title ? `# ${article.title}\n\n` : "";
    const markdown = titleLine + turndown.turndown(article.content);
    const capped = markdown.slice(0, 20000);

    console.log(`\nReadability title: ${article.title}`);
    console.log(`Readability excerpt: ${article.excerpt?.slice(0, 200)}`);
    console.log(`Markdown length: ${markdown.length} chars (capped: ${capped.length})`);
    console.log(`\n--- MARKDOWN OUTPUT ---\n`);
    console.log(capped);
  } else {
    console.log("\nReadability returned null — falling back to regex strip");
    const plain = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 20000);
    console.log(`\n--- FALLBACK OUTPUT ---\n`);
    console.log(plain);
  }
}

const urls = [
  "https://edition.cnn.com/2026/03/30/climate/data-centers-are-having-an-underrported",
  "https://en.wikipedia.org/wiki/Community_Notes",
  "https://httpbin.org/json",
];

for (const url of urls) {
  await fetchAndExtract(url).catch((err) => console.error(`Error: ${err.message}`));
}
