/**
 * Smart scroll script for virtualized lists (like X's notewriter page)
 *
 * Scrolls down and waits for new content to load before continuing.
 * Stops when no new content loads after multiple attempts.
 *
 * Usage:
 *   bun run src/scripts/scrollDown.ts [maxScrolls]
 *
 * Defaults: 1000 max scrolls
 */

import puppeteer from "puppeteer-core";

async function main() {
  const maxScrolls = parseInt(process.argv[2] || "1000", 10);

  console.log(`🔌 Connecting to Chrome on port 9222...`);

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: "http://127.0.0.1:9222",
      protocolTimeout: 120000,
    });
  } catch (err) {
    console.error("❌ Failed to connect to Chrome.");
    console.error("Make sure Chrome is running with remote debugging:");
    console.error(
      "  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile",
    );
    process.exit(1);
  }

  console.log("✅ Connected to Chrome");

  const pages = await browser.pages();
  const page = pages[0];

  if (!page) {
    console.error("❌ No page found");
    process.exit(1);
  }

  console.log(`📄 Using page: ${page.url()}`);
  console.log(`📜 Scrolling (max ${maxScrolls})...\n`);

  let scrollCount = 0;
  let stuckCount = 0;
  const maxStuck = 10;
  let lastScrollHeight = 0;

  while (scrollCount < maxScrolls && stuckCount < maxStuck) {
    scrollCount++;

    // Scroll to bottom
    const scrollInfo = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return {
        scrollY: window.scrollY,
        scrollHeight: document.body.scrollHeight,
      };
    });

    process.stdout.write(
      `\rScroll ${scrollCount} | scrollY: ${scrollInfo.scrollY} | height: ${scrollInfo.scrollHeight} | stuck: ${stuckCount}`,
    );

    // Check if we got new content
    if (scrollInfo.scrollHeight === lastScrollHeight) {
      stuckCount++;
    } else {
      stuckCount = 0;
      lastScrollHeight = scrollInfo.scrollHeight;
    }

    // Wait for content to load
    await new Promise((r) => setTimeout(r, 800));
  }

  console.log("\n");
  if (stuckCount >= maxStuck) {
    console.log("✅ Reached bottom of page (no new content loading)");
  } else {
    console.log(`✅ Completed ${scrollCount} scrolls`);
  }

  // Get final scroll position info
  const finalInfo = await page.evaluate(() => ({
    scrollY: window.scrollY,
    scrollHeight: document.body.scrollHeight,
  }));
  console.log(`📍 Final position: scrollY=${finalInfo.scrollY}, totalHeight=${finalInfo.scrollHeight}`);
}

main().catch(console.error);
