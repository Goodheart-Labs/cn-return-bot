/**
 * Click-Through Notewriter Scraper
 *
 * Scrolls slowly through the notewriter page, clicking "View details" for each note
 * to get accurate note IDs and statuses from the detail page.
 *
 * USAGE:
 * 1. Start Chrome with remote debugging:
 *    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile
 *
 * 2. Navigate to your notewriter page and log in
 *
 * 3. Run this script:
 *    bun run src/scripts/scrapeNotewriterClickThrough.ts [username] [maxNotes] [--fresh]
 *
 *    --fresh: Refresh page and start from top (otherwise continues from current scroll position)
 */

import "dotenv/config";
import puppeteer, { Page } from "puppeteer-core";
import { SupabaseLogger } from "../api/supabaseClient";

const DEFAULT_USERNAME = "wholesome-raspberry-stilt";

interface ScrapedNote {
  note_id: string;
  tweet_id: string;
  note_text?: string;
  cn_status: string;
  created_at?: string;
  source_url?: string;
}

async function waitForSelector(page: Page, selector: string, timeout = 5000): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout });
    return true;
  } catch {
    return false;
  }
}

async function extractNoteFromDetailPage(page: Page): Promise<{ noteId: string; createdAt: string; status: string } | null> {
  // Wait for detail page to load
  await new Promise(r => setTimeout(r, 1000));

  const url = page.url();

  // Check if we're on a note detail page
  const noteIdMatch = url.match(/\/communitynotes\/t\/(\d+)/);
  if (!noteIdMatch) {
    return null;
  }

  const noteId = noteIdMatch[1];

  // Extract created date and status from the page
  // Target the main content area, not the entire body (to avoid pollution from sidebars/lists)
  const pageData = await page.evaluate(() => {
    // Try to find the main content container
    const main = document.querySelector('main') ||
                 document.querySelector('[data-testid="primaryColumn"]') ||
                 document.querySelector('[role="main"]');

    const text = main ? (main as HTMLElement).innerText : document.body.innerText;

    // Look for status indicators - order matters!
    let status = 'UNKNOWN';
    if (text.includes('Currently not rated helpful')) {
      status = 'CURRENTLY_RATED_NOT_HELPFUL';
    } else if (text.includes('Currently rated helpful')) {
      status = 'CURRENTLY_RATED_HELPFUL';
    } else if (text.includes('Needs more ratings')) {
      status = 'NEEDS_MORE_RATINGS';
    } else if (text.match(/Shown on X/i) && !text.includes('Not shown on X')) {
      status = 'SHOWN_ON_X';
    } else if (text.includes('Not shown on X')) {
      status = 'NOT_SHOWN_ON_X';
    }

    // Look for created date (format: "Jan 21, 2026" or similar)
    const dateMatch = text.match(/(?:Created|Written)[:\s]*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i);
    const createdAt = dateMatch ? dateMatch[1] : '';

    return { status, createdAt };
  });

  return {
    noteId,
    createdAt: pageData.createdAt,
    status: pageData.status
  };
}

