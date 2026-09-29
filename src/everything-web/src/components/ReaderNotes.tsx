import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { ensureUser, useSession } from "../../../everything-shared/auth";
import { track } from "../../../everything-shared/analytics";
import { castVote, clearVote, fetchMyVotes, type Vote } from "../../../everything-shared/votes";
import { castNnnVote, clearNnnVote, fetchMyNnnVotes, fetchNnnForClaims } from "../../../everything-shared/noteNotNeeded";
import type { NnnRow, NoteRow } from "../../../everything-shared/types";
import { donationPair, priorTally } from "../lib/donationScoring";
import { preferredCharity, saveDonation, type MintedDonation } from "../lib/donations";
import { LoginModal } from "./LoginModal";
import { NoteCard } from "./NoteCard";
import type { NnnApi } from "./NoteNotNeeded";

interface ReaderNotesState {
  session: Session | null;
  myVotes: Map<string, Vote>;
  nnnByClaim: Map<string, NnnRow[]>;
  improvementsByOriginal: Map<string, NoteRow[]>;
  nnnApi: NnnApi;
  onVote: (note: NoteRow, vote: Vote) => Promise<MintedDonation | null>;
  onChanged: () => void;
  onNeedLogin: () => void;
}

const ReaderNotesContext = createContext<ReaderNotesState | null>(null);

/** Participation state for an article whose note cards can appear in several
 *  places. Reading creates no anonymous account; an account is only needed once
 *  the reader votes or opens a composer, matching the main feed. */
