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

  console.log("Found notewriter tab:", page.url());

  // Scroll down significantly to find older/helpful notes
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await new Promise(r => setTimeout(r, 500));
    console.log(`Scrolled ${(i + 1) * 2000}px`);
  }

  // Get the text of all cells and look for 'Shown on X' or view counts
  const cellTexts = await page.evaluate(() => {
    const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    return [...cells].map(c => (c as HTMLElement).innerText);
  });

  console.log(`\nFound ${cellTexts.length} cells\n`);

  // Look specifically for view patterns
  let foundViews = 0;
  for (const text of cellTexts) {
    if (text.includes("views")) {
      foundViews++;
      console.log("=== CELL WITH VIEWS ===");
      console.log(text.slice(0, 500));
      console.log("\n");
    }
  }

  if (foundViews === 0) {
    console.log("No cells found with 'views' text");
    console.log("\nSample cell texts:");
    for (const text of cellTexts.slice(0, 3)) {
      console.log("---");
      console.log(text.slice(0, 400));
    }
  }

  // Look for "Shown on X" pattern
  for (const text of cellTexts) {
    if (text.includes("Shown on X")) {
      console.log("=== CELL WITH 'Shown on X' ===");
      console.log(text.slice(0, 500));
      console.log("\n");
    }
  }

  // Also check for "Currently rated helpful"
  let helpfulCount = 0;
  for (const text of cellTexts) {
    if (text.includes("Currently rated helpful")) {
      helpfulCount++;
    }
  }
  console.log(`\nCells with 'Currently rated helpful': ${helpfulCount}`);
}

main().catch(console.error);