async function main() {
  // Parse args - support --fresh flag anywhere
  const args = process.argv.slice(2);
  const freshStart = args.includes('--fresh');
  const nonFlagArgs = args.filter(a => !a.startsWith('--'));

  const username = nonFlagArgs[0] || DEFAULT_USERNAME;
  const notewriterUrl = `https://x.com/i/communitynotes/u/${username}`;
  const maxNotes = parseInt(nonFlagArgs[1] || "500", 10);

  console.log("🔌 Connecting to Chrome on port 9222...\n");

  let browser;
  try {
    browser = await puppeteer.connect({
      browserURL: "http://127.0.0.1:9222",
      protocolTimeout: 120000,
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
    await page.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
  } else {
    console.log(`📄 Found existing notewriter tab: ${page.url()}`);
    // Navigate to correct URL if needed, or refresh if --fresh
    if (freshStart || !page.url().includes(username)) {
      console.log(`   ${freshStart ? '🔄 Fresh start - reloading' : 'Navigating to'} ${notewriterUrl}`);
      await page.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
    }
  }

  // If fresh start, scroll to top
  if (freshStart) {
    console.log("   📍 Scrolling to top of list...");
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    await new Promise(r => setTimeout(r, 1000));
  }

  // Wait for content to load
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

  console.log("\n✅ Page loaded\n");
  console.log(`🚀 Starting click-through scrape (max ${maxNotes} notes)...\n`);

  const collectedNotes = new Map<string, ScrapedNote>();
  const processedCells = new Set<string>();
  let scrollCount = 0;
  let stuckCount = 0;
  const maxStuck = 50; // Increased to handle patches of unavailable posts

  // Wrap entire scraping loop in try-catch to ensure we always get to import
  // even if Puppeteer throws a ProtocolError
  try {
  while (collectedNotes.size < maxNotes && stuckCount < maxStuck) {
    scrollCount++;

    // Get all visible cells
    const cells = await page.$$('[data-testid="cellInnerDiv"]');

    // Debug: log scroll position and cell fingerprints
    const debugInfo = await page.evaluate(() => {
      const scrollY = window.scrollY;
      const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      const fingerprints = [...cells].map(c => (c as HTMLElement).innerText.slice(0, 50).replace(/\n/g, ' '));
      return { scrollY, fingerprints };
    });
    console.log(`\n📜 Scroll ${scrollCount}: Found ${cells.length} cells at scrollY=${debugInfo.scrollY}`);
    console.log(`   Fingerprints: ${debugInfo.fingerprints.map(f => f.slice(0, 30) + '...').join(' | ')}`);

    let foundNewNote = false;

    for (const cell of cells) {
      // Generate a fingerprint for this cell to avoid reprocessing
      // For "Post unavailable" cells, we can't use text alone - they're identical
      // Instead, use the View details link href which contains the unique note ID
      const cellFingerprint = await cell.evaluate(el => {
        const text = el.innerText.slice(0, 100);
        // Look for the View details link which has the note ID
        const detailsLink = el.querySelector('a[href*="/communitynotes/t/"]') as HTMLAnchorElement;
        if (detailsLink) {
          // Use the note ID from the link for uniqueness
          return detailsLink.href;
        }
        // Fallback to text for cells with visible tweet content
        return text;
      });

      if (processedCells.has(cellFingerprint)) {
        continue;
      }
      processedCells.add(cellFingerprint);

      // Try to find tweet ID from the cell (may be null for "Post unavailable")
      const tweetData = await cell.evaluate(el => {
        const tweetLink = el.querySelector('a[href*="/status/"]') as HTMLAnchorElement;
        if (tweetLink) {
          const match = tweetLink.href.match(/status\/(\d+)/);
          return { tweetId: match?.[1] || null, tweetUrl: tweetLink.href };
        }

        // Fallback: look for IDs in data attributes
        const allElements = [...el.querySelectorAll('*')];
        for (const elem of allElements) {
          for (const attr of elem.attributes) {
            const match = attr.value?.match(/(\d{18,20})/);
            if (match) {
              return { tweetId: match[1], tweetUrl: `https://x.com/i/web/status/${match[1]}` };
            }
          }
        }
        return { tweetId: null, tweetUrl: null };
      });

      // Skip if we already have this tweet (only if we have a tweet ID to compare)
      if (tweetData.tweetId && [...collectedNotes.values()].some(n => n.tweet_id === tweetData.tweetId)) {
        continue;
      }

      // Extract note text and source URL from cell
      const cellData = await cell.evaluate(el => {
        const text = el.innerText;

        // Extract note text - longest text block that's not boilerplate
        const paragraphs = el.querySelectorAll('div[dir="ltr"], span[dir="ltr"]');
        let noteText = '';
        paragraphs.forEach(p => {
          const t = (p as HTMLElement).innerText.trim();
          if (t.length > 50 &&
              !t.includes('experimental AI contributor') &&
              !t.includes('Needs more ratings') &&
              !t.includes('Currently rated') &&
              t.length > noteText.length) {
            noteText = t;
          }
        });

        // Extract source URLs
        const sourceLinks = [...el.querySelectorAll('a[href^="http"]')]
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => !h.includes('x.com') && !h.includes('twitter.com'));

        return { noteText, sourceUrl: sourceLinks[0] || null };
      });

      // Scroll cell into view first and wait for content to render
      await cell.evaluate(el => {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      });
      await new Promise(r => setTimeout(r, 500)); // Increased wait for render

      // Find and click the "View details" element
      // First, try to find a direct link to /communitynotes/t/
      const clickResult = await cell.evaluate(el => {
        // Best case: find an <a> link that goes to /communitynotes/t/
        const noteLink = el.querySelector('a[href*="/communitynotes/t/"]') as HTMLAnchorElement;
        if (noteLink) {
          const rect = noteLink.getBoundingClientRect();
          return {
            found: true,
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            tag: 'A (direct link)',
            href: noteLink.href,
          };
        }

        // Next: look for a button/span with "View details" that's a DIRECT child of this cell
        // (not from some random other part of the page)
        const buttons = el.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          if (btn.textContent?.includes('View details')) {
            const rect = btn.getBoundingClientRect();
            return {
              found: true,
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              tag: btn.tagName,
              href: '',
            };
          }
        }

        // Last resort: find span with "View details" that's specifically in this cell
        const spans = el.querySelectorAll('span');
        for (const span of spans) {
          if (span.textContent === 'View details') {
            const rect = span.getBoundingClientRect();
            return {
              found: true,
              x: rect.x + rect.width / 2,
              y: rect.y + rect.height / 2,
              tag: 'SPAN (exact match)',
              href: '',
            };
          }
        }

        return { found: false, x: 0, y: 0, tag: '', href: '' };
      });

      if (!clickResult.found) {
        // No View details = unavailable post, just skip silently
        continue;
      }

      // Sanity check - coordinates should be on screen and not at origin
      if (clickResult.x === 0 && clickResult.y === 0) {
        // Button not rendered properly, skip silently
        continue;
      }

      if (clickResult.y < 0 || clickResult.y > 2000) {
        console.log(`   ⚠️ View details off-screen (y=${clickResult.y}) for tweet ${tweetData.tweetId}`);
        continue;
      }

      console.log(`   🖱️ Clicking View details at (${clickResult.x.toFixed(0)}, ${clickResult.y.toFixed(0)}) [${clickResult.tag}]`);

      // Use page.mouse.click for a real mouse click, with timeout protection
      try {
        await Promise.race([
          page.mouse.click(clickResult.x, clickResult.y),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 10000))
        ]);
      } catch (clickErr) {
        console.log(`   ⚠️ Click error (skipping): ${clickErr}`);
        continue;
      }

      // Wait for modal panel to appear (increased from 1000ms for reliability)
      await new Promise(r => setTimeout(r, 1500));

      // Check if modal panel opened by looking for "Note Details" heading or Note ID
      // IMPORTANT: Only look at the modal content, not the entire page body
      // (background list may have notes with different statuses that pollute detection)
      const modalData = await page.evaluate(() => {
        // Find the modal element - X uses various dialog selectors
        const modal = document.querySelector('[data-testid="sheetDialog"]') ||
                      document.querySelector('[role="dialog"]') ||
                      document.querySelector('[aria-modal="true"]') ||
                      document.querySelector('[data-testid="Drawer"]');

        // If no modal found, try to find content near "Note Details" heading
        let modalText = '';
        let usedFallback = false;
        if (modal) {
          modalText = (modal as HTMLElement).innerText;
        } else {
          // Fallback: look for a section containing "Note Details" or "Note ID"
          // Sort by text length to find the smallest container that has what we need
          const candidates: { el: HTMLElement; len: number }[] = [];
          const allElements = document.querySelectorAll('div, section, aside');
          for (const el of allElements) {
            const text = (el as HTMLElement).innerText;
            if (text.includes('Note Details') || text.includes('Note ID')) {
              // Found a container with note details
              if (text.length > 100 && text.length < 10000) {
                candidates.push({ el: el as HTMLElement, len: text.length });
              }
            }
          }
          // Pick the smallest matching container (most targeted)
          if (candidates.length > 0) {
            candidates.sort((a, b) => a.len - b.len);
            modalText = candidates[0].el.innerText;
          }
        }

        // If still no modal text, check if Note Details is visible at all
        if (!modalText) {
          const bodyText = document.body.innerText;
          if (!bodyText.includes('Note Details') && !bodyText.includes('Note ID')) {
            return null;
          }
          // Last resort: use body text but extract status more carefully
          // Look for the status line that appears right after the Note ID
          modalText = bodyText;
          usedFallback = true;
        }

        // Extract Note ID from the modal
        const noteIdMatch = modalText.match(/Note ID[:\s]*(\d{18,20})/i);
        const noteId = noteIdMatch ? noteIdMatch[1] : null;

        // Extract status - order matters! Check most specific first
        let status = 'UNKNOWN';

        if (usedFallback && noteId) {
          // When using body text fallback, we need to be more careful
          // Find the text around the Note ID and look for status there
          const noteIdPos = modalText.indexOf('Note ID');
          if (noteIdPos !== -1) {
            // Look at text after the Note ID (where status should be in the modal)
            const textAfterNoteId = modalText.substring(noteIdPos, noteIdPos + 500);

            if (textAfterNoteId.includes('Currently not rated helpful')) {
              status = 'CURRENTLY_RATED_NOT_HELPFUL';
            } else if (textAfterNoteId.includes('Currently rated helpful')) {
              status = 'CURRENTLY_RATED_HELPFUL';
            } else if (textAfterNoteId.includes('Needs more ratings')) {
              status = 'NEEDS_MORE_RATINGS';
            } else if (textAfterNoteId.match(/Shown on X/i) && !textAfterNoteId.includes('Not shown on X')) {
              status = 'SHOWN_ON_X';
            } else if (textAfterNoteId.includes('Not shown on X')) {
              status = 'NOT_SHOWN_ON_X';
            }
          }
        } else {
          // Normal modal detection - "Currently not rated helpful" must be checked before "Currently rated helpful"
          if (modalText.includes('Currently not rated helpful')) {
            status = 'CURRENTLY_RATED_NOT_HELPFUL';
          } else if (modalText.includes('Currently rated helpful')) {
            status = 'CURRENTLY_RATED_HELPFUL';
          } else if (modalText.includes('Needs more ratings')) {
            status = 'NEEDS_MORE_RATINGS';
          } else if (modalText.match(/Shown on X/i) && !modalText.includes('Not shown on X')) {
            status = 'SHOWN_ON_X';
          } else if (modalText.includes('Not shown on X')) {
            status = 'NOT_SHOWN_ON_X';
          }
        }

        // Extract submitted date
        const dateMatch = modalText.match(/Note submitted[:\s]*([\d:]+\s*(?:AM|PM)?)\s*[·•]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i);
        const submittedDate = dateMatch ? dateMatch[2] : '';

        return { noteId, status, submittedDate, usedFallback };
      });

      if (!modalData || !modalData.noteId) {
        console.log(`   ⚠️ Modal didn't open or couldn't extract Note ID for tweet ${tweetData.tweetId || 'unavailable'}`);
        // Try pressing Escape to close any partial modal
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 300));
        continue;
      }

      // Skip if we already have this note
      if (collectedNotes.has(modalData.noteId)) {
        // Close modal and continue
        await page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 300));
        continue;
      }

      console.log(`   ✓ Found Note ID: ${modalData.noteId} (${modalData.status})${!tweetData.tweetId ? ' [Post unavailable]' : ''}`);

      // Store the note - use note_id as fallback tweet_id for unavailable posts
      const note: ScrapedNote = {
        note_id: modalData.noteId,
        tweet_id: tweetData.tweetId || `unavailable_${modalData.noteId}`,
        note_text: cellData.noteText,
        cn_status: modalData.status,
        created_at: modalData.submittedDate,
        source_url: cellData.sourceUrl || undefined,
      };

      collectedNotes.set(modalData.noteId, note);
      foundNewNote = true;
      console.log(`   ✓ ${collectedNotes.size}: ${modalData.noteId} (${modalData.status})`);

      // Close the modal by clicking the X button
      const closed = await page.evaluate(() => {
        // Look for close button with X
        const closeSelectors = [
          '[aria-label="Close"]',
          '[data-testid="xMigrationBottomBar"] button',
          'div[role="dialog"] button',
        ];

        // First try aria-label close
        for (const selector of closeSelectors) {
          const btn = document.querySelector(selector) as HTMLElement;
          if (btn) {
            btn.click();
            return true;
          }
        }

        // Look for any button near "Note Details" that might be the X
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const rect = btn.getBoundingClientRect();
          // X button is usually in top-left of modal, small size
          if (rect.width < 50 && rect.height < 50) {
            const text = btn.textContent?.trim() || '';
            const ariaLabel = btn.getAttribute('aria-label') || '';
            if (text === '' || text === '×' || text === 'X' || ariaLabel.toLowerCase().includes('close')) {
              btn.click();
              return true;
            }
          }
        }

        return false;
      });

      if (!closed) {
        // Fallback: press Escape
        await page.keyboard.press('Escape');
      }

      await new Promise(r => setTimeout(r, 500));
    }

    if (!foundNewNote) {
      stuckCount++;
      console.log(`   ⏳ No new notes (stuck: ${stuckCount}/${maxStuck})`);
    } else {
      stuckCount = 0;
    }

    // Try multiple scroll methods in order of preference
    // 1. JavaScript scroll on the body/document (works for some pages)
    // 2. Mouse wheel (works for virtualized lists)
    // 3. Keyboard PageDown (fallback)
    let scrollSucceeded = false;

    // First try JavaScript scroll
    try {
      const scrolled = await page.evaluate(() => {
        // Try scrolling window directly
        const beforeY = window.scrollY;
        window.scrollBy(0, 600);
        if (window.scrollY !== beforeY) return true;

        // Try scrolling document element
        const docBefore = document.documentElement.scrollTop;
        document.documentElement.scrollTop += 600;
        if (document.documentElement.scrollTop !== docBefore) return true;

        // Try scrolling body
        const bodyBefore = document.body.scrollTop;
        document.body.scrollTop += 600;
        if (document.body.scrollTop !== bodyBefore) return true;

        // Try finding a scrollable container
        const containers = document.querySelectorAll('[style*="overflow"]');
        for (const c of containers) {
          const el = c as HTMLElement;
          const before = el.scrollTop;
          el.scrollTop += 600;
          if (el.scrollTop !== before) return true;
        }

        return false;
      });
      scrollSucceeded = scrolled;
    } catch {
      // JS scroll failed
    }

    // If JS didn't work, try mouse wheel with timeout
    // Note: Puppeteer's wheel() can throw ProtocolError on timeout even with Promise.race
    // so we need a broader try-catch to prevent crashes
    if (!scrollSucceeded) {
      try {
        await Promise.race([
          (async () => {
            await page.mouse.move(500, 400);
            await page.mouse.wheel({ deltaY: 800 });
          })(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Scroll timeout')), 5000))
        ]);
        scrollSucceeded = true;
      } catch (scrollErr: unknown) {
        // Log but don't crash - includes ProtocolError timeouts from Puppeteer internals
        const errMsg = scrollErr instanceof Error ? scrollErr.message : String(scrollErr);
        console.log(`   ⚠️ Scroll error: ${errMsg.slice(0, 60)}`);
      }
    }

    // Final fallback: keyboard
    if (!scrollSucceeded) {
      try {
        await page.keyboard.press('PageDown');
        await page.keyboard.press('PageDown');
        await page.keyboard.press('PageDown');
      } catch {
        console.log(`   ⚠️ All scroll methods failed`);
      }
    }

    await new Promise(r => setTimeout(r, 1500));
  }
  } catch (loopErr: unknown) {
    // Catch any Puppeteer errors (ProtocolError, etc.) so we can still import collected notes
    const errMsg = loopErr instanceof Error ? loopErr.message : String(loopErr);
    console.log(`\n⚠️ Scraping interrupted by error: ${errMsg.slice(0, 100)}`);
    console.log(`   Proceeding to import ${collectedNotes.size} notes collected so far...`);
  }

  console.log(`\n✅ Scraping complete! Collected ${collectedNotes.size} notes\n`);

  if (collectedNotes.size === 0) {
    console.log("No notes collected.");
    process.exit(0);
  }

  // Import to Supabase
  console.log("💾 Importing to Supabase...\n");

  const supabase = new SupabaseLogger();

  let newNotes = 0;
  let updatedIds = 0;
  let existingNotes = 0;
  let snapshotsCreated = 0;
  let errorCount = 0;

  const noteArray = [...collectedNotes.values()];
  for (const [idx, note] of noteArray.entries()) {
    const progress = `[${idx + 1}/${noteArray.length}]`;

    try {
      // Check if note exists
      const exists = await supabase.scrapedNotewriterNoteExists(note.note_id);
      console.log(`   DEBUG: note_id=${note.note_id}, exists=${exists}`);

      // Also check if there's a placeholder entry for this tweet (only if we have a real tweet_id)
      let placeholderExists = false;
      const placeholderId = note.tweet_id.startsWith('unavailable_') ? null : `tweet_${note.tweet_id}`;
      if (placeholderId) {
        placeholderExists = await supabase.scrapedNotewriterNoteExists(placeholderId);
        console.log(`   DEBUG: placeholderId=${placeholderId}, placeholderExists=${placeholderExists}`);
      }

      if (placeholderExists && placeholderId) {
        // Update placeholder with real ID - this also migrates snapshots
        await supabase.updateScrapedNoteId(placeholderId, note.note_id);
        updatedIds++;
        console.log(`${progress} ✓ UPDATED: ${placeholderId.substring(0, 20)}... → ${note.note_id.substring(0, 15)}...`);
      } else if (!exists) {
        // Brand new note - always upsert to ensure it exists before snapshot
        console.log(`   DEBUG: Creating new note...`);
        await supabase.upsertScrapedNotewriterNote({
          note_id: note.note_id,
          tweet_id: note.tweet_id,
          note_text: note.note_text,
          source_url: note.source_url,
        });
        newNotes++;
        console.log(`${progress} ✓ NEW: ${note.note_id.substring(0, 20)}...`);
      } else {
        console.log(`${progress} EXISTS (skipping note creation)`);
        existingNotes++;
      }

      // Always create a snapshot - the note should now exist
      await supabase.insertScrapedNotewriterSnapshot({
        note_id: note.note_id,
        cn_status: note.cn_status,
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
  console.log(`   • Updated IDs:       ${updatedIds}`);
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
