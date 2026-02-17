import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const fixes = [
  { note_id: "2010012777117598105", old_tweet_id: "1938244629071015936", new_tweet_id: "2009847669640827201" },
  { note_id: "2019361608862966065", old_tweet_id: "1887758095260262400", new_tweet_id: "2019316482031951930" },
  { note_id: "2020977123381440517", old_tweet_id: "1645676408063107073", new_tweet_id: "2020927997570842913" },
  { note_id: "2015727480137761047", old_tweet_id: "1870853024798715904", new_tweet_id: "2015702758590968211" },
  { note_id: "2011515046531129474", old_tweet_id: "unknown",             new_tweet_id: "2011445127861211504" },
  { note_id: "2012158672235884992", old_tweet_id: "unknown",             new_tweet_id: "2011853538364964966" },
  { note_id: "2015949975147184338", old_tweet_id: "1890108715056910337", new_tweet_id: "2015881009347363120" },
  { note_id: "2021223765217075343", old_tweet_id: "1890108715056910337", new_tweet_id: "2020979287340531992" },
  { note_id: "2013402976019181815", old_tweet_id: "1534905804368879621", new_tweet_id: "2013188400598094301" },
];

console.log(`Applying ${fixes.length} tweet_id fixes...\n`);

for (const fix of fixes) {
  const { error } = await client
    .from("scraped_notewriter_notes")
    .update({ tweet_id: fix.new_tweet_id })
    .eq("note_id", fix.note_id);

  if (error) {
    console.log(`  ✗ ${fix.note_id}: ${error.message}`);
  } else {
    console.log(`  ✓ ${fix.note_id}: ${fix.old_tweet_id} → ${fix.new_tweet_id}`);
  }
}

console.log("\nDone.");
