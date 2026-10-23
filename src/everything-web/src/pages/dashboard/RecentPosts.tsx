import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRecentPosts, type RecentPostRow } from "@cn/core/dashboard";
import { LAST_POSTS_PER_CREATOR } from "@cn/core/readers";
import { queryKeys } from "@cn/features/query/queryKeys";
import { cn } from "@cn/ui/cn";
import { CELL, DashboardTable, LoadState, NUMBER_CELL, ShowMore, SUBLINE, type Column } from "./tableParts";

/** How many posts are fetched once, and how many more each "Show more" press
 *  reveals from them. */
const POSTS_FETCHED = 100;
const POSTS_PER_STEP = 25;

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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

const COLUMNS: readonly Column[] = [
  { label: "Post", align: "left", explanation: "The post, and the project it belongs to. The newest finished check comes first." },
  { label: "Published", align: "left", explanation: "The day the author published the post, when the source says. It is counted in whole UTC days." },
  {
    label: "Last checked",
    align: "left",
    explanation: "When the latest check of the post ended. A post can be checked again later, so this can be long after its first check.",
  },
  {
    label: "Readers per post",
    align: "right",
    explanation: `The average number of different people per post, over the author's ${LAST_POSTS_PER_CREATOR} most recently visited posts, however long ago those visits were. The walk ranks authors on it, after adding a few imagined posts that the creator ranking explains. A post in a project without a feed, such as Around the web, has no value here.`,
  },
  { label: "Claims", align: "right", explanation: "The claims the pipeline extracted from the post." },
  { label: "Checked", align: "right", explanation: "The claims that went through a fact-check. Only claims rated uncertain or worse are checked." },
  { label: "Notes", align: "right", explanation: "The notes the pipeline wrote on the post." },
];

function PostCell({ post }: { post: RecentPostRow }) {
  const title = post.title ?? post.url;
  return (
    <td className={cn(CELL, "min-w-60")}>
      {post.url.startsWith("http") ? (
        <a href={post.url} target="_blank" rel="noreferrer" className="font-medium text-fg hover:underline">
          {title}
        </a>
      ) : (
        <span className="font-medium text-fg">{title}</span>
      )}
      <div className={SUBLINE}>
        {post.project ?? "No project"}
        {post.checked_scope === "paragraph" && ". One paragraph checked"}
      </div>
    </td>
  );
}

/** The posts the pipeline finished most recently, newest first, with how much
 *  their author is read and what the pipeline got out of them. */
export function RecentPosts() {
  const query = useQuery({ queryKey: queryKeys.dashboardRecentPosts, queryFn: () => fetchRecentPosts(POSTS_FETCHED) });
  const [shown, setShown] = useState(POSTS_PER_STEP);
  const posts = query.data;

  if (!posts) return <LoadState error={query.error} onRetry={() => void query.refetch()} />;
  if (posts.length === 0) return <p className="text-sm text-fg-muted">The pipeline has not finished a post yet.</p>;
  return (
    <>
      <DashboardTable columns={COLUMNS}>
        {posts.slice(0, shown).map((post) => (
          <tr key={post.id}>
            <PostCell post={post} />
            <td className={cn(CELL, "whitespace-nowrap text-fg-secondary")} title={post.published_at ?? undefined}>
              {post.published_at ? daysAgo(post.published_at) : "—"}
            </td>
            <td className={cn(CELL, "whitespace-nowrap text-fg-secondary")} title={new Date(post.processed_at).toLocaleString()}>
              {timeAgo(post.processed_at)}
            </td>
            <td className={NUMBER_CELL}>{post.author_visitors_per_post === null ? "—" : post.author_visitors_per_post.toFixed(2)}</td>
            <td className={NUMBER_CELL}>{post.claims_extracted}</td>
            <td className={NUMBER_CELL}>{post.claims_checked}</td>
            <td className={NUMBER_CELL}>{post.notes}</td>
          </tr>
        ))}
      </DashboardTable>
      <ShowMore shown={shown} total={posts.length} step={POSTS_PER_STEP} onMore={() => setShown((n) => n + POSTS_PER_STEP)} />
    </>
  );
}
