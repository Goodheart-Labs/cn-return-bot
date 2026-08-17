/**
 * Fetches a tweet's text and author from X's public syndication endpoint at
 * cdn.syndication.twimg.com. That endpoint needs no authentication. The source
 * verifier uses this so it can actually read a cited X post instead of
 * accepting it unread. It works for text-only tweets and for image tweets,
 * which are the ones where yt-dlp finds no video. It returns null when the
 * tweet is deleted, protected, or otherwise unavailable.
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
// algorithm the official react-tweet library uses. The constants in it mean
// something only to X's server, so they are left inline rather than named.
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
