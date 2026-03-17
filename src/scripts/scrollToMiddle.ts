// @ts-nocheck
import "dotenv/config";
import puppeteer from "puppeteer-core";

async function main() {
  const browser = await puppeteer.connect({ browserURL: "http://127.0.0.1:9222" });
  const pages = await browser.pages();
  const page = pages.find(p => p.url().includes("communitynotes"));

  if (!page) {
    console.log("No notewriter tab found");
    process.exit(1);
  }

  console.log("Scrolling to middle of the page...");

  // First scroll to top
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 1000));

  // Then scroll down significantly to get past the stuck area
  for (let i = 0; i < 100; i++) {
    await page.evaluate(() => window.scrollBy(0, 3000));
    await new Promise(r => setTimeout(r, 300));

    const pos = await page.evaluate(() => ({
      scrollY: window.scrollY,
      height: document.body.scrollHeight
    }));

    if (i % 10 === 0) {
      console.log(`Scroll ${i}: ${pos.scrollY}/${pos.height}`);
    }
  }

  console.log("\nDone! Now run the scraper without --fresh to continue from here");
}

main().catch(console.error);
