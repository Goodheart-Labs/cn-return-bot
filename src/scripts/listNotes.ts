import "dotenv/config";
import { SupabaseLogger } from "../api/supabaseClient";

const supabase = new SupabaseLogger();
const notes = await supabase.getNotesWithLatestSnapshots();

// Sort by submitted_at descending (most recent first)
notes.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());

function getStatus(n: any): string {
  const s = n.effective_status?.toLowerCase() || '';
  if (s.includes('helpful') && !s.includes('not')) return 'HELPFUL';
  if (s.includes('not helpful')) return 'NOT HELPFUL';
  if (s.includes('needs more')) return 'NEEDS MORE';
  return 'UNKNOWN';
}

function formatNote(n: any) {
  const date = new Date(n.submitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const status = getStatus(n).padEnd(11);
  const bot = (n.bot_name || 'unknown').padEnd(12);
  const firstLine = (n.note_text || '').split('\n')[0].slice(0, 70) || '[no text]';
  return `${date.padEnd(7)} | ${status} | ${bot} | ${firstLine}`;
}

console.log('DATE    | STATUS      | BOT          | NOTE');
console.log('-'.repeat(110));
notes.forEach(n => console.log(formatNote(n)));
