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
 *    bun run src/scripts/scrapeNotewriterClickThrough.ts [maxNotes] [--fresh] [--start-from <noteId>]
 *
 *    --fresh: Open a new tab and start from top (otherwise reuses existing tab)
 *    --start-from <noteId>: Scroll to this note ID before scraping
 */

import "dotenv/config";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { getSupabaseClient, SupabaseLogger } from "../api/supabaseClient";

const DEFAULT_USERNAME = "wholesome-raspberry-stilt";
const SCROLL_PX = 600;
const MAX_JUMPS = 10; // Safety valve to prevent infinite gap-jump loops
const BOTTOM_NOTE_ID = 1976702059752911225n; // Oldest known note — reaching this = full coverage

// --- Scroll coverage tracking ---
// Note IDs serve as position markers — higher = newer = earlier in the list (lower scroll position)
interface CoveredRegion {
  newest: bigint;  // highest note ID (top of region)
  oldest: bigint;  // lowest note ID (bottom of region)
}

// Scroll coverage tracking
let coveredRegions: CoveredRegion[] = [];

// Jump estimation accuracy tracking
interface JumpEstimation {
  targetNoteId: bigint;
  targetFraction: number;
  estimatedScrolls: number;
  actualFirstNoteId: bigint | null;
  actualFraction: number | null;
}
const jumpEstimations: JumpEstimation[] = [];

/** Get the overall note ID range */
function getOverallRange(): { newest: bigint; oldest: bigint } | null {
  let newest: bigint | null = null;
  let oldest: bigint | null = null;
  for (const r of coveredRegions) {
    if (newest === null || r.newest > newest) newest = r.newest;
    if (oldest === null || r.oldest < oldest) oldest = r.oldest;
  }
  if (newest === null || oldest === null) return null;
  return { newest, oldest };
}

