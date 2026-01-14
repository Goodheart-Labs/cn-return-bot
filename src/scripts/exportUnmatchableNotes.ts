/**
 * Export Unmatchable Notes
 *
 * Exports the 46 notes that don't match scraped data to a markdown file
 */

import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";
import { writeFileSync } from "fs";

async function main() {
  const supabase = new SupabaseLogger();

  console.log("\n[exportUnmatchableNotes] Fetching notes...\n");

  // Get all notes from main table
  const { data: allNotes, error: notesError } = await supabase.client
    .from("notes")
    .select("*")
    .order("submitted_at", { ascending: false });

  if (notesError) {
    console.error("Error fetching notes:", notesError);
    process.exit(1);
  }

  // Get all scraped notes
  const { data: allScraped, error: scrapedError } = await supabase.client
    .from("scraped_notewriter_notes")
    .select("note_id, tweet_id");

  if (scrapedError) {
    console.error("Error fetching scraped notes:", scrapedError);
    process.exit(1);
  }

  // Find unmatchable notes
  const scrapedByTweetId = new Map(
    allScraped?.map(s => [s.tweet_id, s]) || []
  );

  const unmatchableNotes = allNotes?.filter(n => !scrapedByTweetId.has(n.tweet_id)) || [];

  console.log(`Found ${unmatchableNotes.length} unmatchable notes\n`);

  // Generate markdown
  let markdown = `# Unmatchable Notes Analysis\n\n`;
  markdown += `**Generated:** ${new Date().toISOString()}\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `- **Total notes in database:** ${allNotes?.length || 0}\n`;
  markdown += `- **Matched with scraped data:** ${(allNotes?.length || 0) - unmatchableNotes.length}\n`;
  markdown += `- **Unmatchable (not found in scraped data):** ${unmatchableNotes.length}\n\n`;
  markdown += `---\n\n`;
  markdown += `## Unmatchable Notes Details\n\n`;
  markdown += `These notes were submitted by the bot but don't appear in the scraped notewriter profile data.\n\n`;

  for (const [idx, note] of unmatchableNotes.entries()) {
    markdown += `### ${idx + 1}. Note ${note.note_id}\n\n`;
    markdown += `**Tweet:** https://x.com/i/status/${note.tweet_id}\n\n`;

    if (note.note_id) {
      markdown += `**Community Note:** https://x.com/i/birdwatch/n/${note.note_id}\n\n`;
    }

    markdown += `**Submitted:** ${note.submitted_at || "Unknown"}\n\n`;
    markdown += `**Bot:** ${note.bot_name || "Unknown"}\n\n`;
    markdown += `**Current Status:**\n`;
    markdown += `- cn_status: ${note.cn_status || "null"}\n`;
    markdown += `- view_count: ${note.view_count || "null"}\n`;
    markdown += `- helpful_count: ${note.helpful_count || "null"}\n`;
    markdown += `- somewhat_helpful_count: ${note.somewhat_helpful_count || "null"}\n`;
    markdown += `- not_helpful_count: ${note.not_helpful_count || "null"}\n\n`;

    markdown += `**Note Text:**\n\n`;
    markdown += `> ${note.note_text || "(No text)"}\n\n`;

    if (note.source_url) {
      markdown += `**Source URL:** ${note.source_url}\n\n`;
    }

    markdown += `**Evaluation Score:** ${note.evaluation_score || "null"}\n\n`;

    markdown += `---\n\n`;
  }

  // Add footer
  markdown += `## Possible Reasons for Not Matching\n\n`;
  markdown += `1. **Too recent** - Note submitted after the scraping was done\n`;
  markdown += `2. **Not yet visible** - Note pending review or not yet shown on profile\n`;
  markdown += `3. **Removed/Hidden** - Note was removed or hidden by X\n`;
  markdown += `4. **Rate limited** - Note didn't make it past X's rate limits\n`;
  markdown += `5. **Profile pagination** - Note exists but wasn't captured in the scrape (pagination limits)\n\n`;

  // Write to file
  const filename = "docs/unmatchable-notes-analysis.md";
  writeFileSync(filename, markdown);

  console.log(`✓ Exported to ${filename}\n`);
  console.log(`Summary:`);
  console.log(`  • Total unmatchable notes: ${unmatchableNotes.length}`);
  console.log(`  • File size: ${(markdown.length / 1024).toFixed(2)} KB`);
  console.log();
}

main().catch(console.error);
