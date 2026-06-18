/**
 * Fetch a tweet's text + author from X's public syndication endpoint
 * (cdn.syndication.twimg.com) — no auth required. Used by the source verifier
 * to actually read cited X posts instead of blind-accepting them. Works for
 * text-only and image tweets (where yt-dlp finds no video). Returns null when
 * the tweet is deleted, protected, or otherwise unavailable.
 */

const SYNDICATION_ENDPOINT = "https://cdn.syndication.twimg.com/tweet-result";

export interface SyndicationTweet {
  text: string;
  authorName: string;
  authorHandle: string;
  createdAt?: string;
  hasMedia: boolean;
}

function tweetIdFromUrl(url: string): string | null {
  const match = url.match(/(?:twitter|x)\.com\/[^/]+\/status\/(\d+)/i);
  return match ? match[1]! : null;
}

// The endpoint requires a `token` derived from the id. This is the opaque
// algorithm the official react-tweet library uses; the exact constant matters
// only to X's server, so it's left inline rather than named.
function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
}

export async function fetchTweetViaSyndication(url: string): Promise<SyndicationTweet | null> {
  const id = tweetIdFromUrl(url);
  if (!id) return null;
  const endpoint = `${SYNDICATION_ENDPOINT}?id=${id}&token=${syndicationToken(id)}&lang=en`;
  try {
    const response = await fetch(endpoint, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!response.ok) return null;
    const data: any = await response.json();
    if (!data?.text || !data?.user) return null;
    return {
      text: data.text,
      authorName: data.user.name ?? "",
      authorHandle: data.user.screen_name ?? "",
      createdAt: data.created_at,
      hasMedia: Array.isArray(data.mediaDetails) && data.mediaDetails.length > 0,
    };
  } catch {
    return null;
  }
}
