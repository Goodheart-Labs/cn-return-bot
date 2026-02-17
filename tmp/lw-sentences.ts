const FULL_COOKIE = `clientId=G6acrKLJXQbfdMvAM; loginToken=74e599487ad689a20bc28a5080cb4da2c753c2e5deb9c27eb13ab17ff58f652e; _vcrcs=1.1770911314.3600.ZWY5ZjI1ZGZmNTFiZDhkNmI0MTRhYjU0NDkwYjUwMDY=.01f3bf630745e5c6eb49595267f684f4; timezone=Europe/London`;

async function query(gql: string, variables?: Record<string, any>) {
  const res = await fetch("https://www.lesswrong.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": FULL_COOKIE,
      "User-Agent": "Mozilla/5.0",
      "Origin": "https://www.lesswrong.com",
    },
    body: JSON.stringify({ query: gql, variables }),
  });
  return res.json();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function splitSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by space or end
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw
    .map(s => s.trim())
    .filter(s => s.length > 20) // skip very short fragments
    .filter(s => !s.startsWith('[')) // skip references
    .filter(s => !/^\d+\s*$/.test(s)); // skip lone numbers
}

async function main() {
  // Fetch frontpage posts with content
  const result = await query(`{
    posts(input: {
      terms: {
        view: "frontpage",
        limit: 12
      }
    }) {
      results {
        _id
        title
        contents { html }
      }
    }
  }`);

  const posts = result.data.posts.results;
  console.log(`Fetched ${posts.length} posts\n`);

  const allSentences: { sentence: string; postTitle: string }[] = [];

  for (const post of posts) {
    if (!post.contents?.html) continue;
    const text = stripHtml(post.contents.html);
    const sentences = splitSentences(text);
    for (const s of sentences) {
      allSentences.push({ sentence: s, postTitle: post.title });
    }
  }

  console.log(`Total sentences extracted: ${allSentences.length}\n`);
  console.log("=== All sentences (first 80) ===\n");
  for (let i = 0; i < Math.min(80, allSentences.length); i++) {
    const { sentence, postTitle } = allSentences[i]!;
    console.log(`[${postTitle}]`);
    console.log(`  ${sentence}\n`);
  }
}

main().catch(console.error);
