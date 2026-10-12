import { describe, expect, test } from "bun:test";
import { readerHash } from "./readers";

/* The reader hash is what makes unique-reader counting possible, and every
 * property below is one the counting depends on. */

/** Two browsers, each with the random value it holds and never sends. */
const ONE_BROWSER = "6f1c9a3e-0d2b-4c8a-9f11-2b7c5d8e4a30";
const ANOTHER_BROWSER = "aa11bb22-cc33-dd44-ee55-ff6677889900";
const ZVI = "https://thezvi.substack.com";

describe("readerHash", () => {
  test("the same browser and the same creator always give the same value", async () => {
    expect(await readerHash(ONE_BROWSER, ZVI)).toBe(await readerHash(ONE_BROWSER, ZVI));
  });

  test("two creators give unrelated values, so visits cannot be joined across creators", async () => {
    expect(await readerHash(ONE_BROWSER, ZVI)).not.toBe(
      await readerHash(ONE_BROWSER, "https://www.youtube.com/@kurzgesagt"),
    );
  });

  test("two browsers give different values for the same creator, which is what counting readers needs", async () => {
    expect(await readerHash(ONE_BROWSER, ZVI)).not.toBe(await readerHash(ANOTHER_BROWSER, ZVI));
  });

  test("a trailing slash or different capitals is still the same creator", async () => {
    const expected = await readerHash(ONE_BROWSER, ZVI);
    expect(await readerHash(ONE_BROWSER, "https://TheZvi.substack.com/")).toBe(expected);
  });

  test("the value is 64 lower-case hex characters, which the database column checks for", async () => {
    expect(await readerHash(ONE_BROWSER, ZVI)).toMatch(/^[0-9a-f]{64}$/);
  });
});
