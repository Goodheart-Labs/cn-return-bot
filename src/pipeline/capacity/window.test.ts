import { describe, expect, test } from "bun:test";
import { barWithFloor, quantileBar } from "./window";

const range = (n: number) => Array.from({ length: n }, (_, i) => i + 1); // 1..n

describe("quantileBar", () => {
  test("picks the score that would have admitted cap per day", () => {
    // 100 candidates/day for 7 days, cap 40 → the 280th highest of 700 scores.
    const scores = range(700);
    expect(quantileBar(scores, 7, 40, 7)).toBe(700 - 280 + 1);
  });

  test("needs at least three days of history", () => {
    expect(quantileBar(range(200), 2, 40, 2)).toBeNull();
    expect(quantileBar(range(700), 7, 40, 2)).toBeNull();
    expect(quantileBar(range(3000), 30, 40, 2)).toBeNull();
  });

  test("calendar dates do not move the rank within a seven-day span", () => {
    const scores = range(700);
    expect(quantileBar(scores, 7, 40, 8)).toBe(quantileBar(scores, 7, 40, 7));
    expect(quantileBar(scores, 7, 40, 8)).toBe(421);
  });

  test("four days spanning five dates admits rank 160 at cap 40", () => {
    expect(quantileBar(range(700), 4, 40, 5)).toBe(541);
  });

  test("uses fractional days without rounding the span", () => {
    expect(quantileBar(range(700), 4.125, 40, 5)).toBe(536);
  });

  test("admits everything when the cap exceeds the supply", () => {
    expect(quantileBar(range(50), 7, 40, 7)).toBe(-Infinity);
  });
});

describe("barWithFloor", () => {
  test("uses the week when it is stricter than the month", () => {
    const week = { scores: range(700), spanDays: 7, distinctDays: 8 };
    const month = { scores: range(3000), spanDays: 30, distinctDays: 31 };
    // week bar = 421; month bar = 3000 - 1200 + 1 = 1801 → month is stricter here
    expect(barWithFloor(week, month, 40)).toBe(1801);
  });

  test("a junk-heavy week cannot drag the bar below the month", () => {
    const junkWeek = { scores: range(700).map((s) => s / 10), spanDays: 7, distinctDays: 7 }; // all low
    const month = { scores: range(3000), spanDays: 30, distinctDays: 30 };
    expect(barWithFloor(junkWeek, month, 40)).toBe(1801);
  });

  test("falls back to whichever window has history", () => {
    expect(barWithFloor({ scores: [], spanDays: 0, distinctDays: 0 }, { scores: range(300), spanDays: 30, distinctDays: 30 }, 5)).toBe(300 - 150 + 1);
    expect(barWithFloor({ scores: range(300), spanDays: 7, distinctDays: 7 }, { scores: [], spanDays: 0, distinctDays: 0 }, 10)).toBe(300 - 70 + 1);
    expect(barWithFloor({ scores: [], spanDays: 0, distinctDays: 0 }, { scores: [], spanDays: 0, distinctDays: 0 }, 10)).toBeNull();
  });
});
