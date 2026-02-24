import { SupabaseLogger } from "../api/supabaseClient";

async function investigate() {
  const supabase = new SupabaseLogger();

  // Get scraped notes that DON'T have placeholder IDs
  const { data: scraped } = await supabase["client"]
    .from("canonical_note_information")
    .select("note_id, tweet_id")
    .not("note_id", "like", "tweet_%")
    .order("note_id", { ascending: false })
    .limit(10);

  console.log("Recent scraped notes with real IDs:");
  console.log(scraped);
  console.log();

  // Get a sample of notes with bot_name
  const { data: notes } = await supabase["client"]
    .from("notes")
    .select("note_id, bot_name")
    .not("bot_name", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(10);

  console.log("Sample notes with bot_name:");
  console.log(notes?.map((n) => ({ note_id: n.note_id, bot_name: n.bot_name })));
  console.log();

  // Check if any scraped notes exist in notes table
  if (scraped && scraped.length > 0) {
    const { data: match } = await supabase["client"]
      .from("notes")
      .select("note_id, bot_name")
      .in(
        "note_id",
        scraped.map((n) => n.note_id)
      );

    console.log("Matches found:");
    console.log(match);
  }
}

investigate().catch(console.error);
