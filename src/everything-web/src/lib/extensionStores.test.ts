import { describe, expect, test } from "bun:test";
import { detectBrowser } from "./extensionStores";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const EDGE = `${CHROME} Edg/129.0.0.0`;
const FIREFOX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0";
const SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("detectBrowser", () => {
  test("tells the four browsers apart", () => {
    expect(detectBrowser(CHROME)).toBe("chrome");
    expect(detectBrowser(EDGE)).toBe("edge");
    expect(detectBrowser(FIREFOX)).toBe("firefox");
    expect(detectBrowser(SAFARI)).toBe("safari");
  });

  test("counts an unknown browser as Chrome", () => {
    expect(detectBrowser("SomeBot/1.0")).toBe("chrome");
  });
});
