import { describe, expect, test } from "bun:test";
import { nextWritingLimit } from "./writingLimit";

describe("nextWritingLimit", () => {
  test("waits until the notes of the last 24 hours reach the estimate", () => {
    expect(nextWritingLimit(39, 40, 4)).toBeNull();
  });

  test("raises the estimate by the step and doubles the step", () => {
    expect(nextWritingLimit(40, 40, 1)).toEqual({ limit: 41, step: 2 });
    expect(nextWritingLimit(41, 41, 2)).toEqual({ limit: 43, step: 4 });
    expect(nextWritingLimit(43, 43, 4)).toEqual({ limit: 47, step: 8 });
  });

  test("starts from the notes of the last 24 hours without an estimate", () => {
    expect(nextWritingLimit(12, null, 1)).toEqual({ limit: 13, step: 2 });
  });
});
