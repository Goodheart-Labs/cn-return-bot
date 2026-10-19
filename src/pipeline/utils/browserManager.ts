import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, Browser } from "playwright";

let browserInstance: Browser | null = null;

/** The devbox lacks some system libraries Chromium needs, and installing them
 *  needs root. They are extracted into this folder instead, which only exists
 *  on machines that need it. */
const LOCAL_CHROMIUM_LIBS = path.join(os.homedir(), ".cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu");

function chromiumEnv(): NodeJS.ProcessEnv | undefined {
  if (!fs.existsSync(LOCAL_CHROMIUM_LIBS)) return undefined;
  return { ...process.env, LD_LIBRARY_PATH: [LOCAL_CHROMIUM_LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") };
}

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
    browserInstance = await chromium.launch({ handleSIGTERM: false, env: chromiumEnv() });
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
