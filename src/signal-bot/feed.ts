import type { SignalStore } from "./store";

export interface PostedNote {
  note_id: string;
  tweet_id: string;
  note_text: string;
  bot_name?: string | null;
  submitted_at: string;
}

interface FeedDependencies {
  /** Notes submitted at or after the timestamp, oldest first. */
  listNotesSince: (since: string, limit: number) => Promise<PostedNote[]>;
  send: (text: string) => Promise<unknown>;
  store: SignalStore;
  now?: () => Date;
  onError?: (error: unknown) => void;
}

const CURSOR_KEY = "notes_feed_cursor";
const SENT_KEY = "notes_feed_sent";
const REMEMBERED_IDS = 200;

export function formatPostedNote(note: PostedNote): string {
  const who = note.bot_name?.trim() ? ` · ${note.bot_name.trim()}` : "";
  return `New note${who}\nOn https://x.com/i/status/${note.tweet_id}\n\n${note.note_text.trim()}\n\nhttps://x.com/i/communitynotes/${note.note_id}`;
}

/** Posts every note the pipelines submit to X into a Signal group, as it lands
 * in the notes table. It starts from the moment it is first run, never history,
 * and remembers what it sent so a send failure is retried, not skipped. */
export class NotesFeed {
  private polling = false;

  constructor(private readonly deps: FeedDependencies) {}

  cursor(): string {
    const stored = this.deps.store.getMetadata(CURSOR_KEY);
    if (stored) return stored;
    const start = (this.deps.now ?? (() => new Date()))().toISOString();
    this.deps.store.setMetadata(CURSOR_KEY, start);
    return start;
  }

  private sentIds(): string[] {
    try {
      const parsed = JSON.parse(this.deps.store.getMetadata(SENT_KEY) ?? "[]");
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch { return []; }
  }

  /** Returns how many notes were posted. Overlapping polls are skipped. */
  async poll(): Promise<number> {
    if (this.polling) return 0;
    this.polling = true;
    let posted = 0;
    try {
      const since = this.cursor();
      const sent = this.sentIds();
      const notes = (await this.deps.listNotesSince(since, 20))
        .filter((note) => !sent.includes(note.note_id))
        .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at));
      for (const note of notes) {
        await this.deps.send(formatPostedNote(note));
        sent.push(note.note_id);
        // The cursor is inclusive, so ids guard against a shared timestamp.
        this.deps.store.setMetadata(SENT_KEY, JSON.stringify(sent.slice(-REMEMBERED_IDS)));
        this.deps.store.setMetadata(CURSOR_KEY, note.submitted_at);
        posted++;
      }
    } catch (error) {
      this.deps.onError?.(error);
    } finally {
      this.polling = false;
    }
    return posted;
  }
}
