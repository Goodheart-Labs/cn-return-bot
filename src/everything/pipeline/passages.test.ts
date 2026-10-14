import { describe, expect, test } from "bun:test";
import { PassageFormatError, claimsOfPassages, describeProblems, imageSpans, parsePassages, topLevelKeys } from "./passages";

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
    "Revenue grew 30% last year.": { type: "statement" },
    "I think that is great.": { type: "other" },
    "The company was founded in 2010.": { type: "statement" },
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
    const parse = parsePassages(answer({ "Revenue grew 30% last year.": { type: "statement" }, "The company was founded in 2010.": { type: "statement" } }), body);
    expect(parse.uncovered.map((g) => g.text)).toEqual(["I think that is great."]);
    expect(parse.coverage).toBeLessThan(1);
    expect(describeProblems(parse)).toContain("I think that is great.");
  });

  test("finds a passage the model reworded in its punctuation and capitals", () => {
    const parse = parsePassages(answer({ "revenue grew 30 % last year": { type: "statement" }, "I think that is great.": { type: "other" }, "The company was founded in 2010.": { type: "statement" } }), body);
    expect(parse.unmatched).toEqual([]);
    expect(parse.coverage).toBe(1);
  });

  test("reports a passage that is not in the text", () => {
    const parse = parsePassages(answer({ "Sales doubled.": { type: "statement" }, "I think that is great.": { type: "other" } }), body);
    expect(parse.unmatched).toEqual(["Sales doubled."]);
  });

  test("takes an image key when the image is in the text", () => {
    const parse = parsePassages(answer({ "Revenue grew 30% last year.": { type: "other" }, "Image: https://x/a.png": { type: "statement" } }), body);
    expect(parse.passages[1]!.imageUrl).toBe("https://x/a.png");
    expect(parse.unmatched).toEqual([]);
  });

  test("matches a repeated passage to its two places in order", () => {
    const text = "Thanks for reading.\n\nMiddle part.\n\nThanks for reading.";
    const parse = parsePassages('{"Thanks for reading.": {"type": "other"}, "Middle part.": {"type": "other"}, "Thanks for reading.": {"type": "other"}}', text);
    expect(parse.coverage).toBe(1);
    expect(parse.passages.map((p) => p.span!.start)).toEqual([0, 21, 35]);
  });

  test("takes a forecast, which makes no claim", () => {
    const parse = parsePassages(answer({ "Revenue grew 30% last year.": { type: "forecast" }, "I think that is great.": { type: "other" } }), body);
    expect(claimsOfPassages(parse.passages, body)).toEqual([]);
  });

  test("rejects an answer of the wrong shape", () => {
    expect(() => parsePassages("not json", body)).toThrow(PassageFormatError);
    expect(() => parsePassages("[]", body)).toThrow(PassageFormatError);
    expect(() => parsePassages(answer({ "Revenue grew 30% last year.": { type: "gossip" } }), body)).toThrow('The type must be one of: "statement", "forecast", "other"');
    expect(() => parsePassages(answer({ "Revenue grew 30% last year.": "claim" }), body)).toThrow("must be an object");
  });

  test("accepts a type that the caller allows beyond the usual ones", () => {
    const parse = parsePassages(answer({ "Revenue grew 30% last year.": { type: "other", why: "a heading" } }), body, { allowedTypes: ["statement", "other"] });
    expect(parse.passages[0]!.extra).toEqual({ why: "a heading" });
  });
});

describe("parsePassages with an unfinished ending", () => {
  const text = "Revenue grew 30% last year. The company was founded in 2010 and then it";
  const withoutEnding = answer({ "Revenue grew 30% last year.": { type: "statement" }, "The company was founded in 2010": { type: "statement" } });

  test("hands the left-out last words back as the carry when the caller allows it", () => {
    const parse = parsePassages(withoutEnding, text, { allowCarry: true });
    expect(parse.carry).toBe("and then it");
    expect(parse.uncovered).toEqual([]);
    expect(parse.coverage).toBe(1);
  });

  test("counts the same gap as missing text when the caller does not allow it", () => {
    const parse = parsePassages(withoutEnding, text);
    expect(parse.carry).toBe("");
    expect(parse.uncovered.map((gap) => gap.text)).toEqual(["and then it"]);
    expect(parse.coverage).toBeLessThan(1);
  });

  test("does not take a gap in the middle of the text as the carry", () => {
    const parse = parsePassages(answer({ "The company was founded in 2010 and then it": { type: "other" } }), text, { allowCarry: true });
    expect(parse.carry).toBe("");
    expect(parse.uncovered.map((gap) => gap.text)).toEqual(["Revenue grew 30% last year."]);
  });

  test("does not take a gap longer than the limit as the carry", () => {
    const longText = `Revenue grew 30% last year. ${"Words keep coming and coming. ".repeat(40)}`;
    const parse = parsePassages(answer({ "Revenue grew 30% last year.": { type: "other" } }), longText, { allowCarry: true });
    expect(parse.carry).toBe("");
    expect(parse.coverage).toBeLessThan(0.5);
  });
});

describe("claimsOfPassages", () => {
  test("makes one claim of every statement point, which is the point itself, and none of other text", () => {
    const parse = parsePassages(
      answer({
        "Revenue grew 30% last year. I think that is great.": { type: "statement" },
        "The company was founded in 2010.": { type: "forecast" },
      }),
      body,
    );
    expect(claimsOfPassages(parse.passages, body)).toEqual([
      { claim: "Revenue grew 30% last year. I think that is great.", context: "Revenue grew 30% last year. I think that is great.", imageUrls: [] },
    ]);
  });

  test("makes the claim of a point that is an image from its description and its visible text, with no quote", () => {
    const parse = parsePassages(answer({ "Image: https://x/a.png": { type: "statement" } }), body);
    expect(claimsOfPassages(parse.passages, body)).toEqual([
      { claim: "Description: A bar chart [2025] of revenue.\nVisible text: Revenue", context: "", imageUrls: ["https://x/a.png"] },
    ]);
  });
});
