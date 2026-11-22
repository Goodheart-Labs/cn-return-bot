import { afterEach, describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { forumAuthorFromPageLink, forumAuthorTarget, forumOrigin, readSubstackPublicationFromPage } from "./creatorTarget";

const globals = globalThis as unknown as Record<string, unknown>;

function loadPage(href: string, head: string) {
  globals.document = parseHTML(`<html><head>${head}</head><body></body></html>`).document;
  globals.location = new URL(href);
}

afterEach(() => {
  delete globals.document;
  delete globals.location;
});

// A trimmed copy of the scripts on www.astralcodexten.com/p/open-thread-460 as
// fetched on 2026-11-18. The page data sits in a JSON tag. The inline scripts
// that still name window._preloads carry no subdomain, and a later part of the
// data names other publications the page recommends.
const ASTRAL_CODEX_TEN_SCRIPTS = `
  <script type="application/json" id="preloads-json" nonce="n">{"isEU":true,"pub":{"id":89120,"name":"Astral Codex Ten","subdomain":"astralcodexten","custom_domain":"www.astralcodexten.com"},"recommendations":[{"subdomain":"aifutures1"}]}</script>
  <script nonce="n">window._preloads        = JSON.parse(document.querySelector('script#preloads-json[type="application/json"]').textContent)</script>
  <script nonce="n">window.Sentry && window._preloads && window.Sentry.onLoad(function() {})</script>`;

describe("a Substack newsletter on its own domain", () => {
  test("is read as its *.substack.com publication", () => {
    loadPage("https://www.astralcodexten.com/p/open-thread-460", ASTRAL_CODEX_TEN_SCRIPTS);
    expect(readSubstackPublicationFromPage()).toEqual({ subdomain: "astralcodexten", name: "Astral Codex Ten" });
  });

  test("a page without Substack's data, or with another site's tag of that id, is no publication", () => {
    loadPage("https://example.com/post", "<script>window.subdomain = 'x'</script>");
    expect(readSubstackPublicationFromPage()).toBeNull();
    loadPage("https://example.com/post", '<script type="application/json" id="preloads-json">not json</script>');
    expect(readSubstackPublicationFromPage()).toBeNull();
  });

  test("substack.com itself names no creator, because its data describes the reader", () => {
    loadPage("https://substack.com/home", ASTRAL_CODEX_TEN_SCRIPTS);
    expect(readSubstackPublicationFromPage()).toBeNull();
  });
});

describe("the EA Forum", () => {
  test("is a forum, at its own origin without www", () => {
    expect(forumOrigin("https://forum.effectivealtruism.org/posts/abc/title")).toBe("https://forum.effectivealtruism.org");
    expect(forumOrigin("https://effectivealtruism.org/posts/abc")).toBeNull();
  });

  test("an author page is a creator in the form migration 179 accepts", () => {
    expect(forumAuthorTarget("https://forum.effectivealtruism.org/users/Toby-Tremlett", "Toby Tremlett")).toEqual({
      feedType: "lesswrong",
      feedUrl: "https://forum.effectivealtruism.org/users/toby-tremlett",
      kind: "author",
      title: "Toby Tremlett",
    });
  });

  test("the author link read out of a post page becomes the same creator", () => {
    expect(forumAuthorFromPageLink({ href: "https://forum.effectivealtruism.org/users/toby-tremlett", name: "Toby Tremlett" })?.feedUrl).toBe(
      "https://forum.effectivealtruism.org/users/toby-tremlett",
    );
    expect(forumAuthorFromPageLink(null)).toBeNull();
  });
});
