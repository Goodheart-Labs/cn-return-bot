import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { displayName } from "../lib/session";
import { isEarnestNote } from "../lib/judgeNote";

interface SourceItem {
  id: string;
  title: string | null;
  url: string;
  full_text: string | null;
}

interface Hit {
  item: SourceItem;
  index: number;
}

const SNIPPET = 150;
const WINDOW = 1200;

/** Write a note anchored to the source: search the transcript, pick the spot,
 *  select the text you're noting, write the correction. Freeform fallback
 *  carries a "Text not found in transcript" flag. */
export function WriteNoteModal({ open, onClose, projectId, session }: {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  session: Session;
}) {
  const [items, setItems] = useState<SourceItem[]>([]);
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState<Hit | null>(null);
  const [anchorText, setAnchorText] = useState("");
  const [freeform, setFreeform] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const markRef = useRef<HTMLElement>(null);
  // Close only when the PRESS started on the backdrop — a text-selection drag
  // that ends outside the panel must not dismiss the modal.
  const backdropPress = useRef(false);

  useEffect(() => {
    if (!open || !projectId) return;
    supabase
      .from("everything_items")
      .select("id, title, url, full_text")
      .eq("project_id", projectId)
      .then(({ data }) => setItems((data as SourceItem[]) ?? []));
  }, [open, projectId]);

  // Scroll the highlighted match into view when a hit is chosen.
  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, [hit]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const hits: Hit[] = q.length >= 3
    ? items.flatMap((item) => {
        if (!item.full_text) return [];
        const idx = item.full_text.toLowerCase().indexOf(q);
        return idx >= 0 ? [{ item, index: idx }] : [];
      })
    : [];
  const anchorInTranscript = anchorText.trim().length > 0 &&
    items.some((i) => i.full_text?.toLowerCase().includes(anchorText.trim().toLowerCase()));
  // The item the anchor belongs to (freeform text is matched back if possible).
  const anchorItem = hit?.item ??
    items.find((i) => i.full_text?.toLowerCase().includes(anchorText.trim().toLowerCase())) ??
    items[0];

  const reset = () => {
    setQuery(""); setHit(null); setAnchorText(""); setFreeform(false); setNote(""); setError(null); setRejected(false);
  };

  const grabSelection = () => {
    const sel = window.getSelection()?.toString().trim();
    if (sel) setAnchorText(sel);
    else if (hit) setAnchorText(hit.item.full_text!.slice(hit.index, hit.index + q.length));
  };

  const submit = async () => {
    if (!anchorItem) return;
    setBusy(true);
    setError(null);
    setRejected(false);
    try {
      // Judge earnest-vs-trolling BEFORE creating anything, so a rejected note
      // leaves no orphan claim behind.
      const earnest = await isEarnestNote(note.trim(), anchorText.trim());
      if (!earnest) return setRejected(true);
      const { data: claim, error: claimError } = await supabase
        .from("everything_claims")
        .insert({
          item_id: anchorItem.id,
          claim: anchorText.trim().slice(0, 300),
          judgement: "user",
          context_quote: anchorText.trim(),
          context_url: anchorItem.url,
          status: "note",
          created_by: session.user.id,
        })
        .select("id")
        .single();
      if (claimError || !claim) return setError(claimError?.message ?? "could not create the claim");
      const { error: noteError } = await supabase.from("everything_notes").insert({
        claim_id: claim.id,
        note: note.trim(),
        author_id: session.user.id,
        author_name: displayName(session),
        status: "draft",
      });
      if (noteError) return setError(noteError.message);
      reset();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const windowStart = hit ? Math.max(0, hit.index - WINDOW / 2) : 0;
  const windowText = hit ? hit.item.full_text!.slice(windowStart, hit.index + WINDOW / 2) : "";
  const relIdx = hit ? hit.index - windowStart : 0;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50"
      onMouseDown={(e) => { backdropPress.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (backdropPress.current && e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-xl p-6 w-full max-w-2xl space-y-3 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold">Write a note</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        {!anchorText && !freeform && (
          <>
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHit(null); }}
              placeholder="Search the transcript for the text you're noting…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            {q.length >= 3 && hits.length === 0 && !hit && (
              <p className="text-xs text-gray-500">No match in any transcript.</p>
            )}
            {!hit && hits.map((h) => (
              <button
                key={h.item.id}
                onClick={() => setHit(h)}
                className="block w-full text-left border border-gray-200 rounded-lg p-2 hover:bg-gray-50"
              >
                <span className="text-xs font-medium text-gray-700">{h.item.title ?? h.item.url}</span>
                <span className="block text-xs text-gray-500">
                  …{h.item.full_text!.slice(Math.max(0, h.index - SNIPPET / 2), h.index + SNIPPET)}…
                </span>
              </button>
            ))}
            {hit && (
              <>
                <div className="border border-gray-200 rounded-lg p-3 max-h-64 overflow-y-auto text-sm text-gray-700 whitespace-pre-wrap">
                  {windowStart > 0 && "…"}
                  {windowText.slice(0, relIdx)}
                  <mark ref={markRef} className="bg-yellow-100">{windowText.slice(relIdx, relIdx + q.length)}</mark>
                  {windowText.slice(relIdx + q.length)}…
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={grabSelection} className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700">
                    Use selected text
                  </button>
                  <span className="text-xs text-gray-500">Select the exact span in the box (or leave as-is to use the match), then click.</span>
                </div>
              </>
            )}
            <button onClick={() => setFreeform(true)} className="text-xs text-gray-500 hover:text-blue-600 hover:underline">
              Can't find it? Type the text yourself
            </button>
          </>
        )}

        {freeform && !anchorText && (
          <>
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={3}
              placeholder="Paste or type the text you're noting…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="flex items-center gap-3">
              <button
                onClick={() => setAnchorText(query.trim())}
                disabled={query.trim().length < 10}
                className="bg-blue-600 text-white rounded-lg px-3 py-1.5 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
              >
                Use this text
              </button>
              <button onClick={() => { setFreeform(false); setQuery(""); }} className="text-xs text-gray-500 hover:underline">
                Back to search
              </button>
            </div>
          </>
        )}

        {anchorText && (
          <>
            <blockquote className="border-l-4 border-gray-300 pl-3 text-gray-600 italic text-sm">
              “{anchorText}”
            </blockquote>
            {!anchorInTranscript && (
              <span className="inline-block text-xs px-2 py-0.5 rounded-full border bg-amber-100 text-amber-800 border-amber-200">
                ⚠ Text not found in transcript
              </span>
            )}
            <textarea
              value={note}
              onChange={(e) => { setNote(e.target.value); setRejected(false); }}
              rows={4}
              placeholder="Write your correction — include sources as plain URLs…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            {rejected && (
              <p className="text-sm rounded-lg p-2 bg-amber-50 text-amber-800 border border-amber-200">
                That didn't look like a genuine note — try again.
              </p>
            )}
            <div className="flex gap-2 items-center justify-end">
              <button onClick={() => { setAnchorText(""); setFreeform(false); }} className="text-sm text-gray-500 hover:underline">
                Change text
              </button>
              <button
                onClick={submit}
                disabled={busy || note.trim().length < 10}
                className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-40"
              >
                {busy ? "Checking…" : "Post draft note"}
              </button>
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
