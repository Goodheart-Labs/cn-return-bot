import { chromium, Browser } from "playwright";

let browserInstance: Browser | null = null;

/**
 * Returns the shared browser. A new one is launched when there is none yet or
 * the old one has disconnected. Reusing one browser across page loads avoids
 * paying the startup cost of one to two seconds on every check.
 */
export async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch();
  }
  return browserInstance;
}

/**
 * Closes the shared browser. Call this at the end of a script so the Chromium
 * process does not stay alive after the work is done.
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
