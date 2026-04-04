import { chromium, Browser } from "playwright";

let browserInstance: Browser | null = null;

/**
 * Get or create a shared browser instance.
 * Reuses the same browser across multiple page loads to avoid
 * the ~1-2s startup cost per check.
 */
export async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch();
  }
  return browserInstance;
}

/**
 * Close the shared browser instance.
 * Call this at the end of your script to clean up resources.
 */
export async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}
