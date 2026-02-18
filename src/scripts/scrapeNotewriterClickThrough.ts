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
import { getSupabaseClient, SupabaseLogger } from "../api/supabaseClient";

const DEFAULT_USERNAME = "wholesome-raspberry-stilt";
const SCROLL_PX = 600;
const MAX_JUMPS_PER_TAB = 10; // Safety valve to prevent infinite loops

// --- Scroll coverage tracking ---
// Note IDs serve as position markers — higher = newer = earlier in the list (lower scroll position)
interface CoveredRegion {
  newest: bigint;  // highest note ID (top of region)
  oldest: bigint;  // lowest note ID (bottom of region)
}

// Shared state across all tabs (JS is single-threaded, no races)
const tabRegions = new Map<number, CoveredRegion[]>();
const assignedGaps = new Map<number, { above: bigint; below: bigint }>();

// Jump estimation accuracy tracking
interface JumpEstimation {
  tabId: number;
  targetNoteId: bigint;
  targetFraction: number;
  estimatedScrolls: number;
  actualFirstNoteId: bigint | null;
  actualFraction: number | null;
}
const jumpEstimations: JumpEstimation[] = [];

/** Get the overall note ID range across all tabs */
function getOverallRange(): { newest: bigint; oldest: bigint } | null {
  let newest: bigint | null = null;
  let oldest: bigint | null = null;
  for (const regions of tabRegions.values()) {
    for (const r of regions) {
      if (newest === null || r.newest > newest) newest = r.newest;
      if (oldest === null || r.oldest < oldest) oldest = r.oldest;
    }
  }
  if (newest === null || oldest === null) return null;
  return { newest, oldest };
}

/** Merge all tabs' covered regions into a sorted, non-overlapping list */
function getMergedRegions(): CoveredRegion[] {
  const all: CoveredRegion[] = [];
  for (const regions of tabRegions.values()) {
    all.push(...regions);
  }
  if (all.length === 0) return [];

  // Sort by newest descending (higher note ID = earlier in list)
  all.sort((a, b) => (b.newest > a.newest ? 1 : b.newest < a.newest ? -1 : 0));

  const merged: CoveredRegion[] = [{ ...all[0]! }];
  for (let i = 1; i < all.length; i++) {
    const current = all[i]!;
    const last = merged[merged.length - 1]!;
    // Overlapping or adjacent: current's newest falls within or touches last's range
    if (current.newest >= last.oldest) {
      // Extend last's oldest if current goes further
      if (current.oldest < last.oldest) {
        last.oldest = current.oldest;
      }
    } else {
      merged.push({ ...current });
    }
  }
  return merged;
}

