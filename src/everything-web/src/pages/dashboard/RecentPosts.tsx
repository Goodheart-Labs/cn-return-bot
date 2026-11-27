import { DASHBOARD_PAGE_SIZE, fetchRecentPostsPage, type RecentPostRow } from "@cn/core/dashboard";
import { LAST_POSTS_PER_CREATOR } from "@cn/core/readers";
import { queryKeys } from "@cn/features/query/queryKeys";
import { afterFullPage, usePagedList } from "@cn/features/query/usePagedList";
import { cn } from "@cn/ui/cn";
import { CELL, DashboardTable, LoadState, NUMBER_CELL, ShowMore, SUBLINE, timeAgo, type Column } from "./tableParts";

const DAY_MS = 24 * 3600 * 1000;

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
    label: "Readers",
    align: "right",
    explanation: "The different people who opened this post with the extension, since its first visit. Hover a number to see every visit, which also counts people coming back.",
  },
  {
    label: "Author's average",
    align: "right",
    explanation: `The average number of different people per post, over the author's ${LAST_POSTS_PER_CREATOR} most recently visited posts, however long ago those visits were. The walk ranks authors on it, after adding a few imagined posts that the creator ranking explains. A post in a project without a feed, such as Around the web, has no value here.`,
  },
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
 *  they and their author are read and how many notes they got. */
export function RecentPosts() {
  const list = usePagedList({
    queryKey: queryKeys.dashboardRecentPosts,
    fetchPage: fetchRecentPostsPage,
    firstBookmark: null as RecentPostRow | null,
    nextBookmark: afterFullPage(DASHBOARD_PAGE_SIZE),
  });
  const posts = list.pages?.flat();

  if (!posts) return <LoadState error={list.error} onRetry={list.retry} />;
  if (posts.length === 0) return <p className="text-sm text-fg-muted">The pipeline has not finished a post yet.</p>;
  return (
    <>
      <DashboardTable columns={COLUMNS}>
        {posts.map((post) => (
          <tr key={post.id}>
            <PostCell post={post} />
            <td className={cn(CELL, "whitespace-nowrap text-fg-secondary")} title={post.published_at ?? undefined}>
              {post.published_at ? daysAgo(post.published_at) : "—"}
            </td>
            <td className={cn(CELL, "whitespace-nowrap text-fg-secondary")} title={new Date(post.processed_at).toLocaleString()}>
              {timeAgo(post.processed_at)}
            </td>
            <td className={NUMBER_CELL} title={post.visits === 1 ? "1 visit" : `${post.visits} visits`}>
              {post.readers}
            </td>
            <td className={NUMBER_CELL}>{post.author_visitors_per_post === null ? "—" : post.author_visitors_per_post.toFixed(2)}</td>
            <td className={NUMBER_CELL}>{post.notes}</td>
          </tr>
        ))}
      </DashboardTable>
      <ShowMore list={list} />
    </>
  );
}
