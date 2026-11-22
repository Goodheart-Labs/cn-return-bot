import { beforeEach, expect, test } from "bun:test";
import { fakeBrowser } from "@webext-core/fake-browser";
import { deviceId } from "./deviceId";

beforeEach(() => fakeBrowser.reset());

test("callers that ask for the device id at the same moment on a fresh install get the same id", async () => {
  const [heartbeatId, installId] = await Promise.all([deviceId(), deviceId()]);
  expect(installId).toBe(heartbeatId);
  expect(await deviceId()).toBe(heartbeatId);
});
