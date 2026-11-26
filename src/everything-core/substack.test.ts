import { expect, test } from "bun:test";
import { publicationInPageHtml, publicationInPreloads, substackReaderPostId, substackSubdomainOfUrl } from "./substack";

test("every Substack reader URL shape yields its post id", () => {
  for (const href of [
    "https://substack.com/home/post/p-225210833",
    "https://substack.com/@thezvi/p-225210833",
    "https://substack.com/inbox/post/225210833",
    "https://substack.com/inbox/post/225210833/?utm_source=inbox#comments",
    "https://www.substack.com/inbox/post/225210833",
  ]) {
    expect(substackReaderPostId(href)).toBe("225210833");
  }
});

test("other substack.com pages and other hosts have no reader post id", () => {
  for (const href of [
    "https://substack.com/inbox",
    "https://substack.com/inbox/post/abc",
    "https://substack.com/inbox/post/123abc",
    "https://substack.com/home",
    "https://substack.com/@thezvi",
    "https://thezvi.substack.com/p/jensen-huang-really-liked-selling",
    "https://thezvi.substack.com/inbox/post/123",
    "https://example.com/inbox/post/123",
    "not a URL",
  ]) {
    expect(substackReaderPostId(href)).toBeNull();
  }
});

// A trimmed copy of the scripts on jasmi.news/p/no-data-centers-in-my-backyard
// as fetched on 2026-11-26. The publication's data sits in a JSON tag, and a
// later part of it names other publications the page recommends. Its
// subdomain, like slowboring.com's "matthewyglesias", cannot be guessed from
// the domain.
const JASMI_NEWS_POST_HTML = `<html><head>
  <script type="application/json" id="preloads-json" nonce="n">{"isEU":true,"base_url":"https://jasmi.news","pub":{"id":6027,"name":"@jasmine’s substack","subdomain":"jasmine","custom_domain":"jasmi.news"},"recommendations":[{"subdomain":"other"}]}</script>
  <script nonce="n">window._preloads        = JSON.parse(document.querySelector('script#preloads-json[type="application/json"]').textContent)</script>
</head><body></body></html>`;

test("a custom-domain Substack page names its *.substack.com publication", () => {
  expect(publicationInPageHtml(JASMI_NEWS_POST_HTML)).toEqual({ subdomain: "jasmine", name: "@jasmine’s substack" });
});

test("a page without Substack's publication data names none", () => {
  expect(publicationInPageHtml(`<script>var data = {"subdomain":"jasmine"}</script>`)).toBeNull();
  expect(publicationInPreloads("not json")).toBeNull();
  expect(publicationInPreloads(`{"pub":null}`)).toBeNull();
  expect(publicationInPreloads(`{"pub":{"subdomain":"a/b"}}`)).toBeNull();
  expect(publicationInPreloads(null)).toBeNull();
});

test("a publication without a name is called by its subdomain", () => {
  expect(publicationInPreloads(`{"pub":{"subdomain":"Thezvi","name":" "}}`)).toEqual({ subdomain: "thezvi", name: "thezvi" });
});

test("only a publication's own subdomain names it in the address", () => {
  expect(substackSubdomainOfUrl("https://TheZvi.substack.com/p/ai-189")).toBe("thezvi");
  for (const url of ["https://substack.com/@jasmine/p-209624138", "https://www.substack.com/home", "https://jasmi.news/p/claude-code", "not a URL"]) {
    expect(substackSubdomainOfUrl(url)).toBeNull();
  }
});
