/**
 * Deep Notewriter Scraper using Puppeteer
 *
 * Unlike the basic scraper, this one:
 * - Scrolls through the list manually with Page Down
 * - Clicks "View details" on each note to get the full note ID
 * - Extracts creation time from the detail page
 *
 * USAGE:
 * 1. Start Chrome with remote debugging:
 *    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile
 *
 * 2. Log into X/Twitter in that Chrome window
 *
 * 3. Navigate to your notewriter page manually first
 *
 * 4. Run this script:
 *    bun run src/scripts/scrapeNotewriterDeep.ts [username]
 */

import puppeteer, { Page } from "puppeteer-core";
import { SupabaseLogger } from "../api/supabaseClient";

// Default notewriter username
const DEFAULT_USERNAME = "wholesome-raspberry-stilt";
const MAX_NOTES = parseInt(process.env.MAX_NOTES || "20"); // Limit for testing

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
  created_at?: string;
}

// Extract basic info from a cell without clicking
async function extractCellBasicInfo(page: Page, cellIndex: number): Promise<{
  tweetId: string | null;
  noteId: string | null;
  detailsLinkHref: string | null;
  status: string;
  noteText: string;
  viewCount: number | null;
  allLinksDebug: { text: string | undefined; href: string }[];
}> {
  return page.evaluate((idx) => {
    const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    const cell = cells[idx];
    if (!cell) return { tweetId: null, noteId: null, detailsLinkHref: null, status: 'UNKNOWN', noteText: '', viewCount: null };

    const text = cell.innerText;

    // Find tweet link
    const tweetLink = cell.querySelector('a[href*="/status/"]') as HTMLAnchorElement;
    const tweetId = tweetLink?.href.match(/status\/(\d+)/)?.[1] || null;

    // Find details link - try multiple selectors
    // First try the /communitynotes/t/ pattern
    let detailsLink = cell.querySelector('a[href*="/communitynotes/t/"]') as HTMLAnchorElement;

    // If not found, look for any link with "View details" text or similar
    if (!detailsLink) {
      const allLinks = cell.querySelectorAll('a');
      for (const link of allLinks) {
        const text = link.textContent?.toLowerCase() || '';
        if (text.includes('view') || text.includes('detail')) {
          detailsLink = link as HTMLAnchorElement;
          break;
        }
      }
    }

    // Also try looking for links to /communitynotes/n/ or other patterns
    if (!detailsLink) {
      detailsLink = cell.querySelector('a[href*="/communitynotes/n/"]') as HTMLAnchorElement;
    }

    const noteId = detailsLink?.href.match(/\/[tn]\/(\d+)/)?.[1] || null;
    const detailsLinkHref = detailsLink?.href || null;

    // Debug: collect all links for logging
    const allLinksDebug = [...cell.querySelectorAll('a')].map(a => ({
      text: a.textContent?.trim().slice(0, 30),
      href: a.href
    }));

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

    return { tweetId, noteId, detailsLinkHref, status, noteText, viewCount, allLinksDebug };
  }, cellIndex);
}

// Click on a details link and extract note ID and creation time
async function extractNoteDetails(page: Page, detailsUrl: string): Promise<{
  noteId: string | null;
  createdAt: string | null;
}> {
  // Navigate to details page
  await page.goto(detailsUrl, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 2000));

  // Extract note ID from URL and any timestamp info
  const result = await page.evaluate(() => {
    const url = window.location.href;
    const noteId = url.match(/\/t\/(\d+)/)?.[1] || null;

    // Look for timestamp - usually in a time element or specific text
    const timeEl = document.querySelector('time');
    const createdAt = timeEl?.getAttribute('datetime') || null;

    // Also look for "Written on" text
    const bodyText = document.body.innerText;
    const writtenMatch = bodyText.match(/Written on ([A-Za-z]+ \d+, \d{4})/);

    return {
      noteId,
      createdAt: createdAt || (writtenMatch ? writtenMatch[1] : null)
    };
  });

  return result;
}

