// @ts-nocheck
/**
 * Click-Through Notewriter Scraper
 *
 * Connects to a local Chrome via CDP, scrolls through the notewriter page,
 * and clicks "View details" on each note to extract note IDs, statuses, and
 * view counts. If an existing notewriter tab is open, reuses it at its
 * current scroll position. Otherwise opens a new tab.
 *
 * USAGE:
 * 1. Start Chrome with remote debugging:
 *    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile
 *
 * 2. Navigate to your notewriter page and log in
 *
 * 3. Run this script:
 *    bun run src/scripts/scrapeNotewriterClickThrough.ts [maxNotes] [--fresh] [--start-from <noteId>] [--stop-at <noteId>]
 *
 *    --fresh: Open a new tab and start from top (otherwise reuses existing tab)
 *    --start-from <noteId>: Scroll to this note ID before scraping
 *    --stop-at <noteId>: Stop scraping when reaching this note ID (instead of BOTTOM_NOTE_ID)
 */

import "dotenv/config";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { SupabaseLogger } from "../api/supabaseClient";

const DEFAULT_USERNAME = "wholesome-raspberry-stilt";
const SCROLL_PX = 600;
const BOTTOM_NOTE_ID = 1976702059752911225n; // Oldest known note — reaching this = full coverage

async function runReconcile(): Promise<void> {
  console.log("\n🔄 Running snapshot reconciliation...");
  try {
    const { reconcile } = await import("./reconcileSnapshots");
    const result = await reconcile();
    console.log(`   • Tiers: platinum=${result.tierCounts.platinum} gold=${result.tierCounts.gold} silver=${result.tierCounts.silver} junk=${result.tierCounts.junk}`);
    console.log(`   • Collisions: ${result.collisions.note} note-level, ${result.collisions.tweet} tweet-level`);
    console.log(`   • Notes written: ${result.notesWritten}`);
  } catch (err) {
    console.error("   ⚠️ Reconciliation failed (non-fatal):", err);
  }
}

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
  shown_on_x?: boolean | null;
  rater_tags?: string[];
  tweet_handle?: string;
  tweet_text?: string;
  tweet_time?: string;
}

/** Fast-scroll a page without clicking, to reach a starting position for scraping. */
/**
 * Scroll to a target position, sampling notes along the way.
 * Replaces the old quickScroll: waits for the virtualizer at bottom,
 * and periodically clicks "View details" to read note IDs so we know
 * exactly where we are. Sampled notes get fully saved to DB.
 *
 * @param targetNoteId Stop when we find a note with ID <= this value (null = use scrollCount)
 * @param maxScrolls Safety limit on number of scrolls
 */
// Track the CDP target ID of the active tab so reconnectToTab finds the right one
let activeTargetId: string | null = null;

/** Disconnect from Chrome, reconnect, and find the existing notewriter tab. */
async function reconnectToTab(
  oldBrowser: Browser,
  notewriterUrl: string,
  prefix: string,
): Promise<{ browser: Browser; page: Page }> {
  console.log(`   ${prefix} 🔌 Reconnecting to Chrome for fresh page references...`);
  try { oldBrowser.disconnect(); } catch { /* may already be disconnected */ }
  await new Promise(r => setTimeout(r, 800));

  const freshBrowser = await puppeteer.connect({
    browserURL: "http://127.0.0.1:9222",
    protocolTimeout: 120000,
    defaultViewport: null,
  });

  const allPages = await freshBrowser.pages();

  // First try to find the specific tab we were using (by CDP target ID)
  let recoveredPage: Page | undefined;
  if (activeTargetId) {
    recoveredPage = allPages.find(p => {
      const target = p.target();
      return target && (target as any)._targetId === activeTargetId;
    });
    if (!recoveredPage) {
      // Fallback: find by URL, preferring the LAST match (most recently opened)
      const notewriterPages = allPages.filter(p => p.url().includes("communitynotes"));
      recoveredPage = notewriterPages[notewriterPages.length - 1];
    }
  } else {
    // No target ID tracked — use last notewriter tab
    const notewriterPages = allPages.filter(p => p.url().includes("communitynotes"));
    recoveredPage = notewriterPages[notewriterPages.length - 1];
  }

  if (recoveredPage) {
    // Update target ID in case we fell back to a different tab
    activeTargetId = (recoveredPage.target() as any)?._targetId ?? activeTargetId;
    const scrollPos = await recoveredPage.evaluate(() => document.documentElement.scrollTop).catch(() => -1);
    console.log(`   ${prefix} ✅ Reattached to existing tab (scrollY=${scrollPos})`);
    return { browser: freshBrowser, page: recoveredPage };
  }

  // Tab gone — open a new one
  console.log(`   ${prefix} ⚠️ Existing tab not found — opening fresh tab...`);
  const newPage = await freshBrowser.newPage();
  activeTargetId = (newPage.target() as any)?._targetId ?? null;
  await newPage.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await waitForContent(newPage);
  return { browser: freshBrowser, page: newPage };
}

