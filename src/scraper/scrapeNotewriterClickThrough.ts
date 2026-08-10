// @ts-nocheck
/**
 * Click-through notewriter scraper.
 *
 * This script attaches to a Chrome that is already running on your machine. It
 * scrolls through the notewriter page and clicks "View details" on each note,
 * because the note id, the status and the view count are only visible in that
 * modal. If a notewriter tab is already open it carries on from wherever that
 * tab is scrolled to. Otherwise it opens a new tab.
 *
 * How to use it:
 * 1. Start Chrome with remote debugging turned on.
 *    /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 --user-data-dir=$HOME/.chrome-debug-profile
 *
 * 2. Open your notewriter page in that Chrome and log in.
 *
 * 3. Run this script.
 *    bun run scrape [maxNotes] [--fresh] [--start-from <noteId>] [--stop-at <noteId>] [--incremental]
 *
 *    --fresh opens a new tab and starts from the top. Without it an existing
 *    tab is reused.
 *    --start-from <noteId> scrolls down to this note before scraping starts.
 *    --stop-at <noteId> stops the scrape at this note instead of at
 *    BOTTOM_NOTE_ID.
 *    --incremental is the mode the unattended daily run uses. It scrapes from
 *    the top and stops about a week before the oldest note that has no
 *    snapshot yet. If every known note already has a snapshot it exits without
 *    opening the browser at all. It implies --fresh.
 */

import "dotenv/config";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { SupabaseLogger } from "../api/supabaseClient";
import { snowflakeToMillis, snowflakeToDate, millisToSnowflakeFloor } from "../pipeline/utils/snowflake";

const DEFAULT_USERNAME = "wholesome-raspberry-stilt";
const SCROLL_PX = 600;
// The oldest note we know of. Reaching it means the scrape has covered the
// whole list.
const BOTTOM_NOTE_ID = 1976702059752911225n;

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

// The CDP target id of the tab we are working in. reconnectToTab uses it to
// pick the same tab again after Chrome drops the connection.
let activeTargetId: string | null = null;

/** Disconnect from Chrome, reconnect, and find the existing notewriter tab. */
async function reconnectToTab(
  oldBrowser: Browser,
  notewriterUrl: string,
  prefix: string,
): Promise<{ browser: Browser; page: Page }> {
  console.log(`   ${prefix} 🔌 Reconnecting to Chrome for fresh page references...`);
  try { oldBrowser.disconnect(); } catch { /* It may already be disconnected. */ }
  await new Promise(r => setTimeout(r, 800));

  const freshBrowser = await puppeteer.connect({
    browserURL: "http://127.0.0.1:9222",
    protocolTimeout: 120000,
    defaultViewport: null,
  });

  const allPages = await freshBrowser.pages();

  // The target id names the exact tab we were working in, so we look for that
  // first.
  let recoveredPage: Page | undefined;
  if (activeTargetId) {
    recoveredPage = allPages.find(p => {
      const target = p.target();
      return target && (target as any)._targetId === activeTargetId;
    });
    if (!recoveredPage) {
      // That tab is gone, so we settle for any notewriter tab. We take the last
      // one, because that is the most recently opened.
      const notewriterPages = allPages.filter(p => p.url().includes("communitynotes"));
      recoveredPage = notewriterPages[notewriterPages.length - 1];
    }
  } else {
    // We never recorded a target id, so the most recently opened notewriter tab
    // is the best guess.
    const notewriterPages = allPages.filter(p => p.url().includes("communitynotes"));
    recoveredPage = notewriterPages[notewriterPages.length - 1];
  }

  if (recoveredPage) {
    // We may have landed on a different tab than before, so record which one we
    // are now using.
    activeTargetId = (recoveredPage.target() as any)?._targetId ?? activeTargetId;
    const scrollPos = await recoveredPage.evaluate(() => document.documentElement.scrollTop).catch(() => -1);
    console.log(`   ${prefix} ✅ Reattached to existing tab (scrollY=${scrollPos})`);
    return { browser: freshBrowser, page: recoveredPage };
  }

  // No notewriter tab is left at all, so we open one and load the page again.
  console.log(`   ${prefix} ⚠️ Existing tab not found — opening fresh tab...`);
  const newPage = await freshBrowser.newPage();
  activeTargetId = (newPage.target() as any)?._targetId ?? null;
  await newPage.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
  await waitForContent(newPage);
  return { browser: freshBrowser, page: newPage };
}

