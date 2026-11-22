import { chromium, Browser } from "playwright";

let browserInstance: Browser | null = null;

/** Chromium tells every page when a program drives it, by setting
 *  navigator.webdriver to true. This flag switches that off. The script of a
 *  bot check such as Vercel's Security Checkpoint looks at it: from the
 *  services machine, the check refused our browser while the value was true
 *  and let the same browser through once it was not (GOO-832). Jina Reader
 *  starts its Chrome with the same flag, and so does the site checks'
 *  browser (src/everything-extension/scripts/browser.ts). */
export const HIDE_AUTOMATION_FLAG = "--disable-blink-features=AutomationControlled";

/**
 * Returns the shared browser. A new one is launched when there is none yet or
 * the old one has disconnected. Reusing one browser across page loads avoids
 * paying the startup cost of one to two seconds on every check.
 *
 * By default Playwright installs its own SIGTERM handler at launch. That
 * handler closes the browser but never exits the process. Any handler replaces
 * the default behaviour, which is to exit at once. So a long-lived process,
 * such as the cn-fetch service with its open socket, kept running after
 * systemd asked it to stop. Every deploy then waited 90 seconds for systemd's
 * stop timeout to kill it (GOO-361). With the handler switched off, SIGTERM
 * ends the process at once. Under systemd, Chromium stops with it, because
 * systemd stops every process the service started.
 */
export async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.isConnected()) {
    browserInstance = await chromium.launch({ handleSIGTERM: false, args: [HIDE_AUTOMATION_FLAG] });
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
