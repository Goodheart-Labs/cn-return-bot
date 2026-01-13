/**
 * Community Notes Notewriter Scraper
 *
 * Run this in browser console on: x.com/i/communitynotes/u/[your-username]
 *
 * Usage:
 * 1. Open DevTools console (F12)
 * 2. Paste this entire script and press Enter
 * 3. It will auto-scroll and collect notes
 * 4. When done, it outputs JSON to copy
 *
 * To stop early: window._scraper.stop()
 * To export current data: window._scraper.export()
 */
(() => {
  const notes = new Map();
  let isRunning = false;
  let scrollInterval = null;

  function extractNotes() {
    let newCount = 0;

    document.querySelectorAll('[data-testid="cellInnerDiv"]').forEach(cell => {
      try {
        const text = cell.innerText;

        // Find tweet link (contains /status/)
        const tweetLink = cell.querySelector('a[href*="/status/"]');
        if (!tweetLink) return;

        const tweetUrl = tweetLink.href;
        const tweetId = tweetUrl.match(/status\/(\d+)/)?.[1];
        if (!tweetId || notes.has(tweetId)) return;

        // Find "View details" link which contains note ID
        const detailsLink = cell.querySelector('a[href*="/communitynotes/t/"]');
        const noteId = detailsLink?.href.match(/\/t\/(\d+)/)?.[1] || '';

        // Extract status
        let status = 'UNKNOWN';
        if (text.includes('Currently rated helpful')) status = 'CURRENTLY_RATED_HELPFUL';
        else if (text.includes('Needs more ratings')) status = 'NEEDS_MORE_RATINGS';
        else if (text.includes('Currently not rated helpful')) status = 'CURRENTLY_NOT_RATED_HELPFUL';
        // "Shown on X" with views means it was/is helpful
        else if (text.match(/Shown on X[^·]*·.*views/i)) status = 'SHOWN_ON_X';
        else if (text.includes('Not shown on X')) status = 'NOT_SHOWN_ON_X';

        // Find source URLs (external links)
        const sourceLinks = [...cell.querySelectorAll('a[href^="http"]')]
          .map(a => a.href)
          .filter(h => !h.includes('x.com') && !h.includes('twitter.com'));

        // Extract note text - longest text block that's not boilerplate
        const paragraphs = cell.querySelectorAll('div[dir="ltr"], span[dir="ltr"]');
        let noteText = '';
        paragraphs.forEach(p => {
          const t = p.innerText.trim();
          if (t.length > 50 &&
              !t.includes('experimental AI contributor') &&
              !t.includes('Needs more ratings') &&
              !t.includes('Currently rated') &&
              t.length > noteText.length) {
            noteText = t;
          }
        });

        // Try to find view count - ONLY match "Shown on X · 15.1K+ views" pattern
        // Do NOT use a fallback - too easy to match numbers in tweet text
        let viewCount = null;
        const viewMatch = text.match(/Shown on X[^·]*·\s*([\d,.]+)([KMB]?)\+?\s*views?/i);
        if (viewMatch) {
          let num = parseFloat(viewMatch[1].replace(/,/g, ''));
          const suffix = (viewMatch[2] || '').toUpperCase();
          if (suffix === 'K') num *= 1000;
          else if (suffix === 'M') num *= 1000000;
          else if (suffix === 'B') num *= 1000000000;
          viewCount = Math.round(num);
        }

        // Try to find rating counts
        const helpfulMatch = text.match(/(\d+)\s*helpful/i);
        const notHelpfulMatch = text.match(/(\d+)\s*not helpful/i);

        notes.set(tweetId, {
          note_id: noteId,
          tweet_id: tweetId,
          tweet_url: tweetUrl,
          note_text: noteText,
          cn_status: status,
          view_count: viewCount,
          helpful_count: helpfulMatch ? parseInt(helpfulMatch[1]) : null,
          not_helpful_count: notHelpfulMatch ? parseInt(notHelpfulMatch[1]) : null,
          source_url: sourceLinks[0] || null,
          all_sources: sourceLinks
        });

        newCount++;
      } catch (e) { /* skip malformed cells */ }
    });

    return newCount;
  }

  function autoScroll() {
    let lastNoteCount = 0;
    let stuckCount = 0;
    const maxStuck = 10; // Stop if no new notes found after 10 scroll attempts

    console.log('🚀 Starting auto-scroll scraper...');
    console.log('   Stop anytime with: _scraper.stop()');
    console.log('   Export current data: _scraper.export()');

    isRunning = true;

    scrollInterval = setInterval(() => {
      if (!isRunning) {
        clearInterval(scrollInterval);
        return;
      }

      // Extract notes from current view
      extractNotes();

      // Scroll down - use scrollIntoView on last element for more reliable scrolling
      const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      if (cells.length > 0) {
        cells[cells.length - 1].scrollIntoView({ behavior: 'instant', block: 'end' });
      }
      window.scrollBy(0, 500); // Extra nudge

      // Check if we're stuck (no new notes found)
      if (notes.size === lastNoteCount) {
        stuckCount++;
        if (stuckCount >= maxStuck) {
          console.log('✅ Reached end of list!');
          stop();
          exportData();
          return;
        }
      } else {
        console.log(`📝 Found ${notes.size} notes total (+${notes.size - lastNoteCount} new)`);
        stuckCount = 0;
      }
      lastNoteCount = notes.size;

    }, 400); // Scroll every 400ms
  }

  function stop() {
    isRunning = false;
    if (scrollInterval) {
      clearInterval(scrollInterval);
      scrollInterval = null;
    }
    console.log(`\n🛑 Stopped. Total notes collected: ${notes.size}`);
    console.log('Run _scraper.export() to get JSON');
  }

  function exportData() {
    const data = {
      scraped_at: new Date().toISOString(),
      source_url: window.location.href,
      note_count: notes.size,
      notes: [...notes.values()]
    };

    const json = JSON.stringify(data, null, 2);

    // Try to copy to clipboard
    try {
      navigator.clipboard.writeText(json).then(() => {
        console.log('✅ JSON copied to clipboard!');
      }).catch(() => {
        console.log('📋 Copy this JSON manually:');
        console.log(json);
      });
    } catch {
      console.log('📋 Copy this JSON manually:');
      console.log(json);
    }

    return data;
  }

  // Search for text on the page (scrolls until found)
  async function search(query) {
    console.log(`🔍 Searching for "${query}"...`);
    let found = false;
    let lastHeight = 0;
    let stuck = 0;

    // First scroll to top
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 500));

    while (!found && stuck < 20) {
      const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      for (const cell of cells) {
        if (cell.innerText.toLowerCase().includes(query.toLowerCase())) {
          cell.scrollIntoView({ behavior: 'smooth', block: 'center' });
          cell.style.outline = '3px solid red';
          cell.style.background = 'rgba(255,0,0,0.1)';
          console.log('✅ Found! Highlighted in red.');
          found = true;
          break;
        }
      }

      if (!found) {
        window.scrollBy(0, 800);
        await new Promise(r => setTimeout(r, 250));
        if (document.body.scrollHeight === lastHeight) stuck++;
        else { stuck = 0; lastHeight = document.body.scrollHeight; }
      }
    }

    if (!found) console.log('❌ Not found');
    return found;
  }

  // Verify: check notes with view_count and show them
  function verify() {
    const withViews = [...notes.values()].filter(n => n.view_count);
    console.log(`\n📊 ${withViews.length} notes with views:\n`);
    withViews.sort((a, b) => (b.view_count || 0) - (a.view_count || 0));
    withViews.forEach(n => {
      console.log(`${n.view_count.toLocaleString().padStart(12)} | ${n.note_text?.slice(0, 50)}...`);
    });
    return withViews;
  }

  // Expose controls globally
  window._scraper = {
    notes,
    extractNotes,
    start: autoScroll,
    stop,
    export: exportData,
    search,
    verify
  };

  // Start automatically
  autoScroll();
})();
