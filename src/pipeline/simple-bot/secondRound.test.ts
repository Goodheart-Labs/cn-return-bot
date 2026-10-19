import { describe, expect, test } from "bun:test";
import { secondRoundMessage } from "./secondRound";

const verification = { accepted: false, reasoning: "The Texas claim has no source.", good_sources: ["https://good.example"], bad_sources: ["https://bad.example"] } as any;

describe("secondRoundMessage", () => {
  const message = secondRoundMessage({ userMessage: "The original message", findings: "The first findings", researchedBy: "full", noteText: "The rejected note", verification });

  test("keeps the original message and adds the first findings, the note and the verifier's answer", () => {
    expect(message.startsWith("The original message")).toBe(true);
    expect(message).toContain("The first findings");
    expect(message).toContain("The rejected note");
    expect(message).toContain("The Texas claim has no source.");
  });

  test("lists the good and the bad sources when the verifier gave no per-source detail", () => {
    expect(message).toContain("https://good.example");
    expect(message).toContain("https://bad.example");
  });
});