async function scrollToPosition(
  page: Page,
  browser: Browser,
  notewriterUrl: string,
  collectedNotes: Map<string, ScrapedNote>,
  targetNoteId: bigint | null,
  maxScrolls: number,
): Promise<{ page: Page; browser: Browser }> {
  const prefix = `[scraper]`;
  const BATCH_SIZE = 50;
  const BATCH_DELAY_MS = 1200;
  const MAX_RECONNECTS = 10;
  let reconnects = 0;
  let currentPage = page;
  let currentBrowser = browser;
  console.log(`   ${prefix} Scrolling to position${targetNoteId ? ` (target <= ${targetNoteId})` : ` (${maxScrolls} scrolls)`}...`);

  let totalScrollsDone = 0;
  let lastMinTweetId: bigint | null = null;
  let consecutiveIdStalls = 0;

  while (totalScrollsDone < maxScrolls) {
    const scrollsThisBatch = Math.min(BATCH_SIZE, maxScrolls - totalScrollsDone);

    let batchResult: { scrollTop: number; scrollHeight: number; tweetIds: string[]; stuckCount: number };
    try {
      batchResult = await currentPage.evaluate(async (px: number, count: number) => {
        const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
        const html = document.documentElement;
        let lastTop = html.scrollTop;
        let stuckCount = 0;

        for (let i = 0; i < count; i++) {
          const maxScroll = html.scrollHeight - html.clientHeight;
          html.scrollTop = Math.min(html.scrollTop + px, maxScroll);
          html.dispatchEvent(new Event('scroll', { bubbles: true }));
          window.dispatchEvent(new Event('scroll', { bubbles: true }));

          if (html.scrollTop >= maxScroll - 10 && html.scrollTop === lastTop) {
            stuckCount++;
            if (stuckCount % 5 === 0) {
              html.scrollTop = Math.max(0, html.scrollTop - 2000);
              html.dispatchEvent(new Event('scroll', { bubbles: true }));
              await delay(500);
              html.scrollTop = html.scrollHeight - html.clientHeight;
              html.dispatchEvent(new Event('scroll', { bubbles: true }));
              await delay(500);
            }
          } else {
            stuckCount = 0;
          }
          lastTop = html.scrollTop;

          await delay(60 + Math.random() * 20);
        }

        const tweetIds: string[] = [];
        const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
        for (const cell of cells) {
          const links = cell.querySelectorAll('a[href*="/status/"]') as NodeListOf<HTMLAnchorElement>;
          for (const link of links) {
            const match = link.href.match(/\/status\/(\d+)/);
            if (match) tweetIds.push(match[1]!);
          }
        }

        return {
          scrollTop: html.scrollTop,
          scrollHeight: html.scrollHeight,
          tweetIds,
          stuckCount,
        };
      }, SCROLL_PX, scrollsThisBatch);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('detached') || msg.includes('Target closed') || msg.includes('Session closed') || msg.includes('Connection closed') || msg.includes('Execution context') || msg.includes('timed out')) {
        reconnects++;
        if (reconnects > MAX_RECONNECTS) {
          console.log(`   ${prefix} 💀 Too many reconnects during positioning (${MAX_RECONNECTS})`);
          return { page: currentPage, browser: currentBrowser };
        }
        console.log(`   ${prefix} 🔄 Frame detached during scroll (${reconnects}/${MAX_RECONNECTS}) — reconnecting...`);
        const recovered = await reconnectToTab(currentBrowser, notewriterUrl, prefix);
        currentBrowser = recovered.browser;
        currentPage = recovered.page;
        // Don't increment totalScrollsDone — retry this batch
        continue;
      }
      throw err;
    }

    totalScrollsDone += scrollsThisBatch;

    if (targetNoteId && batchResult.tweetIds.length > 0) {
      const minTweetId = batchResult.tweetIds.reduce((min, id) => {
        const n = BigInt(id);
        return n < min ? n : min;
      }, BigInt(batchResult.tweetIds[0]!));

      console.log(`   ${prefix} 📍 tweet ${minTweetId} at scroll ${totalScrollsDone} (scrollY=${batchResult.scrollTop}/${batchResult.scrollHeight})`);

      if (minTweetId <= targetNoteId) {
        console.log(`   ${prefix} ✅ Reached target at scroll ${totalScrollsDone}`);
        return { page: currentPage, browser: currentBrowser };
      }

      if (lastMinTweetId !== null && minTweetId >= lastMinTweetId) {
        consecutiveIdStalls++;
        if (consecutiveIdStalls >= 10) {
          console.log(`   ${prefix} ⚠️ IDs stalled for ${consecutiveIdStalls} batches — stopping`);
          return { page: currentPage, browser: currentBrowser };
        }
      } else {
        consecutiveIdStalls = 0;
      }
      lastMinTweetId = minTweetId;
    } else if (targetNoteId) {
      console.log(`   ${prefix} 📍 No tweet links at scroll ${totalScrollsDone} (scrollY=${batchResult.scrollTop})`);
    } else if (totalScrollsDone % 200 === 0) {
      console.log(`   ${prefix} ... ${totalScrollsDone}/${maxScrolls} scrolls (scrollY=${batchResult.scrollTop}/${batchResult.scrollHeight})`);
    }

    if (batchResult.stuckCount >= 40) {
      console.log(`   ${prefix} ⚠️ Stuck for most of batch at scrollY=${batchResult.scrollTop}`);
    }

    await new Promise(r => setTimeout(r, BATCH_DELAY_MS + Math.random() * 800));
  }

  const pos = await currentPage.evaluate(() => document.documentElement.scrollTop).catch(() => -1);
  console.log(`   ${prefix} Reached scrollTop=${pos} after ${totalScrollsDone} scrolls`);
  return { page: currentPage, browser: currentBrowser };
}

/** Wait for notewriter content to appear on a page. */
async function waitForContent(page: Page): Promise<void> {
  console.log(`   [scraper] Waiting for page to load...`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 800));
    const hasContent = await page.evaluate(() =>
      document.body.innerText.includes('Needs more ratings') ||
      document.body.innerText.includes('Currently rated helpful') ||
      document.body.innerText.includes('Writing Impact')
    );
    if (hasContent) {
      console.log(`   [scraper] Content detected after ${i + 1} seconds`);
      return;
    }
  }
  console.log(`   [scraper] Warning: content not detected after 30s, proceeding anyway`);
}

// Incremental saving state
const supabase = new SupabaseLogger();
let newNotes = 0;
let updatedIds = 0;
let existingNotes = 0;
let snapshotsCreated = 0;
let errorCount = 0;
let qualityRetryCount = 0;


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
      tweet_id: note.tweet_id,
      note_text: note.note_text,
      view_count: note.view_count,
      shown_on_x: note.shown_on_x,
      rater_tags: note.rater_tags,
      tweet_handle: note.tweet_handle,
      tweet_text: note.tweet_text,
      tweet_time: note.tweet_time,
    });
    snapshotsCreated++;
  } catch (err) {
    errorCount++;
    console.error(`   ✗ DB ERROR: ${note.note_id}:`, err);
  }
}

/**
 * Scrape notes by scrolling and clicking "View details" on each note.
 */
