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

test("a *.substack.com post loses every query parameter, a custom-domain post only the tracking ones", () => {
  expect(canonicalizePageUrl("https://nathanpmyoung.substack.com/p/some-post?r=abc12&triedRedirect=true", null)).toBe(
    "https://nathanpmyoung.substack.com/p/some-post",
  );
  expect(canonicalizePageUrl("https://www.astralcodexten.com/p/some-post?lli=1&utm_source=profile&r=abc12", null)).toBe(
    "https://www.astralcodexten.com/p/some-post?r=abc12",
  );
  expect(canonicalizePageUrl("https://www.newyorker.com/magazine/2026/10/26/james-daunt-profile?_sp=769c5ec4.1792595541644", null)).toBe(
    "https://www.newyorker.com/magazine/2026/10/26/james-daunt-profile",
  );
});

test("a custom-domain post loses its whole query when Substack's own parameters show it is a Substack post", () => {
  expect(
    canonicalizePageUrl(
      "https://www.astralcodexten.com/p/against-against-handover?publication_id=89120&post_id=206469842&isFreemail=true&r=1c0bzf&triedRedirect=true",
      null,
    ),
  ).toBe("https://www.astralcodexten.com/p/against-against-handover");
});

test("a BBC article has one address, whichever host the reader was sent to", () => {
  const stored = "https://www.bbc.com/news/articles/cw98z6qlyvg3o";
  expect(canonicalizePageUrl("https://www.bbc.co.uk/news/articles/cw98z6qlyvg3o", null)).toBe(stored);
  expect(canonicalizePageUrl("https://www.bbc.co.uk/news/articles/cw98z6qlyvg3o", "https://www.bbc.co.uk/news/articles/cw98z6qlyvg3o")).toBe(stored);
  expect(canonicalizePageUrl("https://www.bbc.com/news/articles/cw98z6qlyvg3o", null)).toBe(stored);
});

test("only BBC news and sport pages on the BBC's own hosts change host", () => {
  expect(canonicalizePageUrl("https://www.bbc.co.uk/iplayer/episode/m0012345", null)).toBe("https://www.bbc.co.uk/iplayer/episode/m0012345");
  expect(canonicalizePageUrl("https://www.bbc.co.uk/sport/football/articles/c123", null)).toBe("https://www.bbc.com/sport/football/articles/c123");
  expect(canonicalizePageUrl("https://news.bbc.co.uk/2/hi/uk_news/123.stm", null)).toBe("https://news.bbc.co.uk/2/hi/uk_news/123.stm");
  expect(canonicalizePageUrl("https://www.notbbc.co.uk/news/x", null)).toBe("https://www.notbbc.co.uk/news/x");
  expect(canonicalizePageUrl("https://example.com/news/bbc.co.uk", null)).toBe("https://example.com/news/bbc.co.uk");
});

test("query parameters that select content are kept", () => {
  expect(canonicalizePageUrl("https://example.com/watch?v=abc&utm_source=x", null)).toBe("https://example.com/watch?v=abc");
});
