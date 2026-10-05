import { beforeEach, expect, test } from "bun:test";
import { fakeBrowser } from "@webext-core/fake-browser";
import { getClosedClaims, rememberClosedClaim } from "./closedNotes";

beforeEach(() => fakeBrowser.reset());

test("closed claims are remembered, most recent last", async () => {
  await rememberClosedClaim("a");
  await rememberClosedClaim("b");
  expect([...(await getClosedClaims())]).toEqual(["a", "b"]);
  await rememberClosedClaim("a");
  expect([...(await getClosedClaims())]).toEqual(["b", "a"]);
});
