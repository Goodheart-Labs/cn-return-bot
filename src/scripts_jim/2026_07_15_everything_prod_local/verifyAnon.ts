const url = "http://127.0.0.1:54321";
const anon = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
import { createClient } from "@supabase/supabase-js";
const sb = createClient(url, anon);
const NOTE_SELECT = "*, claim:everything_claims(id, item_id, claim, context_quote, context_paragraph, image_urls, updated_quote, context_url, start_seconds, end_seconds), sources:everything_note_sources(url, quote, explanation, sort_order)";
const r = await Promise.all([
  sb.from("everything_projects").select("*"),
  sb.from("everything_items").select("*"),
  sb.from("everything_notes").select(NOTE_SELECT),
]);
console.log("projects:", r[0].error?.message ?? r[0].data?.length);
console.log("items:", r[1].error?.message ?? r[1].data?.length);
console.log("notes:", r[2].error?.message ?? r[2].data?.length);
