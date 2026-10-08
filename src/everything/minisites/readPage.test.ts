import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { plainText } from "../../everything-core/readerText";
import { pageFromArticleHtml, pageFromSubstackPost, readPageForMinisite } from "./readPage";
import bigTentPost from "./fixtures/big-tent-substack-post.json";

const BIG_TENT_URL = "https://www.normaltech.ai/p/a-big-tent-or-small-tent-ai-safety";

describe("a Substack post read from its post endpoint", () => {
  const page = pageFromSubstackPost(bigTentPost, BIG_TENT_URL);

  test("fills every field from the post", () => {
    expect(page).toMatchObject({
      title: "A big-tent or small-tent AI safety movement?",
      description: "The unstated disagreement that underpins safety debates",
      byline: "Arvind Narayanan and Sayash Kapoor · AI as Normal Technology",
      published_at: "2026-10-01T16:34:51.229Z",
      image_url: bigTentPost.cover_image,
      creator_feed_url: "https://aisnakeoil.substack.com",
    });
  });

  test("gives the pipeline the plain text of the reader text", () => {
    expect(page.plain_text).toBe(plainText(page.content));
    expect(page.content).toStartWith("In recent weeks, two narratives about AI safety have emerged");
  });
});

describe("a page read with Readability", () => {
  const html = readFileSync(join(import.meta.dir, "fixtures", "big-tent-page.html"), "utf8");
  const page = pageFromArticleHtml(html, BIG_TENT_URL);

  test("reads the same article text as the post endpoint, headings included", () => {
    expect(page.content).toBe(pageFromSubstackPost(bigTentPost, BIG_TENT_URL).content);
  });

  test("fills the header from the page's own metadata", () => {
    expect(page).toMatchObject({
      title: "A big-tent or small-tent AI safety movement?",
      description: "The unstated disagreement that underpins safety debates",
      byline: "Arvind Narayanan, Sayash Kapoor · AI as Normal Technology",
      published_at: "2026-10-01T16:34:51.000Z",
    });
    expect(page.image_url).toStartWith("https://substackcdn.com/image/fetch/");
  });

  test("keeps a heading inside a small wrapper with an edit link, as on Wikipedia", () => {
    const paragraphs = (from: number) => [0, 1, 2, 3].map((n) => `<p>Paragraph ${from + n} of the article, long enough for Readability to keep it, with a comma or two.</p>`).join("");
    const wiki = pageFromArticleHtml(
      `<html><body><main>${paragraphs(1)}<div class="mw-heading mw-heading2"><h2 id="History">History</h2><span class="mw-editsection"><a href="/w/edit">edit</a></span></div>${paragraphs(5)}</main></body></html>`,
      "https://en.wikipedia.org/wiki/Example",
    );
    expect(wiki.content).toContain("with a comma or two.\n\n## History\n\nParagraph 5");
  });

  test("leaves out a first paragraph that only repeats the title", () => {
    const repeated = pageFromArticleHtml(
      `<html><head><meta property="og:title" content="A long enough title for the test"></head><body><article><p>A long enough title for the test</p>${"<p>The article's own words, long enough for Readability to keep them.</p>".repeat(8)}</article></body></html>`,
      "https://example.com/post",
    );
    expect(repeated.content).toStartWith("The article's own words");
  });
});

test("an address that is not a web page fails with a sentence the website can show", async () => {
  await expect(readPageForMinisite("file:///etc/hostname")).rejects.toThrow("This is not the address of a web page.");
});
