import { useEffect, useState } from "react";
import { fetchRecentPosts, type RecentPostRow } from "../lib/queries";

/** How many posts are fetched once, and how many more each "Show more" press
 *  reveals from them. */
const POSTS_FETCHED = 100;
const POSTS_PER_STEP = 25;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const LABEL_COLOR = "#6b7280";

/** "just now", "12 min ago", "5 h ago", "3 days ago". */
function timeAgo(timestamp: string): string {
  const elapsed = Date.now() - new Date(timestamp).getTime();
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  const days = Math.floor(elapsed / DAY_MS);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

/** A publish date carries no time of day, so it is counted in whole UTC days:
 *  "today", "yesterday", "4 days ago". */
function daysAgo(day: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const days = Math.round((new Date(today).getTime() - new Date(day).getTime()) / DAY_MS);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

const COLUMNS: readonly { label: string; title: string }[] = [
  { label: "Post", title: "The post, and the project it belongs to" },
  { label: "Published", title: "When the author published it" },
  { label: "Checked", title: "When the pipeline finished it" },
  { label: "Visits", title: "Visits recorded by the extension, before and after the check" },
  { label: "Readers", title: "Different readers among those visits" },
  { label: "Claims", title: "Claims extracted from the post" },
  { label: "Checked claims", title: "Claims that went through a fact-check" },
  { label: "Notes", title: "Notes the pipeline wrote" },
];

const cell = { padding: "8px 10px", borderBottom: "1px solid #e5e7eb", verticalAlign: "top" } as const;
const numberCell = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

function PostCell({ post }: { post: RecentPostRow }) {
  const title = post.title ?? post.url;
  return (
    <td style={{ ...cell, minWidth: 240 }}>
      {post.url.startsWith("http") ? (
        <a href={post.url} target="_blank" rel="noreferrer" style={{ color: "#111827" }}>
          {title}
        </a>
      ) : (
        title
      )}
      <div style={{ color: LABEL_COLOR, fontSize: 12, marginTop: 2 }}>
        {post.project ?? "No project"}
        {post.checked_scope === "paragraph" && " · one paragraph checked"}
      </div>
    </td>
  );
}

/** The posts the pipeline finished most recently, newest first, with how much
 *  they were read and what the pipeline got out of them. */
export function RecentPosts() {
  const [posts, setPosts] = useState<RecentPostRow[] | null>(null);
  const [shown, setShown] = useState(POSTS_PER_STEP);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchRecentPosts(POSTS_FETCHED)
      .then(setPosts)
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: "#b91c1c" }}>Failed to load: {error}</p>;
  if (!posts) return <p style={{ color: LABEL_COLOR }}>Loading…</p>;
  if (posts.length === 0) return <p style={{ color: LABEL_COLOR, fontSize: 13 }}>The pipeline has not finished a post yet.</p>;

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
                  style={{ ...cell, textAlign: i < 3 ? "left" : "right", color: LABEL_COLOR, fontWeight: 500, whiteSpace: "nowrap" }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {posts.slice(0, shown).map((post) => (
              <tr key={post.id}>
                <PostCell post={post} />
                <td style={{ ...cell, whiteSpace: "nowrap" }} title={post.published_at ?? undefined}>
                  {post.published_at ? daysAgo(post.published_at) : "—"}
                </td>
                <td style={{ ...cell, whiteSpace: "nowrap" }} title={new Date(post.processed_at).toLocaleString()}>
                  {timeAgo(post.processed_at)}
                </td>
                <td style={numberCell}>{post.visits}</td>
                <td style={numberCell}>{post.readers}</td>
                <td style={numberCell}>{post.claims_extracted}</td>
                <td style={numberCell}>{post.claims_checked}</td>
                <td style={numberCell}>{post.notes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 8, fontSize: 12, color: LABEL_COLOR }}>
        {shown < posts.length && (
          <button
            onClick={() => setShown((n) => n + POSTS_PER_STEP)}
            style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
          >
            Show {Math.min(POSTS_PER_STEP, posts.length - shown)} more
          </button>
        )}
        <span>
          Visits count every time the extension saw someone open the post, before or after the check. A visit only names a reader when
          the extension could tell whose post it was, so readers can be lower than the people who visited.
        </span>
      </div>
    </div>
  );
}
