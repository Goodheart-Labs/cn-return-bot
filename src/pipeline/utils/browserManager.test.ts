import { describe, expect, test } from "bun:test";
import { createBrowserManager } from "./browserManager";

function fakeBrowser() {
  let connected = true;
  let closes = 0;
  return {
    isConnected: () => connected,
    close: async () => { closes++; connected = false; },
    disconnect: () => { connected = false; },
    get closes() { return closes; },
  };
}

describe("browser manager", () => {
  test("concurrent requests share one launch and cleanup closes that browser once", async () => {
    const browser = fakeBrowser();
    const launch = Promise.withResolvers<typeof browser>();
    let launches = 0;
    const manager = createBrowserManager(() => { launches++; return launch.promise; });
    const requests = [manager.getBrowser(), manager.getBrowser(), manager.getBrowser()];
    launch.resolve(browser);
    expect(await Promise.all(requests)).toEqual([browser, browser, browser]);
    expect(launches).toBe(1);
    await Promise.all([manager.closeBrowser(), manager.closeBrowser()]);
    expect(browser.closes).toBe(1);
  });

  test("cleanup waits for an unfinished launch", async () => {
    const browser = fakeBrowser();
    const launch = Promise.withResolvers<typeof browser>();
    const manager = createBrowserManager(() => launch.promise);
    const request = manager.getBrowser();
    const cleanup = manager.closeBrowser();
    launch.resolve(browser);
    await Promise.all([request, cleanup]);
    expect(browser.closes).toBe(1);
    expect(browser.isConnected()).toBe(false);
  });

  test("a failed launch can be retried after cleanup", async () => {
    const browser = fakeBrowser();
    let launches = 0;
    const manager = createBrowserManager(async () => {
      if (++launches === 1) throw new Error("Launch failed");
      return browser;
    });
    const request = manager.getBrowser();
    const cleanup = manager.closeBrowser();
    await expect(request).rejects.toThrow("Launch failed");
    await cleanup;
    expect(await manager.getBrowser()).toBe(browser);
    expect(launches).toBe(2);
    await manager.closeBrowser();
  });

  test("a disconnected browser is replaced", async () => {
    const first = fakeBrowser();
    const second = fakeBrowser();
    let launches = 0;
    const manager = createBrowserManager(async () => ++launches === 1 ? first : second);
    expect(await manager.getBrowser()).toBe(first);
    first.disconnect();
    expect(await manager.getBrowser()).toBe(second);
    await manager.closeBrowser();
    expect(second.closes).toBe(1);
  });

  test("a request during cleanup waits before launching the next browser", async () => {
    const closed = Promise.withResolvers<void>();
    const first = { isConnected: () => true, close: () => closed.promise };
    const second = fakeBrowser();
    let launches = 0;
    const manager = createBrowserManager(async () => ++launches === 1 ? first : second);
    await manager.getBrowser();
    const cleanup = manager.closeBrowser();
    const request = manager.getBrowser();
    await Promise.resolve();
    expect(launches).toBe(1);
    closed.resolve();
    await cleanup;
    expect(await request).toBe(second);
    expect(launches).toBe(2);
    await manager.closeBrowser();
  });

  test("cleanup awaits a replacement launch after a disconnection", async () => {
    const first = fakeBrowser();
    const second = fakeBrowser();
    const replacement = Promise.withResolvers<typeof second>();
    let launches = 0;
    const manager = createBrowserManager(async () => ++launches === 1 ? first : replacement.promise);
    await manager.getBrowser();
    first.disconnect();
    const request = manager.getBrowser();
    const cleanup = manager.closeBrowser();
    replacement.resolve(second);
    await Promise.all([request, cleanup]);
    expect(second.closes).toBe(1);
    expect(second.isConnected()).toBe(false);
  });
});
