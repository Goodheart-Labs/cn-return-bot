/**
 * Import Scraped Notewriter Data
 *
 * Imports data scraped from x.com/i/communitynotes/u/[username]
 * Uses separate tables (canonical_note_information + scraped_notewriter_snapshots)
 * to avoid mixing with verified data.
 *
 * Each import creates new snapshot rows for time-series tracking.
 *
 * Usage:
 *   tsx src/scripts/importNotewriterData.ts <path-to-json-file>
 *
 * JSON format (from browser scraper):
 *   {
 *     "scraped_at": "2026-01-12T...",
 *     "notes": [
 *       {
 *         "note_id": "...",
 *         "tweet_id": "...",
 *         "note_text": "...",
 *         "cn_status": "NEEDS_MORE_RATINGS",
 *         "view_count": 1234,
 *         "source_url": "https://..."
 *       }
 *     ]
 *   }
 */

import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";
import { readFileSync } from "fs";

interface ScrapedNote {
  note_id: string;
  tweet_id: string;
  tweet_url?: string;
  note_text?: string;
  cn_status?: string;
  view_count?: number | null;
  helpful_count?: number | null;
  somewhat_helpful_count?: number | null;
  not_helpful_count?: number | null;
  source_url?: string | null;
  all_sources?: string[];
}

interface ImportData {
  scraped_at?: string;
  source_url?: string;
  note_count?: number;
  notes: ScrapedNote[];
}

async function main() {
  console.log("[importNotewriterData] Starting import...\n");

  // Check for file path argument
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx src/scripts/importNotewriterData.ts <path-to-json-file>");
    console.error("\nExample: tsx src/scripts/importNotewriterData.ts ./scraped-data.json");
    console.error("\nGenerate JSON using the browser scraper:");
    console.error("  scripts/browser-notewriter-scraper.js");
    process.exit(1);
  }

  // Initialize Supabase
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("[importNotewriterData] Missing SUPABASE_URL or SUPABASE_SERVICE_KEY");
    process.exit(1);
  }

  const supabase = new SupabaseLogger();

  // Load the JSON file
  let importData: ImportData;
  try {
    const fileContent = readFileSync(filePath, "utf-8");
    importData = JSON.parse(fileContent);
  } catch (err) {
    console.error("[importNotewriterData] Failed to read or parse JSON file:", err);
    process.exit(1);
  }

  if (!importData.notes || !Array.isArray(importData.notes)) {
    console.error("[importNotewriterData] Invalid JSON: 'notes' array is required");
    process.exit(1);
  }

  console.log(`[importNotewriterData] Found ${importData.notes.length} notes to import`);
  if (importData.scraped_at) {
    console.log(`[importNotewriterData] Scraped at: ${importData.scraped_at}`);
  }
  if (importData.source_url) {
    console.log(`[importNotewriterData] Source: ${importData.source_url}`);
  }
  console.log();

  // Filter out notes without required fields, use tweet_id as fallback for note_id
  const validNotes = importData.notes.filter((note) => {
    if (!note.tweet_id) {
      console.warn(`  ⚠ Skipping note without tweet_id`);
      return false;
    }
    // Use tweet_id as note_id if note_id is empty (scraper couldn't find it)
    if (!note.note_id) {
      note.note_id = `tweet_${note.tweet_id}`;
    }
    return true;
  });

  console.log(`[importNotewriterData] ${validNotes.length} valid notes to process\n`);

  // Import each note
  let newNotes = 0;
  let existingNotes = 0;
  let snapshotsCreated = 0;
  let errorCount = 0;

  for (const [idx, note] of validNotes.entries()) {
    const progress = `[${idx + 1}/${validNotes.length}]`;

    try {
      // Check if note already exists in our scraped data
      const exists = await supabase.scrapedNotewriterNoteExists(note.note_id);

      if (!exists) {
        // Create the note record (immutable core data)
        await supabase.upsertScrapedNotewriterNote({
          note_id: note.note_id,
          tweet_id: note.tweet_id,
          note_text: note.note_text,
          source_url: note.source_url || undefined,
        });
        newNotes++;
        console.log(`${progress} ✓ NEW: ${note.note_id}`);
      } else {
        existingNotes++;
        console.log(`${progress} • EXISTS: ${note.note_id}`);
      }

      // Always create a snapshot (time-series data)
      await supabase.insertScrapedNotewriterSnapshot({
        note_id: note.note_id,
        cn_status: note.cn_status,
        view_count: note.view_count ?? undefined,
        helpful_count: note.helpful_count ?? undefined,
        somewhat_helpful_count: note.somewhat_helpful_count ?? undefined,
        not_helpful_count: note.not_helpful_count ?? undefined,
      });
      snapshotsCreated++;

      // Show snapshot details
      const details: string[] = [];
      if (note.cn_status) details.push(`status=${note.cn_status}`);
      if (note.view_count != null) details.push(`views=${note.view_count}`);
      if (note.helpful_count != null) details.push(`helpful=${note.helpful_count}`);
      if (details.length > 0) {
        console.log(`         → ${details.join(", ")}`);
      }
    } catch (err) {
      errorCount++;
      console.error(`${progress} ✗ ERROR: ${note.note_id}:`, err);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("[importNotewriterData] Import complete!");
  console.log(`  • New notes:         ${newNotes}`);
  console.log(`  • Existing notes:    ${existingNotes}`);
  console.log(`  • Snapshots created: ${snapshotsCreated}`);
  console.log(`  • Errors:            ${errorCount}`);
  console.log("=".repeat(60));

  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[importNotewriterData] Fatal error:", err);
  process.exit(1);
});
