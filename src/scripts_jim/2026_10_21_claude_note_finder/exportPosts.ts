// Saves the text of the given prod items as files the note-finding agents
// read, one folder per post with post.md and meta.json.
//
// Usage: bun run src/scripts_jim/2026_10_21_claude_note_finder/exportPosts.ts <url>...
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { createClient } from "@supabase/supabase-js";

export const WORK_DIR = `${homedir()}/.local/share/claude-note-finder`;

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data: items, error } = await db
  .from("everything_items")
  .select("id, url, title, published_at, full_text, project:everything_projects(slug, name)")
  .in("url", process.argv.slice(2));
if (error) throw error;

for (const item of items) {
  const project = item.project as unknown as { slug: string; name: string };
  const slug = item.url.replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 80).replace(/-$/, "");
  const dir = `${WORK_DIR}/posts/${slug}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/post.md`, `# ${item.title}\n\nBy ${project.name}, published ${item.published_at}\n${item.url}\n\n${item.full_text}`);
  writeFileSync(`${dir}/meta.json`, JSON.stringify({ itemId: item.id, url: item.url, title: item.title, creator: project.name, publishedAt: item.published_at }, null, 2));
  console.log(`${dir}  ${(item.full_text ?? "").length} chars`);
}