async function main() {
  const username = process.argv[2] || DEFAULT_USERNAME;
  const notewriterUrl = `https://x.com/i/communitynotes/u/${username}`;

  console.log("🔌 Connecting to Chrome on port 9222...\n");

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: "http://127.0.0.1:9222",
    });
  } catch (err) {
    console.error("❌ Failed to connect to Chrome.");
    console.error("Error:", err);
    console.error("");
    console.error("Make sure Chrome is running with remote debugging enabled:");
    console.error("");
    console.error('  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile');
    console.error("");
    console.error("Then log into X/Twitter in that browser window.");
    process.exit(1);
  }

  console.log("✅ Connected to Chrome\n");

  // Get all pages and find or create the notewriter page
  const pages = await browser.pages();
  let page = pages.find((p) => p.url().includes("communitynotes"));

  if (!page) {
    console.log(`📄 Opening new tab: ${notewriterUrl}`);
    page = await browser.newPage();
    await page.goto(notewriterUrl, { waitUntil: "networkidle2" });
  } else {
    console.log(`📄 Found existing notewriter tab: ${page.url()}`);
    // Navigate to list page if on a detail page
    if (page.url().includes("/t/")) {
      console.log(`   Navigating back to list: ${notewriterUrl}`);
      await page.goto(notewriterUrl, { waitUntil: "networkidle2" });
    }
  }

  // Wait for page to load
  console.log("   Waiting for page to load...");
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const hasContent = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Needs more ratings') ||
             text.includes('Currently rated helpful') ||
             text.includes('Writing Impact');
    });
    if (hasContent) {
      console.log(`   Content detected after ${i + 1} seconds`);
      break;
    }
    process.stdout.write(`\r   Waiting... ${i + 1}s`);
  }
  console.log();

  console.log("✅ Page loaded\n");
  console.log("🚀 Starting deep scrape (clicking through each note)...\n");

  const notes = new Map<string, ScrapedNote>();
  const seenTweetIds = new Set<string>();
  let scrollAttempts = 0;
  const maxScrollAttempts = 100; // Limit total scrolls
  let lastNoteCount = 0;
  let stuckCount = 0;
  const maxStuck = 15;

  console.log(`   (Limited to ${MAX_NOTES} notes for testing)\n`);

  while (scrollAttempts < maxScrollAttempts && stuckCount < maxStuck && notes.size < MAX_NOTES) {
    scrollAttempts++;

    // Get current cells count
    const cellCount = await page.evaluate(() =>
      document.querySelectorAll('[data-testid="cellInnerDiv"]').length
    );

    console.log(`\n📜 Scroll ${scrollAttempts}: Found ${cellCount} cells visible`);

    // Process each visible cell
    for (let i = 0; i < cellCount; i++) {
      const basicInfo = await extractCellBasicInfo(page, i);

      if (!basicInfo.tweetId) continue;
      if (seenTweetIds.has(basicInfo.tweetId)) continue;

      seenTweetIds.add(basicInfo.tweetId);

      let noteId = basicInfo.noteId;
      let createdAt: string | null = null;

      // Log all links found in this cell
      console.log(`   🔗 Links in cell: ${JSON.stringify(basicInfo.allLinksDebug.slice(0, 5))}`);

      // Click "View details" to get the timestamp (and note_id if missing)
      if (basicInfo.detailsLinkHref) {
        console.log(`   🔍 Navigating to details: ${basicInfo.detailsLinkHref}`);
        try {
          // Navigate directly to the details page using the href we already extracted
          await page.goto(basicInfo.detailsLinkHref, { waitUntil: "networkidle2", timeout: 30000 });
          await new Promise((r) => setTimeout(r, 2000));

          // Extract note_id and timestamp from detail page
          const details = await page.evaluate(() => {
            const url = window.location.href;
            const noteId = url.match(/\/t\/(\d+)/)?.[1] || null;

            // Look for timestamp
            const timeEl = document.querySelector('time');
            let createdAt = timeEl?.getAttribute('datetime') || null;

            // Also look for "Written on" text as fallback
            if (!createdAt) {
              const bodyText = document.body.innerText;
              const writtenMatch = bodyText.match(/Written on ([A-Za-z]+ \d+, \d{4})/);
              if (writtenMatch) createdAt = writtenMatch[1];
            }

            return { noteId, createdAt };
          });

          noteId = details.noteId || noteId;
          createdAt = details.createdAt;
          console.log(`      Got note_id: ${noteId}, created: ${createdAt || 'unknown'}`);

          // Navigate back to list
          await page.goto(notewriterUrl, { waitUntil: "networkidle2" });
          await new Promise((r) => setTimeout(r, 2000));
        } catch (err) {
          console.log(`   ⚠️ Failed to get details: ${err}`);
        }
      } else {
        console.log(`   ⚠️ No <a> details link - searching for clickable element...`);

        // The "View details" text isn't in an <a> tag - look for buttons or role elements
        try {
          // First, find what element contains "View details"
          const elementInfo = await page.evaluate((idx) => {
            const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
            const cell = cells[idx] as HTMLElement;
            if (!cell) return { found: false };

            // Find the exact element containing "View details"
            const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const text = walker.currentNode.textContent?.trim().toLowerCase() || '';
              if (text === 'view details') {
                const parent = walker.currentNode.parentElement;
                // Walk up to find clickable ancestor
                let clickable = parent;
                while (clickable && clickable !== cell) {
                  const role = clickable.getAttribute('role');
                  const tag = clickable.tagName.toLowerCase();
                  if (tag === 'button' || tag === 'a' || role === 'button' || role === 'link') {
                    return {
                      found: true,
                      tag: clickable.tagName,
                      role,
                      classes: clickable.className?.slice(0, 100),
                      testId: clickable.getAttribute('data-testid')
                    };
                  }
                  clickable = clickable.parentElement;
                }
                // Return parent info even if no role
                return {
                  found: true,
                  tag: parent?.tagName,
                  classes: parent?.className?.slice(0, 100),
                  parentTag: parent?.parentElement?.tagName,
                  parentClasses: parent?.parentElement?.className?.slice(0, 100)
                };
              }
            }
            return { found: false };
          }, i);

          console.log(`      Element containing "View details": ${JSON.stringify(elementInfo)}`);

          // Scroll the cell into view first, then get button position
          const buttonPosition = await page.evaluate((idx) => {
            const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
            const cell = cells[idx] as HTMLElement;
            if (!cell) return null;

            // Scroll cell into view first
            cell.scrollIntoView({ behavior: 'instant', block: 'center' });

            // Find text node with "View details" and get button position
            const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const text = walker.currentNode.textContent?.trim().toLowerCase() || '';
              if (text === 'view details') {
                let el = walker.currentNode.parentElement;
                while (el && el !== cell) {
                  const role = el.getAttribute('role');
                  if (role === 'button' || role === 'link' || el.tagName === 'BUTTON') {
                    const rect = el.getBoundingClientRect();
                    return {
                      x: rect.x + rect.width / 2,
                      y: rect.y + rect.height / 2,
                      found: true
                    };
                  }
                  el = el.parentElement;
                }
              }
            }
            return null;
          }, i);

          // Small wait after scroll
          await new Promise((r) => setTimeout(r, 300));

          let clicked = { clicked: false, via: 'none' };
          if (buttonPosition) {
            // Use Puppeteer's native click at the button coordinates
            await page.mouse.click(buttonPosition.x, buttonPosition.y);
            clicked = { clicked: true, via: 'puppeteer mouse click' };
          }

          console.log(`      Click attempt result: ${JSON.stringify(clicked)}`);

          if (clicked.clicked) {
            // Wait for navigation or content change
            await new Promise((r) => setTimeout(r, 3000));

            const currentUrl = page.url();
            console.log(`      URL after click: ${currentUrl}`);

            // Check if "Note Details" panel opened (it's an overlay, URL may not change)
            const pageContent = await page.evaluate(() => {
              const url = window.location.href;
              const bodyText = document.body.innerText;

              // Check if "Note Details" panel is showing
              const hasNoteDetails = bodyText.includes('Note Details');

              // Look for "Note ID" text pattern at bottom of panel: "Note ID 2013251746458739096"
              let noteId: string | null = null;
              const noteIdMatch = bodyText.match(/Note ID\s+(\d{16,20})/);
              if (noteIdMatch) {
                noteId = noteIdMatch[1];
              }

              // Fallback: check URL
              if (!noteId) {
                noteId = url.match(/\/t\/(\d+)/)?.[1] || null;
              }

              // Look for time element
              const timeEl = document.querySelector('time');
              const timestamp = timeEl?.getAttribute('datetime') || null;

              // Try to find "Note submitted" date: "Note submitted 2:06 PM · Jan 19, 2026"
              const submittedMatch = bodyText.match(/Note submitted[^·]*·\s*([A-Za-z]+ \d+,?\s*\d{4})/);
              const submittedDate = submittedMatch ? submittedMatch[1] : null;

              // Fallback: "Written on" pattern
              const writtenMatch = bodyText.match(/Written on ([A-Za-z]+ \d+, \d{4})/);
              const writtenDate = submittedDate || (writtenMatch ? writtenMatch[1] : null);

              // Get a snippet of unique content
              const uniqueText = bodyText.slice(0, 800);

              return { url, hasNoteDetails, noteId, timestamp, writtenDate, uniqueText };
            });

            console.log(`      Page check - Note Details: ${pageContent.hasNoteDetails}, noteId: ${pageContent.noteId}, time: ${pageContent.timestamp}, writtenDate: ${pageContent.writtenDate}`);

            if (pageContent.hasNoteDetails) {
              // We opened the detail panel!
              if (pageContent.noteId) {
                noteId = pageContent.noteId;
              }
              createdAt = pageContent.timestamp || pageContent.writtenDate;
              console.log(`      ✅ Got note details: noteId=${noteId}, created=${createdAt}`);

              // Close the panel by pressing Escape
              await page.keyboard.press('Escape');
              await new Promise((r) => setTimeout(r, 1000));
            } else {
              console.log(`      ⚠️ Note Details panel didn't open`);
              console.log(`      Page snippet: ${pageContent.uniqueText.slice(0, 300)}...`);
            }
          }
        } catch (err) {
          console.log(`   ⚠️ Manual click failed: ${err}`);
        }
      }

      // Use tweet_id as fallback for note_id
      const finalNoteId = noteId || `tweet_${basicInfo.tweetId}`;

      const note: ScrapedNote = {
        note_id: finalNoteId,
        tweet_id: basicInfo.tweetId,
        tweet_url: `https://x.com/i/web/status/${basicInfo.tweetId}`,
        note_text: basicInfo.noteText,
        cn_status: basicInfo.status,
        view_count: basicInfo.viewCount,
        created_at: createdAt || undefined,
      };

      notes.set(finalNoteId, note);
      console.log(`   ✓ ${notes.size}: ${finalNoteId.substring(0, 20)}... (${basicInfo.status})`);
    }

    // Check if we're making progress
    if (notes.size === lastNoteCount) {
      stuckCount++;
      console.log(`   ⏳ No new notes (stuck: ${stuckCount}/${maxStuck})`);
    } else {
      stuckCount = 0;
    }
    lastNoteCount = notes.size;

    // Scroll down using Page Down key
    await page.keyboard.press('PageDown');
    await new Promise((r) => setTimeout(r, 1500));

    // Also try scrolling the last cell into view
    await page.evaluate(() => {
      const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      if (cells.length > 0) {
        cells[cells.length - 1].scrollIntoView({ behavior: 'smooth', block: 'end' });
      }
    });
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log("\n\n✅ Scraping complete!\n");
  console.log(`📦 Collected ${notes.size} notes\n`);

  // Import to Supabase
  console.log("💾 Importing to Supabase...\n");

  const supabase = new SupabaseLogger();

  let newNotes = 0;
  let updatedNotes = 0;
  let existingNotes = 0;
  let snapshotsCreated = 0;
  let errorCount = 0;

  const noteArray = [...notes.values()];
  for (const [idx, note] of noteArray.entries()) {
    const progress = `[${idx + 1}/${noteArray.length}]`;

    try {
      // First check if this exact note_id exists
      const exists = await supabase.scrapedNotewriterNoteExists(note.note_id);

      if (!exists) {
        // Check if there's an existing note with same tweet_id (might have placeholder ID)
        const existingNoteId = await supabase.findScrapedNoteByTweetId(note.tweet_id);

        if (existingNoteId && existingNoteId !== note.note_id) {
          // Found existing note with different ID (probably tweet_XXXX placeholder)
          // Update to real note_id
          await supabase.updateScrapedNoteId(existingNoteId, note.note_id);
          updatedNotes++;
          console.log(`${progress} ✓ UPDATED: ${existingNoteId.substring(0, 15)}... → ${note.note_id.substring(0, 15)}...`);
        } else if (!existingNoteId) {
          // Truly new note
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
  console.log(`   • Updated IDs:       ${updatedNotes}`);
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
