import { useCallback, useEffect, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { ItemRow, NnnRow, NoteRow, NoteSourceRow, ProjectRow } from "./types";

// The public site reads whichever backend is deployed, which may be BEHIND the
// migrations this build assumes. Columns/tables that can be missing:
//   - migration 056: `everything_note_sources` table (old notes keep a `sources`
//     jsonb array of URLs on the note row instead)
//   - migration 057: `everything_claims.image_urls`
//   - migration 063: `everything_note_not_needed` (the list simply stays empty)
// Probe once and shape the query + normalize rows so the SPA renders
// identically against the old or the new schema.
const CLAIM_COLS = "id, item_id, claim, context_quote, context_paragraph, updated_quote, context_url, start_seconds, end_seconds";

type Schema = { hasImageUrls: boolean; hasNoteSources: boolean; hasNnn: boolean };
let schemaProbe: Promise<Schema> | null = null;

function detectSchema(): Promise<Schema> {
  schemaProbe ??= (async () => {
    const [img, ns, nnn] = await Promise.all([
      supabase.from("everything_claims").select("image_urls").limit(1),
      supabase.from("everything_note_sources").select("url").limit(1),
      supabase.from("everything_note_not_needed").select("id").limit(1),
    ]);
    return { hasImageUrls: !img.error, hasNoteSources: !ns.error, hasNnn: !nnn.error };
  })();
  return schemaProbe;
}

function noteSelect(s: Schema): string {
  const claim = `claim:everything_claims(${CLAIM_COLS}${s.hasImageUrls ? ", image_urls" : ""})`;
  const sources = s.hasNoteSources ? ", sources:everything_note_sources(url, quote, explanation, sort_order)" : "";
  return `*, ${claim}${sources}`;
}

/** Coerce a raw note row from either schema into NoteRow: sources always a
 *  NoteSourceRow[] (old jsonb URL array → quote-less rows), claim.image_urls
 *  always an array. */
function normalizeNote(row: any, s: Schema): NoteRow {
  const sources: NoteSourceRow[] = s.hasNoteSources
    ? (row.sources ?? [])
    : (Array.isArray(row.sources) ? row.sources : []).map((url: string, i: number) => ({
        url, quote: null, explanation: null, sort_order: i,
      }));
  const claim = row.claim ? { ...row.claim, image_urls: row.claim.image_urls ?? [] } : row.claim;
  return { ...row, sources, claim };
}

type RowMap<T> = Map<string, T>;

function upsertHandler<T extends { id: string }>(setter: React.Dispatch<React.SetStateAction<RowMap<T>>>) {
  return (payload: RealtimePostgresChangesPayload<T>) => {
    setter((prev) => {
      const next = new Map(prev);
      if (payload.eventType === "DELETE") next.delete((payload.old as Partial<T>).id as string);
      else next.set((payload.new as T).id, payload.new as T);
      return next;
    });
  };
}

/** Live projects, items, notes (with their claim), and note-not-needed entries.
 *  `upsertNote` / `addNnn` are the write paths' local echo: a row you just
 *  posted enters state from your own insert rather than waiting for the
 *  realtime round trip, which a slept or reconnecting socket can drop. */
export function useLiveData() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [items, setItems] = useState<RowMap<ItemRow>>(new Map());
  const [notes, setNotes] = useState<RowMap<NoteRow>>(new Map());
  const [nnn, setNnn] = useState<RowMap<NnnRow>>(new Map());
  const [loaded, setLoaded] = useState(false);

  // Realtime deltas don't carry the joined claim, so a note is always taken in
  // full by id — for the realtime INSERT and for the author's own local echo.
  const upsertNote = useCallback(async (id: string) => {
    const schema = await detectSchema();
    const { data } = await supabase.from("everything_notes").select(noteSelect(schema)).eq("id", id).maybeSingle();
    if (data) setNotes((prev) => new Map(prev).set(id, normalizeNote(data, schema)));
  }, []);

  // An entry has no joins, so the inserted row is the whole thing — but only
  // fills a gap, never overwrites: the author's self-upvote trigger fires after
  // the insert's RETURNING, so a realtime row that beat us here is the fresher
  // of the two.
  const addNnn = useCallback(
    (row: NnnRow) => setNnn((prev) => (prev.has(row.id) ? prev : new Map(prev).set(row.id, row))),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    let resubscribed = false;

    async function load() {
      const schema = await detectSchema();
      const [p, i, n, e] = await Promise.all([
        supabase.from("everything_projects").select("*").order("sort_order"),
        supabase.from("everything_items").select("*"),
        supabase.from("everything_notes").select(noteSelect(schema)),
        schema.hasNnn
          ? supabase.from("everything_note_not_needed").select("*")
          : Promise.resolve({ data: [] as NnnRow[] }),
      ]);
      if (cancelled) return;
      setProjects((p.data as ProjectRow[]) ?? []);
      setItems(new Map(((i.data as ItemRow[]) ?? []).map((r) => [r.id, r])));
      setNotes(new Map(((n.data ?? []) as any[]).map((r) => [r.id, normalizeNote(r, schema)])));
      setNnn(new Map(((e.data as NnnRow[]) ?? []).map((r) => [r.id, r])));
      setLoaded(true);
    }
    load();

    const channel = supabase
      .channel(`common-notes-${crypto.randomUUID()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_items" }, upsertHandler(setItems))
      // Note-not-needed entries have no joins, so the generic handler covers
      // all events (vote-count UPDATEs arrive as full rows via the counter trigger).
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_note_not_needed" }, upsertHandler(setNnn))
      .on("postgres_changes", { event: "*", schema: "public", table: "everything_notes" }, (payload) => {
        if (payload.eventType === "DELETE") {
          setNotes((prev) => {
            const next = new Map(prev);
            next.delete((payload.old as { id?: string }).id!);
            return next;
          });
        } else if (payload.eventType === "UPDATE") {
          const row = payload.new as any;
          setNotes((prev) => {
            const existing = prev.get(row.id);
            if (!existing) {
              upsertNote(row.id); // don't have it yet — fetch fresh + normalized
              return prev;
            }
            // Vote-count update: take the scalar fields but keep the already
            // normalized sources + claim (the raw row carries a raw jsonb
            // `sources` on the old schema, and never the joined claim).
            return new Map(prev).set(row.id, { ...existing, ...row, sources: existing.sources, claim: existing.claim ?? row.claim });
          });
        } else {
          upsertNote((payload.new as { id: string }).id);
        }
      })
      // A socket that drops (laptop sleep, network blip) misses every event
      // until it comes back, and nothing replays them — so a re-subscribe
      // refetches instead of leaving the page on a frozen snapshot.
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        if (resubscribed) load();
        resubscribed = true;
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [upsertNote]);

  return { projects, items, notes, nnn, loaded, upsertNote, addNnn };
}
