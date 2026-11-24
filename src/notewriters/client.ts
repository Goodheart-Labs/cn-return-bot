/* The notewriter API v2 (GOO-791): a typed client with one function per call.
 * The rules live in the database functions notewriter_api_* of migration 184,
 * and docs/notewriter-api.md is the guide. The client needs nothing from this
 * repository, so a notewriter outside the team can copy this file as it is.
 *
 * Every call sends two keys: the Supabase key (the website's public key for a
 * notewriter outside the team, the secret key for our own runners) and the
 * notewriter's own key, which names the notewriter. A refused call throws a
 * NotewriterApiError with the HTTP status:
 *   400 a rule was broken, 401 no key or a wrong one, 403 switched off or the
 *   reservation is not yours, 404 no such post, 409 the reservation already
 *   ended or you already wrote a note on that passage, 429 a limit reached. */

export type CaptionCue = { start: number; end: number; text: string };

/** A passage a reader asked about, with the reader's reason. */
export type AskedPassage = { request: string; passage: string; reason: string | null };

/** A post as a notewriter reads it. */
export type Post = {
  id: string;
  url: string;
  title: string | null;
  source: string;
  creator: string | null;
  published_at: string | null;
  /** A reader asked for this page or a passage of it. */
  requested: boolean;
  text: string;
  caption_cues: CaptionCue[] | null;
  asked_passages: AskedPassage[];
  /** True when the post was already checked in full, so only the asked
   *  passages need checking. */
  only_asked_passages: boolean;
};

/** A post on a page of the list. Its reservations are the ones that count:
 *  open and before their deadline, or ended as done or skipped. On a
 *  requested post only those since the request count. */
export type ListedPost = Pick<Post, "id" | "url" | "title" | "source" | "creator" | "published_at" | "requested"> & {
  creator_priority: boolean;
  creator_score: number;
  /** Different readers who opened the post in the last 24 hours. The list
   *  ranks a post by creator_score plus readers (GOO-868). */
  readers: number;
  reservations: { notewriter: string; place: number; state: "open" | "done" | "skipped" }[];
};

/** The sort key of the last post on a page. Pass it back as `after`. */
export type ListCursor = [number, number, number, number, string];

export type PostsPage = { posts: ListedPost[]; next: ListCursor | null };

export type ListOptions = {
  /** 1 to 50 posts. Default 1. */
  limit?: number;
  after?: ListCursor | null;
  /** List only posts on which at most this many other notewriters count.
   *  Default 0: posts nobody counts on. */
  maxOthers?: number;
  /** "team" counts only our own notewriters' reservations. Default
   *  "everyone". */
  othersFrom?: "everyone" | "team";
  requestedOnly?: boolean;
  /** List only the post with this address. */
  url?: string;
};

export type Reserve =
  | { kind: "reserved"; reservation: string; place: number; deadline: string; post: Post }
  | { kind: "taken"; reservations: number };

export type NewNote = {
  /** The exact words of the post the note is about, at least 20 characters. */
  passage: string;
  /** At most 1,000 characters. */
  note: string;
  /** 1 to 8 sources, each with an http(s) address. */
  sources: { url: string; quote?: string; explanation?: string }[];
  /** For a video: whole seconds where the passage is said. */
  start_seconds?: number | null;
  end_seconds?: number | null;
};

export type AddedNote = { kind: "posted"; note: string } | { kind: "not_posted"; reason: string };

export type Failure = { at: string; url: string; outcome: "failed" | "expired"; reason: string };

export type Me = {
  notewriter: { id: string; name: string };
  /** null means no limit. */
  limits: { notes_per_day: number | null; max_open: number | null; lease_minutes: number };
  /** Notes it may still post, counted over the last 24 hours. null means no limit. */
  notes_left: number | null;
  open: { reservation: string; post: string; url: string; deadline: string }[];
  last_7_days: { done: number; skipped: number; failed: number; expired: number; notes: number };
  last_call: string;
  last_failures: Failure[];
};

export type OwnNote = {
  note: string;
  created_at: string;
  post: string;
  url: string;
  passage: string;
  text: string;
  helpful: number;
  somewhat_helpful: number;
  not_helpful: number;
};

export type NotesPage = { notes: OwnNote[]; next: [string, string] | null };

export class NotewriterApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(`${status}: ${message}`);
    this.name = "NotewriterApiError";
  }
}

export type NotewriterClientOptions = {
  /** The project's address, such as https://<project>.supabase.co. */
  supabaseUrl: string;
  /** The Supabase key: the public key, or our secret key. */
  apiKey: string;
  /** The notewriter's own key, cnw_... */
  notewriterKey: string;
};

export function notewriterClient({ supabaseUrl, apiKey, notewriterKey }: NotewriterClientOptions) {
  async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey, Authorization: `Bearer ${apiKey}`, "X-Notewriter-Key": notewriterKey },
      body: JSON.stringify(Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined))),
    });
    const body = await response.text();
    if (!response.ok) {
      const error = (() => {
        try {
          return JSON.parse(body) as { code?: string; message?: string };
        } catch {
          return { message: body };
        }
      })();
      throw new NotewriterApiError(response.status, error.code, error.message ?? body);
    }
    return JSON.parse(body) as T;
  }

  return {
    /** Its limits, open reservations and health numbers. Also its sign of
     *  life: call it at least every few minutes. */
    me: () => call<Me>("notewriter_api_me"),
    posts: (options: ListOptions = {}) =>
      call<PostsPage>("notewriter_api_posts", {
        p_limit: options.limit,
        p_after: options.after ?? undefined,
        p_max_others: options.maxOthers,
        p_others_from: options.othersFrom,
        p_requested_only: options.requestedOnly,
        p_url: options.url,
      }),
    /** One post with its text, by id or address. Needs no reservation. */
    post: (by: { id: string } | { url: string }) => call<Post>("notewriter_api_post", "id" in by ? { p_post: by.id } : { p_url: by.url }),
    /** Reserves the post if fewer than `atMost` reservations count on it
     *  now. 1 means "only if I am first". */
    reserve: (postId: string, atMost = 1) => call<Reserve>("notewriter_api_reserve", { p_post: postId, p_at_most: atMost }),
    /** Done with the post, or skipped with a reason. Answers how many reader
     *  requests on it got their answer. */
    finish: (reservation: string, options: { summary?: unknown; skipReason?: string } = {}) =>
      call<{ answered: number }>("notewriter_api_finish", { p_reservation: reservation, p_summary: options.summary, p_skip_reason: options.skipReason }),
    /** Could not finish the post. It is never listed to this notewriter again. */
    fail: (reservation: string, reason: string) => call<Record<string, never>>("notewriter_api_fail", { p_reservation: reservation, p_reason: reason }),
    addNote: (reservation: string, note: NewNote) => call<AddedNote>("notewriter_api_add_note", { p_reservation: reservation, p_note: note }),
    notes: (options: { limit?: number; after?: [string, string] | null } = {}) =>
      call<NotesPage>("notewriter_api_notes", { p_limit: options.limit, p_after: options.after ?? undefined }),
  };
}

export type NotewriterClient = ReturnType<typeof notewriterClient>;