/** Find the closest unassigned gap to a given tab's current position */
function getClosestUnassignedGap(tabId: number): { above: bigint; below: bigint } | null {
  const merged = getMergedRegions();
  if (merged.length <= 1) return null; // No gaps possible with 0 or 1 region

  // Collect gaps between consecutive merged regions
  const gaps: { above: bigint; below: bigint }[] = [];
  for (let i = 0; i < merged.length - 1; i++) {
    const gapAbove = merged[i]!.oldest;    // bottom of upper region
    const gapBelow = merged[i + 1]!.newest; // top of lower region
    if (gapAbove > gapBelow) {
      gaps.push({ above: gapAbove, below: gapBelow });
    }
  }

  if (gaps.length === 0) return null;

  // Filter out gaps already assigned to other tabs
  const assignedSet = new Set<string>();
  for (const [tid, gap] of assignedGaps) {
    if (tid !== tabId) {
      assignedSet.add(`${gap.above}:${gap.below}`);
    }
  }
  const available = gaps.filter(g => !assignedSet.has(`${g.above}:${g.below}`));
  if (available.length === 0) return null;

  // Find closest gap to this tab's current position
  const tabRegs = tabRegions.get(tabId);
  const currentPos = tabRegs && tabRegs.length > 0
    ? tabRegs[tabRegs.length - 1]!.oldest  // tab's most recent position (oldest note found)
    : BigInt(0);

  let closest = available[0]!;
  let closestDist = abs(gapMidpoint(closest) - currentPos);
  for (let i = 1; i < available.length; i++) {
    const dist = abs(gapMidpoint(available[i]!) - currentPos);
    if (dist < closestDist) {
      closest = available[i]!;
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

/** Check if a note ID falls within any other tab's covered region */
function isInOtherTabRegion(noteId: bigint, excludeTabId: number): boolean {
  for (const [tid, regions] of tabRegions) {
    if (tid === excludeTabId) continue;
    for (const r of regions) {
      if (noteId <= r.newest && noteId >= r.oldest) return true;
    }
  }
  return false;
}

/** Update a tab's current region with a newly found note ID */
function updateTabRegion(tabId: number, noteId: bigint): void {
  if (!tabRegions.has(tabId)) {
    tabRegions.set(tabId, [{ newest: noteId, oldest: noteId }]);
    return;
  }
  const regions = tabRegions.get(tabId)!;
  const current = regions[regions.length - 1]!;
  if (noteId > current.newest) current.newest = noteId;
  if (noteId < current.oldest) current.oldest = noteId;
}

/** Start a new region for a tab (after a jump) */
function startNewRegion(tabId: number): void {
  if (!tabRegions.has(tabId)) {
    tabRegions.set(tabId, []);
  }
  // New region will be created by first updateTabRegion call after jump
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
  console.log(`   Worst fraction error: ${(errors[worstIdx]! * 100).toFixed(1)}% (Tab ${worst.tabId})`);
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
async function scrollToPosition(
  page: Page,
  tabId: number,
  collectedNotes: Map<string, ScrapedNote>,
  targetNoteId: bigint | null,
  maxScrolls: number,
): Promise<void> {
  const prefix = `[Tab ${tabId}]`;
  const SAMPLE_EVERY = 15;
  console.log(`   ${prefix} Scrolling to position${targetNoteId ? ` (target note <= ${targetNoteId})` : ` (${maxScrolls} scrolls)`}...`);

  let scrollsDone = 0;
  let consecutiveStalls = 0;
  let lastSampledNoteId: bigint | null = null;
  const sampledCells = new Set<string>();

  while (scrollsDone < maxScrolls) {
    scrollsDone++;

    // Same 600px incremental scroll as normal scraping — virtualizer responds to this
    const result = await page.evaluate((px) => {
      const html = document.documentElement;
      const before = html.scrollTop;
      const maxScroll = html.scrollHeight - html.clientHeight;
      html.scrollTop = Math.min(before + px, maxScroll);
      html.dispatchEvent(new Event('scroll', { bubbles: true }));
      window.dispatchEvent(new Event('scroll', { bubbles: true }));
      return {
        scrollTop: html.scrollTop,
        scrollHeight: html.scrollHeight,
        atBottom: html.scrollTop >= maxScroll - 10,
      };
    }, SCROLL_PX);

    // When at bottom, wait longer for virtualizer to extend the page with new cells.
    // Normal scraping naturally waits 2-10s per cell (click, modal, extract) which
    // gives the virtualizer time. During positioning we need explicit waits instead.
    if (result.atBottom) {
      await new Promise(r => setTimeout(r, 800));
    } else {
      await new Promise(r => setTimeout(r, 150));
    }

    // Sample a note periodically to check position (uses safe element.click, not coordinates)
    if (targetNoteId && scrollsDone % SAMPLE_EVERY === 0) {
      const noteId = await sampleOneNote(page, tabId, collectedNotes, sampledCells);
      if (noteId !== null) {
        updateTabRegion(tabId, noteId);
        if (noteId <= targetNoteId) {
          console.log(`   ${prefix} ✅ Reached target position at scroll ${scrollsDone}`);
          return;
        }
        // Stall detection: if note IDs aren't decreasing, we're stuck
        if (lastSampledNoteId !== null && noteId >= lastSampledNoteId) {
          consecutiveStalls++;
          if (consecutiveStalls >= 3) {
            console.log(`   ${prefix} ⚠️ Progress stalled after ${scrollsDone} scrolls — stopping`);
            return;
          }
        } else {
          consecutiveStalls = 0;
        }
        lastSampledNoteId = noteId;
        console.log(`   ${prefix} 📍 Position check: note ${noteId} at scroll ${scrollsDone} (scrollY=${result.scrollTop})`);
      }
    }

    // Log progress every 100 scrolls (when not sampling)
    if (!targetNoteId && scrollsDone % 100 === 0) {
      console.log(`   ${prefix} ... ${scrollsDone}/${maxScrolls} scrolls (scrollY=${result.scrollTop}, height=${result.scrollHeight})`);
    }
  }

  const pos = await page.evaluate(() => document.documentElement.scrollTop);
  console.log(`   ${prefix} Reached scrollTop=${pos} after ${scrollsDone} scrolls`);
}

/**
 * Sample a single note from the current view during positioning.
 * Clicks "View details" on the first available cell, extracts note data
 * from the modal, saves to DB, and returns the note ID.
 */
async function sampleOneNote(
  page: Page,
  tabId: number,
  collectedNotes: Map<string, ScrapedNote>,
  processedCells: Set<string>,
): Promise<bigint | null> {
  const prefix = `[Tab ${tabId}]`;
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

      // Extract tweet ID from cell
      const tweetId = await cell.evaluate(el => {
        const link = el.querySelector('a[href*="/status/"]') as HTMLAnchorElement;
        return link ? (link.href.match(/status\/(\d+)/)?.[1] || null) : null;
      });

      // Extract note text from cell
      const noteText = await cell.evaluate(el => {
        const paragraphs = el.querySelectorAll('div[dir="ltr"], span[dir="ltr"]');
        let best = '';
        paragraphs.forEach(p => {
          const t = (p as HTMLElement).innerText.trim();
          if (t.length > 50 && !t.includes('experimental AI') && !t.includes('Needs more ratings') && !t.includes('Currently rated') && t.length > best.length) {
            best = t;
          }
        });
        return best;
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

      // Wait for modal
      for (let waitMs = 0; waitMs < 2500; waitMs += 150) {
        const hasModal = await page.evaluate(() => document.body.innerText.includes('Note ID'));
        if (hasModal) break;
        await new Promise(r => setTimeout(r, 150));
      }

      // Extract note ID and status from modal
      const modalData = await page.evaluate(() => {
        const bodyText = document.body.innerText;
        const noteIdMatch = bodyText.match(/Note ID[:\s]*(\d{18,20})/i);
        if (!noteIdMatch) return null;

        let status = 'UNKNOWN';
        if (bodyText.includes('Currently not rated helpful')) status = 'CURRENTLY_RATED_NOT_HELPFUL';
        else if (bodyText.includes('Currently rated helpful')) status = 'CURRENTLY_RATED_HELPFUL';
        else if (bodyText.includes('Needs more ratings')) status = 'NEEDS_MORE_RATINGS';
        else if (/Shown on X/i.test(bodyText) && !bodyText.includes('Not shown on X')) status = 'SHOWN_ON_X';
        else if (bodyText.includes('Not shown on X')) status = 'NOT_SHOWN_ON_X';

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
        const note: ScrapedNote = {
          note_id: modalData.noteId,
          tweet_id: tweetId || `unavailable_${modalData.noteId}`,
          note_text: noteText,
          cn_status: modalData.status,
          created_at: modalData.submittedDate,
        };
        collectedNotes.set(modalData.noteId, note);
        await saveNoteIncrementally(note);
        console.log(`   ${prefix} 📍 Sampled: ${modalData.noteId} (${modalData.status})`);
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
  browser: Browser,
  initialPage: Page,
  collectedNotes: Map<string, ScrapedNote>,
  tabId: number,
  maxNotes: number,
  notewriterUrl: string,
  totalEstimatedScrolls: number,
): Promise<void> {
  const prefix = `[Tab ${tabId}]`;

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
  const jiggleWaits = [0, 0, 30000, 30000, 60000, 60000, 60000, 180000, 180000, 180000];
  const maxRetries = jiggleWaits.length;
  let retryCount = 0;
  let jumpCount = 0;
  let currentPage = initialPage;
  let frameRecoveries = 0;
  const MAX_FRAME_RECOVERIES = 3;
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
        await page.keyboard.press('Escape');
        await randomDelay(100, 200);
        continue;
      }

      const noteIdBigInt = BigInt(modalData.noteId);

      // Check if this note falls within another tab's covered region → overlap detected
      if (isInOtherTabRegion(noteIdBigInt, tabId)) {
        console.log(`   ${prefix} 🔀 Note ${modalData.noteId} is in another tab's covered region — jumping`);
        await page.keyboard.press('Escape');
        await randomDelay(100, 200);

        // Find closest unassigned gap and jump to it
        const gap = getClosestUnassignedGap(tabId);
        if (!gap) {
          console.log(`   ${prefix} ✅ No uncovered gaps remain — tab done (full scroll coverage)`);
          break;
        }
        if (jumpCount >= MAX_JUMPS_PER_TAB) {
          console.log(`   ${prefix} 🛑 Hit safety limit of ${MAX_JUMPS_PER_TAB} jumps — tab done`);
          break;
        }

        jumpCount++;
        assignedGaps.set(tabId, gap);
        const targetNoteId = gapMidpoint(gap);
        const range = getOverallRange();
        const est = range
          ? estimateScrollsForNoteId(targetNoteId, range.newest, range.oldest, totalEstimatedScrolls)
          : { scrollCount: totalEstimatedScrolls / 2, fraction: 0.5 };

        console.log(`   ${prefix} 🎯 Jump ${jumpCount}: targeting gap [${gap.above} → ${gap.below}], midpoint=${targetNoteId}`);
        console.log(`   ${prefix}    Estimated fraction: ${(est.fraction * 100).toFixed(1)}%, scrolls: ${est.scrollCount}`);

        const estimation: JumpEstimation = {
          tabId, targetNoteId, targetFraction: est.fraction,
          estimatedScrolls: est.scrollCount,
          actualFirstNoteId: null, actualFraction: null,
        };
        jumpEstimations.push(estimation);

        // Reload page and scroll to estimated position
        startNewRegion(tabId);
        processedCells.clear();
        stuckCount = 0;
        retryCount = 0;
        await page.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
        await waitForContent(page, tabId);
        await scrollToPosition(page, tabId, collectedNotes, targetNoteId, est.scrollCount > 0 ? est.scrollCount * 2 : 3000);
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
      if (modalData.submittedDate) lastNoteDate = modalData.submittedDate;

      // Update coverage tracking
      updateTabRegion(tabId, noteIdBigInt);

      // Record first note found after a jump for estimation accuracy
      if (jumpEstimations.length > 0) {
        const lastEst = jumpEstimations[jumpEstimations.length - 1]!;
        if (lastEst.tabId === tabId && lastEst.actualFirstNoteId === null) {
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

      await randomDelay(100, 250);
    }

    if (!foundNewNote) {
      stuckCount++;
      if (stuckCount >= stuckBeforePause) {
        retryCount++;
        if (retryCount > maxRetries) {
          // Instead of stopping, try to jump to an uncovered gap
          console.log(`\n   ${prefix} 🔄 Scroll stuck${lastNoteDate ? ` (last note: ${lastNoteDate})` : ''}. Exhausted ${maxRetries} jiggle retries, looking for uncovered gaps...`);
          const gap = getClosestUnassignedGap(tabId);
          if (!gap) {
            console.log(`   ${prefix} ✅ No uncovered gaps remain — tab done (full scroll coverage)`);
            break;
          }
          if (jumpCount >= MAX_JUMPS_PER_TAB) {
            console.log(`   ${prefix} 🛑 Hit safety limit of ${MAX_JUMPS_PER_TAB} jumps — tab done`);
            break;
          }

          jumpCount++;
          assignedGaps.set(tabId, gap);
          const targetNoteId = gapMidpoint(gap);
          const range = getOverallRange();
          const est = range
            ? estimateScrollsForNoteId(targetNoteId, range.newest, range.oldest, totalEstimatedScrolls)
            : { scrollCount: totalEstimatedScrolls / 2, fraction: 0.5 };

          console.log(`   ${prefix} 🎯 Jump ${jumpCount}: targeting gap [${gap.above} → ${gap.below}], midpoint=${targetNoteId}`);
          console.log(`   ${prefix}    Estimated fraction: ${(est.fraction * 100).toFixed(1)}%, scrolls: ${est.scrollCount}`);

          const estimation: JumpEstimation = {
            tabId, targetNoteId, targetFraction: est.fraction,
            estimatedScrolls: est.scrollCount,
            actualFirstNoteId: null, actualFraction: null,
          };
          jumpEstimations.push(estimation);

          // Reload page and scroll to estimated position
          startNewRegion(tabId);
          processedCells.clear();
          stuckCount = 0;
          retryCount = 0;
          await page.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
          await waitForContent(page, tabId);
          await scrollToPosition(page, tabId, collectedNotes, targetNoteId, est.scrollCount > 0 ? est.scrollCount * 2 : 3000);
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
          // Try opening a new page; if the browser connection died, reconnect first
          let recoveredBrowser = browser;
          try {
            currentPage = await recoveredBrowser.newPage();
          } catch (newPageErr) {
            const npMsg = newPageErr instanceof Error ? newPageErr.message : String(newPageErr);
            if (npMsg.includes('Connection closed') || npMsg.includes('closed')) {
              console.log(`   ${prefix} 🔌 Browser connection lost — reconnecting...`);
              await new Promise(r => setTimeout(r, 2000));
              recoveredBrowser = await puppeteer.connect({
                browserURL: "http://127.0.0.1:9222",
                protocolTimeout: 120000,
                defaultViewport: null,
              });
              // Update the outer browser reference via closure
              browser = recoveredBrowser;
              currentPage = await recoveredBrowser.newPage();
            } else {
              throw newPageErr;
            }
          }

          await currentPage.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
          await waitForContent(currentPage, tabId);

          // Scroll back to approximate position using coverage tracking
          const tabRegs = tabRegions.get(tabId);
          const lastOldest = tabRegs && tabRegs.length > 0 ? tabRegs[tabRegs.length - 1]!.oldest : null;
          if (lastOldest) {
            console.log(`   ${prefix} Scrolling back to note ${lastOldest}...`);
            await scrollToPosition(currentPage, tabId, collectedNotes, lastOldest, totalEstimatedScrolls);
          }

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

  // Parse --tabs N (and note which arg indices are consumed by flags)
  const tabsFlagIdx = args.indexOf('--tabs');
  const numTabs = tabsFlagIdx !== -1 && args[tabsFlagIdx + 1]
    ? Math.min(Math.max(parseInt(args[tabsFlagIdx + 1]!, 10) || 1, 1), 5)
    : 1;

  // Parse --start-from <noteId> to resume from a previous run's last position
  const startFromIdx = args.indexOf('--start-from');
  const startFromNoteId = startFromIdx !== -1 && args[startFromIdx + 1]
    ? BigInt(args[startFromIdx + 1]!)
    : null;

  // Filter out flag args AND their values (e.g. --tabs 3 removes both)
  const flagValueIndices = new Set<number>();
  if (tabsFlagIdx !== -1) {
    flagValueIndices.add(tabsFlagIdx);
    flagValueIndices.add(tabsFlagIdx + 1);
  }
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
  console.log(`🚀 Starting scrape with ${numTabs} tab${numTabs > 1 ? 's' : ''} (max ${maxNotes} notes)...\n`);

  // Open tabs
  const tabPages: Page[] = [];

  for (let i = 0; i < numTabs; i++) {
    let tabPage: Page | undefined;

    if (i === 0) {
      if (freshStart) {
        // Fresh start: always open a new tab (avoids stale virtualizer state
        // and viewport emulation from previous runs)
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            console.log(`📄 [Tab 0] Opening fresh tab: ${notewriterUrl}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
            tabPage = await browser.newPage();
            await tabPage.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
            break;
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.log(`   [Tab 0] ⚠️ Tab creation failed: ${msg.slice(0, 80)}`);
            if (attempt === 2) throw e;
            await new Promise(r => setTimeout(r, 2000));
          }
        }
      } else {
        // Reuse existing notewriter tab if present
        const existingPages = await browser.pages();
        tabPage = existingPages.find((p) => p.url().includes("communitynotes"));

        if (!tabPage) {
          console.log(`📄 [Tab 0] Opening new tab: ${notewriterUrl}`);
          tabPage = await browser.newPage();
          await tabPage.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
        } else {
          console.log(`📄 [Tab 0] Found existing notewriter tab: ${tabPage.url()}`);
          if (!tabPage.url().includes(username)) {
            console.log(`   [Tab 0] Navigating to ${notewriterUrl}`);
            await tabPage.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
          }
        }
      }
    } else {
      // Additional tabs: always open fresh (with retry for flaky frame detach)
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          console.log(`📄 [Tab ${i}] Opening new tab: ${notewriterUrl}${attempt > 0 ? ` (retry ${attempt})` : ''}`);
          tabPage = await browser.newPage();
          await tabPage.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
          break;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`   [Tab ${i}] ⚠️ Tab creation failed: ${msg.slice(0, 80)}`);
          if (attempt === 2) throw e;
          await new Promise(r => setTimeout(r, 2000));
        }
      }
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

  // Safety limit on scrolls (list is roughly 200-250 scrolls of 600px each)
  const totalEstimatedScrolls = 240;

  // Shared map — create before positioning so scrollToPosition can save sampled notes
  const collectedNotes = new Map<string, ScrapedNote>();

  // If resuming from a previous run, scroll to the start position first
  if (startFromNoteId) {
    console.log(`\n📍 Resuming from note ${startFromNoteId} — scrolling to position...`);
    await scrollToPosition(tabPages[0]!, 0, collectedNotes, startFromNoteId, 3000);
  }

  // Start tab 0 scraping immediately — don't make it wait for other tabs to position
  // (idle tabs get throttled/detached by Chrome, which is why tab 0 often failed to start)
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🏁 Starting Tab 0 scraping immediately${numTabs > 1 ? ' while positioning other tabs...' : '...'}\n`);

  const tab0Promise = scrapeTab(browser, tabPages[0]!, collectedNotes, 0, maxNotes, notewriterUrl, totalEstimatedScrolls);

  // Position and start remaining tabs
  if (numTabs > 1) {
    const fractions = Array.from({ length: numTabs - 1 }, (_, i) => (i + 1) / numTabs);
    console.log(`📍 Querying DB for positioning targets (${fractions.map(f => (f * 100).toFixed(0) + '%').join(', ')})...`);
    const percentiles = await getPercentileNoteIds(fractions);

    // Position each tab then start it scraping immediately (don't wait for all to position)
    const otherTabPromises: Promise<void>[] = [];
    for (let idx = 0; idx < tabPages.length - 1; idx++) {
      const tabIdx = idx + 1;
      const fraction = tabIdx / numTabs;
      const scrollCount = Math.round(fraction * totalEstimatedScrolls);
      const targetNoteId = percentiles.get(fraction) ?? null;

      console.log(`   [Tab ${tabIdx}] Scrolling to ${(fraction * 100).toFixed(0)}% (${scrollCount} scrolls${targetNoteId ? `, target note <= ${targetNoteId}` : ''})...`);

      jumpEstimations.push({
        tabId: tabIdx,
        targetNoteId: targetNoteId ?? 0n,
        targetFraction: fraction,
        estimatedScrolls: scrollCount,
        actualFirstNoteId: null,
        actualFraction: null,
      });

      try {
        // Use DB percentile note ID as target — samples every 10 scrolls to verify position
        // maxScrolls is generous; stall detection stops early if stuck
        await scrollToPosition(tabPages[tabIdx]!, tabIdx, collectedNotes, targetNoteId, targetNoteId ? 3000 : scrollCount);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.log(`   [Tab ${tabIdx}] ⚠️ Positioning failed: ${msg.slice(0, 80)} — will start from current position`);
      }

      // Start this tab scraping as soon as it's positioned
      console.log(`   [Tab ${tabIdx}] ▶️ Starting scrape from current position`);
      otherTabPromises.push(
        scrapeTab(browser, tabPages[tabIdx]!, collectedNotes, tabIdx, maxNotes, notewriterUrl, totalEstimatedScrolls)
      );
    }

    // Wait for all tabs to finish
    await Promise.all([tab0Promise, ...otherTabPromises]);
  } else {
    await tab0Promise;
  }

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
