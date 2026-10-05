import { expect, test } from "bun:test";
import { canonicalizePageUrl } from "./pageUrls";

// The post links on Nathan Young's Substack profile, Posts tab, as the page
// rendered them on 2026-10-05 (GOO-365). Logged in, Substack adds lli=1.
const PROFILE_POST_LINK_LOGGED_OUT =
  "https://nathanpmyoung.substack.com/p/the-navier-stokes-controversy-most?utm_source=profile&utm_medium=reader2";
const PROFILE_POST_LINK_LOGGED_IN =
  "https://nathanpmyoung.substack.com/p/the-navier-stokes-controversy-most?lli=1&utm_source=profile&utm_medium=reader2";
const STORED_ITEM_URL = "https://nathanpmyoung.substack.com/p/the-navier-stokes-controversy-most";

test("a Substack profile's post links canonicalize to the stored item URL, logged in or out", () => {
  expect(canonicalizePageUrl(PROFILE_POST_LINK_LOGGED_OUT, null)).toBe(STORED_ITEM_URL);
  expect(canonicalizePageUrl(PROFILE_POST_LINK_LOGGED_IN, null)).toBe(STORED_ITEM_URL);
});

test("query parameters that select content are kept", () => {
  expect(canonicalizePageUrl("https://example.com/watch?v=abc&utm_source=x", null)).toBe("https://example.com/watch?v=abc");
});
