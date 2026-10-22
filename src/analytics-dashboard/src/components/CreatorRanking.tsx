import { useEffect, useState } from "react";
import { fetchCreatorRanking, type CreatorRankingRow } from "../lib/queries";
import { byWalkOrder, LAST_POSTS_PER_CREATOR, MIN_SCORE_TO_WALK } from "../../../everything-core/readers";

const CREATORS_PER_STEP = 25;
const HOURS_SHOWN_AS_HOURS = 48;
const HOURS_PER_DAY = 24;
const LABEL_COLOR = "#6b7280";

const COLUMNS: readonly { label: string; title: string }[] = [
  { label: "#", title: "The creator's place in the walk's order" },
  { label: "Creator", title: "The creator, and why the walk takes them" },
  { label: "Score", title: `Average number of different people per post, over the creator's ${LAST_POSTS_PER_CREATOR} most recently visited posts` },
  {
    label: "Median delay",
    title: `Median time from the publish day to the end of processing, over the creator's ${LAST_POSTS_PER_CREATOR} most recently published checked posts`,
  },
  {
    label: "Vote rate",
    title: `Extension voters divided by visitors after the first note, over the creator's ${LAST_POSTS_PER_CREATOR} most recently visited posts with notes`,
  },
];

const cell = { padding: "8px 10px", borderBottom: "1px solid #e5e7eb", verticalAlign: "top" } as const;
const numberCell = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const subline = { color: LABEL_COLOR, fontSize: 12, marginTop: 2 } as const;

/** "19 h" under two days, "6.7 days" above. */
function formatDelay(hours: number): string {
  if (hours < HOURS_SHOWN_AS_HOURS) return `${Math.round(hours)} h`;
  return `${(hours / HOURS_PER_DAY).toFixed(1)} days`;
}

const postCount = (n: number) => (n === 1 ? "1 post" : `${n} posts`);

/** The walk's comparator needs the score of a prioritised creator nobody
 *  visited as zero, the same value the walk itself uses for them. */
const walkOrderKey = (row: CreatorRankingRow) => ({
  prioritized: row.priority_until !== null,
  feed_url: row.feed_url,
  score: { visitors_per_post: row.visitors_per_post ?? 0, people: row.people ?? 0 },
});

function CreatorCell({ row }: { row: CreatorRankingRow }) {
  return (
    <td style={{ ...cell, minWidth: 200 }}>
      <a href={row.feed_url} target="_blank" rel="noreferrer" style={{ color: "#111827" }}>
        {row.project_name ?? row.feed_url.replace(/^https?:\/\/(www\.)?/, "")}
      </a>
      <div style={subline}>
        {row.priority_until
          ? `Priority until ${new Date(row.priority_until).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`
          : `Score of ${MIN_SCORE_TO_WALK} or more`}
      </div>
    </td>
  );
}

function ScoreCell({ row }: { row: CreatorRankingRow }) {
  if (row.visitors_per_post === null || row.score_posts === null) return <td style={numberCell}>—</td>;
  return (
    <td style={numberCell}>
      {row.visitors_per_post.toFixed(2)}
      <div style={subline}>{postCount(row.score_posts)}</div>
    </td>
  );
}

function DelayCell({ row }: { row: CreatorRankingRow }) {
  if (row.median_delay_hours === null || row.delay_posts === null) return <td style={numberCell}>—</td>;
  return (
    <td style={numberCell}>
      {formatDelay(row.median_delay_hours)}
      <div style={subline}>{postCount(row.delay_posts)}</div>
    </td>
  );
}

function VoteRateCell({ row }: { row: CreatorRankingRow }) {
  if (!row.vote_visitors || row.extension_voters === null || row.vote_posts === null) return <td style={numberCell}>—</td>;
  return (
    <td style={numberCell} title={`Summed over ${postCount(row.vote_posts)} with notes`}>
      {Math.round((100 * row.extension_voters) / row.vote_visitors)}%
      <div style={subline}>
        {row.extension_voters} of {row.vote_visitors}
      </div>
    </td>
  );
}

/** The creators the walk would go through if it ran now, in its order, with
 *  how widely each is read, how fast we check their posts, and how often their
 *  readers vote. */
export function CreatorRanking() {
  const [rows, setRows] = useState<CreatorRankingRow[] | null>(null);
  const [shown, setShown] = useState(CREATORS_PER_STEP);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCreatorRanking()
      .then((fetched) => setRows(fetched.sort((a, b) => byWalkOrder(walkOrderKey(a), walkOrderKey(b)))))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: "#b91c1c" }}>Failed to load: {error}</p>;
  if (!rows) return <p style={{ color: LABEL_COLOR }}>Loading…</p>;
  if (rows.length === 0) return <p style={{ color: LABEL_COLOR, fontSize: 13 }}>No creator holds priority or reaches the walk's score.</p>;

  return (
    <div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 13 }}>
          <thead>
            <tr>
              {COLUMNS.map((column, i) => (
                <th
                  key={column.label}
                  title={column.title}
                  style={{ ...cell, textAlign: i === 1 ? "left" : "right", color: LABEL_COLOR, fontWeight: 500, whiteSpace: "nowrap" }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((row, i) => (
              <tr key={row.feed_url}>
                <td style={{ ...numberCell, color: LABEL_COLOR }}>{i + 1}</td>
                <CreatorCell row={row} />
                <ScoreCell row={row} />
                <DelayCell row={row} />
                <VoteRateCell row={row} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, fontSize: 12, color: LABEL_COLOR }}>
        {shown < rows.length && (
          <button
            onClick={() => setShown((n) => n + CREATORS_PER_STEP)}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
          >
            Show {Math.min(CREATORS_PER_STEP, rows.length - shown)} more
          </button>
        )}
        <span>
          This is the order the next walk will go through, computed now. The median delay runs from the day a post was published to
          the end of its check. It leaves out a creator's most popular posts of all time, which the walk also checks, because those
          can be years old. The vote rate divides the people who voted in the extension on a post's notes by the people who opened
          the post after its first note appeared. Votes by admins are left out. The two sides cannot be matched person to person, so
          a rate is a ratio of counts.
        </span>
      </div>
    </div>
  );
}
