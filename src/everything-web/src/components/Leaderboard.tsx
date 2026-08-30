import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  fetchLeaderboard,
  fetchMyLeaderboardOptIn,
  setMyLeaderboardOptIn,
  type LeaderboardEntry,
} from "../lib/leaderboard";
import { displayName } from "../../../everything-shared/session";

/** Ranks people by how many notes they have rated. A person is listed only if
 *  they opt in. */
export function Leaderboard({ session, myVoteCount }: {
  session: Session | null;
  myVoteCount: number;
}) {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [optIn, setOptIn] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = () => fetchLeaderboard().then(setEntries).catch(() => setFailed(true));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (session) fetchMyLeaderboardOptIn().then(setOptIn).catch(() => {});
    else setOptIn(false);
  }, [session?.user.id]);

  const myName = session ? displayName(session) : null;

  const toggleVisibility = async () => {
    if (!session) return;
    const next = !optIn;
    setOptIn(next);
    setSaving(true);
    try {
      await setMyLeaderboardOptIn(session.user.id, next);
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto w-full">
      <p className="text-sm text-gray-500 mb-6">
        People who opted in, ranked by how many notes they've rated.
      </p>

      {session && (
        <div className="flex items-center justify-between gap-3 mb-6 text-sm">
          <label className="flex items-center gap-2 text-gray-600 cursor-pointer">
            <input type="checkbox" checked={optIn} disabled={saving} onChange={toggleVisibility} />
            Show me on the leaderboard
          </label>
          {!optIn && (
            <span className="text-gray-400">
              You're not listed, you've rated {myVoteCount} {myVoteCount === 1 ? "note" : "notes"}
            </span>
          )}
        </div>
      )}

      {failed && <p className="text-gray-400">Couldn't load the leaderboard.</p>}
      {!failed && entries === null && <p className="text-gray-400">Loading…</p>}
      {!failed && entries?.length === 0 && <p className="text-gray-400">No ratings yet.</p>}

      {entries && entries.length > 0 && (
        <ol className="space-y-1">
          {entries.map((entry, i) => {
            const isMe = optIn && entry.name === myName;
            return (
              <li
                key={i}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                  isMe ? "bg-blue-50 font-medium" : ""
                }`}
              >
                <span className="w-8 text-right tabular-nums text-gray-400">{i + 1}</span>
                <span className="flex-1 truncate" title={entry.name}>
                  {entry.name}
                  {isMe && <span className="text-gray-400 font-normal"> (you)</span>}
                </span>
                <span className="tabular-nums text-gray-500">
                  {entry.rating_count} {entry.rating_count === 1 ? "rating" : "ratings"}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
