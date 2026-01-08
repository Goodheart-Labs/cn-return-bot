/**
 * Verification script to check what's stored in Supabase
 * Run with: bun run src/scripts/verifySupabaseStorage.ts
 */

import { getSupabaseClient } from "../api/supabaseClient";

async function verifySupabaseStorage() {
  console.log("🔍 Verifying Supabase Storage...\n");

  const client = getSupabaseClient();

  // Check bot_configs table
  console.log("═══════════════════════════════════════════════════════");
  console.log("📋 BOT CONFIGS TABLE");
  console.log("═══════════════════════════════════════════════════════");
  const { data: botConfigs, error: botConfigsError } = await client
    .from("bot_configs")
    .select("*")
    .order("created_at", { ascending: false });

  if (botConfigsError) {
    console.error("Error fetching bot_configs:", botConfigsError.message);
  } else {
    console.log(`Total bot configs: ${botConfigs?.length || 0}`);
    if (botConfigs && botConfigs.length > 0) {
      console.log("\nBot configs:");
      for (const config of botConfigs) {
        console.log(`  - ${config.name} (id: ${config.id})`);
        console.log(`    Active: ${config.is_active}, Created: ${config.created_at}`);
      }
    }
  }

  // Check notewriters table
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("👤 NOTEWRITERS TABLE");
  console.log("═══════════════════════════════════════════════════════");
  const { data: notewriters, error: notewritersError } = await client
    .from("notewriters")
    .select("*")
    .order("created_at", { ascending: false });

  if (notewritersError) {
    console.error("Error fetching notewriters:", notewritersError.message);
  } else {
    console.log(`Total notewriters: ${notewriters?.length || 0}`);
    if (notewriters && notewriters.length > 0) {
      console.log("\nNotewriters:");
      for (const writer of notewriters) {
        console.log(`  - @${writer.handle} (${writer.display_name || "no display name"})`);
        console.log(`    Active: ${writer.is_active}, Created: ${writer.created_at}`);
      }
    }
  }

  // Check notes table
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("📝 NOTES TABLE");
  console.log("═══════════════════════════════════════════════════════");
  const { data: notes, error: notesError, count: notesCount } = await client
    .from("notes")
    .select("*", { count: "exact" })
    .order("submitted_at", { ascending: false })
    .limit(10);

  if (notesError) {
    console.error("Error fetching notes:", notesError.message);
  } else {
    console.log(`Total notes: ${notesCount || notes?.length || 0}`);

    if (notes && notes.length > 0) {
      // Status breakdown
      const { data: statusBreakdown } = await client
        .from("notes")
        .select("cn_status");

      if (statusBreakdown) {
        const statusCounts: Record<string, number> = {};
        for (const note of statusBreakdown) {
          const status = note.cn_status || "NO_STATUS";
          statusCounts[status] = (statusCounts[status] || 0) + 1;
        }
        console.log("\nStatus breakdown:");
        for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
          console.log(`  - ${status}: ${count}`);
        }
      }

      // Bot name breakdown
      const { data: botBreakdown } = await client
        .from("notes")
        .select("bot_name");

      if (botBreakdown) {
        const botCounts: Record<string, number> = {};
        for (const note of botBreakdown) {
          const botName = note.bot_name || "UNKNOWN";
          botCounts[botName] = (botCounts[botName] || 0) + 1;
        }
        console.log("\nBot breakdown:");
        for (const [botName, count] of Object.entries(botCounts).sort((a, b) => b[1] - a[1])) {
          console.log(`  - ${botName}: ${count}`);
        }
      }

      console.log("\nMost recent 10 notes:");
      for (const note of notes) {
        console.log(`\n  📌 Note ID: ${note.note_id}`);
        console.log(`     Tweet ID: ${note.tweet_id}`);
        console.log(`     Bot: ${note.bot_name || "Unknown"}`);
        console.log(`     Status: ${note.cn_status || "Not checked"}`);
        console.log(`     Submitted: ${note.submitted_at}`);
        console.log(`     Helpful: ${note.helpful_count} | Somewhat: ${note.somewhat_helpful_count} | Not: ${note.not_helpful_count}`);
        if (note.source_url) {
          console.log(`     Source: ${note.source_url.substring(0, 60)}...`);
        }
        console.log(`     Text: ${note.note_text.substring(0, 100)}...`);
      }
    }
  }

  // Check note_status_history table
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("📊 NOTE STATUS HISTORY TABLE");
  console.log("═══════════════════════════════════════════════════════");
  const { data: history, error: historyError, count: historyCount } = await client
    .from("note_status_history")
    .select("*", { count: "exact" })
    .order("recorded_at", { ascending: false })
    .limit(10);

  if (historyError) {
    console.error("Error fetching note_status_history:", historyError.message);
  } else {
    console.log(`Total history records: ${historyCount || history?.length || 0}`);
    if (history && history.length > 0) {
      console.log("\nMost recent 10 status changes:");
      for (const record of history) {
        console.log(`  - Note: ${record.note_id.substring(0, 20)}...`);
        console.log(`    Status: ${record.status}, Recorded: ${record.recorded_at}`);
        console.log(`    Helpful: ${record.helpful_count} | Somewhat: ${record.somewhat_helpful_count} | Not: ${record.not_helpful_count}`);
      }
    }
  }

  // Summary stats
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("📈 SUMMARY");
  console.log("═══════════════════════════════════════════════════════");

  // Count helpful notes
  const { count: helpfulCount } = await client
    .from("notes")
    .select("*", { count: "exact", head: true })
    .eq("cn_status", "CURRENTLY_RATED_HELPFUL");

  // Count notes needing feedback check
  const staleDate = new Date();
  staleDate.setDate(staleDate.getDate() - 1);
  const { count: needsFeedbackCount } = await client
    .from("notes")
    .select("*", { count: "exact", head: true })
    .or(`last_checked_at.is.null,last_checked_at.lt.${staleDate.toISOString()}`);

  console.log(`  Bot configs: ${botConfigs?.length || 0}`);
  console.log(`  Notewriters: ${notewriters?.length || 0}`);
  console.log(`  Total notes: ${notesCount || 0}`);
  console.log(`  Helpful notes: ${helpfulCount || 0}`);
  console.log(`  Notes needing feedback update: ${needsFeedbackCount || 0}`);
  console.log(`  Status history records: ${historyCount || 0}`);

  console.log("\n✅ Verification complete!");
}

verifySupabaseStorage().catch((error) => {
  console.error("Verification failed:", error);
  process.exit(1);
});