async function scrapeTab(
  browser: Browser,
  initialPage: Page,
  collectedNotes: Map<string, ScrapedNote>,
  maxNotes: number,
  notewriterUrl: string,
  stopAtNoteId: bigint | null = null,
): Promise<void> {
  const prefix = `[scraper]`;

  // Diagnostic: log page dimensions to help debug virtualizer issues
  const dims = await initialPage.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
    bodyScrollHeight: document.body.scrollHeight,
    cells: document.querySelectorAll('[data-testid="cellInnerDiv"]').length,
  }));
  console.log(`${prefix} 📐 Page dimensions: ${dims.innerWidth}x${dims.innerHeight} viewport, ${dims.scrollHeight}px scroll height, ${dims.cells} cells visible`);

  let processedCells = new Set<string>();
  let scrollCount = 0;
  let stuckCount = 0;
  const stuckBeforePause = 10;
  // Escalating wait times before each jiggle retry: quick, 30s, 30s, 60s, 60s, 60s, 180s, 180s, 180s, 180s
  const jiggleWaits = [800, 1600, 3200, 6400, 12000, 24000, 48000, 96000];
  const maxRetries = jiggleWaits.length;
  let retryCount = 0;
  let currentPage = initialPage;
  let frameRecoveries = 0;
  const MAX_FRAME_RECOVERIES = 15;
  let lastNoteDate = ''; // Track date of last scraped note for stuck messages

  recoveryLoop:
  while (frameRecoveries <= MAX_FRAME_RECOVERIES) {
    const page = currentPage; // Shadow for inner code — updated on recovery
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

      // --- Helper: extract tweet/note IDs from cell ---
      async function readCellTweetData() {
        return cell.evaluate(el => {
          let tweetId: string | null = null;
          let tweetUrl: string | null = null;
          let noteIdFromUrl: string | null = null;

          // Primary: read tweet URL from React fiber tree (role="link" div's parent has link.pathname)
          const roleLink = el.querySelector('[role="link"]') as any;
          if (roleLink) {
            const fiberKey = Object.keys(roleLink).find(k => k.startsWith('__reactFiber'));
            if (fiberKey) {
              const fiber = roleLink[fiberKey];
              const parentProps = fiber?.return?.memoizedProps;
              const linkPathname = parentProps?.link?.pathname;
              if (typeof linkPathname === 'string') {
                const match = linkPathname.match(/status\/(\d+)/);
                if (match) {
                  tweetId = match[1]!;
                  tweetUrl = linkPathname;
                }
              }
            }
          }

          // Fallback: look for /status/ links in the cell (rare — only when tweet text contains status links)
          if (!tweetId) {
            const allStatusLinks = [...el.querySelectorAll('a[href*="/status/"]')] as HTMLAnchorElement[];
            const noteTextContainers = el.querySelectorAll('div[dir="ltr"], span[dir="ltr"]');
            const noteTextEls = new Set<Node>();
            noteTextContainers.forEach(container => {
              if ((container as HTMLElement).innerText.trim().length > 50) {
                noteTextEls.add(container);
              }
            });

            for (const link of allStatusLinks) {
              let insideNoteText = false;
              for (const container of noteTextEls) {
                if (container.contains(link)) { insideNoteText = true; break; }
              }
              if (insideNoteText) continue;

              const match = link.href.match(/status\/(\d+)/);
              if (match) {
                tweetId = match[1]!;
                tweetUrl = link.href;
                break;
              }
            }
          }

          return { tweetId, tweetUrl, noteIdFromUrl };
        });
      }

      // --- Helper: extract note text, views, status, and tweet info from cell ---
      async function readCellData() {
        return cell.evaluate(el => {
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

          // NOTE: cell innerText concatenates DOM nodes without whitespace
          // (e.g. "...GermantownCurrently rated helpful19h..."), so leading/trailing
          // \b word boundaries fail when a phrase abuts other letters. The phrases
          // below are distinctive enough that bare substring match is safe.
          let viewCount: number | null = null;
          let shownOnX: boolean | null = null;
          if (/Not shown on X/i.test(text)) {
            shownOnX = false;
          } else if (/Shown on X/i.test(text)) {
            shownOnX = true;
            const viewMatch = text.match(/Shown on X[^·]*·\s*([\d,.]+)([KMB]?)\+?\s*views?/i);
            if (viewMatch) {
              let num = parseFloat(viewMatch[1]!.replace(/,/g, ''));
              const suffix = (viewMatch[2] || '').toUpperCase();
              if (suffix === 'K') num *= 1000;
              else if (suffix === 'M') num *= 1000000;
              else if (suffix === 'B') num *= 1000000000;
              viewCount = Math.round(num);
            }
          }

          let cellStatus: string | null = null;
          if (/Currently rated not helpful/i.test(text)) cellStatus = 'CURRENTLY_RATED_NOT_HELPFUL';
          else if (/Currently rated helpful/i.test(text)) cellStatus = 'CURRENTLY_RATED_HELPFUL';
          else if (/Needs more ratings/i.test(text)) cellStatus = 'NEEDS_MORE_RATINGS';

          const postUnavailable = /Post unavailable/i.test(text);
          // Sensitive-content / age-restricted preview: X hides the embedded tweet
          // behind a "show this content" overlay, so avatar/tweetText/status link
          // are absent from the cell DOM. Modal still works — skip cell retries.
          const hasInterstitial = !!el.querySelector('[data-testid="previewInterstitial"]');

          // --- Extract original tweet info from the cell ---
          let tweetHandle: string | null = null;
          let tweetText: string | null = null;
          let tweetTime: string | null = null;

          // Tweet handle: extract from UserAvatar-Container data-testid attribute
          const avatarEl = el.querySelector('[data-testid^="UserAvatar-Container-"]');
          if (avatarEl) {
            const testId = avatarEl.getAttribute('data-testid') || '';
            const handle = testId.replace('UserAvatar-Container-', '');
            if (handle && handle.length > 0) {
              tweetHandle = handle;
            }
          }

          // Tweet time: look for <time> elements (X uses these for timestamps)
          const timeEl = el.querySelector('time');
          if (timeEl) {
            // Prefer the datetime attribute (ISO format) over display text
            tweetTime = timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || null;
          }

          // Tweet text: use data-testid="tweetText" element (X's own tweet text container)
          const tweetTextEl = el.querySelector('[data-testid="tweetText"]');
          if (tweetTextEl) {
            const t = (tweetTextEl as HTMLElement).innerText.trim();
            if (t.length > 0) {
              tweetText = t;
            }
          }

          return { noteText, sourceUrl: sourceLinks[0] || null, viewCount, shownOnX, cellStatus, postUnavailable, hasInterstitial, tweetHandle, tweetText, tweetTime };
        });
      }

      // --- Helper: click the cell's View details button/link ---
      async function clickViewDetails(): Promise<boolean> {
        try {
          return await cell.evaluate(el => {
            const blocker = (e: Event) => {
              if ((e.target as HTMLElement).closest?.('a')) {
                e.preventDefault();
                e.stopPropagation();
              }
            };
            document.addEventListener('click', blocker, true);
            try {
              const noteLink = el.querySelector('a[href*="/communitynotes/t/"]') as HTMLAnchorElement;
              if (noteLink) { noteLink.click(); return true; }
              const buttons = el.querySelectorAll('button, [role="button"]');
              for (const btn of buttons) {
                if (btn.textContent?.includes('View details')) {
                  (btn as HTMLElement).click();
                  return true;
                }
              }
              return false;
            } finally {
              document.removeEventListener('click', blocker, true);
            }
          });
        } catch (clickErr) {
          console.log(`   ${prefix} ⚠️ Click error: ${clickErr}`);
          return false;
        }
      }

      // --- Helper: wait for modal to render, then extract data ---
      type ModalData = { noteId: string | null; status: string; submittedDate: string; usedFallback?: boolean; raterTags?: string[] | null };
      async function waitAndExtractModal(maxWaitMs: number): Promise<ModalData | null> {
        for (let waitMs = 0; waitMs < maxWaitMs; waitMs += 150) {
          const state = await page.evaluate(() => {
            const modal = document.querySelector('[data-testid="sheetDialog"]') ||
                          document.querySelector('[role="dialog"]') ||
                          document.querySelector('[aria-modal="true"]') ||
                          document.querySelector('[data-testid="Drawer"]');
            const text = modal ? (modal as HTMLElement).innerText : document.body.innerText;
            const hasNoteId = /Note ID[\s:]*\d{18,20}/i.test(text);
            const hasStatus = /Current Status\s+(Not Helpful|Helpful|Needs More Ratings)\b/i.test(text)
              || /Currently (not )?rated helpful/i.test(text)
              || /Needs more ratings/i.test(text);
            return { hasNoteId, hasStatus };
          });
          if (state.hasNoteId && state.hasStatus) break;
          if (state.hasNoteId && waitMs >= maxWaitMs * 0.5) break;
          await new Promise(r => setTimeout(r, 120));
        }

        return await page.evaluate(() => {
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

          // New modal (May 2026): the "Note ID …" footer line lives in a sibling
          // container outside [data-testid="sheetDialog"]. If we found a modal
          // element but it's missing the Note ID line, widen to body text.
          const modalMissingNoteId = !!modalText && !/Note ID/i.test(modalText);
          if (!modalText || modalMissingNoteId) {
            const bodyText = document.body.innerText;
            if (!bodyText.includes('Note Details') && !bodyText.includes('Note ID')) {
              return null;
            }
            modalText = bodyText;
            usedFallback = true;
          }

          const noteIdMatch = modalText.match(/Note ID[:\s]*(\d{18,20})/i);
          const noteId = noteIdMatch ? (noteIdMatch[1] ?? null) : null;

          // In the new modal UI (May 2026+), the label appears on its own line
          // directly under a "Current Status" header: "Helpful" / "Not Helpful" /
          // "Needs More Ratings". Fall back to the older "Currently rated ..." copy.
          const parseStatus = (text: string): string => {
            const headerMatch = text.match(/Current Status\s+(Not Helpful|Helpful|Needs More Ratings)\b/i);
            if (headerMatch) {
              const label = headerMatch[1]!.toLowerCase();
              if (label === 'not helpful') return 'CURRENTLY_RATED_NOT_HELPFUL';
              if (label === 'helpful') return 'CURRENTLY_RATED_HELPFUL';
              if (label === 'needs more ratings') return 'NEEDS_MORE_RATINGS';
            }
            // No leading \b — body-fallback text concatenates DOM without spaces.
            if (/Currently rated not helpful/i.test(text)) return 'CURRENTLY_RATED_NOT_HELPFUL';
            if (/Currently rated helpful/i.test(text)) return 'CURRENTLY_RATED_HELPFUL';
            if (/Needs more ratings/i.test(text)) return 'NEEDS_MORE_RATINGS';
            return 'UNKNOWN';
          };

          let status = 'UNKNOWN';
          if (usedFallback && noteId) {
            const noteIdPos = modalText.indexOf('Note ID');
            if (noteIdPos !== -1) {
              // New UI puts "Current Status" ABOVE "Note ID"; old fallback only looked after.
              // Search the whole text once we've confirmed Note ID is present.
              status = parseStatus(modalText);
            }
          } else {
            status = parseStatus(modalText);
          }

          const dateMatch = modalText.match(/Note submitted[:\s]*([\d:]+\s*(?:AM|PM)?)\s*[·•]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i);
          const submittedDate = dateMatch ? (dateMatch[2] ?? '') : '';

          const raterTags: string[] = [];
          const tagsMatch = modalText.match(/Top tags selected by raters\s*\n([\s\S]*?)(?:\n\s*\n|Note ID|Note submitted|$)/i);
          if (tagsMatch) {
            const tagLines = tagsMatch[1]!.split('\n').map(l => l.trim()).filter(l => l.length > 0 && l.length < 80);
            for (const line of tagLines) {
              if (/^(note|rating|status|currently|needs|shown)/i.test(line)) break;
              raterTags.push(line);
            }
          }

          return { noteId, status, submittedDate, usedFallback, raterTags: raterTags.length > 0 ? raterTags : null };
        });
      }

      // ============================================================
      // OUTER CONFLICT RETRY LOOP: cell scrape → modal → conflict check
      // Retries everything up to 2 more times if cross-source data conflicts
      // ============================================================
      let tweetData: Awaited<ReturnType<typeof readCellTweetData>> = { tweetId: null, tweetUrl: null, noteIdFromUrl: null };
      let cellData: Awaited<ReturnType<typeof readCellData>> = { noteText: '', sourceUrl: null, viewCount: null, shownOnX: null, cellStatus: null, postUnavailable: false, hasInterstitial: false, tweetHandle: null, tweetText: null, tweetTime: null };
      let modalData: ModalData | null = null;

      conflictLoop:
      for (let conflictRetry = 0; conflictRetry < 3; conflictRetry++) {
        if (conflictRetry > 0) {
          console.log(`   ${prefix} 🔄 Conflict retry ${conflictRetry}/2 — re-reading cell and modal`);
          await page.keyboard.press('Escape');
          await new Promise(r => setTimeout(r, 1600));
        }

        // --- CELL SCRAPE with retries (up to 6 attempts) ---
        // If any tweet info is present (handle, text, time), the tweet exists —
        // keep retrying until all tweet fields are populated
        for (let cellAttempt = 0; cellAttempt < 6; cellAttempt++) {
          tweetData = await readCellTweetData();
          cellData = await readCellData();
          const cellMissing: string[] = [];
          // When the original post is unavailable or hidden behind a sensitive-content
          // interstitial, the embedded tweet DOM doesn't exist in the cell at all —
          // tweet_id/handle/text will never appear, so don't waste retries on them.
          // The modal still has the noteId.
          const embeddedTweetAbsent = cellData.postUnavailable || cellData.hasInterstitial;
          if (!embeddedTweetAbsent && !tweetData.tweetId) cellMissing.push('tweet_id');
          if (!cellData.noteText) cellMissing.push('note_text');
          if (!cellData.cellStatus) cellMissing.push('status');
          // If we see ANY tweet info, the tweet is present — retry for all tweet fields
          const hasSomeTweetInfo = cellData.tweetHandle || cellData.tweetText || cellData.tweetTime;
          if (!embeddedTweetAbsent && hasSomeTweetInfo) {
            if (!cellData.tweetHandle) cellMissing.push('tweet_handle');
            if (!cellData.tweetText) cellMissing.push('tweet_text');
            if (!cellData.tweetTime) cellMissing.push('tweet_time');
          }
          if (cellMissing.length === 0) break;
          if (cellAttempt < 5) {
            console.log(`   ${prefix} 🔄 Cell retry ${cellAttempt + 1}/6: missing ${cellMissing.join(', ')}`);
            await randomDelay(400, 800);
          } else {
            // Final attempt failed — dump cell innerText so we can diagnose the layout.
            const dump = await cell.evaluate(el => {
              const text = (el as HTMLElement).innerText || '';
              const links = [...el.querySelectorAll('a[href]')].map(a => (a as HTMLAnchorElement).getAttribute('href')).slice(0, 10);
              const testIds = [...el.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid')).slice(0, 20);
              return { text: text.slice(0, 800), links, testIds };
            }).catch(() => null);
            if (dump) {
              console.log(`   ${prefix} 🐛 Cell dump — testIds: ${JSON.stringify(dump.testIds)}`);
              console.log(`   ${prefix} 🐛 Cell dump — links: ${JSON.stringify(dump.links)}`);
              console.log(`   ${prefix} 🐛 Cell dump — innerText:\n${dump.text.split('\n').map(l => '       | ' + l).join('\n')}`);
            }
          }
        }

        // Skip if we already have this tweet
        if (tweetData.tweetId && [...collectedNotes.values()].some(n => n.tweet_id === tweetData.tweetId)) {
          break conflictLoop;
        }

        // Scroll cell into view
        await cell.evaluate(el => {
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
        });
        await randomDelay(80, 160);

        // Check if cell has a clickable "View details" button
        const hasViewDetails = await cell.evaluate(el => {
          const noteLink = el.querySelector('a[href*="/communitynotes/t/"]');
          if (noteLink) return 'A';
          const buttons = el.querySelectorAll('button, [role="button"]');
          for (const btn of buttons) {
            if (btn.textContent?.includes('View details')) return btn.tagName;
          }
          return null;
        });

        if (!hasViewDetails) break conflictLoop;

        if (conflictRetry === 0) {
          console.log(`   ${prefix} 🖱️ Clicking View details [${hasViewDetails}]`);
        }

        // --- MODAL EXTRACTION with quality retries (up to 6 attempts) ---
        const maxQualityRetries = 5;
        const modalWaits = [3000, 5000, 8000, 10000, 10000, 10000];

        let accNoteId: string | null = null;
        let accStatus: string = 'UNKNOWN';
        let accSubmittedDate: string = '';
        let accRaterTags: string[] | null = null;
        let finalModalData: ModalData | null = null;

        // Only check fields the modal can provide (status, submittedDate).
        // Cell-only fields (tweet_id, note_text, view_count) can't be fixed by modal retries.
        // Rater tags are NOT required: X only shows the "Top tags selected by raters"
        // section when raters have agreed on tags. Many Helpful notes have no tags section
        // in the modal at all — requiring it caused 5 useless retries per such note.
        function checkModalMissingFields(): string[] {
          const missing: string[] = [];
          if (accStatus === 'UNKNOWN') missing.push('status');
          if (!accSubmittedDate) missing.push('submitted_date');
          return missing;
        }

        for (let qualityAttempt = 0; qualityAttempt <= maxQualityRetries; qualityAttempt++) {
          let clicked = false;
          for (let clickRetry = 0; clickRetry < 3; clickRetry++) {
            if (clickRetry > 0) {
              console.log(`   ${prefix} 🔄 Click retry ${clickRetry}...`);
              await randomDelay(400, 800);
            }
            clicked = await clickViewDetails();
            if (clicked) break;
          }
          if (!clicked) {
            console.log(`   ${prefix} ⚠️ Could not click View details`);
            break;
          }

          const waitMs = modalWaits[qualityAttempt] || 3000;
          const md = await waitAndExtractModal(waitMs);

          if (!md?.noteId) {
            await page.keyboard.press('Escape');
            await randomDelay(160, 320);
            if (qualityAttempt < maxQualityRetries) {
              console.log(`   ${prefix} 🔄 No note ID in modal — quality retry ${qualityAttempt + 1}/${maxQualityRetries}`);
              qualityRetryCount++;
            }
            continue;
          }

          // Accumulate modal data (use latest if modal-vs-modal conflicts)
          if (accNoteId && md.noteId && accNoteId !== md.noteId) {
            // Different note loaded — use latest
            accNoteId = md.noteId;
            accStatus = md.status !== 'UNKNOWN' ? md.status : 'UNKNOWN';
            accSubmittedDate = md.submittedDate;
            accRaterTags = md.raterTags || null;
          } else {
            if (!accNoteId && md.noteId) accNoteId = md.noteId;
            const newStatus = md.status !== 'UNKNOWN' ? md.status : null;
            if (accStatus === 'UNKNOWN' && newStatus) accStatus = newStatus;
            if (!accSubmittedDate && md.submittedDate) accSubmittedDate = md.submittedDate;
            if (!accRaterTags && md.raterTags) accRaterTags = md.raterTags;
          }

          finalModalData = md;

          const missingFields = checkModalMissingFields();
          if (missingFields.length === 0) break;

          // On the FINAL retry, dump while the modal is still open so we can see
          // what the layout actually looks like for the missing field.
          if (qualityAttempt >= maxQualityRetries) {
            const dump = await page.evaluate(() => {
              const modal = document.querySelector('[data-testid="sheetDialog"]') ||
                            document.querySelector('[role="dialog"]') ||
                            document.querySelector('[aria-modal="true"]');
              const modalText = modal ? (modal as HTMLElement).innerText.slice(0, 1500) : '(no modal element)';
              const bodyText = document.body.innerText;
              const tagsIdx = bodyText.indexOf('Top tags');
              const slice = (i: number) => i >= 0 ? bodyText.slice(Math.max(0, i - 50), i + 500) : '(not found)';
              return { modalText, bodyAroundTags: slice(tagsIdx) };
            }).catch(() => null);
            if (dump) {
              console.log(`   ${prefix} 🐛 Modal dump (final retry, missing=[${missingFields.join(', ')}]) — modal innerText:\n${dump.modalText.split('\n').map(l => '       | ' + l).join('\n')}`);
              console.log(`   ${prefix} 🐛 Body around "Top tags":\n${dump.bodyAroundTags.split('\n').map(l => '       | ' + l).join('\n')}`);
            }
          }

          await page.keyboard.press('Escape');

          if (qualityAttempt < maxQualityRetries) {
            const retryWait = [800, 1600, 2400, 3200, 4000][qualityAttempt] || 1600;
            console.log(`   ${prefix} 🔄 Quality retry ${qualityAttempt + 1}/${maxQualityRetries}: missing=[${missingFields.join(', ')}]`);
            qualityRetryCount++;
            await new Promise(r => setTimeout(r, retryWait));
          }
        } // end quality retry loop

        // Build modalData from accumulated
        modalData = finalModalData;
        if (accNoteId && modalData) {
          modalData.noteId = accNoteId;
          if (accStatus !== 'UNKNOWN') modalData.status = accStatus;
          if (accSubmittedDate) modalData.submittedDate = accSubmittedDate;
          if (accRaterTags) modalData.raterTags = accRaterTags;
        }

        if (!modalData?.noteId) break conflictLoop; // No modal data — nothing to conflict-check

        // --- CROSS-SOURCE CONFLICT CHECK ---
        const crossConflicts: string[] = [];
        if (tweetData.noteIdFromUrl && modalData.noteId && tweetData.noteIdFromUrl !== modalData.noteId) {
          crossConflicts.push(`note_id: URL=${tweetData.noteIdFromUrl} modal=${modalData.noteId}`);
        }
        if (cellData.cellStatus && modalData.status !== 'UNKNOWN' && cellData.cellStatus !== modalData.status) {
          crossConflicts.push(`status: cell=${cellData.cellStatus} modal=${modalData.status}`);
        }

        if (crossConflicts.length === 0) break conflictLoop; // All good

        console.log(`   ${prefix} ⚠️ CROSS-SOURCE CONFLICT: ${crossConflicts.join(', ')}`);
        if (conflictRetry >= 2) {
          console.log(`   ${prefix} ⚠️ Conflict persists after 3 attempts — skipping note`);
          modalData = null;
          break conflictLoop;
        }
        qualityRetryCount++;
      } // end conflict retry loop

      if (!modalData || !modalData.noteId) {
        console.log(`   ${prefix} ⚠️ Could not extract valid data for this cell`);
        await page.keyboard.press('Escape');
        await randomDelay(160, 320);
        continue;
      }

      // Skip if another tab already got this note
      if (collectedNotes.has(modalData.noteId)) {
        await page.keyboard.press('Escape');
        await randomDelay(80, 160);
        continue;
      }

      const noteIdBigInt = BigInt(modalData.noteId);

      // Use cell status as fallback when modal gives UNKNOWN
      const finalStatus = modalData.status !== 'UNKNOWN' ? modalData.status
        : (cellData.cellStatus || 'UNKNOWN');

      // Determine tweet_id: real link > post_unavailable > unavailable_noteId
      const finalTweetId = tweetData.tweetId
        || (cellData.postUnavailable ? 'post_unavailable' : `unavailable_${modalData.noteId}`);

      const shownInfo = cellData.shownOnX === true ? ' [Shown on X]' : cellData.shownOnX === false ? ' [Not shown on X]' : '';
      const viewInfo = cellData.viewCount ? ` [${cellData.viewCount.toLocaleString()} views]` : '';
      const tweetInfo = tweetData.tweetId ? ` tweet:${tweetData.tweetId}` : (cellData.postUnavailable ? ' [Post unavailable]' : ' [No tweet link]');
      const textPreview = cellData.noteText ? ` "${cellData.noteText.slice(0, 80)}${cellData.noteText.length > 80 ? '...' : ''}"` : '';
      console.log(`   ${prefix} ✓ Found Note ID: ${modalData.noteId} (${finalStatus})${shownInfo}${viewInfo}${tweetInfo}${textPreview}`);

      const tweetMetaInfo = cellData.tweetHandle ? ` [@${cellData.tweetHandle}${cellData.tweetTime ? ` · ${cellData.tweetTime}` : ''}]` : '';
      if (tweetMetaInfo) console.log(`   ${prefix}   ${tweetMetaInfo}${cellData.tweetText ? ` "${cellData.tweetText.slice(0, 60)}${cellData.tweetText.length > 60 ? '...' : ''}"` : ''}`);
      const tagInfo = modalData.raterTags ? ` [tags: ${modalData.raterTags.join(', ')}]` : '';
      if (tagInfo) console.log(`   ${prefix}   ${tagInfo}`);

      const note: ScrapedNote = {
        note_id: modalData.noteId,
        tweet_id: finalTweetId,
        note_text: cellData.noteText,
        cn_status: finalStatus,
        created_at: modalData.submittedDate,
        source_url: cellData.sourceUrl || undefined,
        view_count: cellData.viewCount || undefined,
        shown_on_x: cellData.shownOnX,
        rater_tags: modalData.raterTags || undefined,
        tweet_handle: cellData.tweetHandle || undefined,
        tweet_text: cellData.tweetText || undefined,
        tweet_time: cellData.tweetTime || undefined,
      };

      collectedNotes.set(modalData.noteId, note);
      foundNewNote = true;
      if (modalData.submittedDate) lastNoteDate = modalData.submittedDate;

      // Early exit if we've reached the stop point or the very bottom of the list
      const effectiveBottom = stopAtNoteId ?? BOTTOM_NOTE_ID;
      if (noteIdBigInt <= effectiveBottom) {
        const label = stopAtNoteId ? 'stop-at target' : 'bottom note';
        console.log(`\n   ${prefix} 🎉 Reached the ${label} (${modalData.noteId})! Scrape complete.`);
        break recoveryLoop;
      }

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

      // Wait for modal to actually leave the DOM before continuing
      try {
        await page.waitForFunction(() => {
          return !document.querySelector('[role="dialog"]') &&
                 !document.querySelector('[aria-modal="true"]') &&
                 !document.querySelector('[data-testid="sheetDialog"]');
        }, { timeout: 3000 });
      } catch {
        // Timeout is non-fatal — press Escape again and continue
        await page.keyboard.press('Escape');
        await randomDelay(300, 500);
      }

      // Cooldown after modal close — reduces burst failures on next click
      await randomDelay(160, 320);
    }

    if (!foundNewNote) {
      stuckCount++;
      if (stuckCount >= stuckBeforePause) {
        retryCount++;
        if (retryCount > maxRetries) {
          console.log(`\n   ${prefix} 🛑 Scroll stuck${lastNoteDate ? ` (last note: ${lastNoteDate})` : ''}. Exhausted ${maxRetries} jiggle retries — done.`);
          break;
        }
        // Unstick the virtualizer: escalating wait, then scroll up a big chunk, wait, scroll back down
        const waitMs = jiggleWaits[retryCount - 1] || 0;
        if (waitMs > 0) {
          console.log(`\n   ${prefix} ⏳ Scroll stuck${lastNoteDate ? ` (last note: ${lastNoteDate})` : ''}. Waiting ${waitMs / 1000}s before jiggle ${retryCount}/${maxRetries}...`);
          await new Promise(r => setTimeout(r, waitMs));
        }
        console.log(`\n   ${prefix} 🔄 Jiggling virtualizer (retry ${retryCount}/${maxRetries})...`);
        const jiggleDistance = 3000 + (retryCount * 2000); // Scroll up further each retry
        await page.evaluate((dist) => {
          const html = document.documentElement;
          html.scrollTop = Math.max(0, html.scrollTop - dist);
          html.dispatchEvent(new Event('scroll', { bubbles: true }));
          window.dispatchEvent(new Event('scroll', { bubbles: true }));
        }, jiggleDistance);
        await new Promise(r => setTimeout(r, 1600)); // Let virtualizer re-render
        // Scroll back down past where we were
        await page.evaluate((dist) => {
          const html = document.documentElement;
          html.scrollTop += dist + 600; // Go slightly past original position
          html.dispatchEvent(new Event('scroll', { bubbles: true }));
          window.dispatchEvent(new Event('scroll', { bubbles: true }));
        }, jiggleDistance);
        await new Promise(r => setTimeout(r, 800));
        stuckCount = 0;
        processedCells.clear(); // Clear fingerprints since we're in shifted territory
        console.log(`   ${prefix} ▶️  Resuming after jiggle...`);
      }
    } else {
      stuckCount = 0;
      retryCount = 0;
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
        console.log(`   ${prefix} 📍 At bottom${lastNoteDate ? ` (last note: ${lastNoteDate})` : ''}`);
        // Wait longer at bottom — the virtualizer needs time to extend the page
        await new Promise(r => setTimeout(r, 1600));
      }
    } catch (scrollErr: unknown) {
      const errMsg = scrollErr instanceof Error ? scrollErr.message : String(scrollErr);
      console.log(`   ${prefix} ⚠️ Scroll error: ${errMsg.slice(0, 60)}`);
    }

    await randomDelay(240, 400);
      }
      // Normal completion — exit recovery loop
      break recoveryLoop;
    } catch (loopErr: unknown) {
      const errMsg = loopErr instanceof Error ? loopErr.message : String(loopErr);

      // Recoverable frame detach — open new tab and scroll back
      if (errMsg.toLowerCase().includes('detached frame') || errMsg.includes('Execution context') || errMsg.includes('Target closed') || errMsg.includes('Session closed') || errMsg.includes('Connection closed')) {
        frameRecoveries++;
        if (frameRecoveries > MAX_FRAME_RECOVERIES) {
          console.log(`\n${prefix} 💀 Frame detach recovery limit reached (${MAX_FRAME_RECOVERIES}). Tab stopping.`);
          break recoveryLoop;
        }

        console.log(`\n${prefix} 🔄 Frame detached! Recovering (${frameRecoveries}/${MAX_FRAME_RECOVERIES})...`);

        try {
          const recovered = await reconnectToTab(browser, notewriterUrl, prefix);
          browser = recovered.browser;
          currentPage = recovered.page;

          processedCells = new Set<string>();
          stuckCount = 0;
          retryCount = 0;
          scrollCount = 0;

          continue recoveryLoop;
        } catch (recoveryErr) {
          console.log(`\n${prefix} 💀 Recovery failed: ${recoveryErr}`);
          break recoveryLoop;
        }
      }

      // Non-recoverable error
      console.log(`\n${prefix} ⚠️ Scraping interrupted: ${errMsg.slice(0, 100)}`);
      console.log(`   ${prefix} Collected ${collectedNotes.size} notes so far`);
      break recoveryLoop;
    }
  } // end recoveryLoop

  console.log(`\n${prefix} ✅ Tab finished. Total notes across all tabs: ${collectedNotes.size}`);
}