export function ReaderNotesProvider({ notes, onRefresh, children }: {
  notes: NoteRow[];
  onRefresh: () => Promise<void> | void;
  children: ReactNode;
}) {
  const { session } = useSession();
  const [myVotes, setMyVotes] = useState<Map<string, Vote>>(new Map());
  const [myNnnVotes, setMyNnnVotes] = useState<Map<string, Vote>>(new Map());
  const [entries, setEntries] = useState<NnnRow[]>([]);
  const [loginOpen, setLoginOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(new Set<string>());
  const voteRequest = useRef(0);
  const entryRequest = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      voteRequest.current += 1;
      entryRequest.current += 1;
    };
  }, []);

  // A note's changing tally must not start another request for the same claims.
  const claimKey = JSON.stringify([...new Set(notes.map((note) => note.claim_id))].sort());
  const reloadEntries = useCallback(async () => {
    const request = ++entryRequest.current;
    const next = await fetchNnnForClaims(JSON.parse(claimKey) as string[]);
    if (mounted.current && request === entryRequest.current) setEntries(next);
  }, [claimKey]);

  const reloadVotes = useCallback(async () => {
    const request = ++voteRequest.current;
    const [votes, nnnVotes] = await Promise.all([fetchMyVotes(), fetchMyNnnVotes()]);
    if (mounted.current && request === voteRequest.current) {
      setMyVotes(votes);
      setMyNnnVotes(nnnVotes);
    }
    return { votes, nnnVotes };
  }, []);

  useEffect(() => {
    if (session) {
      void reloadVotes().catch(() => setError("Your ratings could not be loaded. Please try again."));
    } else {
      voteRequest.current += 1;
      setMyVotes(new Map());
      setMyNnnVotes(new Map());
    }
  }, [session?.user.id, reloadVotes]);

  useEffect(() => {
    void reloadEntries().catch(() => setError("Some responses could not be loaded. Please try again."));
  }, [reloadEntries]);

  const refresh = useCallback(async () => {
    const [votes] = await Promise.all([reloadVotes(), reloadEntries(), onRefresh()]);
    return votes;
  }, [reloadVotes, reloadEntries, onRefresh]);

  const onChanged = useCallback(() => {
    void refresh().catch(() => setError("Your change was saved, but the notes could not be refreshed. Reload the page to see it."));
  }, [refresh]);

  const onVote = async (note: NoteRow, vote: Vote): Promise<MintedDonation | null> => {
    const key = `note:${note.id}`;
    if (pending.current.has(key)) return null;
    pending.current.add(key);
    setError(null);
    try {
      const user = session?.user ?? await ensureUser();
      if (!user) {
        track("vote_gated_login", { note_id: note.id });
        setLoginOpen(true);
        return null;
      }
      // Read before deciding whether this click changes or retracts a vote. A
      // restored session may still be loading when the first click arrives.
      const current = (await fetchMyVotes()).get(note.id);
      if (current === vote) {
        await clearVote(note.id);
        const { votes } = await refresh();
        if (votes.has(note.id)) setError("Your rating could not be removed. Please try again.");
        return null;
      }

      const voteId = await castVote(note.id, user.id, vote, "web");
      let minted: MintedDonation | null = null;
      if (voteId) {
        const pair = donationPair(priorTally(note, current), vote);
        const charity = preferredCharity(user);
        const { error: donationError } = await saveDonation(voteId, charity, pair);
        if (!donationError) minted = { voteId, charity, pair };
      }
      const { votes } = await refresh();
      if (votes.get(note.id) !== vote) {
        setError("Your rating could not be saved. Please try again.");
        return null;
      }
      return minted;
    } catch {
      setError("Your rating could not be updated. Please try again.");
      return null;
    } finally {
      pending.current.delete(key);
    }
  };

  const onNnnVote = async (entry: NnnRow, vote: Vote) => {
    const key = `nnn:${entry.id}`;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    setError(null);
    try {
      const user = session?.user ?? await ensureUser();
      if (!user) {
        setLoginOpen(true);
        return;
      }
      const current = (await fetchMyNnnVotes()).get(entry.id);
      if (current === vote) await clearNnnVote(entry.id);
      else await castNnnVote(entry.id, user.id, vote);
      const { nnnVotes } = await refresh();
      const expected = current === vote ? undefined : vote;
      if (nnnVotes.get(entry.id) !== expected) setError("Your rating could not be updated. Please try again.");
    } catch {
      setError("Your rating could not be updated. Please try again.");
    } finally {
      pending.current.delete(key);
    }
  };

  const nnnByClaim = useMemo(() => {
    const result = new Map<string, NnnRow[]>();
    for (const entry of entries) {
      const list = result.get(entry.claim_id) ?? [];
      list.push(entry);
      result.set(entry.claim_id, list);
    }
    return result;
  }, [entries]);

  const improvementsByOriginal = useMemo(() => {
    const result = new Map<string, NoteRow[]>();
    for (const note of notes) {
      if (!note.improved_from_note_id) continue;
      const list = result.get(note.improved_from_note_id) ?? [];
      list.push(note);
      result.set(note.improved_from_note_id, list);
    }
    return result;
  }, [notes]);

  return (
    <ReaderNotesContext.Provider value={{
      session,
      myVotes,
      nnnByClaim,
      improvementsByOriginal,
      nnnApi: { myVotes: myNnnVotes, onVote: onNnnVote, onAuthored: onChanged, onDeleted: onChanged },
      onVote,
      onChanged,
      onNeedLogin: () => setLoginOpen(true),
    }}>
      {children}
      {error && (
        <div role="alert" className="fixed bottom-4 left-4 right-4 z-40 mx-auto flex max-w-xl items-start gap-3 rounded-xl border border-red-200 bg-white p-4 text-sm text-red-700 shadow-lg dark:border-red-900 dark:bg-gray-900 dark:text-red-300">
          <p className="flex-1">{error}</p>
          <button type="button" aria-label="Dismiss message" onClick={() => setError(null)} className="font-medium underline">Dismiss</button>
        </div>
      )}
      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} />
    </ReaderNotesContext.Provider>
  );
}

/** The participation state for anything rendered inside the provider: the note
 *  cards, and the composer that adds a note. */
export function useReaderNotes(): ReaderNotesState {
  const state = useContext(ReaderNotesContext);
  if (!state) throw new Error("useReaderNotes must be used inside ReaderNotesProvider");
  return state;
}

/** The feed's note UI, sized to fit beside an essay passage. Status, citations,
 *  voting, donations, and improvement editors remain shared with the feed. */
export function ReaderNoteCard({ note, projectSlug }: { note: NoteRow; projectSlug: string }) {
  const state = useReaderNotes();
  return (
    <NoteCard
      compact
      note={note}
      projectSlug={projectSlug}
      improvements={state.improvementsByOriginal.get(note.id) ?? []}
      nnnEntries={state.nnnByClaim.get(note.claim_id) ?? []}
      nnnApi={state.nnnApi}
      session={state.session}
      myVote={state.myVotes.get(note.id)}
      onVote={state.onVote}
      onAuthored={state.onChanged}
      onDeleted={state.onChanged}
      onNeedLogin={state.onNeedLogin}
    />
  );
}
