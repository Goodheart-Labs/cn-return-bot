import { displayName } from "@cn/core/session";
import { Button } from "@cn/ui/Button";
import { Checkbox } from "@cn/ui/Field";
import { useLoginPrompt } from "@cn/features/auth/loginPrompt";
import { useSession } from "@cn/features/auth/useSession";
import { useMyVotes } from "@cn/features/notes/useVotes";
import { useLeaderboard, useLeaderboardOptIn } from "../lib/leaderboardQueries";

/** Ranks people by how many notes they have rated. A person is listed only if
 *  they opt in. */
export function LeaderboardPage() {
  const { session } = useSession();
  const myVoteCount = useMyVotes().size;
  const { data: entries, isError: failed, refetch } = useLeaderboard();
  const { optIn, saving, setOptIn } = useLeaderboardOptIn();
  const openLogin = useLoginPrompt();
  // An anonymous account has no name to list, so only a real account can
  // opt in. Everyone else sees the same checkbox, and ticking it opens the
  // sign-in form.
  const signedIn = !!session && !session.user.is_anonymous;
  const listed = signedIn && optIn;
  const myName = session && signedIn ? displayName(session) : null;

  return (
    <div className="w-full">
      <p className="text-sm text-fg-muted mb-6">
        People who opted in, ranked by how many notes they've rated.
      </p>

      <div className="flex items-center justify-between gap-3 mb-6 text-sm">
        <Checkbox checked={listed} disabled={saving} onChange={(show) => (signedIn ? setOptIn(show) : openLogin())} className="text-fg-secondary">
          Show me on the leaderboard
        </Checkbox>
        {!listed && (
          <span className="text-fg-muted">
            You're not listed. You've rated {myVoteCount} {myVoteCount === 1 ? "note" : "notes"}.
          </span>
        )}
      </div>

      {failed && (
        <div className="space-y-3">
          <p className="text-sm text-fg-secondary">The leaderboard could not be loaded. The connection to our server failed.</p>
          <Button onClick={() => void refetch()}>Try again</Button>
        </div>
      )}
      {!failed && !entries && <p className="text-sm text-fg-muted">Loading…</p>}
      {!failed && entries?.length === 0 && <p className="text-sm text-fg-muted">No ratings yet.</p>}

      {entries && entries.length > 0 && (
        <ol className="space-y-1">
          {entries.map((entry, i) => {
            const isMe = listed && entry.name === myName;
            return (
              <li
                key={i}
                className={`flex items-center gap-3 rounded-control px-3 py-2 ${
                  isMe ? "bg-tint border border-tint-line font-medium" : ""
                }`}
              >
                <span className="w-8 text-right tabular-nums text-fg-muted">{i + 1}</span>
                <span className="flex-1 truncate" title={entry.name}>
                  {entry.name}
                  {isMe && <span className="text-fg-muted font-normal"> (you)</span>}
                </span>
                <span className="tabular-nums text-fg-muted">
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
