import { afterEach, expect, test } from "bun:test";
import { DEFAULT_BAR_MIN_NET, raterBar } from "./raterBar";

afterEach(() => { delete process.env.NOTE_BAR_MIN_NET; });

test("the bar comes from the repo variable and defaults to 0.05", () => {
  expect(raterBar()).toBe(DEFAULT_BAR_MIN_NET);
  process.env.NOTE_BAR_MIN_NET = "0.08"; expect(raterBar()).toBe(0.08);
  process.env.NOTE_BAR_MIN_NET = "nonsense"; expect(raterBar()).toBe(DEFAULT_BAR_MIN_NET);
});

test("off, or a negative number, means no bar", () => {
  process.env.NOTE_BAR_MIN_NET = "off"; expect(raterBar()).toBeNull();
  process.env.NOTE_BAR_MIN_NET = "-1"; expect(raterBar()).toBeNull();
});
