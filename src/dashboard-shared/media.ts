import type { ReferencedTweetData, TweetMediaItem } from "./types";

export interface MediaImage { url: string }
export interface MediaVideo { url: string }

export interface ExtractedMedia {
  images: MediaImage[];
  videos: MediaVideo[];
  quotedImages: MediaImage[];
  quotedVideos: MediaVideo[];
  quotedPostContext?: string;
}

function pushMedia(
  m: TweetMediaItem,
  imagesOut: MediaImage[],
  videosOut: MediaVideo[],
): void {
  const url = m.url ?? m.preview_image_url;
  if (!url) return;
  if (m.type === "photo") imagesOut.push({ url });
  else if (m.type === "video" || m.type === "animated_gif") videosOut.push({ url });
}

export function extractMedia(
  tweetMedia?: TweetMediaItem[],
  referencedTweetData?: ReferencedTweetData,
): ExtractedMedia {
  const result: ExtractedMedia = {
    images: [],
    videos: [],
    quotedImages: [],
    quotedVideos: [],
    quotedPostContext: undefined,
  };
  for (const m of tweetMedia ?? []) pushMedia(m, result.images, result.videos);
  for (const m of referencedTweetData?.media ?? [])
    pushMedia(m, result.quotedImages, result.quotedVideos);
  if (referencedTweetData?.text) result.quotedPostContext = referencedTweetData.text;
  return result;
}
