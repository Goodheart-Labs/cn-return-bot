import { describe, expect, test } from "bun:test";
import type { ClaimRef } from "@cn/core/types";
import { claimContent } from "./ClaimContent";

const ARTICLE_URL = "https://example.substack.com/p/rents";
const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

function claim(fields: Partial<ClaimRef>): ClaimRef {
  return {
    id: "claim-1",
    item_id: "item-1",
    claim: "Rents in the city fell by 20% in 2025.",
    context_quote: null,
    context_paragraph: null,
    image_urls: [],
    updated_quote: null,
    context_url: ARTICLE_URL,
    start_seconds: null,
    end_seconds: null,
    ...fields,
  };
}

describe("claimContent", () => {
  test("quotes the source's own words", () => {
    expect(claimContent(claim({ context_quote: "Rents fell by a fifth." }), undefined))
      .toMatchObject({ kind: "article", quote: "Rents fell by a fifth.", restated: false });
  });

  test("falls back to the restated claim when there is no excerpt", () => {
    expect(claimContent(claim({}), undefined))
      .toMatchObject({ kind: "article", quote: "Rents in the city fell by 20% in 2025.", restated: true });
  });

  test("gives a claim that rests on an image no citation", () => {
    const content = claimContent(claim({ image_urls: ["https://example.com/chart.png"] }), undefined);
    expect(content.kind).toBe("article");
    expect(content.quote).toBeUndefined();
  });

  test("turns a claim in a video into a clip with its quote", () => {
    expect(claimContent(claim({ context_url: VIDEO_URL, context_quote: "Rents fell.", start_seconds: 12 }), undefined))
      .toMatchObject({ kind: "youtube", url: VIDEO_URL, quote: "Rents fell.", startSeconds: 12 });
  });
});
