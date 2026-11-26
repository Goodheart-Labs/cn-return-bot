import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { browser } from "#imports";
import { fakeBrowser } from "@webext-core/fake-browser";
import { parseHTML } from "linkedom";
import { readSubstackPublicationFromPage, substackCreatorTarget } from "./substackCreator";
import { storedCache } from "./storedCache";

const globals = globalThis as unknown as Record<string, unknown>;

function loadPage(href: string, head: string) {
  globals.document = parseHTML(`<html><head>${head}</head><body></body></html>`).document;
  globals.location = new URL(href);
}

beforeEach(() => fakeBrowser.reset());

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

describe("a publication on its own subdomain", () => {
  test("is named by the address", () => {
    expect(substackCreatorTarget("https://thezvi.substack.com/p/ai-189")?.feedUrl).toBe("https://thezvi.substack.com");
    expect(substackCreatorTarget("https://substack.com/@jasmine/p-209624138")).toBeNull();
  });
});

describe("a stored cache", () => {
  const KEY = "test:cache";

  test("computes an answer once, also for callers that ask while it runs", async () => {
    const cache = storedCache<string>(KEY, 10);
    let computed = 0;
    const answer = async () => {
      computed++;
      return "jasmine";
    };
    expect(await Promise.all([cache.remember("jasmi.news", answer), cache.remember("jasmi.news", answer)])).toEqual(["jasmine", "jasmine"]);
    expect(await storedCache<string>(KEY, 10).remember("jasmi.news", answer)).toBe("jasmine");
    expect(computed).toBe(1);
  });

  test("does not keep a missing answer", async () => {
    const cache = storedCache<string>(KEY, 10);
    expect(await cache.remember("example.com", async () => null)).toBeNull();
    expect(await cache.remember("example.com", async () => "found")).toBe("found");
  });

  test("keeps another writer's entries and drops the oldest past its size", async () => {
    await storedCache<string>(KEY, 2).remember("a.com", async () => "a");
    await storedCache<string>(KEY, 2).remember("b.com", async () => "b");
    await storedCache<string>(KEY, 2).remember("c.com", async () => "c");
    expect((await browser.storage.local.get(KEY))[KEY]).toEqual({ "b.com": "b", "c.com": "c" });
  });
});
