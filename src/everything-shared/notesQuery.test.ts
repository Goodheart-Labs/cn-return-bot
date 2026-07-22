import { describe, expect, test } from "bun:test";
import { parseHTML } from "linkedom";
import { extractEmbeddedCanonical, isSubstackReaderUrl, normalizePageUrl } from "./notesQuery";

function docWithCanonical(href: string): Document {
  const { document } = parseHTML(`<html><head><link rel="canonical" href="${href}"></head><body></body></html>`);
  return document as unknown as Document;
}

describe("normalizePageUrl", () => {
  test("follows canonical when paths match (custom-domain newsletter)", () => {
    const url = normalizePageUrl("https://www.example.com/p/foo?utm_source=x", docWithCanonical("https://example.substack.com/p/foo"));
    expect(url).toBe("https://example.substack.com/p/foo");
  });

  test("ignores a stale canonical left behind by SPA navigation", () => {
    const url = normalizePageUrl("https://thezvi.substack.com/", docWithCanonical("https://thezvi.substack.com/p/monthly-roundup-44"));
    expect(url).toBe("https://thezvi.substack.com/");
  });

  test("trailing-slash difference still counts as the same path", () => {
    const url = normalizePageUrl("https://example.com/p/foo/", docWithCanonical("https://example.substack.com/p/foo"));
    expect(url).toBe("https://example.substack.com/p/foo");
  });

  test("strips hash and tracking params without a canonical", () => {
    expect(normalizePageUrl("https://a.com/p/x?utm_campaign=c&id=5#frag")).toBe("https://a.com/p/x?id=5");
  });
});

describe("substack reader URLs", () => {
  test("detects reader post URLs, rejects publication and profile URLs", () => {
    expect(isSubstackReaderUrl("https://substack.com/@thezvi/p-207449107")).toBe(true);
    expect(isSubstackReaderUrl("https://www.substack.com/@thezvi/p-207449107?utm_source=x")).toBe(true);
    expect(isSubstackReaderUrl("https://thezvi.substack.com/p/on-kimi-k3")).toBe(false);
    expect(isSubstackReaderUrl("https://substack.com/@thezvi")).toBe(false);
    expect(isSubstackReaderUrl("not a url")).toBe(false);
  });

  test("extracts the embedded canonical_url, raw and JSON-escaped", () => {
    const target = "https://thezvi.substack.com/p/on-kimi-k3-its-capabilities-and-related";
    expect(extractEmbeddedCanonical(`{"canonical_url":"${target}","x":1}`)).toBe(target);
    expect(extractEmbeddedCanonical(`JSON.parse("{\\"canonical_url\\":\\"${target}\\"}")`)).toBe(target);
    expect(extractEmbeddedCanonical("<html>no field</html>")).toBe(null);
  });
});