/**
 * Scrolls the page down until it reaches a starting position for the scrape.
 * It never clicks anything and it never writes to the database.
 *
 * To tell how far down it has got, it reads the tweet ids out of the links in
 * the cells that are currently rendered. Tweet ids and note ids are both
 * snowflakes, so the smallest visible tweet id is a good enough stand-in for
 * the note id we are looking for.
 *
 * @param targetNoteId Stop once the smallest visible tweet id is at or below
 *   this value. When it is null, scroll for maxScrolls batches instead.
 * @param maxScrolls The most scroll steps to take, so the loop always ends.
 */
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
        // We leave totalScrollsDone alone so that this batch runs again.
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

// Notes are written to the database as they are found, not at the end. These
// counters record what that writing did, so the run can print a summary.
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

    const { exists, hasFirstSnapshot } = await supabase.getNoteSnapshotState(note.note_id);
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

    // Stamp the first-snapshot time once so getOldestUnscrapedNoteId stays a cheap lookup.
    if (!hasFirstSnapshot) {
      await supabase.markFirstSnapshot(note.note_id);
    }
  } catch (err) {
    errorCount++;
    console.error(`   ✗ DB ERROR: ${note.note_id}:`, err);
  }
}

/**
 * Scrapes notes by scrolling down the list and clicking "View details" on each
 * one. Every note is written to the database as soon as it is read. The
 * function returns when it reaches the note it was told to stop at, when it
 * has collected maxNotes notes, or when it can no longer make progress.
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

  // These page dimensions are only logged. They are the first thing to look at
  // when the virtualizer stops handing us new cells.
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
  // How long to wait before each attempt at unsticking the virtualizer, in
  // milliseconds. Each wait is twice the one before it, from under a second up
  // to about a minute and a half.
  const jiggleWaits = [800, 1600, 3200, 6400, 12000, 24000, 48000, 96000];
  const maxRetries = jiggleWaits.length;
  let retryCount = 0;
  let currentPage = initialPage;
  let frameRecoveries = 0;
  const MAX_FRAME_RECOVERIES = 15;
  // The submission date of the last note we scraped. It goes into the log lines
  // about being stuck, so we can see how far the run got.
  let lastNoteDate = '';

  recoveryLoop:
  while (frameRecoveries <= MAX_FRAME_RECOVERIES) {
    // The inner code uses this local name. Recovery replaces currentPage, and
    // the next turn of this loop picks the new page up here.
    const page = currentPage;
    try {
      while (collectedNotes.size < maxNotes && retryCount <= maxRetries) {
    scrollCount++;

    const cells = await page.$$('[data-testid="cellInnerDiv"]');

    const debugInfo = await page.evaluate(() => {
      const scrollY = window.scrollY;
      const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      const fingerprints = [...cells].map(c => (c as HTMLElement).innerText.slice(0, 50).replace(/\n/g, ' '));
      return { scrollY, fingerprints };
    });
    console.log(`\n${prefix} 📜 Scroll ${scrollCount}: ${cells.length} cells at scrollY=${debugInfo.scrollY}`);

    let foundNewNote = false;

    for (const cell of cells) {
      if (collectedNotes.size >= maxNotes) break;

      // The virtualizer shows us the same cell again and again as we scroll.
      // This fingerprint lets us recognise a cell we have already handled.
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

      // Reads the id of the tweet the note was written about.
      async function readCellTweetData() {
        return cell.evaluate(el => {
          let tweetId: string | null = null;
          let tweetUrl: string | null = null;
          let noteIdFromUrl: string | null = null;

          // X renders the embedded tweet as a div with role="link" rather than
          // an anchor, so there is no href to read. We reach into React's
          // internal fiber tree instead. The parent of that div carries the
          // tweet's path in its props.
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

          // If that did not work, fall back to any real link to a status in the
          // cell. We skip links that sit inside the note text itself, because a
          // note often cites other posts and those are not the tweet we want.
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

      // Reads everything else the cell shows. That is the note text, the view
      // count, the status, and the original tweet's author, text and time.
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

          // The cell's innerText joins DOM nodes together with no space between
          // them. A run of text can look like "GermantownCurrently rated
          // helpful19h". That means a word boundary at either end of a phrase
          // will not match. So the patterns below match bare substrings. The
          // phrases are distinctive enough that this is safe.
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
          // When a post is marked as sensitive or age restricted, X hides the
          // embedded tweet behind an overlay that asks you to show the content.
          // The avatar, the tweet text and the link to the status are then not
          // in the cell at all. The modal still opens and still has the note id,
          // so there is no point retrying the cell in this case.
          const hasInterstitial = !!el.querySelector('[data-testid="previewInterstitial"]');

          let tweetHandle: string | null = null;
          let tweetText: string | null = null;
          let tweetTime: string | null = null;

          // The author's handle is not written out anywhere we can rely on, but
          // X puts it into the avatar's data-testid attribute.
          const avatarEl = el.querySelector('[data-testid^="UserAvatar-Container-"]');
          if (avatarEl) {
            const testId = avatarEl.getAttribute('data-testid') || '';
            const handle = testId.replace('UserAvatar-Container-', '');
            if (handle && handle.length > 0) {
              tweetHandle = handle;
            }
          }

          const timeEl = el.querySelector('time');
          if (timeEl) {
            // The datetime attribute holds a full ISO timestamp. The text of the
            // element is only a rough label such as "19h", so we prefer the
            // attribute and fall back to the text.
            tweetTime = timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || null;
          }

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

      // Opens the note's details modal by clicking the cell's link or its
      // "View details" button.
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

      // Waits for the details modal to render and then reads it. Returns null
      // when no modal text could be found at all.
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

          // Since May 2026 the modal puts the "Note ID" footer line in a
          // container next to the dialog rather than inside it. So a dialog we
          // found may not contain the note id. When that happens we read the
          // whole page body instead.
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

          // The modal has shown the status in two different ways. Since May 2026
          // it puts a "Current Status" header above a line that reads "Helpful",
          // "Not Helpful" or "Needs More Ratings". Older pages wrote it out as
          // "Currently rated helpful" and so on. We look for the newer wording
          // first and fall back to the older one.
          const parseStatus = (text: string): string => {
            const headerMatch = text.match(/Current Status\s+(Not Helpful|Helpful|Needs More Ratings)\b/i);
            if (headerMatch) {
              const label = headerMatch[1]!.toLowerCase();
              if (label === 'not helpful') return 'CURRENTLY_RATED_NOT_HELPFUL';
              if (label === 'helpful') return 'CURRENTLY_RATED_HELPFUL';
              if (label === 'needs more ratings') return 'NEEDS_MORE_RATINGS';
            }
            // These patterns have no word boundary at the start, because the
            // page body text runs DOM nodes together without spaces.
            if (/Currently rated not helpful/i.test(text)) return 'CURRENTLY_RATED_NOT_HELPFUL';
            if (/Currently rated helpful/i.test(text)) return 'CURRENTLY_RATED_HELPFUL';
            if (/Needs more ratings/i.test(text)) return 'NEEDS_MORE_RATINGS';
            return 'UNKNOWN';
          };

          let status = 'UNKNOWN';
          if (usedFallback && noteId) {
            const noteIdPos = modalText.indexOf('Note ID');
            if (noteIdPos !== -1) {
              // In the current page the "Current Status" header sits above the
              // "Note ID" line. An older version of this code only searched the
              // text after the note id and so missed it. Once we know the note
              // id is present we search the whole text.
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

      // We read the same note from two places, the cell in the list and the
      // details modal. The loop below reads the cell, opens the modal, and then
      // checks that the two agree. If they do not, it throws the reading away
      // and starts again, up to two more times.
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

        // Read the cell, and read it again if a field we expect is missing.
        const MAX_CELL_ATTEMPTS = 2;
        for (let cellAttempt = 0; cellAttempt < MAX_CELL_ATTEMPTS; cellAttempt++) {
          tweetData = await readCellTweetData();
          cellData = await readCellData();
          const cellMissing: string[] = [];
          // Sometimes the embedded tweet is not in the cell at all. That happens
          // when the original post has been taken down, and when X hides it
          // behind a sensitive content overlay. The tweet id, the handle and the
          // tweet text will never turn up in those cases, so retrying for them
          // only wastes time. The modal still gives us the note id.
          const embeddedTweetAbsent = cellData.postUnavailable || cellData.hasInterstitial;
          if (!embeddedTweetAbsent && !tweetData.tweetId) cellMissing.push('tweet_id');
          if (!cellData.noteText) cellMissing.push('note_text');
          if (!cellData.cellStatus) cellMissing.push('status');
          // If we can see any part of the tweet, the tweet is really there. In
          // that case we expect all three of its fields and retry until we have
          // them.
          const hasSomeTweetInfo = cellData.tweetHandle || cellData.tweetText || cellData.tweetTime;
          if (!embeddedTweetAbsent && hasSomeTweetInfo) {
            if (!cellData.tweetHandle) cellMissing.push('tweet_handle');
            if (!cellData.tweetText) cellMissing.push('tweet_text');
            if (!cellData.tweetTime) cellMissing.push('tweet_time');
          }
          if (cellMissing.length === 0) break;
          if (cellAttempt < MAX_CELL_ATTEMPTS - 1) {
            console.log(`   ${prefix} 🔄 Cell retry ${cellAttempt + 1}/${MAX_CELL_ATTEMPTS}: missing ${cellMissing.join(', ')}`);
            await randomDelay(400, 800);
          } else {
            // The last attempt failed too. We print the cell's text, links and
            // test ids so that a person can see how X's layout has changed.
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

        // We have already scraped a note on this tweet in this run, so there is
        // nothing left to do for this cell.
        if (tweetData.tweetId && [...collectedNotes.values()].some(n => n.tweet_id === tweetData.tweetId)) {
          break conflictLoop;
        }

        // The click below only lands if the cell is actually on screen.
        await cell.evaluate(el => {
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
        });
        await randomDelay(80, 160);

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

        // Open the modal and read it. If a field is missing we close it and try
        // again, waiting longer each time.
        const maxQualityRetries = 2;
        const modalWaits = [3000, 5000, 8000];

        let accNoteId: string | null = null;
        let accStatus: string = 'UNKNOWN';
        let accSubmittedDate: string = '';
        let accRaterTags: string[] | null = null;
        let finalModalData: ModalData | null = null;

        // Only the status and the submission date are worth retrying for. The
        // tweet id, the note text and the view count come from the cell, so
        // reopening the modal cannot fix them.
        // Rater tags are not required. X only shows the "Top tags selected by
        // raters" section once raters have agreed on some tags, and many helpful
        // notes have no such section at all. Treating them as required made
        // every one of those notes burn five pointless retries.
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

          // We keep the best answer we have seen so far across the retries. A
          // retry that returns a different note id means the modal has loaded
          // some other note, so everything we kept belongs to the wrong note and
          // we start again from this reading.
          if (accNoteId && md.noteId && accNoteId !== md.noteId) {
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

          // On the last retry we print the modal before closing it. That is the
          // only chance to see what the layout looks like where the missing
          // field should have been.
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
            const retryWait = [800, 1600][qualityAttempt] || 1600;
            console.log(`   ${prefix} 🔄 Quality retry ${qualityAttempt + 1}/${maxQualityRetries}: missing=[${missingFields.join(', ')}]`);
            qualityRetryCount++;
            await new Promise(r => setTimeout(r, retryWait));
          }
        }

        // The last reading is the base, and the fields we kept along the way
        // overwrite it.
        modalData = finalModalData;
        if (accNoteId && modalData) {
          modalData.noteId = accNoteId;
          if (accStatus !== 'UNKNOWN') modalData.status = accStatus;
          if (accSubmittedDate) modalData.submittedDate = accSubmittedDate;
          if (accRaterTags) modalData.raterTags = accRaterTags;
        }

        // Without a note id there is nothing to compare the cell against.
        if (!modalData?.noteId) break conflictLoop;

        // Check that the cell and the modal tell the same story.
        const crossConflicts: string[] = [];
        if (tweetData.noteIdFromUrl && modalData.noteId && tweetData.noteIdFromUrl !== modalData.noteId) {
          crossConflicts.push(`note_id: URL=${tweetData.noteIdFromUrl} modal=${modalData.noteId}`);
        }
        if (cellData.cellStatus && modalData.status !== 'UNKNOWN' && cellData.cellStatus !== modalData.status) {
          crossConflicts.push(`status: cell=${cellData.cellStatus} modal=${modalData.status}`);
        }

        // The two sources agree, so we can keep this note.
        if (crossConflicts.length === 0) break conflictLoop;

        console.log(`   ${prefix} ⚠️ CROSS-SOURCE CONFLICT: ${crossConflicts.join(', ')}`);
        if (conflictRetry >= 2) {
          console.log(`   ${prefix} ⚠️ Conflict persists after 3 attempts — skipping note`);
          modalData = null;
          break conflictLoop;
        }
        qualityRetryCount++;
      }

      if (!modalData || !modalData.noteId) {
        console.log(`   ${prefix} ⚠️ Could not extract valid data for this cell`);
        await page.keyboard.press('Escape');
        await randomDelay(160, 320);
        continue;
      }

      // We have already collected this note earlier in the run.
      if (collectedNotes.has(modalData.noteId)) {
        await page.keyboard.press('Escape');
        await randomDelay(80, 160);
        continue;
      }

      const noteIdBigInt = BigInt(modalData.noteId);

      // The modal is the better source for the status. We only fall back to the
      // status shown in the cell when the modal did not give us one.
      const finalStatus = modalData.status !== 'UNKNOWN' ? modalData.status
        : (cellData.cellStatus || 'UNKNOWN');

      // A real tweet id is always preferred. When the post has been taken down
      // we record "post_unavailable", because that is a fact worth keeping.
      // Otherwise we store a placeholder built from the note id, so the row
      // still has a unique value in this column.
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

      // We work out here whether this note is the one we stop at, but we do not
      // act on it until after the save below. Stopping first would leave the
      // boundary note counted in memory with no snapshot in the database.
      const effectiveBottom = stopAtNoteId ?? BOTTOM_NOTE_ID;
      const reachedStopPoint = noteIdBigInt <= effectiveBottom;

      console.log(`   ${prefix} ✓ Total ${collectedNotes.size}: ${modalData.noteId} (${modalData.status})`);

      // Saving each note as we go means a killed run still keeps its work.
      await saveNoteIncrementally(note);
      if (reachedStopPoint) {
        const label = stopAtNoteId ? 'stop-at target' : 'bottom note';
        console.log(`\n   ${prefix} 🎉 Reached the ${label} (${modalData.noteId})! Scrape complete.`);
      }

      // Close the modal. We try a few likely close buttons, and if none of them
      // is there we look for any small button that reads as a close control.
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

      // The next cell must not be clicked while the old modal is still up, so we
      // wait for it to leave the page.
      try {
        await page.waitForFunction(() => {
          return !document.querySelector('[role="dialog"]') &&
                 !document.querySelector('[aria-modal="true"]') &&
                 !document.querySelector('[data-testid="sheetDialog"]');
        }, { timeout: 3000 });
      } catch {
        // Running out of time here is not fatal. We press Escape once more and
        // carry on.
        await page.keyboard.press('Escape');
        await randomDelay(300, 500);
      }

      // A short pause after closing the modal. Clicking again straight away
      // makes the next click fail far more often.
      await randomDelay(160, 320);

      if (reachedStopPoint) {
        break recoveryLoop;
      }
    }

    if (!foundNewNote) {
      stuckCount++;
      if (stuckCount >= stuckBeforePause) {
        retryCount++;
        if (retryCount > maxRetries) {
          console.log(`\n   ${prefix} 🛑 Scroll stuck${lastNoteDate ? ` (last note: ${lastNoteDate})` : ''}. Exhausted ${maxRetries} jiggle retries — done.`);
          break;
        }
        // The virtualizer has stopped giving us new cells. We wait, scroll a
        // long way back up, wait again, and then scroll past where we were. That
        // usually makes it render fresh cells.
        const waitMs = jiggleWaits[retryCount - 1] || 0;
        if (waitMs > 0) {
          console.log(`\n   ${prefix} ⏳ Scroll stuck${lastNoteDate ? ` (last note: ${lastNoteDate})` : ''}. Waiting ${waitMs / 1000}s before jiggle ${retryCount}/${maxRetries}...`);
          await new Promise(r => setTimeout(r, waitMs));
        }
        console.log(`\n   ${prefix} 🔄 Jiggling virtualizer (retry ${retryCount}/${maxRetries})...`);
        // Each retry reaches further up the page than the one before.
        const jiggleDistance = 3000 + (retryCount * 2000);
        await page.evaluate((dist) => {
          const html = document.documentElement;
          html.scrollTop = Math.max(0, html.scrollTop - dist);
          html.dispatchEvent(new Event('scroll', { bubbles: true }));
          window.dispatchEvent(new Event('scroll', { bubbles: true }));
        }, jiggleDistance);
        // Give the virtualizer time to render the cells up here.
        await new Promise(r => setTimeout(r, 1600));
        await page.evaluate((dist) => {
          const html = document.documentElement;
          // Land a little past where we started, so the cells are new ones.
          html.scrollTop += dist + 600;
          html.dispatchEvent(new Event('scroll', { bubbles: true }));
          window.dispatchEvent(new Event('scroll', { bubbles: true }));
        }, jiggleDistance);
        await new Promise(r => setTimeout(r, 800));
        stuckCount = 0;
        // The jiggle has moved us somewhere else in the list, so the
        // fingerprints we collected no longer tell us anything useful.
        processedCells.clear();
        console.log(`   ${prefix} ▶️  Resuming after jiggle...`);
      }
    } else {
      stuckCount = 0;
      retryCount = 0;
    }

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
        // At the bottom the virtualizer has to fetch more notes and make the
        // page taller, which takes longer than a normal scroll step.
        await new Promise(r => setTimeout(r, 1600));
      }
    } catch (scrollErr: unknown) {
      const errMsg = scrollErr instanceof Error ? scrollErr.message : String(scrollErr);
      console.log(`   ${prefix} ⚠️ Scroll error: ${errMsg.slice(0, 60)}`);
    }

    await randomDelay(240, 400);
      }
      // The scrape loop finished on its own terms, so there is nothing to
      // recover from.
      break recoveryLoop;
    } catch (loopErr: unknown) {
      const errMsg = loopErr instanceof Error ? loopErr.message : String(loopErr);

      // Chrome sometimes drops the frame or the whole connection out from under
      // us. We can come back from that by reattaching to the tab.
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

      // Any other error is one we cannot come back from.
      console.log(`\n${prefix} ⚠️ Scraping interrupted: ${errMsg.slice(0, 100)}`);
      console.log(`   ${prefix} Collected ${collectedNotes.size} notes so far`);
      break recoveryLoop;
    }
  }

  console.log(`\n${prefix} ✅ Tab finished. Total notes across all tabs: ${collectedNotes.size}`);
}


/**
 * Reads the command line, gets a Chrome tab on the notewriter page, and runs
 * the scrape. It restarts the scrape by itself when a run stops early, and
 * reconciles the snapshots once everything is done.
 */
