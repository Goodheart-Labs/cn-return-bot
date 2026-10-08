import { describe, expect, test } from "bun:test";
import { PassageFormatError, claimsOfPassages, describeProblems, imageSpans, paragraphAround, parsePassages, topLevelKeys } from "./passages";

const body = [
  "Revenue grew 30% last year. I think that is great.",
  "",
  "[Image: https://x/a.png\nDescription: A bar chart [2025] of revenue.\nVisible text: Revenue]",
  "",
  "The company was founded in 2010.",
].join("\n");

const answer = (passages: Record<string, unknown>) => JSON.stringify(passages);

describe("topLevelKeys", () => {
  test("keeps the order of keys that look like whole numbers", () => {
    expect(topLevelKeys('{"b": {"type": "x"}, "2024": {"type": "x"}, "a": {"type": "x"}}')).toEqual(["b", "2024", "a"]);
  });

  test("lists a repeated key twice", () => {
    expect(topLevelKeys('{"Thanks.": {"type": "other"}, "Other.": {"type": "other"}, "Thanks.": {"type": "other"}}')).toEqual(["Thanks.", "Other.", "Thanks."]);
  });

  test("reads keys with quotes and braces in them, and ignores nested keys", () => {
    const json = '{"He said \\"{no}\\", twice.": {"type": "statement", "claims": ["a"], "nested": {"type": "x"}}, "Next.": {"type": "other"}}';
    expect(topLevelKeys(json)).toEqual(['He said "{no}", twice.', "Next."]);
  });
});

describe("imageSpans", () => {
  test("ends an image block at the bracket that ends a line, not at a bracket inside the description", () => {
    const [span] = imageSpans(body);
    expect(body.slice(span!.start, span!.end)).toBe("[Image: https://x/a.png\nDescription: A bar chart [2025] of revenue.\nVisible text: Revenue]");
  });
});

describe("parsePassages", () => {
  const good = answer({
    "Revenue grew 30% last year.": { type: "statement", claims: ["The company's revenue grew 30% last year."] },
    "I think that is great.": { type: "other" },
    "The company was founded in 2010.": { type: "statement", claims: ["The company was founded in 2010."] },
  });

  test("accepts passages that add up to the text, leaving out the image block and the line breaks", () => {
    const parse = parsePassages(good, body);
    expect(parse.coverage).toBe(1);
    expect(parse.unmatched).toEqual([]);
    expect(parse.uncovered).toEqual([]);
    expect(parse.passages.map((p) => p.type)).toEqual(["statement", "other", "statement"]);
    expect(body.slice(parse.passages[1]!.span!.start, parse.passages[1]!.span!.end)).toBe("I think that is great.");
  });

  test("reports the text that no passage covers", () => {
    const parse = parsePassages(answer({ "Revenue grew 30% last year.": { type: "statement", claims: ["c"] }, "The company was founded in 2010.": { type: "statement", claims: ["c"] } }), body);
    expect(parse.uncovered.map((g) => g.text)).toEqual(["I think that is great."]);
    expect(parse.coverage).toBeLessThan(1);
    expect(describeProblems(parse)).toContain("I think that is great.");
  });

  test("finds a passage the model reworded in its punctuation and capitals", () => {
    const parse = parsePassages(answer({ "revenue grew 30 % last year": { type: "statement", claims: ["c"] }, "I think that is great.": { type: "other" }, "The company was founded in 2010.": { type: "statement", claims: ["c"] } }), body);
    expect(parse.unmatched).toEqual([]);
    expect(parse.coverage).toBe(1);
  });

  test("reports a passage that is not in the text", () => {
    const parse = parsePassages(answer({ "Sales doubled.": { type: "statement", claims: ["c"] }, "I think that is great.": { type: "other" } }), body);
    expect(parse.unmatched).toEqual(["Sales doubled."]);
  });

  test("takes an image key when the image is in the text", () => {
    const parse = parsePassages(answer({ "Revenue grew 30% last year.": { type: "other" }, "Image: https://x/a.png": { type: "statement", claims: ["Revenue is shown in a chart."] } }), body);
    expect(parse.passages[1]!.imageUrl).toBe("https://x/a.png");
    expect(parse.unmatched).toEqual([]);
  });

  test("matches a repeated passage to its two places in order", () => {
    const text = "Thanks for reading.\n\nMiddle part.\n\nThanks for reading.";
    const parse = parsePassages('{"Thanks for reading.": {"type": "other"}, "Middle part.": {"type": "other"}, "Thanks for reading.": {"type": "other"}}', text);
    expect(parse.coverage).toBe(1);
    expect(parse.passages.map((p) => p.span!.start)).toEqual([0, 21, 35]);
  });

  test("takes a forecast, which lists no claims", () => {
    const parse = parsePassages(answer({ "Revenue grew 30% last year.": { type: "forecast" }, "I think that is great.": { type: "other" } }), body);
    expect(parse.passages[0]!.claims).toEqual([]);
    expect(claimsOfPassages(parse.passages, body)).toEqual([]);
  });

  test("rejects an answer of the wrong shape", () => {
    expect(() => parsePassages("not json", body)).toThrow(PassageFormatError);
    expect(() => parsePassages("[]", body)).toThrow(PassageFormatError);
    expect(() => parsePassages(answer({ "Revenue grew 30% last year.": { type: "gossip" } }), body)).toThrow('The type must be one of: "statement", "forecast", "other"');
    expect(() => parsePassages(answer({ "Revenue grew 30% last year.": { type: "statement" } }), body)).toThrow('needs "claims"');
    expect(() => parsePassages(answer({ "Revenue grew 30% last year.": "claim" }), body)).toThrow("must be an object");
  });

  test("accepts a type that the caller allows beyond the usual ones", () => {
    const parse = parsePassages(answer({ "Revenue grew 30% last year.": { type: "other", why: "a heading" } }), body, ["statement", "other"]);
    expect(parse.passages[0]!.extra).toEqual({ why: "a heading" });
  });
});

describe("claimsOfPassages", () => {
  test("gives every claim of a passage the passage and its paragraph, and none for other text", () => {
    const parse = parsePassages(
      answer({
        "Revenue grew 30% last year.": { type: "statement", claims: ["Revenue grew 30% last year.", "Revenue grew."] },
        "I think that is great.": { type: "other" },
        "The company was founded in 2010.": { type: "statement", claims: ["The company was founded in 2010."] },
      }),
      body,
    );
    const claims = claimsOfPassages(parse.passages, body);
    expect(claims).toHaveLength(3);
    expect(claims[0]).toEqual({ claim: "Revenue grew 30% last year.", context: "Revenue grew 30% last year.", contextParagraph: "Revenue grew 30% last year. I think that is great.", imageUrls: [] });
    
  });

  test("gives a claim that rests on an image the image and no passage", () => {
    const parse = parsePassages(answer({ "Image: https://x/a.png": { type: "statement", claims: ["Revenue is shown in a chart."] } }), body);
    expect(claimsOfPassages(parse.passages, body)).toEqual([{ claim: "Revenue is shown in a chart.", context: "", contextParagraph: "", imageUrls: ["https://x/a.png"] }]);
  });
});

describe("paragraphAround", () => {
  test("returns the paragraph between blank lines", () => {
    const start = body.indexOf("The company");
    expect(paragraphAround(body, { start, end: start + 10 })).toBe("The company was founded in 2010.");
  });
});
