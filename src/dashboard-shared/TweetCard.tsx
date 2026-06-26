import type { Tweet } from "./types";
import { extractMedia, type MediaImage, type MediaVideo } from "./media";

function MediaBlock({ images, videos }: { images: MediaImage[]; videos: MediaVideo[] }) {
  if (images.length === 0 && videos.length === 0) return null;
  return (
    <>
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {images.map((img, i) => (
            <a key={i} href={img.url} target="_blank" rel="noopener noreferrer">
              <img
                src={img.url}
                alt={`Image ${i + 1}`}
                className="max-w-[300px] max-h-[250px] rounded border border-gray-200 object-contain cursor-pointer hover:opacity-90"
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            </a>
          ))}
        </div>
      )}
      {videos.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {videos.map((vid, i) => vid.url && (
            <a key={i} href={vid.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-500 hover:underline">
              {vid.url}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

// "View on <domain>" label: nicer names for the common hosts, bare hostname
// otherwise.
function sourceLinkLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
  if (host === "x.com" || host === "twitter.com") return "X";
  if (host === "youtube.com" || host === "youtu.be") return "YouTube";
  return host;
}

export function TweetCard({ tweet }: { tweet: Tweet }) {
  const media = extractMedia(tweet.media, tweet.referencedTweetData);
  // Prefer an explicit source link (e.g. timestamped YouTube for podcast items);
  // otherwise fall back to the X status URL. Hide the link entirely when neither
  // is available (e.g. a podcast item whose link hasn't been backfilled yet).
  const sourceUrl = tweet.sourceUrl?.trim()
    ? tweet.sourceUrl
    : tweet.tweetId
      ? `https://x.com/i/status/${tweet.tweetId}`
      : null;

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {tweet.handle && (
            <span className="text-sm font-medium text-gray-800">@{tweet.handle}</span>
          )}
          {tweet.hasPhoto && (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">
              {tweet.mediaCount && tweet.mediaCount > 1 ? `${tweet.mediaCount} images` : "image"}
            </span>
          )}
          {tweet.hasVideo && (
            <span className="text-xs bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">video</span>
          )}
        </div>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-500 hover:underline"
          >
            View on {sourceLinkLabel(sourceUrl)} ↗
          </a>
        )}
      </div>

      {tweet.text && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap mb-2">{tweet.text}</p>
      )}

      <MediaBlock images={media.images} videos={media.videos} />

      {(media.quotedPostContext || media.quotedImages.length > 0 || media.quotedVideos.length > 0) && (
        <div className="bg-white border border-gray-200 rounded p-2 mb-2 text-sm text-gray-600">
          <div className="text-xs text-gray-400 mb-1">Quoted post</div>
          {media.quotedPostContext && (
            <p className="whitespace-pre-wrap mb-2">{media.quotedPostContext}</p>
          )}
          <MediaBlock images={media.quotedImages} videos={media.quotedVideos} />
        </div>
      )}
    </div>
  );
}
