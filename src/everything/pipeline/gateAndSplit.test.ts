import { describe, expect, test } from "bun:test";
import { cutCues, cutText, locatePartStarts, parseGateSplitOutput } from "./gateAndSplit";
import type { SubtitleCue } from "../../pipeline/media/ytDlpDownload";

const text = [
  "Welcome back. Today we cover two things.",
  "",
  "First, the economy. GDP grew 3% last year, which surprised everyone.",
  "Prices rose too.",
  "",
  "Second, the election. Turnout was 61%, the highest since 1968.",
].join("\n");

describe("locatePartStarts", () => {
  test("finds excerpts despite punctuation, case and whitespace differences", () => {
    const offsets = locatePartStarts(text, [
      { title: "Economy", startExcerpt: "first   the ECONOMY gdp grew 3" },
      { title: "Election", startExcerpt: "Second, the election." },
    ]);
    expect(offsets).toEqual([text.indexOf("First, the economy"), text.indexOf("Second, the election")]);
  });

  test("resolves a repeated sentence to the later occurrence", () => {
    const repeated = "Same words here. Something else. Same words here. The end.";
    const offsets = locatePartStarts(repeated, [
      { title: "A", startExcerpt: "Same words here" },
      { title: "B", startExcerpt: "Same words here" },
    ]);
    expect(offsets).toEqual([0, repeated.lastIndexOf("Same words here")]);
  });

  test("gives up when an excerpt is not in the text", () => {
    expect(locatePartStarts(text, [{ title: "X", startExcerpt: "This sentence was made up." }])).toBeNull();
  });

  test("gives up when the starts do not advance", () => {
    const offsets = locatePartStarts(text, [
      { title: "Election", startExcerpt: "Second, the election." },
      { title: "Economy", startExcerpt: "First, the economy." },
    ]);
    expect(offsets).toBeNull();
  });
});

describe("cutText", () => {
  test("cuts at the starts and keeps what precedes the first as the introduction", () => {
    const cut = cutText(text, [
      { title: "Economy", startExcerpt: "First, the economy." },
      { title: "Election", startExcerpt: "Second, the election." },
    ]);
    expect(cut).toEqual({
      introduction: "Welcome back. Today we cover two things.",
      parts: [
        { title: "Economy", text: "First, the economy. GDP grew 3% last year, which surprised everyone.\nPrices rose too." },
        { title: "Election", text: "Second, the election. Turnout was 61%, the highest since 1968." },
      ],
    });
  });

  test("has no introduction when the first part starts the text", () => {
    const cut = cutText(text, [{ title: "All", startExcerpt: "Welcome back." }]);
    expect(cut?.introduction).toBeNull();
    expect(cut?.parts[0]?.text).toBe(text);
  });

  test("returns null for an empty part list", () => {
    expect(cutText(text, [])).toBeNull();
  });
});

const cues: SubtitleCue[] = [
  { start: 0, end: 2, text: "welcome back today we cover" },
  { start: 2, end: 4, text: "two things first the economy" },
  { start: 4, end: 6, text: "gdp grew three percent" },
  { start: 6, end: 8, text: "second the election turnout" },
  { start: 8, end: 10, text: "was sixty one percent" },
];

describe("cutCues", () => {
  test("cuts on whole cues, starting a part at the cue its excerpt falls in", () => {
    const cut = cutCues(cues, [
      { title: "Economy", startExcerpt: "first the economy" },
      { title: "Election", startExcerpt: "second the election" },
    ]);
    expect(cut?.introduction).toEqual(cues.slice(0, 1));
    expect(cut?.parts.map((p) => p.cues)).toEqual([cues.slice(1, 3), cues.slice(3, 5)]);
  });

  test("gives up when two starts land in the same cue", () => {
    const cut = cutCues(cues, [
      { title: "A", startExcerpt: "two things" },
      { title: "B", startExcerpt: "first the economy" },
    ]);
    expect(cut).toBeNull();
  });
});

describe("parseGateSplitOutput", () => {
  test("accepts the expected shape", () => {
    expect(parseGateSplitOutput('{"checkable":true,"reason":"argues","parts":[]}').checkable).toBe(true);
  });

  test("rejects a reply missing the parts list", () => {
    expect(() => parseGateSplitOutput('{"checkable":true,"reason":"argues"}')).toThrow();
  });
});
