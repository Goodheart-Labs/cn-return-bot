/**
 * Manual Import Script for Scraped Community Notes
 *
 * This script allows you to manually import community notes data that you've scraped.
 * It will:
 * - Create new notes if they don't exist
 * - Update existing notes with new view counts and status
 * - Track view counts over time via history table
 *
 * Usage:
 *   1. Create a JSON file with your scraped data (see scraped-notes-template.json)
 *   2. Run: tsx src/scripts/importScrapedNotes.ts <path-to-json-file>
 */

import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";
import { readFileSync } from "fs";

interface ScrapedNote {
  note_id: string;
  tweet_id: string;
  note_text: string;
  cn_status?: string;
  view_count?: number;
  bot_name?: string;
  source_url?: string;
  submitted_at?: string; // ISO string format
}

interface ImportData {
  notes: ScrapedNote[];
  import_date?: string;
  description?: string;
}

async function main() {
  console.log("[importScrapedNotes] Starting manual import...");

  // Check for file path argument
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: tsx src/scripts/importScrapedNotes.ts <path-to-json-file>");
    console.error("Example: tsx src/scripts/importScrapedNotes.ts ./scraped-notes.json");
    process.exit(1);
  }

  // Initialize Supabase
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("[importScrapedNotes] Missing Supabase credentials");
    process.exit(1);
  }

  const supabase = new SupabaseLogger();

  // Load the JSON file
  let importData: ImportData;
  try {
    const fileContent = readFileSync(filePath, "utf-8");
    importData = JSON.parse(fileContent);
  } catch (err) {
    console.error("[importScrapedNotes] Failed to read or parse JSON file:", err);
    process.exit(1);
  }

  if (!importData.notes || !Array.isArray(importData.notes)) {
    console.error("[importScrapedNotes] Invalid JSON format: 'notes' array is required");
    process.exit(1);
  }

  console.log(`[importScrapedNotes] Found ${importData.notes.length} notes to import`);
  if (importData.description) {
    console.log(`[importScrapedNotes] Import description: ${importData.description}`);
  }

  // Validate notes
  const errors: string[] = [];
  importData.notes.forEach((note, idx) => {
    if (!note.note_id) errors.push(`Note #${idx + 1}: missing note_id`);
    if (!note.tweet_id) errors.push(`Note #${idx + 1}: missing tweet_id`);
    if (!note.note_text) errors.push(`Note #${idx + 1}: missing note_text`);
  });

  if (errors.length > 0) {
    console.error("[importScrapedNotes] Validation errors:");
    errors.forEach((err) => console.error(`  - ${err}`));
    process.exit(1);
  }

  // Import each note
  let createdCount = 0;
  let updatedCount = 0;
  let errorCount = 0;

  for (const [idx, note] of importData.notes.entries()) {
    console.log(`\n[importScrapedNotes] Processing note ${idx + 1}/${importData.notes.length}: ${note.note_id}`);

    try {
      const existing = await supabase.getNoteByNoteId(note.note_id);
      const isNewNote = !existing;

      const result = await supabase.upsertScrapedNote(note);

      if (isNewNote) {
        createdCount++;
        console.log(`  ✓ Created new note`);
      } else {
        updatedCount++;
        console.log(`  ✓ Updated existing note`);
      }

      // Log to status history if we have status or view count
      if (note.cn_status || note.view_count !== undefined) {
        await supabase.logStatusHistory(
          note.note_id,
          note.cn_status || existing?.cn_status || "UNKNOWN",
          {
            view_count: note.view_count,
          }
        );
        console.log(`  ✓ Logged to status history`);
      }

      // Show key info
      if (note.view_count !== undefined) {
        console.log(`  - View count: ${note.view_count}`);
      }
      if (note.cn_status) {
        console.log(`  - Status: ${note.cn_status}`);
      }
    } catch (err) {
      errorCount++;
      console.error(`  ✗ Error processing note ${note.note_id}:`, err);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("[importScrapedNotes] Import complete!");
  console.log(`  - Created: ${createdCount} notes`);
  console.log(`  - Updated: ${updatedCount} notes`);
  console.log(`  - Errors: ${errorCount} notes`);
  console.log("=".repeat(60));

  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("[importScrapedNotes] Fatal error:", err);
  process.exit(1);
});