/** Merge covered regions into a sorted, non-overlapping list */
function getMergedRegions(): CoveredRegion[] {
  if (coveredRegions.length === 0) return [];

  const all = coveredRegions.map(r => ({ ...r }));
  // Sort by newest descending (higher note ID = earlier in list)
  all.sort((a, b) => (b.newest > a.newest ? 1 : b.newest < a.newest ? -1 : 0));

  const merged: CoveredRegion[] = [all[0]!];
  for (let i = 1; i < all.length; i++) {
    const current = all[i]!;
    const last = merged[merged.length - 1]!;
    if (current.newest >= last.oldest) {
      if (current.oldest < last.oldest) {
        last.oldest = current.oldest;
      }
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** Find the closest gap to the current scroll position */
function getClosestGap(): { above: bigint; below: bigint } | null {
  const merged = getMergedRegions();
  if (merged.length <= 1) return null;

  const gaps: { above: bigint; below: bigint }[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const gapAbove = merged[i]!.oldest;
    const gapBelow = merged[i + 1]!.newest;
    if (gapAbove > gapBelow) {
      gaps.push({ above: gapAbove, below: gapBelow });
    }
  }
  if (gaps.length === 0) return null;

  const currentPos = coveredRegions.length > 0
    ? coveredRegions[coveredRegions.length - 1]!.oldest
    : 0n;

  let closest = gaps[0]!;
  let closestDist = abs(gapMidpoint(closest) - currentPos);
  for (let i = 1; i < gaps.length; i++) {
    const dist = abs(gapMidpoint(gaps[i]!) - currentPos);
    if (dist < closestDist) {
      closest = gaps[i]!;
      closestDist = dist;
    }
  }
  return closest;
}

function gapMidpoint(gap: { above: bigint; below: bigint }): bigint {
  return (gap.above + gap.below) / 2n;
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** Update the current region with a newly found note ID */
function updateCoverageRegion(noteId: bigint): void {
  if (coveredRegions.length === 0 || needsNewRegion) {
    coveredRegions.push({ newest: noteId, oldest: noteId });
    needsNewRegion = false;
    return;
  }
  const current = coveredRegions[coveredRegions.length - 1]!;
  if (noteId > current.newest) current.newest = noteId;
  if (noteId < current.oldest) current.oldest = noteId;
}

/** Mark that the next updateCoverageRegion should start a fresh region (after a jump) */
let needsNewRegion = false;
function startNewRegion(): void {
  needsNewRegion = true;
}

/**
 * Estimate how many quickScrolls to reach a target note ID.
 * Uses fraction-based estimate: if target is X% through the note ID range,
 * scroll roughly X% of the estimated total scrolls.
 * Returns the number of quickScroll steps from the top.
 */
function estimateScrollsForNoteId(
  targetNoteId: bigint,
  newestNoteId: bigint,
  oldestNoteId: bigint,
  totalEstimatedScrolls: number,
): { scrollCount: number; fraction: number } {
  const range = newestNoteId - oldestNoteId;
  if (range <= 0n) return { scrollCount: 0, fraction: 0 };
  const distFromTop = newestNoteId - targetNoteId;
  const fraction = Number(distFromTop) / Number(range);
  const scrollCount = Math.round(fraction * totalEstimatedScrolls);
  return { scrollCount, fraction };
}

/** Print scroll estimation summary at end of run */
function printEstimationSummary(): void {
  if (jumpEstimations.length === 0) {
    console.log("\n📐 No jumps with estimation data to summarize.");
    return;
  }

  const withData = jumpEstimations.filter(e => e.actualFirstNoteId !== null && e.actualFraction !== null);
  if (withData.length === 0) {
    console.log("\n📐 No jumps landed on identifiable positions.");
    return;
  }

  console.log(`\n📐 Scroll estimation summary (${jumpEstimations.length} jumps, ${withData.length} with landing data):`);
  const errors: number[] = [];
  for (const e of withData) {
    const error = Math.abs(e.targetFraction - e.actualFraction!);
    errors.push(error);
  }
  const meanError = errors.reduce((a, b) => a + b, 0) / errors.length;
  const worstIdx = errors.indexOf(Math.max(...errors));
  const worst = withData[worstIdx]!;
  console.log(`   Mean fraction error:  ${(meanError * 100).toFixed(1)}%`);
  console.log(`   Worst fraction error: ${(errors[worstIdx]! * 100).toFixed(1)}%`);
  console.log(`   Target fractions: [${jumpEstimations.map(e => (e.targetFraction * 100).toFixed(0) + '%').join(', ')}]`);
  console.log(`   Actual fractions: [${jumpEstimations.map(e => e.actualFraction !== null ? (e.actualFraction * 100).toFixed(0) + '%' : '?').join(', ')}]`);
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
  await new Promise(r => setTimeout(r, 1000));

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
  const BATCH_DELAY_MS = 1500;
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

          await delay(75 + Math.random() * 25);
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

    await new Promise(r => setTimeout(r, BATCH_DELAY_MS + Math.random() * 1000));
  }

  const pos = await currentPage.evaluate(() => document.documentElement.scrollTop).catch(() => -1);
  console.log(`   ${prefix} Reached scrollTop=${pos} after ${totalScrollsDone} scrolls`);
  return { page: currentPage, browser: currentBrowser };
}

/**
 * Sample a single note from the current view during positioning.
 * Clicks "View details" on the first available cell, extracts note data
 * from the modal, saves to DB, and returns the note ID.
 */
async function sampleOneNote(
  page: Page,
  collectedNotes: Map<string, ScrapedNote>,
  processedCells: Set<string>,
): Promise<bigint | null> {
  const prefix = `[scraper]`;
  try {
    const cells = await page.$$('[data-testid="cellInnerDiv"]');
    for (const cell of cells) {
      // Fingerprint to avoid re-sampling the same cell
      const fp = await cell.evaluate(el => {
        const link = el.querySelector('a[href*="/communitynotes/t/"]') as HTMLAnchorElement;
        return link ? link.href : (el as HTMLElement).innerText.slice(0, 100);
      });
      if (processedCells.has(fp)) continue;
      processedCells.add(fp);

      // Check that cell has "View details" before investing more work
      const hasViewDetails = await cell.evaluate(el => {
        const buttons = el.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          if (btn.textContent?.includes('View details')) return true;
        }
        return false;
      });
      if (!hasViewDetails) continue;

      // Extract tweet ID from cell — skip links inside note text
      const sampleCellData = await cell.evaluate(el => {
        const text = (el as HTMLElement).innerText;

        // Tweet ID: only grab /status/ links outside note text containers
        const allStatusLinks = [...el.querySelectorAll('a[href*="/status/"]')] as HTMLAnchorElement[];
        const noteTextContainers = el.querySelectorAll('div[dir="ltr"], span[dir="ltr"]');
        const noteTextEls = new Set<Node>();
        noteTextContainers.forEach(container => {
          if ((container as HTMLElement).innerText.trim().length > 50) noteTextEls.add(container);
        });
        let tweetId: string | null = null;
        for (const link of allStatusLinks) {
          let insideNoteText = false;
          for (const container of noteTextEls) {
            if (container.contains(link)) { insideNoteText = true; break; }
          }
          if (insideNoteText) continue;
          const match = link.href.match(/status\/(\d+)/);
          if (match) { tweetId = match[1]!; break; }
        }

        // Note text
        let noteText = '';
        noteTextContainers.forEach(p => {
          const t = (p as HTMLElement).innerText.trim();
          if (t.length > 50 && !t.includes('experimental AI') && !t.includes('Needs more ratings') && !t.includes('Currently rated') && t.length > noteText.length) {
            noteText = t;
          }
        });

        // Cell status
        let cellStatus: string | null = null;
        if (/\bCurrently not rated helpful\b/i.test(text)) cellStatus = 'CURRENTLY_RATED_NOT_HELPFUL';
        else if (/\bCurrently rated helpful\b/i.test(text)) cellStatus = 'CURRENTLY_RATED_HELPFUL';
        else if (/\bNeeds more ratings\b/i.test(text)) cellStatus = 'NEEDS_MORE_RATINGS';

        const postUnavailable = /\bPost unavailable\b/i.test(text);

        return { tweetId, noteText, cellStatus, postUnavailable };
      });

      // Scroll into view, then click the button directly via JS (not coordinates)
      // Using element.click() instead of page.mouse.click(x,y) prevents stale coordinates
      // from landing on a link and accidentally navigating away from the page.
      await cell.evaluate(el => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
      await new Promise(r => setTimeout(r, 200));

      const clicked = await cell.evaluate(el => {
        // Block any <a> navigation during the click (safety net)
        const blocker = (e: Event) => {
          if ((e.target as HTMLElement).closest?.('a')) {
            e.preventDefault();
            e.stopPropagation();
          }
        };
        document.addEventListener('click', blocker, true);
        try {
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
      if (!clicked) continue;

      // Wait for modal with status text
      for (let waitMs = 0; waitMs < 2500; waitMs += 150) {
        const state = await page.evaluate(() => {
          const text = document.body.innerText;
          const hasNoteId = /Note ID[\s:]*\d{18,20}/i.test(text);
          const hasStatus = /\bCurrently (not )?rated helpful\b/i.test(text) || /\bNeeds more ratings\b/i.test(text);
          return { hasNoteId, hasStatus };
        });
        if (state.hasNoteId && state.hasStatus) break;
        if (state.hasNoteId && waitMs >= 1500) break;
        await new Promise(r => setTimeout(r, 150));
      }

      // Extract note ID and status from modal
      const modalData = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const noteIdMatch = bodyText.match(/Note ID[:\s]*(\d{18,20})/i);
        if (!noteIdMatch) return null;

        let status = 'UNKNOWN';
        if (/\bCurrently not rated helpful\b/i.test(bodyText)) status = 'CURRENTLY_RATED_NOT_HELPFUL';
        else if (/\bCurrently rated helpful\b/i.test(bodyText)) status = 'CURRENTLY_RATED_HELPFUL';
        else if (/\bNeeds more ratings\b/i.test(bodyText)) status = 'NEEDS_MORE_RATINGS';

        const dateMatch = bodyText.match(/Note submitted[:\s]*([\d:]+\s*(?:AM|PM)?)\s*[·•]\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})/i);
        const submittedDate = dateMatch ? (dateMatch[2] ?? '') : '';
        return { noteId: noteIdMatch[1], status, submittedDate };
      });

      // Close modal
      await page.keyboard.press('Escape');
      await new Promise(r => setTimeout(r, 200));

      if (!modalData?.noteId) continue;

      const noteIdBigInt = BigInt(modalData.noteId);

      // Save note if not already collected
      if (!collectedNotes.has(modalData.noteId)) {
        const finalStatus = modalData.status !== 'UNKNOWN' ? modalData.status
          : (sampleCellData.cellStatus || 'UNKNOWN');
        const finalTweetId = sampleCellData.tweetId
          || (sampleCellData.postUnavailable ? 'post_unavailable' : `unavailable_${modalData.noteId}`);
        const note: ScrapedNote = {
          note_id: modalData.noteId,
          tweet_id: finalTweetId,
          note_text: sampleCellData.noteText,
          cn_status: finalStatus,
          created_at: modalData.submittedDate,
        };
        collectedNotes.set(modalData.noteId, note);
        await saveNoteIncrementally(note);
        console.log(`   ${prefix} 📍 Sampled: ${modalData.noteId} (${finalStatus})`);
      }

      return noteIdBigInt;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Rethrow frame detach errors — these need recovery at a higher level
    if (msg.toLowerCase().includes('detached frame') || msg.includes('Target closed') || msg.includes('Session closed')) {
      throw e;
    }
    console.log(`   ${prefix} ⚠️ Sample failed: ${msg.slice(0, 80)}`);
  }
  return null;
}

/** Wait for notewriter content to appear on a page. */
async function waitForContent(page: Page): Promise<void> {
  console.log(`   [scraper] Waiting for page to load...`);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
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
  totalEstimatedScrolls: number,
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
  const jiggleWaits = [1000, 2000, 4000, 8000, 15000, 30000, 60000, 120000];
  const maxRetries = jiggleWaits.length;
  let retryCount = 0;
  let jumpCount = 0;
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

      // Try to find tweet ID from the cell — only grab links outside the note text area
      const tweetData = await cell.evaluate(el => {
        // Find all /status/ links in the cell
        const allStatusLinks = [...el.querySelectorAll('a[href*="/status/"]')] as HTMLAnchorElement[];

        // Filter out links that are inside the note text (div[dir="ltr"] containers with long text)
        // The parent tweet link is typically at the top of the cell, not inside the note body
        const noteTextContainers = el.querySelectorAll('div[dir="ltr"], span[dir="ltr"]');
        const noteTextEls = new Set<Node>();
        noteTextContainers.forEach(container => {
          if ((container as HTMLElement).innerText.trim().length > 50) {
            noteTextEls.add(container);
          }
        });

        for (const link of allStatusLinks) {
          // Skip links that are inside a note text container
          let insideNoteText = false;
          for (const container of noteTextEls) {
            if (container.contains(link)) { insideNoteText = true; break; }
          }
          if (insideNoteText) continue;

          const match = link.href.match(/status\/(\d+)/);
          if (match) {
            return { tweetId: match[1], tweetUrl: link.href };
          }
        }

        return { tweetId: null, tweetUrl: null };
      });

      // Skip if we already have this tweet (another tab got it)
      if (tweetData.tweetId && [...collectedNotes.values()].some(n => n.tweet_id === tweetData.tweetId)) {
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
        let shownOnX: boolean | null = null;
        if (/\bNot shown on X\b/i.test(text)) {
          shownOnX = false;
        } else if (/\bShown on X\b/i.test(text)) {
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

        // Extract status from cell text as fallback for modal
        let cellStatus: string | null = null;
        if (/\bCurrently not rated helpful\b/i.test(text)) cellStatus = 'CURRENTLY_RATED_NOT_HELPFUL';
        else if (/\bCurrently rated helpful\b/i.test(text)) cellStatus = 'CURRENTLY_RATED_HELPFUL';
        else if (/\bNeeds more ratings\b/i.test(text)) cellStatus = 'NEEDS_MORE_RATINGS';

        // Detect "Post unavailable"
        const postUnavailable = /\bPost unavailable\b/i.test(text);

        return { noteText, sourceUrl: sourceLinks[0] || null, viewCount, shownOnX, cellStatus, postUnavailable };
      });

      // Scroll cell into view
      await cell.evaluate(el => {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      });
      await randomDelay(100, 200);

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

      if (!hasViewDetails) continue;

      console.log(`   ${prefix} 🖱️ Clicking View details [${hasViewDetails}]`);

      // Retry click + modal extraction up to 3 times per cell.
      // Uses element.click() instead of page.mouse.click() to avoid CDP frame detach.
      let modalData: { noteId: string | null; status: string; submittedDate: string; usedFallback?: boolean } | null = null;
      for (let clickAttempt = 0; clickAttempt < 3; clickAttempt++) {
        if (clickAttempt > 0) {
          console.log(`   ${prefix} 🔄 Retry ${clickAttempt} for click...`);
          await randomDelay(500, 1000);
        }

        // Click via element.click() inside the page context — avoids CDP Input.dispatchMouseEvent
        // which can cause "Session closed" / "detached Frame" errors
        try {
          const clicked = await cell.evaluate(el => {
            // Block any <a> navigation during the click (safety net)
            const blocker = (e: Event) => {
              if ((e.target as HTMLElement).closest?.('a')) {
                e.preventDefault();
                e.stopPropagation();
              }
            };
            document.addEventListener('click', blocker, true);
            try {
              // Try direct note link first
              const noteLink = el.querySelector('a[href*="/communitynotes/t/"]') as HTMLAnchorElement;
              if (noteLink) {
                noteLink.click();
                return true;
              }
              // Try buttons with "View details"
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
          if (!clicked) {
            console.log(`   ${prefix} ⚠️ Button not found in cell`);
            continue;
          }
        } catch (clickErr) {
          console.log(`   ${prefix} ⚠️ Click error: ${clickErr}`);
          continue;
        }

        // Wait for modal with status text — poll for Note ID first, then give status text time to render
        let modalReady = false;
        for (let waitMs = 0; waitMs < 3000; waitMs += 150) {
          const state = await page.evaluate(() => {
            const modal = document.querySelector('[data-testid="sheetDialog"]') ||
                          document.querySelector('[role="dialog"]') ||
                          document.querySelector('[aria-modal="true"]') ||
                          document.querySelector('[data-testid="Drawer"]');
            const text = modal ? (modal as HTMLElement).innerText : document.body.innerText;
            const hasNoteId = /Note ID[\s:]*\d{18,20}/i.test(text);
            const hasStatus = /\bCurrently (not )?rated helpful\b/i.test(text) || /\bNeeds more ratings\b/i.test(text);
            return { hasNoteId, hasStatus };
          });
          if (state.hasNoteId && state.hasStatus) { modalReady = true; break; }
          if (state.hasNoteId && waitMs >= 1500) { modalReady = true; break; } // Give up waiting for status after 1.5s
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
            if (/\bCurrently not rated helpful\b/i.test(textAfterNoteId)) {
              status = 'CURRENTLY_RATED_NOT_HELPFUL';
            } else if (/\bCurrently rated helpful\b/i.test(textAfterNoteId)) {
              status = 'CURRENTLY_RATED_HELPFUL';
            } else if (/\bNeeds more ratings\b/i.test(textAfterNoteId)) {
              status = 'NEEDS_MORE_RATINGS';
            }
          }
        } else {
          if (/\bCurrently not rated helpful\b/i.test(modalText)) {
            status = 'CURRENTLY_RATED_NOT_HELPFUL';
          } else if (/\bCurrently rated helpful\b/i.test(modalText)) {
            status = 'CURRENTLY_RATED_HELPFUL';
          } else if (/\bNeeds more ratings\b/i.test(modalText)) {
            status = 'NEEDS_MORE_RATINGS';
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
        await page.keyboard.press('Escape');
        await randomDelay(100, 200);
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

      const note: ScrapedNote = {
        note_id: modalData.noteId,
        tweet_id: finalTweetId,
        note_text: cellData.noteText,
        cn_status: finalStatus,
        created_at: modalData.submittedDate,
        source_url: cellData.sourceUrl || undefined,
        view_count: cellData.viewCount || undefined,
        shown_on_x: cellData.shownOnX,
      };

      collectedNotes.set(modalData.noteId, note);
      foundNewNote = true;
      if (modalData.submittedDate) lastNoteDate = modalData.submittedDate;

      // Update coverage tracking
      updateCoverageRegion(noteIdBigInt);

      // Early exit if we've reached the very bottom of the list
      if (noteIdBigInt <= BOTTOM_NOTE_ID) {
        console.log(`\n   ${prefix} 🎉 Reached the bottom note (${modalData.noteId})! Scrape complete.`);
        break recoveryLoop;
      }

      // Record first note found after a jump for estimation accuracy
      if (jumpEstimations.length > 0) {
        const lastEst = jumpEstimations[jumpEstimations.length - 1]!;
        if (lastEst.actualFirstNoteId === null) {
          lastEst.actualFirstNoteId = noteIdBigInt;
          const range = getOverallRange();
          if (range && range.newest > range.oldest) {
            lastEst.actualFraction = Number(range.newest - noteIdBigInt) / Number(range.newest - range.oldest);
            console.log(`   ${prefix} 📐 Jump landed at fraction ${(lastEst.actualFraction * 100).toFixed(1)}% (target was ${(lastEst.targetFraction * 100).toFixed(1)}%)`);
          }
        }
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

      // Cooldown after modal close — reduces burst failures on next click
      await randomDelay(200, 400);
    }

    if (!foundNewNote) {
      stuckCount++;
      if (stuckCount >= stuckBeforePause) {
        retryCount++;
        if (retryCount > maxRetries) {
          // Instead of stopping, try to jump to an uncovered gap
          console.log(`\n   ${prefix} 🔄 Scroll stuck${lastNoteDate ? ` (last note: ${lastNoteDate})` : ''}. Exhausted ${maxRetries} jiggle retries, looking for uncovered gaps...`);
          const gap = getClosestGap();
          if (!gap) {
            console.log(`   ${prefix} ✅ No uncovered gaps remain — done (full scroll coverage)`);
            break;
          }
          if (jumpCount >= MAX_JUMPS) {
            console.log(`   ${prefix} 🛑 Hit safety limit of ${MAX_JUMPS} jumps — done`);
            break;
          }

          jumpCount++;
          const targetNoteId = gapMidpoint(gap);
          const range = getOverallRange();
          const est = range
            ? estimateScrollsForNoteId(targetNoteId, range.newest, range.oldest, totalEstimatedScrolls)
            : { scrollCount: totalEstimatedScrolls / 2, fraction: 0.5 };

          console.log(`   ${prefix} 🎯 Jump ${jumpCount}: targeting gap [${gap.above} → ${gap.below}], midpoint=${targetNoteId}`);
          console.log(`   ${prefix}    Estimated fraction: ${(est.fraction * 100).toFixed(1)}%, scrolls: ${est.scrollCount}`);

          const estimation: JumpEstimation = {
            targetNoteId, targetFraction: est.fraction,
            estimatedScrolls: est.scrollCount,
            actualFirstNoteId: null, actualFraction: null,
          };
          jumpEstimations.push(estimation);

          // Reload page and scroll to estimated position
          startNewRegion();
          processedCells.clear();
          stuckCount = 0;
          retryCount = 0;
          await page.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
          await waitForContent(page);
          const jumpResult2 = await scrollToPosition(page, browser, notewriterUrl, collectedNotes, targetNoteId, est.scrollCount > 0 ? est.scrollCount * 2 : 3000);
          currentPage = jumpResult2.page;
          browser = jumpResult2.browser;
          continue;
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
        await new Promise(r => setTimeout(r, 2000));
      }
    } catch (scrollErr: unknown) {
      const errMsg = scrollErr instanceof Error ? scrollErr.message : String(scrollErr);
      console.log(`   ${prefix} ⚠️ Scroll error: ${errMsg.slice(0, 60)}`);
    }

    await randomDelay(300, 500);
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
async function getPercentileNoteIds(fractions: number[]): Promise<Map<number, bigint>> {
  const client = getSupabaseClient();
  const allNotes: { note_id: string }[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await client
      .from('scraped_notewriter_notes')
      .select('note_id')
      .not('note_id', 'like', 'tweet_%')
      .order('note_id', { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) { console.error('   DB percentile query error:', error); break; }
    if (!data || data.length === 0) break;
    allNotes.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  if (allNotes.length === 0) return new Map();

  // Already sorted descending (newest first) from the query
  const result = new Map<number, bigint>();
  for (const frac of fractions) {
    const idx = Math.floor(allNotes.length * frac);
    result.set(frac, BigInt(allNotes[idx]!.note_id));
  }
  console.log(`📊 DB has ${allNotes.length} notes with real IDs`);
  for (const [frac, noteId] of result) {
    console.log(`   ${(frac * 100).toFixed(0)}th percentile: ${noteId}`);
  }
  return result;
}

async function main() {
  // Parse args
  const args = process.argv.slice(2);
  const freshStart = args.includes('--fresh');

  // Parse --start-from <noteId> to resume from a previous run's last position
  const startFromIdx = args.indexOf('--start-from');
  const startFromNoteId = startFromIdx !== -1 && args[startFromIdx + 1]
    ? BigInt(args[startFromIdx + 1]!)
    : null;

  // Filter out flag args and their values
  const flagValueIndices = new Set<number>();
  if (startFromIdx !== -1) {
    flagValueIndices.add(startFromIdx);
    flagValueIndices.add(startFromIdx + 1);
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
  console.log(`🚀 Starting scrape (max ${maxNotes} notes)...\n`);

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
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    page = page!;
  } else if (existingNotewriterTabs.length > 0) {
    // Reuse existing notewriter tab (last one, most likely to be active)
    page = existingNotewriterTabs[existingNotewriterTabs.length - 1]!;
    activeTargetId = (page.target() as any)?._targetId ?? null;
    const scrollPos = await page.evaluate(() => document.documentElement.scrollTop).catch(() => -1);
    console.log(`📄 Reusing existing tab (scrollY=${scrollPos}): ${page.url().slice(0, 80)}`);
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
    await new Promise(r => setTimeout(r, 500));
  }

  await waitForContent(page);

  // Safety limit on scrolls (list is roughly 200-250 scrolls of 600px each)
  const totalEstimatedScrolls = 240;

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
        await new Promise(r => setTimeout(r, 1000));
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

    await scrapeTab(browser, page, collectedNotes, maxNotes, notewriterUrl, totalEstimatedScrolls);

    // Check if we reached the bottom
    const scrapedNoteIds = [...collectedNotes.keys()]
      .filter(id => /^\d+$/.test(id))
      .map(id => BigInt(id));
    const oldestScraped = scrapedNoteIds.length > 0
      ? scrapedNoteIds.reduce((a, b) => a < b ? a : b)
      : null;

    if (oldestScraped !== null && oldestScraped <= BOTTOM_NOTE_ID) {
      console.log(`\n🎉 Reached the bottom! Oldest scraped: ${oldestScraped}`);
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

  console.log(`\n✅ Scrape finished! Collected ${collectedNotes.size} notes total\n`);

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

  // Run snapshot reconciliation (tier classification, collision resolution, canonical data)
  console.log("\n🔄 Running snapshot reconciliation...");
  try {
    const { reconcile } = await import("./reconcileSnapshots.js");
    const result = await reconcile();
    console.log(`   • Tiers: platinum=${result.tierCounts.platinum} gold=${result.tierCounts.gold} silver=${result.tierCounts.silver} junk=${result.tierCounts.junk}`);
    console.log(`   • Collisions: ${result.collisions.note} note-level, ${result.collisions.tweet} tweet-level`);
    console.log(`   • Notes written: ${result.notesWritten}`);
  } catch (err) {
    console.error("   ⚠️ Reconciliation failed (non-fatal):", err);
  }

  // Print scroll estimation accuracy summary
  printEstimationSummary();

  // Print coverage regions
  const merged = getMergedRegions();
  if (merged.length > 0) {
    console.log(`\n📊 Scroll coverage: ${merged.length} region${merged.length > 1 ? 's' : ''}`);
    for (let i = 0; i < merged.length; i++) {
      console.log(`   Region ${i + 1}: ${merged[i]!.newest} → ${merged[i]!.oldest}`);
    }
    if (merged.length > 1) {
      console.log(`   ⚠️ ${merged.length - 1} gap${merged.length - 1 > 1 ? 's' : ''} in coverage:`);
      for (let i = 0; i < merged.length - 1; i++) {
        const gapAbove = merged[i]!.oldest;
        const gapBelow = merged[i + 1]!.newest;
        console.log(`     Gap ${i + 1}: ${gapAbove} → ${gapBelow}`);
      }
    } else {
      console.log(`   ✅ Full contiguous scroll coverage!`);
    }
  }

  // Print resume command if scraping didn't reach the bottom of the list
  if (merged.length > 0) {
    const oldestReached = merged[merged.length - 1]!.oldest;
    console.log(`\n📌 To resume from where this run stopped:`);
    console.log(`   bun run src/scripts/scrapeNotewriterClickThrough.ts ${maxNotes} --fresh --start-from ${oldestReached}`);
  }

  console.log("\n💡 Chrome browser left open. Close it manually when done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
