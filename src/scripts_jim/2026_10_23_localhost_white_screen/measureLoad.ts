// Loads a page in headless Chromium and reports how many requests it took,
// how many bytes they carried, and when the page first showed content.
// The optional latency and throughput imitate the SSH tunnel to Jim's Mac.
//
//   bun run src/scripts_jim/2026_10_23_localhost_white_screen/measureLoad.ts <url> [latencyMs] [kbPerSecond]
import * as os from "os";
import * as path from "path";
import { chromium } from "playwright";

const [url, latencyArg = "0", throughputArg = "0"] = process.argv.slice(2);
const latencyMs = Number(latencyArg);
const bytesPerSecond = Number(throughputArg) * 1024;
const BYTES_PER_KB = 1024;
const PAGE_TIMEOUT_MS = 600_000;

const localLibs = path.join(os.homedir(), ".cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu");
const browser = await chromium.launch({
  channel: "chromium",
  env: { ...process.env, LD_LIBRARY_PATH: [localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") },
});
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: latencyMs,
  downloadThroughput: bytesPerSecond || -1,
  uploadThroughput: -1,
});

let requestCount = 0;
let totalBytes = 0;
cdp.on("Network.loadingFinished", (event) => {
  requestCount++;
  totalBytes += event.encodedDataLength;
});

const start = Date.now();
await page.goto(url, { waitUntil: "load", timeout: PAGE_TIMEOUT_MS });
const loadMs = Date.now() - start;
await page.waitForFunction(() => (document.getElementById("root")?.childElementCount ?? 0) > 0, null, { timeout: PAGE_TIMEOUT_MS });
const firstContentMs = Date.now() - start;

console.log(
  `latency ${latencyMs} ms, throughput ${throughputArg || "unlimited"} KB/s: ` +
    `${requestCount} requests, ${(totalBytes / BYTES_PER_KB).toFixed(0)} KB, ` +
    `load event after ${(loadMs / 1000).toFixed(1)} s, content after ${(firstContentMs / 1000).toFixed(1)} s`,
);
await browser.close();
