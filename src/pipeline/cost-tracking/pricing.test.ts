import { describe, expect, test } from "bun:test";
import { SERPER_COST_PER_SEARCH, whisperTranscriptionCost } from "./pricing";

describe("per-use API prices", () => {
  test("a Serper search costs one fifty-thousandth of the $50 plan", () => {
    expect(SERPER_COST_PER_SEARCH).toBeCloseTo(0.001, 10);
  });

  test("Whisper bills an hour of audio at $0.111", () => {
    expect(whisperTranscriptionCost(3600).cost).toBeCloseTo(0.111, 10);
  });

  test("Whisper bills a clip shorter than 10 seconds as 10 seconds", () => {
    expect(whisperTranscriptionCost(3).cost).toBeCloseTo(whisperTranscriptionCost(10).cost, 10);
  });
});
