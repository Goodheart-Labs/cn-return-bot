import "dotenv/config";
import { getSupabaseClient } from "../api/supabaseClient";

const client = getSupabaseClient();

// Check notes from bd60b25 run
const bd60b25Notes = [
  "2003320051907117068",
  "2003311919898231262",
  "2002183835837177862",
];

console.log("Notes from bd60b25 run:");
for (const id of bd60b25Notes) {
  const { data: d } = await client
    .from("canonical_note_information")
    .select("note_id, tweet_id")
    .eq("note_id", id);
  console.log(`  ${id}: ${d?.length ? "YES - tweet " + d[0]!.tweet_id : "NO"}`);
}
