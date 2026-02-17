/**
 * Click-Through Notewriter Scraper (Parallel Tabs)
 *
 * Opens multiple browser tabs to scrape the notewriter page in parallel.
 * Each tab scrolls to a different starting position, then clicks "View details"
 * for each note to get accurate note IDs and statuses from the detail modal.
 *
 * USAGE:
 * 1. Start Chrome with remote debugging:
 *    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile
 *
 * 2. Navigate to your notewriter page and log in
 *
 * 3. Run this script:
 *    bun run src/scripts/scrapeNotewriterClickThrough.ts [maxNotes] [--fresh] [--tabs N]
 *
 *    --fresh: Refresh page and start from top (otherwise continues from current scroll position)
 *    --tabs N: Number of parallel tabs (default 1, max 5). Each tab scrapes a different
 *              section of the list simultaneously.
 *
 * SECURITY WARNING:
 * The remote debugging port (9222) gives FULL control over the browser to any process
 * that can connect to it. This includes access to all logged-in sessions and cookies.
 * - Only run this on a trusted machine
 * - Use --remote-debugging-address=127.0.0.1 to restrict to localhost only
 * - Close Chrome when done scraping
 */

import "dotenv/config";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { SupabaseLogger } from "../api/supabaseClient";

const DEFAULT_USERNAME = "wholesome-raspberry-stilt";
const SCROLL_PX = 600;
const SCROLLS_PER_TAB_OFFSET = 80; // ~48,000px per tab, roughly 1/3 of a 500-note list

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise(r => setTimeout(r, delay));
}

interface ScrapedNote {
  note_id: string;
  tweet_id: string;
  note_text?: string;
  cn_status: string;
  created_at?: string;
  source_url?: string;
  view_count?: number;
}

/** Fast-scroll a page without clicking, to reach a starting position for scraping. */
async function quickScroll(page: Page, scrollCount: number, tabId: number): Promise<void> {
  console.log(`   [Tab ${tabId}] Quick-scrolling ${scrollCount} times to reach starting position...`);
  for (let i = 0; i < scrollCount; i++) {
    await page.evaluate((px) => {
      const html = document.documentElement;
      html.scrollTop += px;
      html.dispatchEvent(new Event('scroll', { bubbles: true }));
      window.dispatchEvent(new Event('scroll', { bubbles: true }));
    }, SCROLL_PX);
    await new Promise(r => setTimeout(r, 200));
  }
  const pos = await page.evaluate(() => document.documentElement.scrollTop);
  console.log(`   [Tab ${tabId}] Reached scrollTop=${pos}`);
}

/** Wait for notewriter content to appear on a page. */
async function waitForContent(page: Page, tabId: number): Promise<void> {
  console.log(`   [Tab ${tabId}] Waiting for page to load...`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const hasContent = await page.evaluate(() =>
      document.body.innerText.includes('Needs more ratings') ||
      document.body.innerText.includes('Currently rated helpful') ||
      document.body.innerText.includes('Writing Impact')
    );
    if (hasContent) {
      console.log(`   [Tab ${tabId}] Content detected after ${i + 1} seconds`);
      return;
    }
  }
  console.log(`   [Tab ${tabId}] Warning: content not detected after 30s, proceeding anyway`);
}

// Shared incremental saving state (module-level so all tabs + main() can access)
const supabase = new SupabaseLogger();
let newNotes = 0;
let updatedIds = 0;
let existingNotes = 0;
let snapshotsCreated = 0;
let errorCount = 0;

