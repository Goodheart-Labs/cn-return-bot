import { SupabaseLogger } from "../api/supabaseClient";

async function analyzeViewConsistency() {
  const supabase = new SupabaseLogger();

  // Get all snapshots with view counts, ordered by note_id and time
  const { data: snapshots, error } = await supabase["client"]
    .from("scraped_notewriter_snapshots")
    .select("note_id, view_count, scraped_at")
    .not("view_count", "is", null)
    .order("note_id", { ascending: true })
    .order("scraped_at", { ascending: true });

  if (error) {
    console.error("Error fetching snapshots:", error);
    process.exit(1);
  }

  // Group by note_id
  const byNote = new Map<string, Array<{ view_count: number; scraped_at: string }>>();
  for (const snap of snapshots || []) {
    if (!byNote.has(snap.note_id)) {
      byNote.set(snap.note_id, []);
    }
    byNote.get(snap.note_id)!.push({
      view_count: snap.view_count,
      scraped_at: snap.scraped_at,
    });
  }

  // Filter to notes with at least 2 scrapes
  const notesWithMultipleScrapes = Array.from(byNote.entries())
    .filter(([_, scrapes]) => scrapes.length >= 2)
    .map(([note_id, scrapes]) => ({ note_id, scrapes }));

  console.log(`Total notes with view counts: ${byNote.size}`);
  console.log(`Notes with 2+ scrapes: ${notesWithMultipleScrapes.length}`);

  // Analyze consistency
  let increasing = 0;
  let decreasing = 0;
  let stable = 0;
  let erratic = 0;

  const examples: Array<{
    note_id: string;
    pattern: string;
    scrapes: Array<{ view_count: number; scraped_at: string }>;
  }> = [];

  for (const { note_id, scrapes } of notesWithMultipleScrapes) {
    let pattern = "stable";
    let hasIncrease = false;
    let hasDecrease = false;

    for (let i = 1; i < scrapes.length; i++) {
      const prev = scrapes[i - 1]!.view_count;
      const curr = scrapes[i]!.view_count;

      if (curr > prev) hasIncrease = true;
      if (curr < prev) hasDecrease = true;
    }

    if (hasIncrease && hasDecrease) {
      pattern = "erratic";
      erratic++;
    } else if (hasIncrease) {
      pattern = "increasing";
      increasing++;
    } else if (hasDecrease) {
      pattern = "decreasing";
      decreasing++;
    } else {
      stable++;
    }

    // Collect examples
    if (examples.length < 5 || pattern === "erratic" || pattern === "decreasing") {
      examples.push({ note_id, pattern, scrapes });
    }
  }

  console.log("\nView count patterns:");
  console.log(`  Increasing: ${increasing} (${((increasing / notesWithMultipleScrapes.length) * 100).toFixed(1)}%)`);
  console.log(`  Stable: ${stable} (${((stable / notesWithMultipleScrapes.length) * 100).toFixed(1)}%)`);
  console.log(`  Decreasing: ${decreasing} (${((decreasing / notesWithMultipleScrapes.length) * 100).toFixed(1)}%)`);
  console.log(`  Erratic: ${erratic} (${((erratic / notesWithMultipleScrapes.length) * 100).toFixed(1)}%)`);

  // Show examples of each pattern
  console.log("\nExamples:");
  const patternExamples = {
    increasing: examples.filter((e) => e.pattern === "increasing").slice(0, 2),
    stable: examples.filter((e) => e.pattern === "stable").slice(0, 2),
    decreasing: examples.filter((e) => e.pattern === "decreasing").slice(0, 2),
    erratic: examples.filter((e) => e.pattern === "erratic").slice(0, 2),
  };

  for (const [pattern, items] of Object.entries(patternExamples)) {
    if (items.length > 0) {
      console.log(`\n${pattern.toUpperCase()}:`);
      for (const { note_id, scrapes } of items) {
        console.log(`  ${note_id}:`);
        for (const scrape of scrapes) {
          console.log(`    ${scrape.scraped_at}: ${scrape.view_count.toLocaleString()} views`);
        }
      }
    }
  }

  // Calculate total views for notes with 2+ scrapes (using latest)
  const totalViewsMultipleScrapes = notesWithMultipleScrapes.reduce(
    (sum, { scrapes }) => sum + scrapes[scrapes.length - 1]!.view_count,
    0,
  );

  console.log(`\nTotal views (notes with 2+ scrapes only): ${totalViewsMultipleScrapes.toLocaleString()}`);
  console.log(`Notes counted: ${notesWithMultipleScrapes.length}`);
  console.log(
    `Average: ${Math.round(totalViewsMultipleScrapes / notesWithMultipleScrapes.length).toLocaleString()} views/note`,
  );
}

analyzeViewConsistency().catch(console.error);
