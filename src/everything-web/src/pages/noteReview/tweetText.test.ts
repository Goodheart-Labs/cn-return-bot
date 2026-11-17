import { expect, test } from "bun:test";
import { taggedForX } from "./tweetText";

test("a note link in a tweet keeps ?note= and gains the X tags", () => {
  const link = taggedForX("https://commonnotes.net/notes/zvi?note=n-1", "n-1");
  expect(link).toBe("https://commonnotes.net/notes/zvi?note=n-1&utm_source=x&utm_campaign=note&utm_content=n-1");
  expect(new URL(link).searchParams.get("note")).toBe("n-1");
});