/**
 * Query DB for note IDs at specific percentile positions.
 * Returns a map from fraction (e.g. 0.33) to the note ID at that position.
 * Uses paginated query to avoid the 1000-row limit.
 */
async function main() {
  // Parse args
  const args = process.argv.slice(2);
  const freshStart = args.includes('--fresh');

  // Parse --start-from <noteId> to resume from a previous run's last position
  const startFromIdx = args.indexOf('--start-from');
  const startFromNoteId = startFromIdx !== -1 && args[startFromIdx + 1]
    ? BigInt(args[startFromIdx + 1]!)
    : null;

  // Parse --stop-at <noteId> to stop scraping at a specific note instead of BOTTOM_NOTE_ID
  const stopAtIdx = args.indexOf('--stop-at');
  const stopAtNoteId = stopAtIdx !== -1 && args[stopAtIdx + 1]
    ? BigInt(args[stopAtIdx + 1]!)
    : null;

  // Filter out flag args and their values
  const flagValueIndices = new Set<number>();
  if (startFromIdx !== -1) {
    flagValueIndices.add(startFromIdx);
    flagValueIndices.add(startFromIdx + 1);
  }
  if (stopAtIdx !== -1) {
    flagValueIndices.add(stopAtIdx);
    flagValueIndices.add(stopAtIdx + 1);
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
      defaultViewport: null, // Use browser's actual window size, not Puppeteer's 800x600 default
    });
  } catch (err) {
    console.error("❌ Failed to connect to Chrome.");
    console.error("Make sure Chrome is running with remote debugging:");
    console.error('  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile');
    process.exit(1);
  }

  console.log("✅ Connected to Chrome\n");
  console.log(`🚀 Starting scrape (max ${maxNotes} notes)...`);
  if (stopAtNoteId) {
    console.log(`   🛑 Will stop at note ${stopAtNoteId}`);
  }
  console.log();

  // Find or create the notewriter tab
  let page: Page;
  const existingPages = await browser.pages();
  const existingNotewriterTabs = existingPages.filter(p => p.url().includes("communitynotes"));

  if (freshStart) {
    // Fresh start: open a new tab (avoids stale virtualizer state)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.log(`📄 Opening fresh tab: ${notewriterUrl}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
        page = await browser.newPage();
        activeTargetId = (page.target() as any)?._targetId ?? null;
        await page.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
        break;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`   ⚠️ Tab creation failed: ${msg.slice(0, 80)}`);
        if (attempt === 2) throw e;
        await new Promise(r => setTimeout(r, 1600));
      }
    }
    page = page!;
  } else if (existingNotewriterTabs.length > 0) {
    // Pick the tab scrolled furthest down (highest scrollTop = most progress)
    let bestTab = existingNotewriterTabs[0]!;
    let bestScroll = await bestTab.evaluate(() => document.documentElement.scrollTop).catch(() => -1);
    for (let i = 1; i < existingNotewriterTabs.length; i++) {
      const scrollPos = await existingNotewriterTabs[i]!.evaluate(() => document.documentElement.scrollTop).catch(() => -1);
      if (scrollPos > bestScroll) {
        bestScroll = scrollPos;
        bestTab = existingNotewriterTabs[i]!;
      }
    }
    page = bestTab;
    activeTargetId = (page.target() as any)?._targetId ?? null;
    console.log(`📄 Reusing furthest-scrolled tab (scrollY=${bestScroll}, ${existingNotewriterTabs.length} tab${existingNotewriterTabs.length > 1 ? "s" : ""} found): ${page.url().slice(0, 80)}`);
  } else {
    // No existing tabs — open a new one
    console.log(`📄 Opening new tab: ${notewriterUrl}`);
    page = await browser.newPage();
    activeTargetId = (page.target() as any)?._targetId ?? null;
    await page.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
  }

  // If fresh start, scroll to top
  if (freshStart) {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    await new Promise(r => setTimeout(r, 400));
  }

  await waitForContent(page);

  // Shared map — create before positioning so scrollToPosition can save sampled notes
  const collectedNotes = new Map<string, ScrapedNote>();

  // The oldest known note — reaching this means we've covered the full list (also used in scrapeTab)
  // BOTTOM_NOTE_ID is defined at module scope
  const OCT_23_NOTE_ID = 1985806966241812487n; // Must reach at least this far to justify restarting
  const MAX_AUTO_RESTARTS = 20;
  let autoRestartCount = 0;
  let currentStartFrom = startFromNoteId;

  // Auto-restart loop: if scraping stops before reaching the bottom,
  // automatically open a fresh tab and resume from the last position
  autoRestartLoop:
  while (autoRestartCount <= MAX_AUTO_RESTARTS) {
    if (autoRestartCount > 0) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`🔄 Auto-restart ${autoRestartCount}/${MAX_AUTO_RESTARTS} — reconnecting and opening fresh tab...`);
      try {
        try { browser.disconnect(); } catch { /* may already be disconnected */ }
        await new Promise(r => setTimeout(r, 800));
        browser = await puppeteer.connect({
          browserURL: "http://127.0.0.1:9222",
          protocolTimeout: 120000,
          defaultViewport: null,
        });
        page = await browser.newPage();
        activeTargetId = (page.target() as any)?._targetId ?? null;
        await page.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
        await waitForContent(page);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`   💀 Restart failed: ${msg.slice(0, 80)}`);
        break autoRestartLoop;
      }
    }

    // Scroll to start position if resuming
    if (currentStartFrom) {
      console.log(`\n📍 ${autoRestartCount > 0 ? 'Resuming' : 'Starting'} from note ${currentStartFrom} — scrolling to position...`);
      try {
        const posResult = await scrollToPosition(page, browser, notewriterUrl, collectedNotes, currentStartFrom, 3000);
        page = posResult.page;
        browser = posResult.browser;
      } catch (scrollErr) {
        const msg = scrollErr instanceof Error ? scrollErr.message : String(scrollErr);
        console.log(`   ⚠️ Scroll-to-position failed: ${msg.slice(0, 100)}`);
        try {
          const recovered = await reconnectToTab(browser, notewriterUrl, "[scraper]");
          page = recovered.page;
          browser = recovered.browser;
        } catch { /* will fail at scrapeTab start if still broken */ }
        console.log(`   📍 Starting from current scroll position instead`);
      }
    }

    // Start scraping
    console.log(`\n${"=".repeat(60)}`);
    console.log(`🏁 ${autoRestartCount > 0 ? `Restart ${autoRestartCount}: scraping` : 'Starting scrape'}...\n`);

    await scrapeTab(browser, page, collectedNotes, maxNotes, notewriterUrl, stopAtNoteId);

    // Check if we reached the bottom
    const scrapedNoteIds = [...collectedNotes.keys()]
      .filter(id => /^\d+$/.test(id))
      .map(id => BigInt(id));
    const oldestScraped = scrapedNoteIds.length > 0
      ? scrapedNoteIds.reduce((a, b) => a < b ? a : b)
      : null;

    const effectiveBottom = stopAtNoteId ?? BOTTOM_NOTE_ID;
    if (oldestScraped !== null && oldestScraped <= effectiveBottom) {
      const label = stopAtNoteId ? 'stop-at target' : 'bottom';
      console.log(`\n🎉 Reached the ${label}! Oldest scraped: ${oldestScraped}`);
      break autoRestartLoop;
    }

    if (collectedNotes.size >= maxNotes) {
      console.log(`\n📊 Hit max notes limit (${maxNotes}) — stopping.`);
      break autoRestartLoop;
    }

    // Don't restart if we haven't even reached Oct 23 — something is fundamentally broken
    if (oldestScraped !== null && oldestScraped > OCT_23_NOTE_ID) {
      console.log(`\n⚠️ Didn't reach Oct 23 (oldest scraped: ${oldestScraped}). Not restarting.`);
      break autoRestartLoop;
    }

    // Not at bottom yet — auto-restart from where we stopped
    if (oldestScraped !== null) {
      currentStartFrom = oldestScraped;
      autoRestartCount++;
      console.log(`\n⏩ Haven't reached bottom yet (oldest: ${oldestScraped}). Auto-restarting...`);
    } else {
      console.log(`\n⚠️ No notes scraped in this run — stopping.`);
      break autoRestartLoop;
    }
  } // end autoRestartLoop

  if (autoRestartCount > MAX_AUTO_RESTARTS) {
    console.log(`\n⚠️ Hit auto-restart limit (${MAX_AUTO_RESTARTS}). Stopping.`);
  }

  console.log(`\n✅ Scrape finished! Collected ${collectedNotes.size} notes total (${qualityRetryCount} quality retries)\n`);

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

  // Final reconciliation (tier classification, collision resolution, canonical data).
  // Snapshots are persisted per-note already, so a hard Ctrl+C / crash mid-run
  // is recoverable: a future clean run's end-of-script reconcile rebuilds the
  // canonical state from the full snapshot history.
  await runReconcile();

  // Print resume command based on oldest note scraped
  const scrapedNoteIds = [...collectedNotes.keys()]
    .filter(id => /^\d+$/.test(id))
    .map(id => BigInt(id));
  if (scrapedNoteIds.length > 0) {
    const oldestReached = scrapedNoteIds.reduce((a, b) => a < b ? a : b);
    console.log(`\n📌 To resume from where this run stopped:`);
    console.log(`   bun run src/scripts/scrapeNotewriterClickThrough.ts ${maxNotes} --fresh --start-from ${oldestReached}`);
  }

  console.log("\n💡 Chrome browser left open. Close it manually when done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