async function saveNoteIncrementally(note: ScrapedNote): Promise<void> {
  try {
    if (!note.note_id || !/^\d{18,20}$/.test(note.note_id)) {
      console.error(`   ✗ SKIP: Invalid note_id: ${note.note_id}`);
      errorCount++;
      return;
    }
    if (!note.tweet_id) {
      console.error(`   ✗ SKIP: Missing tweet_id for note ${note.note_id}`);
      errorCount++;
      return;
    }

    const exists = await supabase.scrapedNotewriterNoteExists(note.note_id);
    const placeholderId = note.tweet_id.startsWith('unavailable_') ? null : `tweet_${note.tweet_id}`;
    let placeholderExists = false;
    if (placeholderId) {
      placeholderExists = await supabase.scrapedNotewriterNoteExists(placeholderId);
    }

    if (placeholderExists && placeholderId) {
      await supabase.updateScrapedNoteId(placeholderId, note.note_id);
      updatedIds++;
    } else if (!exists) {
      await supabase.upsertScrapedNotewriterNote({
        note_id: note.note_id,
        tweet_id: note.tweet_id,
        note_text: note.note_text,
        source_url: note.source_url,
      });
      newNotes++;
    } else {
      existingNotes++;
    }

    await supabase.insertScrapedNotewriterSnapshot({
      note_id: note.note_id,
      cn_status: note.cn_status,
    });
    snapshotsCreated++;
  } catch (err) {
    errorCount++;
    console.error(`   ✗ DB ERROR: ${note.note_id}:`, err);
  }
}

/**
 * Scrape notes from a single tab. Multiple instances run in parallel,
 * sharing a collectedNotes map for deduplication.
 */
