import { describe, expect, test } from "bun:test";
import { findInPage, pageLines, pageWindow, WINDOW_CHARS } from "./pageText";

const URL = "https://example.com/a";

describe("pageWindow", () => {
  test("numbers the non-empty lines and says how many there are", () => {
    const page = pageLines(URL, "# Title\n\nFirst paragraph.\n\n\nSecond paragraph.\n");
    expect(pageWindow(page, 0)).toBe(`${URL}\nLines 0 to 2 of 3.\n\nL0: # Title\nL1: First paragraph.\nL2: Second paragraph.`);
  });

  test("stops at the window size and says where to go on", () => {
    const line = "x".repeat(WINDOW_CHARS / 4);
    const page = pageLines(URL, Array(10).fill(line).join("\n"));
    const window = pageWindow(page, 2);
    expect(window).toStartWith(`${URL}\nLines 2 to 5 of 10. Open it again from line 6 to read on.`);
    expect(window).toContain("L5: ");
    expect(window).not.toContain("L6: ");
  });

  test("cuts a line longer than the window, so reading still moves on", () => {
    const page = pageLines(URL, `${"y".repeat(WINDOW_CHARS * 2)}\nnext`);
    expect(pageWindow(page, 0)).toStartWith(`${URL}\nLines 0 to 0 of 2. Open it again from line 1 to read on.`);
  });

  test("answers a line past the end", () => {
    expect(pageWindow(pageLines(URL, "one\ntwo"), 5)).toBe(`${URL} has 2 lines, so there is no line 5.`);
  });
});

describe("findInPage", () => {
  const page = pageLines(URL, "Intro.\nThe rate “fell by half” in 2020.\nOutro.\nAnother line.");

  test("finds a quote regardless of case, whitespace and curly quotes, with the lines around it", () => {
    expect(findInPage(page, 'the rate  "Fell by half"')).toBe(`"the rate  "Fell by half"" is on 1 line of ${URL}: L1.\n\nL0: Intro.\nL1: The rate “fell by half” in 2020.\nL2: Outro.`);
  });

  test("says so when the text is not on the page", () => {
    expect(findInPage(page, "doubled")).toBe(`"doubled" is not on ${URL}.`);
  });

  test("asks for a longer phrase when the text is everywhere", () => {
    const common = pageLines(URL, Array(30).fill("the same words").join("\n"));
    expect(findInPage(common, "same")).toBe(`"same" is on 30 lines of ${URL}. Use a longer phrase.`);
  });
});
