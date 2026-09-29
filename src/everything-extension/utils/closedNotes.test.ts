import { beforeEach, expect, test } from "bun:test";
import { fakeBrowser } from "@webext-core/fake-browser";
import { forgetClosedClaim, getClosedClaims, rememberClosedClaim } from "./closedNotes";

beforeEach(() => fakeBrowser.reset());

test("a closed claim is remembered until the reader opens it again", async () => {
  await rememberClosedClaim("a");
  await rememberClosedClaim("b");
  expect([...(await getClosedClaims())]).toEqual(["a", "b"]);
  await forgetClosedClaim("a");
  expect([...(await getClosedClaims())]).toEqual(["b"]);
});
