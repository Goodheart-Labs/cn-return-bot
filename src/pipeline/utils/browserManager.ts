import { chromium, type Browser } from "playwright";

export function createBrowserManager<T extends Pick<Browser, "isConnected" | "close">>(launch: () => Promise<T>) {
  let browserInstance: T | null = null;
  let launching: Promise<T> | null = null;
  let closing: Promise<void> | null = null;

  async function getBrowser(): Promise<T> {
    if (closing) await closing;
    if (browserInstance?.isConnected()) return browserInstance;
    if (!launching) {
      launching = Promise.resolve().then(launch).then((browser) => {
        browserInstance = browser;
        return browser;
      }).finally(() => { launching = null; });
    }
    return launching;
  }

  async function closeBrowser(): Promise<void> {
    if (!closing) {
      closing = (async () => {
        const browser = launching ? await launching.catch(() => null) : browserInstance;
        if (browser) await browser.close();
        browserInstance = null;
      })().finally(() => { closing = null; });
    }
    return closing;
  }

  return { getBrowser, closeBrowser };
}

const shared = createBrowserManager(() => chromium.launch());

/**
 * Returns the shared browser. A new one is launched when there is none yet or
 * the old one has disconnected. Reusing one browser across page loads avoids
 * paying the startup cost of one to two seconds on every check.
 */
export async function getBrowser(): Promise<Browser> {
  return shared.getBrowser();
}

/**
 * Closes the shared browser. Call this at the end of a script so the Chromium
 * process does not stay alive after the work is done.
 */
export async function closeBrowser(): Promise<void> {
  return shared.closeBrowser();
}
