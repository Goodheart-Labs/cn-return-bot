/** The real pages the site checks open. Each was picked because it should
 *  stay as it is for years: old posts we already checked, with notes, by
 *  creators we follow. A check that fails because one of these pages went
 *  away needs a new page here, not a code fix. */

/** A post with 20 notes on Astral Codex Ten, which runs on its own domain. */
export const CUSTOM_DOMAIN_SUBSTACK_POST = "https://www.astralcodexten.com/p/obscure-pregnancy-interventions-much";
/** The same post as Substack's reader app links it, by its post id. */
export const SUBSTACK_READER_LINK = "https://substack.com/home/post/p-52041324";
export const CUSTOM_DOMAIN_SUBSTACK_ARCHIVE = "https://www.astralcodexten.com/archive";
export const CUSTOM_DOMAIN_SUBSTACK = { subdomain: "astralcodexten", feedUrl: "https://astralcodexten.substack.com" };

/** A post with 19 notes on Don't Worry About the Vase, on *.substack.com. */
export const SUBSTACK_POST = "https://thezvi.substack.com/p/childhood-and-education-22-voice";
export const SUBSTACK_ARCHIVE = "https://thezvi.substack.com/archive";
export const SUBSTACK_PUBLICATION = "https://thezvi.substack.com";
export const SUBSTACK_PROFILE_HANDLE = "thezvi";

/** A video with 36 timestamped notes. */
export const YOUTUBE_VIDEO = { url: "https://www.youtube.com/watch?v=zB6PhTxnj7U", channelPath: "/@ChrisWillx" };
export const YOUTUBE_CHANNEL = "https://www.youtube.com/@ChrisWillx";
/** A channel page whose first rows list videos we noted. */
export const YOUTUBE_CHANNEL_VIDEOS = "https://www.youtube.com/@veritasium/videos";
/** The first video ever uploaded. Nobody follows its channel or requests
 *  it, so its three-dot menu always offers our rows. */
export const YOUTUBE_UNFOLLOWED_VIDEO = "https://www.youtube.com/watch?v=jNQXAC9IVRw";

export const LESSWRONG_POST = { url: "https://www.lesswrong.com/posts/DZPodskqJJNEkMLvH/ai-189-new-math", author: "https://www.lesswrong.com/users/zvi" };
export const LESSWRONG_AUTHOR = "https://www.lesswrong.com/users/zvi";
export const ALIGNMENT_FORUM_POST = {
  url: "https://www.alignmentforum.org/posts/Emp7awtxsYn8MusNq/the-alignment-problem-computer-science-meets-analytic",
  author: "https://www.alignmentforum.org/users/vanessa-kosoy",
};
export const EA_FORUM_POST = {
  url: "https://forum.effectivealtruism.org/posts/JadwtSNrdsSaF6Ciq/intrasolar-and-extrasolar-space-governance",
  author: "https://forum.effectivealtruism.org/users/jordanstone",
};
export const EA_FORUM_AUTHOR = "https://forum.effectivealtruism.org/users/toby-tremlett";

/** An ordinary article on a site without an API of its own, for the fetch
 *  ladder and Jina. */
export const PLAIN_ARTICLE = "https://en.wikipedia.org/wiki/Community_Notes";
