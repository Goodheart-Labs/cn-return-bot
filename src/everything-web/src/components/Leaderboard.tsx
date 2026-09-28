import { displayName } from "@cn/core/session";
import { useSession } from "@cn/features/auth/useSession";
import { useMyVotes } from "@cn/features/notes/useVotes";
import { useLeaderboard, useLeaderboardOptIn } from "../lib/leaderboardQueries";

/** Ranks people by how many notes they have rated. A person is listed only if
 *  they opt in. */
export function Leaderboard() {
  const { session } = useSession();
  const myVoteCount = useMyVotes().size;
  const { data: entries, isError: failed } = useLeaderboard();
  const { optIn, saving, setOptIn } = useLeaderboardOptIn();
  const myName = session ? displayName(session) : null;

  return (
    <div className="max-w-xl mx-auto w-full">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
        People who opted in, ranked by how many notes they've rated.
      </p>

      {session && (
        <div className="flex items-center justify-between gap-3 mb-6 text-sm">
          <label className="flex items-center gap-2 text-gray-600 dark:text-gray-300 cursor-pointer">
            <input type="checkbox" checked={optIn} disabled={saving} onChange={() => setOptIn(!optIn)} />
            Show me on the leaderboard
          </label>
          {!optIn && (
            <span className="text-gray-400 dark:text-gray-500">
              You're not listed, you've rated {myVoteCount} {myVoteCount === 1 ? "note" : "notes"}
            </span>
          )}
        </div>
      )}

      {failed && <p className="text-sm text-gray-500 dark:text-gray-400">Couldn't load the leaderboard.</p>}
      {!failed && !entries && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
      {!failed && entries?.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No ratings yet.</p>}

      {entries && entries.length > 0 && (
        <ol className="space-y-1">
          {entries.map((entry, i) => {
            const isMe = optIn && entry.name === myName;
            return (
              <li
                key={i}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                  isMe ? "bg-blue-50 dark:bg-blue-950/50 border border-blue-100 dark:border-blue-900 font-medium" : ""
                }`}
              >
                <span className="w-8 text-right tabular-nums text-gray-400 dark:text-gray-500">{i + 1}</span>
                <span className="flex-1 truncate" title={entry.name}>
                  {entry.name}
                  {isMe && <span className="text-gray-400 dark:text-gray-500 font-normal"> (you)</span>}
                </span>
                <span className="tabular-nums text-gray-500 dark:text-gray-400">
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