async function scrapeTab(
  page: Page,
  collectedNotes: Map<string, ScrapedNote>,
  tabId: number,
  maxNotes: number,
): Promise<void> {
  const prefix = `[Tab ${tabId}]`;
  const processedCells = new Set<string>();
  let scrollCount = 0;
  let stuckCount = 0;
  const stuckBeforePause = 10;
  const maxRetries = 5;
  let retryCount = 0;
  let consecutiveOverlaps = 0;
  const overlapJumpThreshold = 15;
  let jumpCount = 0;
  const maxJumps = 3;

  try {
  while (collectedNotes.size < maxNotes && retryCount <= maxRetries) {
    scrollCount++;

    // Get all visible cells
    const cells = await page.$$('[data-testid="cellInnerDiv"]');

    // Debug: log scroll position
    const debugInfo = await page.evaluate(() => {
      const scrollY = window.scrollY;
      const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      const fingerprints = [...cells].map(c => (c as HTMLElement).innerText.slice(0, 50).replace(/\n/g, ' '));
      return { scrollY, fingerprints };
    });
    console.log(`\n${prefix} 📜 Scroll ${scrollCount}: ${cells.length} cells at scrollY=${debugInfo.scrollY}`);

    let foundNewNote = false;

    for (const cell of cells) {
      // Check shared cap before processing each cell
      if (collectedNotes.size >= maxNotes) break;

      // Generate a fingerprint for this cell to avoid reprocessing
      const cellFingerprint = await cell.evaluate(el => {
        const text = (el as HTMLElement).innerText.slice(0, 100);
        const detailsLink = el.querySelector('a[href*="/communitynotes/t/"]') as HTMLAnchorElement;
        if (detailsLink) {
          return detailsLink.href;
        }
        return text;
      });

      if (processedCells.has(cellFingerprint)) {
        continue;
      }
      processedCells.add(cellFingerprint);

      // Try to find tweet ID from the cell
      const tweetData = await cell.evaluate(el => {
        const tweetLink = el.querySelector('a[href*="/status/"]') as HTMLAnchorElement;
        if (tweetLink) {
          const match = tweetLink.href.match(/status\/(\d+)/);
          return { tweetId: match?.[1] || null, tweetUrl: tweetLink.href };
        }

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

      // Skip if we already have this tweet (another tab got it)
      if (tweetData.tweetId && [...collectedNotes.values()].some(n => n.tweet_id === tweetData.tweetId)) {
        consecutiveOverlaps++;
        continue;
      }

      // Extract note text and source URL from cell
      const cellData = await cell.evaluate(el => {
        const text = (el as HTMLElement).innerText;

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

        const sourceLinks = [...el.querySelectorAll('a[href^="http"]')]
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((h) => !h.includes('x.com') && !h.includes('twitter.com'));

        let viewCount: number | null = null;
        const viewMatch = text.match(/Shown on X[^·]*·\s*([\d,.]+)([KMB]?)\+?\s*views?/i);
        if (viewMatch) {
          let num = parseFloat(viewMatch[1]!.replace(/,/g, ''));
          const suffix = (viewMatch[2] || '').toUpperCase();
          if (suffix === 'K') num *= 1000;
          else if (suffix === 'M') num *= 1000000;
          else if (suffix === 'B') num *= 1000000000;
          viewCount = Math.round(num);
        }

        return { noteText, sourceUrl: sourceLinks[0] || null, viewCount };
      });

      // Scroll cell into view
      await cell.evaluate(el => {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      });
      await randomDelay(100, 200);

      // Find and click the "View details" element
      const clickResult = await cell.evaluate(el => {
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

      if (!clickResult.found) continue;
      if (clickResult.x === 0 && clickResult.y === 0) continue;
      if (clickResult.y < 0 || clickResult.y > 2000) {
        console.log(`   ${prefix} ⚠️ View details off-screen (y=${clickResult.y}) for tweet ${tweetData.tweetId}`);
        continue;
      }

      console.log(`   ${prefix} 🖱️ Clicking View details at (${clickResult.x.toFixed(0)}, ${clickResult.y.toFixed(0)}) [${clickResult.tag}]`);

      // Retry click + modal extraction up to 2 times
      let modalData: { noteId: string | null; status: string; submittedDate: string; usedFallback?: boolean } | null = null;
      for (let clickAttempt = 0; clickAttempt < 2; clickAttempt++) {
        if (clickAttempt > 0) {
          console.log(`   ${prefix} 🔄 Retry ${clickAttempt} for click...`);
          await randomDelay(500, 1000);
        }

        try {
          await Promise.race([
            page.mouse.click(clickResult.x, clickResult.y),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Click timeout')), 10000))
          ]);
        } catch (clickErr) {
          console.log(`   ${prefix} ⚠️ Click error: ${clickErr}`);
          continue;
        }

        // Wait for modal — poll instead of fixed sleep
        for (let waitMs = 0; waitMs < 3000; waitMs += 150) {
          const hasModal = await page.evaluate(() => {
            const modal = document.querySelector('[data-testid="sheetDialog"]') ||
                          document.querySelector('[role="dialog"]') ||
                          document.querySelector('[aria-modal="true"]') ||
                          document.querySelector('[data-testid="Drawer"]');
            if (modal && (modal as HTMLElement).innerText.includes('Note ID')) return true;
            return document.body.innerText.includes('Note Details');
          });
          if (hasModal) break;
          await new Promise(r => setTimeout(r, 150));
        }

      // Extract data from modal
      modalData = await page.evaluate(() => {
        const modal = document.querySelector('[data-testid="sheetDialog"]') ||
                      document.querySelector('[role="dialog"]') ||
                      document.querySelector('[aria-modal="true"]') ||
                      document.querySelector('[data-testid="Drawer"]');

        let modalText = '';
        let usedFallback = false;
        if (modal) {
          modalText = (modal as HTMLElement).innerText;
        } else {
          const candidates: { el: HTMLElement; len: number }[] = [];
          const allElements = document.querySelectorAll('div, section, aside');
          for (const el of allElements) {
            const text = (el as HTMLElement).innerText;
            if (text.includes('Note Details') || text.includes('Note ID')) {
              if (text.length > 100 && text.length < 10000) {
                candidates.push({ el: el as HTMLElement, len: text.length });
              }
            }
          }
          if (candidates.length > 0) {
            candidates.sort((a, b) => a.len - b.len);
            modalText = candidates[0]!.el.innerText;
          }
        }

        if (!modalText) {
          const bodyText = document.body.innerText;
          if (!bodyText.includes('Note Details') && !bodyText.includes('Note ID')) {
            return null;
          }
          modalText = bodyText;
          usedFallback = true;
        }

        const noteIdMatch = modalText.match(/Note ID[:\s]*(\d{18,20})/i);
        const noteId = noteIdMatch ? (noteIdMatch[1] ?? null) : null;

        let status = 'UNKNOWN';

        if (usedFallback && noteId) {
          const noteIdPos = modalText.indexOf('Note ID');
          if (noteIdPos !== -1) {
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

        const dateMatch = modalText.match(/Note submitted[:\s]*([\d:]+\s*(?:AM|PM)?)\s*[·•]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i);
        const submittedDate = dateMatch ? (dateMatch[2] ?? '') : '';

        return { noteId, status, submittedDate, usedFallback };
      });

        if (modalData?.noteId) break;

        await page.keyboard.press('Escape');
        await randomDelay(200, 400);
      } // end retry loop

      if (!modalData || !modalData.noteId) {
        console.log(`   ${prefix} ⚠️ Modal didn't open or couldn't extract Note ID for tweet ${tweetData.tweetId || 'unavailable'}`);
        await page.keyboard.press('Escape');
        await randomDelay(200, 400);
        continue;
      }

      // Skip if another tab already got this note
      if (collectedNotes.has(modalData.noteId)) {
        consecutiveOverlaps++;
        await page.keyboard.press('Escape');
        await randomDelay(100, 200);
        continue;
      }

      const viewInfo = cellData.viewCount ? ` [${cellData.viewCount.toLocaleString()} views]` : '';
      console.log(`   ${prefix} ✓ Found Note ID: ${modalData.noteId} (${modalData.status})${viewInfo}${!tweetData.tweetId ? ' [Post unavailable]' : ''}`);

      const note: ScrapedNote = {
        note_id: modalData.noteId,
        tweet_id: tweetData.tweetId || `unavailable_${modalData.noteId}`,
        note_text: cellData.noteText,
        cn_status: modalData.status,
        created_at: modalData.submittedDate,
        source_url: cellData.sourceUrl || undefined,
        view_count: cellData.viewCount || undefined,
      };

      collectedNotes.set(modalData.noteId, note);
      foundNewNote = true;
      consecutiveOverlaps = 0; // Reset overlap counter on new find
      console.log(`   ${prefix} ✓ Total ${collectedNotes.size}: ${modalData.noteId} (${modalData.status})`);

      // Save to DB immediately so data isn't lost if process is killed
      await saveNoteIncrementally(note);

      // Close the modal
      const closed = await page.evaluate(() => {
        const closeSelectors = [
          '[aria-label="Close"]',
          '[data-testid="xMigrationBottomBar"] button',
          'div[role="dialog"] button',
        ];
        for (const selector of closeSelectors) {
          const btn = document.querySelector(selector) as HTMLElement;
          if (btn) {
            btn.click();
            return true;
          }
        }
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const rect = btn.getBoundingClientRect();
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
        await page.keyboard.press('Escape');
      }

      await randomDelay(100, 250);
    }

    if (!foundNewNote) {
      stuckCount++;
      if (stuckCount >= stuckBeforePause) {
        retryCount++;
        if (retryCount > maxRetries) {
          console.log(`\n   ${prefix} 🛑 Exhausted ${maxRetries} retries. Tab stopping.`);
          break;
        }
        // Unstick the virtualizer: scroll up a big chunk, wait, then scroll back down
        console.log(`\n   ${prefix} 🔄 Stuck after ${stuckCount} scrolls. Jiggling scroll to unstick virtualizer (retry ${retryCount}/${maxRetries})...`);
        const jiggleDistance = 3000 + (retryCount * 2000); // Scroll up further each retry
        await page.evaluate((dist) => {
          const html = document.documentElement;
          html.scrollTop = Math.max(0, html.scrollTop - dist);
          html.dispatchEvent(new Event('scroll', { bubbles: true }));
          window.dispatchEvent(new Event('scroll', { bubbles: true }));
        }, jiggleDistance);
        await new Promise(r => setTimeout(r, 2000)); // Let virtualizer re-render
        // Scroll back down past where we were
        await page.evaluate((dist) => {
          const html = document.documentElement;
          html.scrollTop += dist + 600; // Go slightly past original position
          html.dispatchEvent(new Event('scroll', { bubbles: true }));
          window.dispatchEvent(new Event('scroll', { bubbles: true }));
        }, jiggleDistance);
        await new Promise(r => setTimeout(r, 1000));
        stuckCount = 0;
        processedCells.clear(); // Clear fingerprints since we're in shifted territory
        console.log(`   ${prefix} ▶️  Resuming after jiggle...`);
      }
    } else {
      stuckCount = 0;
      retryCount = 0;
    }

    // Check if we're in another tab's territory — jump far ahead to find uncovered ground
    if (consecutiveOverlaps >= overlapJumpThreshold) {
      jumpCount++;
      if (jumpCount > maxJumps) {
        console.log(`\n   ${prefix} 🏁 Hit overlap ${maxJumps} times, no more uncovered territory. Tab done.`);
        break;
      }
      const jumpScrolls = SCROLLS_PER_TAB_OFFSET; // Jump same distance as initial tab spacing
      console.log(`\n   ${prefix} 🔀 Overlapping with another tab (${consecutiveOverlaps} dupes). Jumping ahead ${jumpScrolls} scrolls (jump ${jumpCount}/${maxJumps})...`);
      consecutiveOverlaps = 0;
      processedCells.clear(); // Clear fingerprints since we're in new territory
      await quickScroll(page, jumpScrolls, tabId);
      continue; // Skip the normal scroll, go straight to processing
    }

    // Scroll down
    try {
      const scrollResult = await page.evaluate((px) => {
        const html = document.documentElement;
        const before = html.scrollTop;
        const maxScroll = html.scrollHeight - html.clientHeight;
        html.scrollTop = Math.min(before + px, maxScroll);
        html.dispatchEvent(new Event('scroll', { bubbles: true }));
        window.dispatchEvent(new Event('scroll', { bubbles: true }));
        return {
          moved: html.scrollTop !== before,
          scrollTop: html.scrollTop,
          maxScroll,
          atBottom: html.scrollTop >= maxScroll - 10,
        };
      }, SCROLL_PX);

      if (scrollResult.atBottom) {
        console.log(`   ${prefix} 📍 At bottom of page (${scrollResult.scrollTop}/${scrollResult.maxScroll})`);
      }
    } catch (scrollErr: unknown) {
      const errMsg = scrollErr instanceof Error ? scrollErr.message : String(scrollErr);
      console.log(`   ${prefix} ⚠️ Scroll error: ${errMsg.slice(0, 60)}`);
    }

    await randomDelay(300, 500);
  }
  } catch (loopErr: unknown) {
    const errMsg = loopErr instanceof Error ? loopErr.message : String(loopErr);
    console.log(`\n${prefix} ⚠️ Scraping interrupted: ${errMsg.slice(0, 100)}`);
    console.log(`   ${prefix} Collected ${collectedNotes.size} notes so far across all tabs`);
  }

  console.log(`\n${prefix} ✅ Tab finished. Total notes across all tabs: ${collectedNotes.size}`);
}


async function main() {
  // Parse args
  const args = process.argv.slice(2);
  const freshStart = args.includes('--fresh');

  // Parse --tabs N (and note which arg indices are consumed by flags)
  const tabsFlagIdx = args.indexOf('--tabs');
  const numTabs = tabsFlagIdx !== -1 && args[tabsFlagIdx + 1]
    ? Math.min(Math.max(parseInt(args[tabsFlagIdx + 1]!, 10) || 1, 1), 5)
    : 1;

  // Filter out flag args AND their values (e.g. --tabs 3 removes both)
  const flagValueIndices = new Set<number>();
  if (tabsFlagIdx !== -1) {
    flagValueIndices.add(tabsFlagIdx);
    flagValueIndices.add(tabsFlagIdx + 1);
  }
  const nonFlagArgs = args.filter((a, i) => !a.startsWith('--') && !flagValueIndices.has(i));

  // Smart arg parsing: if first non-flag arg is a number, treat it as maxNotes
  let username = DEFAULT_USERNAME;
  let maxNotes = 500;
  if (nonFlagArgs.length === 1 && /^\d+$/.test(nonFlagArgs[0]!)) {
    maxNotes = parseInt(nonFlagArgs[0]!, 10);
  } else {
    username = nonFlagArgs[0] || DEFAULT_USERNAME;
    maxNotes = parseInt(nonFlagArgs[1] || "500", 10);
  }
  const notewriterUrl = `https://x.com/i/communitynotes/u/${username}`;

  console.log("🔌 Connecting to Chrome on port 9222...\n");

  let browser: Browser;
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
  console.log(`🚀 Starting scrape with ${numTabs} tab${numTabs > 1 ? 's' : ''} (max ${maxNotes} notes)...\n`);

  // Open tabs
  const tabPages: Page[] = [];

  for (let i = 0; i < numTabs; i++) {
    let tabPage: Page | undefined;

    if (i === 0) {
      // First tab: reuse existing notewriter tab if present
      const existingPages = await browser.pages();
      tabPage = existingPages.find((p) => p.url().includes("communitynotes"));

      if (!tabPage) {
        console.log(`📄 [Tab 0] Opening new tab: ${notewriterUrl}`);
        tabPage = await browser.newPage();
        await tabPage.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
      } else {
        console.log(`📄 [Tab 0] Found existing notewriter tab: ${tabPage.url()}`);
        if (freshStart || !tabPage.url().includes(username)) {
          console.log(`   [Tab 0] ${freshStart ? '🔄 Fresh start - reloading' : 'Navigating to'} ${notewriterUrl}`);
          await tabPage.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
        }
      }
    } else {
      // Additional tabs: always open fresh
      console.log(`📄 [Tab ${i}] Opening new tab: ${notewriterUrl}`);
      tabPage = await browser.newPage();
      await tabPage.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
    }

    // If fresh start, scroll to top
    if (freshStart) {
      await tabPage.evaluate(() => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      });
      await new Promise(r => setTimeout(r, 500));
    }

    tabPages.push(tabPage);
  }

  // Wait for content on all tabs
  await Promise.all(tabPages.map((p, i) => waitForContent(p, i)));

  // Position tabs: tab i scrolls past (i * SCROLLS_PER_TAB_OFFSET) positions
  if (numTabs > 1) {
    console.log(`\n📍 Positioning ${numTabs} tabs across the notewriter list...\n`);
    // Position tabs 1-N (tab 0 starts from current position)
    await Promise.all(
      tabPages.slice(1).map((p, idx) =>
        quickScroll(p, (idx + 1) * SCROLLS_PER_TAB_OFFSET, idx + 1)
      )
    );
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🏁 All ${numTabs} tabs ready. Starting parallel scrape...\n`);

  // Shared map — JS is single-threaded so no race conditions
  const collectedNotes = new Map<string, ScrapedNote>();

  // Run all tabs in parallel
  await Promise.all(
    tabPages.map((p, i) => scrapeTab(p, collectedNotes, i, maxNotes))
  );

  console.log(`\n✅ All tabs finished! Collected ${collectedNotes.size} notes total\n`);

  // Close extra tabs (keep tab 0)
  for (let i = 1; i < tabPages.length; i++) {
    try {
      await tabPages[i]!.close();
      console.log(`   Closed tab ${i}`);
    } catch { /* tab may already be closed */ }
  }

  if (collectedNotes.size === 0) {
    console.log("No notes collected.");
    process.exit(0);
  }

  // Notes were already saved incrementally during scraping
  console.log("\n" + "=".repeat(60));
  console.log("✅ Scrape & import complete!");
  console.log(`   • New notes:         ${newNotes}`);
  console.log(`   • Updated IDs:       ${updatedIds}`);
  console.log(`   • Existing notes:    ${existingNotes}`);
  console.log(`   • Snapshots created: ${snapshotsCreated}`);
  console.log(`   • Errors:            ${errorCount}`);
  console.log("=".repeat(60));

  // Coverage check
  const scrapedIds = [...collectedNotes.keys()].filter(id => /^\d+$/.test(id)).sort();
  if (scrapedIds.length >= 2) {
    const minId = scrapedIds[0]!;
    const maxId = scrapedIds[scrapedIds.length - 1]!;

    const knownIds = await supabase.getScrapedNoteIdsInRange(minId, maxId);

    if (knownIds.length > 0) {
      const dbIds = new Set(knownIds);
      const scrapedSet = new Set(scrapedIds);
      const missed = [...dbIds].filter(id => !scrapedSet.has(id));
      const newlyFound = [...scrapedSet].filter(id => !dbIds.has(id));
      const recovered = [...dbIds].filter(id => scrapedSet.has(id));
      const coverage = dbIds.size > 0
        ? ((recovered.length / dbIds.size) * 100).toFixed(1)
        : "N/A (no prior notes in range)";

      console.log("\n📊 Coverage check (vs. previously known notes in this ID range):");
      console.log(`   • ID range: ${minId} → ${maxId}`);
      console.log(`   • Previously known in range: ${dbIds.size}`);
      console.log(`   • Re-scraped (of known):     ${recovered.length}/${dbIds.size} (${coverage}%)`);
      console.log(`   • Missed (known but not scraped): ${missed.length}`);
      console.log(`   • Newly found (not previously in DB): ${newlyFound.length}`);
      if (missed.length > 0 && missed.length <= 10) {
        console.log(`   • Missed IDs: ${missed.join(", ")}`);
      } else if (missed.length > 10) {
        console.log(`   • First 10 missed: ${missed.slice(0, 10).join(", ")}`);
      }
    }
  }

  // Derive canonical tweet_ids from snapshot majority vote
  console.log("\n🔗 Deriving tweet_ids from snapshot majority vote...");
  const deriveResult = await supabase.deriveTweetIds();
  console.log(`   • Total notes:  ${deriveResult.total}`);
  console.log(`   • Updated:      ${deriveResult.updated}`);
  console.log(`   • Flagged:      ${deriveResult.flagged}`);
  console.log(`   • No votes yet: ${deriveResult.noVotes}`);

  // Detect snapshot anomalies
  console.log("\n🔍 Detecting snapshot anomalies...");
  const anomalies = await supabase.detectSnapshotAnomalies();
  console.log(`   • View count decreases: ${anomalies.viewCountDecreases.length}`);
  console.log(`   • Note text changes:    ${anomalies.noteTextChanges.length}`);
  if (anomalies.viewCountDecreases.length > 0) {
    console.log("\n   View count decreases (likely virtualizer corruption):");
    for (const a of anomalies.viewCountDecreases.slice(0, 10)) {
      console.log(`     ${a.note_id}: ${a.from} → ${a.to} (${a.fromDate} → ${a.toDate})`);
    }
    if (anomalies.viewCountDecreases.length > 10) {
      console.log(`     ... and ${anomalies.viewCountDecreases.length - 10} more`);
    }
  }
  if (anomalies.noteTextChanges.length > 0) {
    console.log("\n   Note text changes (likely virtualizer corruption):");
    for (const a of anomalies.noteTextChanges.slice(0, 10)) {
      console.log(`     ${a.note_id}: ${a.texts.length} different texts across ${a.dates.length} snapshots`);
    }
    if (anomalies.noteTextChanges.length > 10) {
      console.log(`     ... and ${anomalies.noteTextChanges.length - 10} more`);
    }
  }

  console.log("\n💡 Chrome browser left open. Close it manually when done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