async function main() {
  const args = process.argv.slice(2);
  let freshStart = args.includes('--fresh');

  // --start-from names the note a previous run stopped at, so this run can pick
  // up where that one left off.
  const startFromIdx = args.indexOf('--start-from');
  const startFromNoteId = startFromIdx !== -1 && args[startFromIdx + 1]
    ? BigInt(args[startFromIdx + 1]!)
    : null;

  // --stop-at names the note to stop at, in place of BOTTOM_NOTE_ID.
  const stopAtIdx = args.indexOf('--stop-at');
  let stopAtNoteId = stopAtIdx !== -1 && args[stopAtIdx + 1]
    ? BigInt(args[stopAtIdx + 1]!)
    : null;

  // Drop the flags and the values that belong to them, so that what is left is
  // only the positional arguments.
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

  // A single positional argument that is a number is the note limit. Otherwise
  // the first one is the notewriter name and the second is the limit.
  let username = DEFAULT_USERNAME;
  let maxNotes = 500;
  if (nonFlagArgs.length === 1 && /^\d+$/.test(nonFlagArgs[0]!)) {
    maxNotes = parseInt(nonFlagArgs[0]!, 10);
  } else {
    username = nonFlagArgs[0] || DEFAULT_USERNAME;
    maxNotes = parseInt(nonFlagArgs[1] || "500", 10);
  }
  const notewriterUrl = `https://x.com/i/communitynotes/u/${username}`;

  // --incremental is the unattended daily mode. It catches up on the notes that
  // have no snapshot yet. To do that it scrapes from the top of the list down to
  // about a week before the oldest note that is still missing one. On the way it
  // passes every newer note again, which is how recent notes build up a series
  // of view counts over time. If no note is missing a snapshot there is nothing
  // to catch up on, so the run exits before it opens the browser.
  if (args.includes('--incremental')) {
    const RESAMPLE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
    const INCREMENTAL_MAX_NOTES = 100_000;
    const oldestUnscrapedNoteId = await supabase.getOldestUnscrapedNoteId();
    if (!oldestUnscrapedNoteId) {
      console.log("🔁 Incremental: every known note already has a snapshot — nothing to catch up. Exiting.");
      process.exit(0);
    }
    freshStart = true;
    maxNotes = INCREMENTAL_MAX_NOTES;
    const cutoffMillis = snowflakeToMillis(oldestUnscrapedNoteId) - RESAMPLE_WINDOW_MS;
    const rawStopAtNoteId = millisToSnowflakeFloor(cutoffMillis);
    stopAtNoteId = rawStopAtNoteId < BOTTOM_NOTE_ID ? BOTTOM_NOTE_ID : rawStopAtNoteId;
    const clampInfo = stopAtNoteId !== rawStopAtNoteId ? ` (clamped to bottom note ${BOTTOM_NOTE_ID})` : "";
    console.log(`🔁 Incremental: oldest note without a snapshot ${oldestUnscrapedNoteId} (${snowflakeToDate(oldestUnscrapedNoteId).toISOString().slice(0, 10)}).`);
    console.log(`   Scraping from top, stopping ~1 week before it at note <= ${stopAtNoteId} (${new Date(cutoffMillis).toISOString().slice(0, 10)})${clampInfo}.\n`);
  }

  console.log("🔌 Connecting to Chrome on port 9222...\n");

  let browser: Browser;
  try {
    browser = await puppeteer.connect({
      browserURL: "http://127.0.0.1:9222",
      protocolTimeout: 120000,
      // Keep the browser window's own size. Puppeteer would otherwise force it
      // to 800 by 600, which shows far fewer notes at a time.
      defaultViewport: null,
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

  let page: Page;
  const existingPages = await browser.pages();
  const existingNotewriterTabs = existingPages.filter(p => p.url().includes("communitynotes"));

  if (freshStart) {
    // A new tab starts the virtualizer from scratch. Reusing a tab that has been
    // scrolled around for a while often leaves it in a state where it stops
    // rendering new cells.
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
    // The tab that is scrolled furthest down is the one that got furthest
    // through the list, so it is the best place to carry on from.
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
    // There is no notewriter tab open, so we have to make one.
    console.log(`📄 Opening new tab: ${notewriterUrl}`);
    page = await browser.newPage();
    activeTargetId = (page.target() as any)?._targetId ?? null;
    await page.goto(notewriterUrl, { waitUntil: "networkidle2", timeout: 60000 });
  }

  // A fresh run always begins at the newest note.
  if (freshStart) {
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
    await new Promise(r => setTimeout(r, 400));
  }

  await waitForContent(page);

  // Every note found in this run, across all the restarts below.
  const collectedNotes = new Map<string, ScrapedNote>();

  // A run that did not even get back as far as this note has gone wrong in some
  // basic way, and restarting it is not worth the time.
  const OCT_23_NOTE_ID = 1985806966241812487n;
  const MAX_AUTO_RESTARTS = 20;
  let autoRestartCount = 0;
  let currentStartFrom = startFromNoteId;

  // When a scrape stops before it reaches the bottom of the list, this loop
  // opens a fresh tab and starts again from the oldest note it managed to get.
  autoRestartLoop:
  while (autoRestartCount <= MAX_AUTO_RESTARTS) {
    if (autoRestartCount > 0) {
      console.log(`\n${"=".repeat(60)}`);
      console.log(`🔄 Auto-restart ${autoRestartCount}/${MAX_AUTO_RESTARTS} — reconnecting and opening fresh tab...`);
      try {
        try { browser.disconnect(); } catch { /* It may already be disconnected. */ }
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
        } catch { /* If reattaching fails too, scrapeTab will report the problem. */ }
        console.log(`   📍 Starting from current scroll position instead`);
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`🏁 ${autoRestartCount > 0 ? `Restart ${autoRestartCount}: scraping` : 'Starting scrape'}...\n`);

    await scrapeTab(browser, page, collectedNotes, maxNotes, notewriterUrl, stopAtNoteId);

    // The oldest note we captured tells us how far down the list we reached.
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

    // Stopping this early means something is badly wrong, and another attempt
    // would very likely fail in the same place.
    if (oldestScraped !== null && oldestScraped > OCT_23_NOTE_ID) {
      console.log(`\n⚠️ Didn't reach Oct 23 (oldest scraped: ${oldestScraped}). Not restarting.`);
      break autoRestartLoop;
    }

    // There is still list left, so start again from where this attempt stopped.
    if (oldestScraped !== null) {
      currentStartFrom = oldestScraped;
      autoRestartCount++;
      console.log(`\n⏩ Haven't reached bottom yet (oldest: ${oldestScraped}). Auto-restarting...`);
    } else {
      console.log(`\n⚠️ No notes scraped in this run — stopping.`);
      break autoRestartLoop;
    }
  }

  if (autoRestartCount > MAX_AUTO_RESTARTS) {
    console.log(`\n⚠️ Hit auto-restart limit (${MAX_AUTO_RESTARTS}). Stopping.`);
  }

  console.log(`\n✅ Scrape finished! Collected ${collectedNotes.size} notes total (${qualityRetryCount} quality retries)\n`);

  if (collectedNotes.size === 0) {
    console.log("No notes collected.");
    process.exit(0);
  }

  // In incremental mode we record a miss against every note the scrape scrolled
  // past without capturing. Those are the notes that still have no snapshot and
  // whose id is at or above the oldest note this run did capture. A note that
  // has been missed enough times is given up on. Without that, a note that was
  // deleted and can never be captured would hold the daily scrape at its date
  // forever.
  if (args.includes('--incremental')) {
    const capturedIds = [...collectedNotes.keys()].filter(id => /^\d+$/.test(id)).map(id => BigInt(id));
    if (capturedIds.length > 0) {
      const oldestCaptured = capturedIds.reduce((a, b) => (a < b ? a : b));
      const { givenUp, firstMisses } = await supabase.markIncrementalMisses(oldestCaptured.toString());
      console.log(`🧮 Miss accounting (covered >= ${oldestCaptured}): ${givenUp} given up, ${firstMisses} first-miss.\n`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ Scrape & import complete!");
  console.log(`   • New notes:         ${newNotes}`);
  console.log(`   • Updated IDs:       ${updatedIds}`);
  console.log(`   • Existing notes:    ${existingNotes}`);
  console.log(`   • Snapshots created: ${snapshotsCreated}`);
  console.log(`   • Errors:            ${errorCount}`);
  console.log("=".repeat(60));

  // Compare what this run captured against the notes we already knew about in
  // the same id range. That tells us whether the scrape missed anything.
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

  // Turn the snapshots into one trusted row per note. Every snapshot was already
  // written to the database as it was found, so a crash or a Ctrl+C in the
  // middle of a run loses nothing here. The next run that finishes reconciles
  // the whole snapshot history again and catches up.
  await runReconcile();

  const scrapedNoteIds = [...collectedNotes.keys()]
    .filter(id => /^\d+$/.test(id))
    .map(id => BigInt(id));
  if (scrapedNoteIds.length > 0) {
    const oldestReached = scrapedNoteIds.reduce((a, b) => a < b ? a : b);
    console.log(`\n📌 To resume from where this run stopped:`);
    console.log(`   bun run scrape ${maxNotes} --start-from ${oldestReached}`);
  }

  console.log("\n💡 Chrome browser left open. Close it manually when done.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
