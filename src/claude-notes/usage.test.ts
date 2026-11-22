import { expect, test } from "bun:test";
import { readingFromHeaders } from "./usage";

const at = new Date("2026-11-22T02:00:00Z");

test("the weekly usage is read from an inference response's rate-limit headers", () => {
  const headers = new Headers({
    "anthropic-ratelimit-unified-7d-utilization": "0.86",
    "anthropic-ratelimit-unified-7d-reset": "1795453200",
  });
  expect(readingFromHeaders(headers, at)).toEqual({
    at: "2026-11-22T02:00:00.000Z",
    weekly: 86,
    weeklyResetsAt: new Date(1795453200 * 1000).toISOString(),
  });
});

test("a response without the weekly headers is an error, not a reading of 0%", () => {
  expect(() => readingFromHeaders(new Headers(), at)).toThrow("no weekly usage headers");
});

test("a weekly header that is not a number is an error", () => {
  const headers = new Headers({
    "anthropic-ratelimit-unified-7d-utilization": "soon",
    "anthropic-ratelimit-unified-7d-reset": "1795453200",
  });
  expect(() => readingFromHeaders(headers, at)).toThrow("no weekly usage headers");
});
