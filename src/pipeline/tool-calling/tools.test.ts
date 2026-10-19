import { describe, expect, test } from "bun:test";
import { stripBrowserLineCitations, stripCiteTags } from "./tools";

describe("stripBrowserLineCitations", () => {
  test("removes Meta's line-citation markers and keeps the URLs and text", () => {
    const text = "Built 1887–89 https://www.britannica.com/x 【1586541899417117766†L16-L18】 and 330 m 【12†L21】.";
    expect(stripBrowserLineCitations(text)).toBe("Built 1887–89 https://www.britannica.com/x and 330 m.");
  });

  test("leaves text without markers unchanged", () => {
    expect(stripBrowserLineCitations("Plain findings [1] (a) https://a.b")).toBe("Plain findings [1] (a) https://a.b");
  });
});

describe("stripCiteTags", () => {
  test("removes Claude's cite tags and keeps the quoted words", () => {
    const text = 'Section 5.2 says <cite index="8-7:8-11">"We trained the base models for 12 hours"</cite> (https://arxiv.org/pdf/1706.03762).';
    expect(stripCiteTags(text)).toBe('Section 5.2 says "We trained the base models for 12 hours" (https://arxiv.org/pdf/1706.03762).');
  });
});
