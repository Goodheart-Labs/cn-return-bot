import { describe, expect, test } from "bun:test";
import { stripBrowserLineCitations } from "./tools";

describe("stripBrowserLineCitations", () => {
  test("removes Meta's line-citation markers and keeps the URLs and text", () => {
    const text = "Built 1887–89 https://www.britannica.com/x 【1586541899417117766†L16-L18】 and 330 m 【12†L21】.";
    expect(stripBrowserLineCitations(text)).toBe("Built 1887–89 https://www.britannica.com/x and 330 m.");
  });

  test("leaves text without markers unchanged", () => {
    expect(stripBrowserLineCitations("Plain findings [1] (a) https://a.b")).toBe("Plain findings [1] (a) https://a.b");
  });
});
