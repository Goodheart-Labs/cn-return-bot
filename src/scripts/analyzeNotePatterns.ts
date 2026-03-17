import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";

const supabase = new SupabaseLogger();
const notes = await supabase.getNotesWithLatestSnapshots();

// Separate helpful and not helpful notes
const helpful: typeof notes = [];
const notHelpful: typeof notes = [];

for (const note of notes) {
  const status = note.effective_status?.toLowerCase().replace(/_/g, " ") || "";
  if (status.includes("helpful") && !status.includes("not")) {
    helpful.push(note);
  } else if (status.includes("not helpful")) {
    notHelpful.push(note);
  }
}

console.log("=== HELPFUL NOTES ===\n");
for (const note of helpful.slice(0, 5)) {
  console.log(`Bot: ${note.bot_name}`);
  console.log(`Note: ${note.note_text?.slice(0, 200)}...`);
  console.log(`URL: ${note.source_url}`);
  console.log(`Length: ${note.note_text?.length || 0} chars`);
  console.log("---\n");
}

console.log("\n=== NOT HELPFUL NOTES ===\n");
for (const note of notHelpful) {
  console.log(`Bot: ${note.bot_name}`);
  console.log(`Note: ${note.note_text?.slice(0, 200)}...`);
  console.log(`URL: ${note.source_url}`);
  console.log(`Length: ${note.note_text?.length || 0} chars`);
  console.log("---\n");
}

// Analyze patterns
console.log("\n=== ANALYSIS ===\n");
console.log(`Helpful notes: ${helpful.length}`);
console.log(`Not helpful notes: ${notHelpful.length}`);

const avgHelpfulLen = helpful.reduce((sum, n) => sum + (n.note_text?.length || 0), 0) / helpful.length;
const avgNotHelpfulLen = notHelpful.reduce((sum, n) => sum + (n.note_text?.length || 0), 0) / notHelpful.length;

console.log(`\nAverage helpful note length: ${avgHelpfulLen.toFixed(0)} chars`);
console.log(`Average not helpful note length: ${avgNotHelpfulLen.toFixed(0)} chars`);

// Check URL domains
const helpfulDomains: Record<string, number> = {};
const notHelpfulDomains: Record<string, number> = {};

for (const note of helpful) {
  try {
    const domain = new URL(note.source_url || "").hostname;
    helpfulDomains[domain] = (helpfulDomains[domain] || 0) + 1;
  } catch {}
}

for (const note of notHelpful) {
  try {
    const domain = new URL(note.source_url || "").hostname;
    notHelpfulDomains[domain] = (notHelpfulDomains[domain] || 0) + 1;
  } catch {}
}

console.log("\nHelpful note domains:");
for (const [domain, count] of Object.entries(helpfulDomains)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)) {
  console.log(`  ${domain}: ${count}`);
}

console.log("\nNot helpful note domains:");
for (const [domain, count] of Object.entries(notHelpfulDomains)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10)) {
  console.log(`  ${domain}: ${count}`);
}
