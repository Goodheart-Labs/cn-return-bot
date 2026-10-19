/** The catch-all "Around the web" project (migration 068). Write-anywhere pages
 *  and reader-requested pages both land here. This module stays free of imports
 *  so the pipeline can use the constant without pulling in the browser Supabase
 *  client. */
export const WEB_PROJECT_SLUG = "web";

/** Where a creator publishes, named for a link to their own page. */
export type CreatorPlatform = "Substack" | "YouTube" | "LessWrong" | "Alignment Forum";

/** The platform a creator's feed URL belongs to, or null for a URL we do not
 *  recognise. Feed URLs are canonical (migration 086): a *.substack.com root,
 *  a YouTube channel, or a forum author's profile. */
export function creatorPlatform(feedUrl: string): CreatorPlatform | null {
  let hostname: string;
  try {
    hostname = new URL(feedUrl).hostname;
  } catch {
    return null;
  }
  if (hostname.endsWith("substack.com")) return "Substack";
  if (hostname.endsWith("youtube.com")) return "YouTube";
  if (hostname.endsWith("lesswrong.com")) return "LessWrong";
  if (hostname.endsWith("alignmentforum.org")) return "Alignment Forum";
  return null;
}
