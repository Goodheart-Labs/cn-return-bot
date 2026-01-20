/**
 * Notewriter Scraper with Better Scrolling
 *
 * Uses Puppeteer to handle scrolling via keyboard (Page Down)
 * which works better with X's virtualized list than scrollIntoView.
 *
 * USAGE:
 * 1. Start Chrome with remote debugging:
 *    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile
 *
 * 2. Log into X/Twitter and navigate to:
 *    https://x.com/i/communitynotes/u/wholesome-raspberry-stilt
 *
 * 3. Run this script:
 *    bun run src/scripts/scrapeNotewriterScroll.ts
 */

import "dotenv/config";
import puppeteer, { Page } from "puppeteer-core";
import { writeFileSync } from "fs";
import { SupabaseLogger } from "../api/supabaseClient";

const DEFAULT_USERNAME = "wholesome-raspberry-stilt";

interface ScrapedNote {
  note_id: string;
  tweet_id: string;
  tweet_url?: string;
  note_text?: string;
  cn_status?: string;
  view_count?: number | null;
  helpful_count?: number | null;
  not_helpful_count?: number | null;
  source_url?: string | null;
}

// Extract all notes from currently visible cells
function extractVisibleNotes(): ScrapedNote[] {
  const notes: ScrapedNote[] = [];
  const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');

  cells.forEach((cell) => {
    try {
      const text = (cell as HTMLElement).innerText;

      // Find tweet link
      const tweetLink = cell.querySelector('a[href*="/status/"]') as HTMLAnchorElement;
      let tweetId: string | null = null;
      let tweetUrl: string | null = null;

      if (tweetLink) {
        tweetUrl = tweetLink.href;
        tweetId = tweetUrl.match(/status\/(\d+)/)?.[1] || null;
      }

      // Fallback: look for IDs in data attributes
      if (!tweetId) {
        const allElements = [...cell.querySelectorAll('*')];
        for (const el of allElements) {
          for (const attr of el.attributes) {
            const match = attr.value?.match(/(\d{18,20})/);
            if (match) {
              tweetId = match[1];
              tweetUrl = `https://x.com/i/web/status/${tweetId}`;
              break;
            }
          }
          if (tweetId) break;
        }
      }

      if (!tweetId) return;

      // Find note ID from details link
      const detailsLink = cell.querySelector('a[href*="/communitynotes/t/"]') as HTMLAnchorElement;
      const noteId = detailsLink?.href.match(/\/t\/(\d+)/)?.[1] || '';

      // Extract status
      let status = 'UNKNOWN';
      if (text.includes('Currently rated helpful')) status = 'CURRENTLY_RATED_HELPFUL';
      else if (text.includes('Needs more ratings')) status = 'NEEDS_MORE_RATINGS';
      else if (text.includes('Currently not rated helpful')) status = 'CURRENTLY_NOT_RATED_HELPFUL';
      else if (text.match(/Shown on X[^·]*·.*views/i)) status = 'SHOWN_ON_X';
      else if (text.includes('Not shown on X')) status = 'NOT_SHOWN_ON_X';

      // Extract note text
      const paragraphs = cell.querySelectorAll('div[dir="ltr"], span[dir="ltr"]');
      let noteText = '';
      paragraphs.forEach((p) => {
        const t = (p as HTMLElement).innerText.trim();
        if (t.length > 50 &&
            !t.includes('experimental AI contributor') &&
            !t.includes('Needs more ratings') &&
            !t.includes('Currently rated') &&
            t.length > noteText.length) {
          noteText = t;
        }
      });

      // Extract view count
      let viewCount: number | null = null;
      const viewMatch = text.match(/Shown on X[^·]*·\s*([\d,.]+)([KMB]?)?\+?\s*views?/i);
      if (viewMatch) {
        let num = parseFloat(viewMatch[1].replace(/,/g, ''));
        const suffix = (viewMatch[2] || '').toUpperCase();
        if (suffix === 'K') num *= 1000;
        else if (suffix === 'M') num *= 1000000;
        else if (suffix === 'B') num *= 1000000000;
        viewCount = Math.round(num);
      }

      // Extract source URLs
      const sourceLinks = [...cell.querySelectorAll('a[href^="http"]')]
        .map((a) => (a as HTMLAnchorElement).href)
        .filter((h) => !h.includes('x.com') && !h.includes('twitter.com'));

      notes.push({
        note_id: noteId,
        tweet_id: tweetId,
        tweet_url: tweetUrl || undefined,
        note_text: noteText,
        cn_status: status,
        view_count: viewCount,
        source_url: sourceLinks[0] || null,
      });
    } catch (e) {
      console.warn('Error extracting note:', e);
    }
  });

  return notes;
}

