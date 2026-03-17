/**
 * Scrolls to a specific position on the notewriter page, then runs the scraper
 * Usage: bun run src/scripts/scrollAndScrape.ts [scrollPercent] [maxNotes]
 *
 * Example: bun run src/scripts/scrollAndScrape.ts 50 200  # Start from 50% down, scrape 200 notes
 */
import "dotenv/config";
import puppeteer from "puppeteer-core";
import { spawn } from "child_process";

async function main() {
  const scrollPercent = parseInt(process.argv[2] || "0", 10);
  const maxNotes = process.argv[3] || "500";

  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222" });
  const pages = await browser.pages();
  const page = pages.find((p) => p.url().includes("communitynotes"));

  if (!page) {
    console.log("No notewriter tab found");
    process.exit(1);
  }

  // Scroll to top first
  console.log("Scrolling to top...");
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 2000));

  // Load more content by scrolling to bottom first
  console.log("Loading full page content...");
  let lastHeight = 0;
  let stuck = 0;
  while (stuck < 5) {
    await page.evaluate(() => window.scrollBy(0, 5000));
    await new Promise((r) => setTimeout(r, 500));
    const height = await page.evaluate(() => document.body.scrollHeight);
    if (height === lastHeight) stuck++;
    else {
      stuck = 0;
      lastHeight = height;
    }
  }

  // Now scroll to the target percentage
  const totalHeight = await page.evaluate(() => document.body.scrollHeight);
  const targetScroll = Math.floor((totalHeight * scrollPercent) / 100);

  console.log(`Page height: ${totalHeight}, scrolling to ${scrollPercent}% = ${targetScroll}px`);
  await page.evaluate((y) => window.scrollTo(0, y), targetScroll);
  await new Promise((r) => setTimeout(r, 2000));

  const finalPos = await page.evaluate(() => window.scrollY);
  console.log(`Final scroll position: ${finalPos}px`);

  console.log(`\nStarting scraper from this position (max ${maxNotes} notes)...`);

  // Disconnect from browser (scraper will reconnect)
  browser.disconnect();

  // Run the scraper without --fresh
  const scraper = spawn("bun", ["run", "src/scripts/scrapeNotewriterClickThrough.ts", maxNotes], {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, PATH: process.env.PATH + ":/Users/natha/.bun/bin" },
  });

  scraper.on("close", (code) => {
    console.log(`Scraper exited with code ${code}`);
  });
}

main().catch(console.error);
