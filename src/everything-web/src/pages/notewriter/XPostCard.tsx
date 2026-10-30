import { useState } from "react";
import type { XMedia, XNote } from "@cn/core/notewriter";
import { cn } from "@cn/ui/cn";
import { getBestMediaUrl } from "../../../../pipeline/media/bestMediaUrl";
import { LinkifiedText } from "../../../../dashboard-shared/LinkifiedText";

type Post = NonNullable<XNote["post"]>;

const REFERENCED_LABEL = { quoted: "Quoted post", replied_to: "Replying to", retweeted: "Reposted" } as const;

const postUrl = (id: string) => `https://x.com/i/status/${id}`;

/** One photo, or one video's still frame with a label. It opens the full
 *  image or the video file. X's image host refuses an image request that
 *  names another site as its referrer, so the image sends none.
 *  A post deleted on X takes its images with it. Such an image hides its
 *  whole tile instead of showing a broken picture. */
function MediaTile({ item, url }: { item: XMedia; url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const still = item.type === "photo" ? url : item.preview_image_url;
  const label = item.type === "photo" ? "Photo" : item.type === "animated_gif" ? "GIF" : "Video";
  return (
    <a href={url} target="_blank" rel="noreferrer" className="relative block overflow-hidden rounded-control border border-line">
      {still ? (
        <img src={still} alt={label} loading="lazy" referrerPolicy="no-referrer" className="max-h-72 w-full object-cover" onError={() => setFailed(true)} />
      ) : (
        <span className="block px-3 py-6 text-center text-sm text-link">{label}</span>
      )}
      {item.type !== "photo" && still && (
        <span className="absolute bottom-1.5 left-1.5 rounded-control bg-inverse px-1.5 py-0.5 text-xs font-semibold text-on-inverse">{label}</span>
      )}
    </a>
  );
}

/** A post's photos and videos as a grid. */
function Media({ media }: { media: XMedia[] }) {
  const shown = media.flatMap((item) => {
    const url = getBestMediaUrl(item);
    return url ? [{ item, url }] : [];
  });
  if (shown.length === 0) return null;
  return (
    <div className={cn("grid gap-1.5", shown.length > 1 && "grid-cols-2")}>
      {shown.map(({ item, url }) => <MediaTile key={url} item={item} url={url} />)}
    </div>
  );
}

const linkClass = "text-link hover:underline break-all";

/** The X post a note is on, the way X shows it: who wrote it and when, its
 *  text and media, and the post it quotes or replies to inside it. It plays
 *  the part the quoted passage plays on the website's note cards. */
export function XPostCard({ post }: { post: Post }) {
  const date = post.postedAt && new Date(post.postedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div className="space-y-2 [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="min-w-0">
          {post.name && <span className="font-semibold text-fg">{post.name} </span>}
          {post.handle && <span className="text-fg-muted">@{post.handle}</span>}
          {date && <span className="text-fg-muted"> · {date}</span>}
        </span>
        <a href={postUrl(post.id)} target="_blank" rel="noreferrer" className="shrink-0 text-xs text-link hover:underline">
          View on X ↗
        </a>
      </div>
      {post.text && <LinkifiedText className="text-sm text-fg whitespace-pre-wrap" linkClassName={linkClass} text={post.text} />}
      <Media media={post.media} />
      {post.referenced && (post.referenced.text || post.referenced.media.length > 0) && (
        <div className="space-y-2 rounded-card border border-line bg-surface-muted p-3">
          <div className="text-xs font-semibold text-fg-muted">{REFERENCED_LABEL[post.referenced.kind ?? "quoted"]}</div>
          {post.referenced.text && <LinkifiedText className="text-sm text-fg-secondary whitespace-pre-wrap" linkClassName={linkClass} text={post.referenced.text} />}
          <Media media={post.referenced.media} />
        </div>
      )}
    </div>
  );
}
