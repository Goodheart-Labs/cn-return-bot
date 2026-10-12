import type { Tweet } from "./types";
import { extractMedia, type MediaImage, type MediaVideo } from "./media";
import { sourceLinkLabel } from "../everything-core/pageUrls";

const LINK = "text-blue-600 dark:text-blue-400 hover:underline";

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
                className="max-w-[300px] max-h-[250px] rounded-lg border border-gray-200 dark:border-gray-700 object-contain cursor-pointer hover:opacity-90"
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
            <a key={i} href={vid.url} target="_blank" rel="noopener noreferrer" className={`text-xs ${LINK}`}>
              {vid.url}
            </a>
          ))}
        </div>
      )}
    </>
  );
}

export function TweetCard({ tweet }: { tweet: Tweet }) {
  const media = extractMedia(tweet.media, tweet.referencedTweetData);
  // An explicit source link wins, for example the timestamped YouTube URL of a
  // podcast item. Without one we link to the post on X. When there is neither we
  // show no link at all. That happens for a podcast item whose source link has
  // not been backfilled yet.
  const sourceUrl = tweet.sourceUrl?.trim()
    ? tweet.sourceUrl
    : tweet.tweetId
      ? `https://x.com/i/status/${tweet.tweetId}`
      : null;

  return (
    <div className="bg-gray-50 dark:bg-gray-800/40 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {tweet.handle && (
            <span className="text-sm font-medium text-gray-800 dark:text-gray-200">@{tweet.handle}</span>
          )}
        </div>
        {sourceUrl && (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs ${LINK}`}
          >
            View on {sourceLinkLabel(sourceUrl)} ↗
          </a>
        )}
      </div>

      {tweet.text && (
        <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap mb-2">{tweet.text}</p>
      )}

      <MediaBlock images={media.images} videos={media.videos} />

      {(media.quotedPostContext || media.quotedImages.length > 0 || media.quotedVideos.length > 0) && (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 mb-2 text-sm text-gray-600 dark:text-gray-300">
          <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">Quoted post</div>
          {media.quotedPostContext && (
            <p className="whitespace-pre-wrap mb-2">{media.quotedPostContext}</p>
          )}
          <MediaBlock images={media.quotedImages} videos={media.quotedVideos} />
        </div>
      )}
    </div>
  );
}