async function main() {
  const username = process.argv[2] || DEFAULT_USERNAME;
  const notewriterUrl = `https://x.com/i/communitynotes/u/${username}`;

  console.log("🔌 Connecting to Chrome on port 9222...\n");

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: "http://127.0.0.1:9222",
      protocolTimeout: 60000, // 60 second timeout for CDP commands
    });
  } catch (err) {
    console.error("❌ Failed to connect to Chrome.");
    console.error("Make sure Chrome is running with remote debugging:");
    console.error('  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile');
    process.exit(1);
  }

  console.log("✅ Connected to Chrome\n");

  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes("communitynotes"));

  if (!page) {
    console.log(`📄 Opening new tab: ${notewriterUrl}`);
    page = await browser.newPage();
  } else {
    console.log(`📄 Found existing notewriter tab: ${page.url()}`);
  }

  // Always navigate fresh to ensure clean state
  console.log(`   Navigating fresh to ${notewriterUrl}`);
  await page.goto(notewriterUrl, { waitUntil: "networkidle2" });

  // Wait for content
  console.log("   Waiting for page to load...");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const hasContent = await page.evaluate(() =>
      document.body.innerText.includes('Needs more ratings') ||
      document.body.innerText.includes('Currently rated helpful') ||
      document.body.innerText.includes('Writing Impact')
    );
    if (hasContent) {
      console.log(`   Content detected after ${i + 1} seconds`);
      break;
    }
  }

  // Make sure we're at the top
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 1000));

  console.log("✅ Page ready (at top)\n");
  console.log("🚀 Starting scrape with keyboard scrolling...\n");

  const allNotes = new Map<string, ScrapedNote>();
  let scrollCount = 0;
  const maxScrolls = 300; // Safety limit
  let lastNoteCount = 0;
  let stuckCount = 0;
  const maxStuck = 25;

  while (scrollCount < maxScrolls && stuckCount < maxStuck) {
    scrollCount++;

    // Extract visible notes
    const visibleNotes = await page.evaluate(extractVisibleNotes);

    // Add to our collection
    for (const note of visibleNotes) {
      if (!note.tweet_id) continue;

      // Use note_id if we have it, otherwise use tweet_id
      const key = note.note_id || `tweet_${note.tweet_id}`;
      if (!allNotes.has(key)) {
        note.note_id = key;
        allNotes.set(key, note);
      }
    }

    // Log progress
    const newCount = allNotes.size - lastNoteCount;
    if (newCount > 0) {
      process.stdout.write(`\r   📊 Notes: ${allNotes.size} (+${newCount}) | Scrolls: ${scrollCount}          `);
      stuckCount = 0;
    } else {
      stuckCount++;
      process.stdout.write(`\r   📊 Notes: ${allNotes.size} (stuck ${stuckCount}/${maxStuck}) | Scrolls: ${scrollCount}   `);
    }
    lastNoteCount = allNotes.size;

    // Scroll using JavaScript inside the page (more reliable than mouse wheel)
    try {
      await page.evaluate(() => {
        // Scroll the last cell into view
        const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
        if (cells.length > 0) {
          cells[cells.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
        // Also scroll window
        window.scrollBy(0, 600);
      });
    } catch (err) {
      console.log(`\n   ⚠️ Scroll error: ${err}`);
    }
    await new Promise((r) => setTimeout(r, 2000)); // Wait longer for content to load
  }

  console.log("\n\n✅ Scraping complete!\n");
  console.log(`📦 Collected ${allNotes.size} notes\n`);

  // Save to JSON file first
  const outputFile = `scraped-notes-${new Date().toISOString().slice(0, 16).replace(/[:-]/g, '')}.json`;
  const exportData = {
    scraped_at: new Date().toISOString(),
    source_url: notewriterUrl,
    note_count: allNotes.size,
    notes: [...allNotes.values()]
  };
  writeFileSync(outputFile, JSON.stringify(exportData, null, 2));
  console.log(`💾 Saved to ${outputFile}\n`);

  // Try to import to Supabase
  console.log("💾 Importing to Supabase...\n");

  let supabase: SupabaseLogger;
  try {
    supabase = new SupabaseLogger();
  } catch (err) {
    console.log("⚠️ Supabase not configured. Run importNotewriterData.ts with the JSON file.");
    console.log(`   bun run src/scripts/importNotewriterData.ts ${outputFile}`);
    process.exit(0);
  }

  let newNotes = 0;
  let existingNotes = 0;
  let snapshotsCreated = 0;
  let errorCount = 0;

  const noteArray = [...allNotes.values()];
  for (const [idx, note] of noteArray.entries()) {
    const progress = `[${idx + 1}/${noteArray.length}]`;

    try {
      const exists = await supabase.scrapedNotewriterNoteExists(note.note_id);

      if (!exists) {
        await supabase.upsertScrapedNotewriterNote({
          note_id: note.note_id,
          tweet_id: note.tweet_id,
          note_text: note.note_text,
          source_url: note.source_url || undefined,
        });
        newNotes++;
        console.log(`${progress} ✓ NEW: ${note.note_id.substring(0, 20)}...`);
      } else {
        existingNotes++;
      }

      await supabase.insertScrapedNotewriterSnapshot({
        note_id: note.note_id,
        cn_status: note.cn_status,
        view_count: note.view_count ?? undefined,
        helpful_count: note.helpful_count ?? undefined,
        not_helpful_count: note.not_helpful_count ?? undefined,
      });
      snapshotsCreated++;
    } catch (err) {
      errorCount++;
      console.error(`${progress} ✗ ERROR: ${note.note_id}:`, err);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ Import complete!");
  console.log(`   • New notes:         ${newNotes}`);
  console.log(`   • Existing notes:    ${existingNotes}`);
  console.log(`   • Snapshots created: ${snapshotsCreated}`);
  console.log(`   • Errors:            ${errorCount}`);
  console.log("=".repeat(60));

  console.log("\n💡 Chrome browser left open. Close it manually when done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
