/** The site checks for what the services read: posts, listings, captions and
 *  the page reader's fallbacks. A page or listing is read by the services box
 *  through /read-page and /read-listing, the way a feed run on GitHub Actions
 *  reads it, so the check sees the network, proxy and keys that production
 *  uses. Then our own parsers run on the answer here. A few reads that
 *  production makes from GitHub Actions or the devbox are made here
 *  directly. */
import { requestListing, requestPageRead } from "../service/client";
import type { PageRead, ReadPage } from "../service/contract";
import { postPublication } from "../pipeline/fetch/sites/substack";
import { BROWSER_HEADERS, classifyMarkdown, tryWayback } from "../pipeline/fetch/fetchLadder";
import { fetchWithJinaReader } from "../pipeline/fetch/jinaReader";
import { fetchChannelUploads, resolveChannel } from "../pipeline/media/youtubeDataApi";
import { fetchArchivePosts, fetchLatestFreePosts, parseSubstackFeed } from "../everything/sources/substack";
import { substackFeedInPageHtml } from "../everything/feedUrls";
import { pageFromArticleHtml, pageFromSubstackPost } from "../everything/minisites/readPage";
import { must, type SiteCheck } from "./siteCheck";
import * as pages from "./pages";

/** Fewer characters than this means we read a stub, a wall or an error page
 *  instead of the post. */
const MIN_POST_CHARS = 1000;
/** A Substack RSS feed lists about 20 posts. */
const MIN_FEED_POSTS = 10;
const LISTED_POSTS = 3;
/** A 40-minute video has hundreds of caption lines. */
const MIN_CAPTION_CUES = 100;

async function readThroughServices(url: string): Promise<ReadPage> {
  const read: PageRead = await requestPageRead({ url });
  must(read.type === "page", `the services box could not read ${url}: ${read.type === "unreadable" ? read.reason : read.type}`);
  return read.page;
}

async function forumListingThroughServices(feedUrl: string) {
  const listing = await requestListing({ feedUrl, limit: LISTED_POSTS });
  must(listing.kind === "forum", `${feedUrl} was listed as ${listing.kind}, not as a forum author`);
  return listing.listing;
}

function substackPostCheck(url: string, subdomain: string, where: string): SiteCheck {
  return {
    site: "Substack",
    name: `A post ${where} is read through Substack's post endpoint, and its publication is found`,
    code: "readSubstackPost and postPublication (src/pipeline/fetch/sites/substack.ts), pageFromSubstackPost (minisites)",
    run: async () => {
      const page = await readThroughServices(url);
      must(page.source.kind === "substack", `the post was read by "${page.source.kind}", so Substack's post endpoint gave no usable answer`);
      must(page.text.length >= MIN_POST_CHARS, `the post's text has only ${page.text.length} characters`);
      must(page.authorName, "the post has no author name");
      const publication = postPublication(page.source.post);
      must(publication?.subdomain === subdomain, `the post's publication is ${publication?.subdomain ?? "unknown"}, not ${subdomain}`);
      const minisite = pageFromSubstackPost(page.source.post, url);
      must(minisite.creator_feed_url === `https://${subdomain}.substack.com`, `a minisite of it would name the creator ${minisite.creator_feed_url}`);
      return `${page.text.length} characters by ${page.authorName}, publication ${publication.subdomain}`;
    },
  };
}

function forumPostCheck(name: string, post: { url: string; author: string }): SiteCheck {
  return {
    site: "Forums",
    name: `${name} post is read through the forum's GraphQL API, with its author`,
    code: "readForumPost (src/pipeline/fetch/sites/forum.ts)",
    run: async () => {
      const page = await readThroughServices(post.url);
      must(page.source.kind === "forum", `the post was read by "${page.source.kind}", so the GraphQL API gave no usable answer`);
      must(page.text.length >= MIN_POST_CHARS, `the post's text has only ${page.text.length} characters`);
      must(page.source.authorFeedUrl === post.author, `the post's author is ${page.source.authorFeedUrl}, not ${post.author}`);
      return `${page.text.length} characters by ${page.authorName}`;
    },
  };
}

async function answersWithImage(url: string): Promise<boolean> {
  const res = await fetch(url);
  return res.ok && (res.headers.get("content-type") ?? "").startsWith("image/");
}

export const serverChecks: SiteCheck[] = [
  substackPostCheck(pages.CUSTOM_DOMAIN_SUBSTACK_POST, pages.CUSTOM_DOMAIN_SUBSTACK.subdomain, "on a newsletter's own domain"),
  substackPostCheck(pages.SUBSTACK_POST, "thezvi", "on *.substack.com"),
  {
    site: "Substack",
    name: "A publication's RSS feed lists its posts with name, logo, dates and bodies",
    code: "readListing and parseSubstackFeed (src/everything/sources/substack.ts)",
    run: async () => {
      const listing = await requestListing({ feedUrl: pages.CUSTOM_DOMAIN_SUBSTACK.feedUrl, limit: 0 });
      must(listing.kind === "substack", `the feed was listed as ${listing.kind}`);
      const feed = parseSubstackFeed(listing.xml);
      must(feed.title, "the feed names no publication");
      must(feed.imageUrl, "the feed has no logo");
      must(feed.posts.length >= MIN_FEED_POSTS, `the feed lists only ${feed.posts.length} posts`);
      const free = feed.posts.filter((post) => !post.paywalled && post.bodyHtml.length >= MIN_POST_CHARS);
      must(free.length > 0, "no post in the feed has a full free body");
      must(
        feed.posts.every((post) => post.title && post.url.includes("/p/")),
        "a post in the feed has no title or no post address",
      );
      return `"${feed.title}" lists ${feed.posts.length} posts, ${free.length} with a full free body`;
    },
  },
  {
    site: "Substack",
    name: "The archive API lists a publication's newest free posts",
    code: "fetchArchivePosts (src/everything/sources/substack.ts)",
    run: async () => {
      const posts = await fetchArchivePosts(pages.SUBSTACK_PUBLICATION, LISTED_POSTS);
      must(posts.length === LISTED_POSTS, `the archive gave ${posts.length} free posts`);
      must(
        posts.every((post) => post.url?.includes("/p/") && post.title && !Number.isNaN(Date.parse(post.postDate))),
        "an archive post lacks its address, title or date",
      );
      return posts.map((post) => post.title).join(" · ");
    },
  },
  {
    site: "Substack",
    name: "The profile API names a writer's publication",
    code: "fetchLatestFreePosts (src/everything/sources/substack.ts)",
    run: async () => {
      const { publicationName, posts } = await fetchLatestFreePosts(`https://substack.com/@${pages.SUBSTACK_PROFILE_HANDLE}`, 1);
      must(publicationName, "the profile names no publication");
      must(posts.length === 1, "the publication's archive gave no post");
      return `@${pages.SUBSTACK_PROFILE_HANDLE} writes "${publicationName}"`;
    },
  },
  {
    site: "Substack",
    name: "A page on a newsletter's own domain names its *.substack.com publication in its HTML",
    code: "substackFeedInPageHtml (src/everything/feedUrls.ts), pageFromArticleHtml (minisites)",
    run: async () => {
      const res = await fetch(pages.CUSTOM_DOMAIN_SUBSTACK_POST, { headers: BROWSER_HEADERS });
      must(res.ok, `the page answered HTTP ${res.status}`);
      const html = await res.text();
      const expected = pages.CUSTOM_DOMAIN_SUBSTACK.feedUrl;
      const fromHtml = substackFeedInPageHtml(html)?.feed_url ?? null;
      must(fromHtml === expected, `everything-prioritize would read the publication ${fromHtml}`);
      const minisite = pageFromArticleHtml(html, pages.CUSTOM_DOMAIN_SUBSTACK_POST).creator_feed_url;
      must(minisite === expected, `a minisite of the page would name the creator ${minisite}`);
      return expected;
    },
  },
  {
    site: "YouTube",
    name: "The Data API finds a channel and lists its uploads",
    code: "resolveChannel and fetchChannelUploads (src/pipeline/media/youtubeDataApi.ts)",
    run: async () => {
      const channel = await resolveChannel(pages.YOUTUBE_CHANNEL);
      must(channel.title && channel.thumbnailUrl, "the channel has no title or no picture");
      const videos = await fetchChannelUploads(channel.id, LISTED_POSTS);
      must(videos.length === LISTED_POSTS, `the channel listed ${videos.length} uploads`);
      must(
        videos.every((video) => video.title && video.publishedTime && video.viewCount > 0),
        "an upload lacks its title, time or views",
      );
      return `${channel.title}: ${videos.map((video) => video.title).join(" · ")}`;
    },
  },
  {
    site: "YouTube",
    name: "A video's captions are read with their timings",
    code: "readYoutubeVideo and youtubeCaptions.ts on the services box (yt-dlp, the PO token provider, the residential proxy)",
    run: async () => {
      const page = await readThroughServices(pages.YOUTUBE_VIDEO.url);
      must(page.source.kind === "youtube", `the video was read by "${page.source.kind}", not as captions`);
      must(page.source.cues.length >= MIN_CAPTION_CUES, `the captions have only ${page.source.cues.length} lines`);
      return `${page.source.cues.length} caption lines`;
    },
  },
  forumPostCheck("A LessWrong", pages.LESSWRONG_POST),
  forumPostCheck("An Alignment Forum", pages.ALIGNMENT_FORUM_POST),
  forumPostCheck("An EA Forum", pages.EA_FORUM_POST),
  {
    site: "Forums",
    name: "A LessWrong author's newest posts are listed with name and text",
    code: "readForumAuthor (src/pipeline/fetch/sites/forum.ts)",
    run: async () => {
      const listing = await forumListingThroughServices(pages.LESSWRONG_AUTHOR);
      must(listing.authorName, "the author has no name");
      must(listing.posts.length === LISTED_POSTS, `the author listed ${listing.posts.length} posts`);
      must(
        listing.posts.every((post) => post.text && post.url.includes("/posts/") && !Number.isNaN(Date.parse(post.postedAt))),
        "a listed post lacks its text, address or date",
      );
      return `${listing.authorName}: ${listing.posts.map((post) => post.title).join(" · ")}`;
    },
  },
  {
    site: "Forums",
    name: "An EA Forum author's newest posts are listed, with a profile picture that loads",
    code: "readForumAuthor and profileImageUrl (src/pipeline/fetch/sites/forum.ts)",
    run: async () => {
      const listing = await forumListingThroughServices(pages.EA_FORUM_AUTHOR);
      must(listing.authorName, "the author has no name");
      must(listing.posts.length === LISTED_POSTS, `the author listed ${listing.posts.length} posts`);
      must(listing.imageUrl, "the author has no profile picture");
      must(await answersWithImage(listing.imageUrl), `the profile picture does not load: ${listing.imageUrl}`);
      return `${listing.authorName}: ${listing.posts.length} posts and a picture`;
    },
  },
  {
    site: "Page reader",
    name: "The fetch ladder reads an ordinary article",
    code: "fetchPageWithLadder (src/pipeline/fetch/fetchLadder.ts) in cn-fetch",
    run: async () => {
      const page = await readThroughServices(pages.PLAIN_ARTICLE);
      must(page.source.kind === "ladder", `the article was read by "${page.source.kind}", so the ladder failed`);
      must(page.text.length >= MIN_POST_CHARS, `the article's text has only ${page.text.length} characters`);
      return `${page.text.length} characters via ${page.source.via ?? "a plain request"}`;
    },
  },
  {
    site: "Page reader",
    name: "Jina Reader reads an article",
    code: "fetchWithJinaReader (src/pipeline/fetch/jinaReader.ts)",
    run: async () => {
      const jina = await fetchWithJinaReader(pages.PLAIN_ARTICLE);
      must(jina.type === "page", `Jina answered ${JSON.stringify(jina)}`);
      must(classifyMarkdown(jina.markdown) === "good", `Jina's text counts as "${classifyMarkdown(jina.markdown)}"`);
      return `${jina.markdown.length} characters`;
    },
  },
  {
    site: "Page reader",
    name: "The Wayback Machine finds and serves a snapshot",
    code: "tryWayback (src/pipeline/fetch/fetchLadder.ts)",
    run: async () => {
      const snapshot = await tryWayback(pages.PLAIN_ARTICLE);
      must(snapshot.ok, `the Wayback step failed: ${snapshot.error ?? `HTTP ${snapshot.status}`}`);
      must((snapshot.body?.length ?? 0) >= MIN_POST_CHARS, "the snapshot is nearly empty");
      return `${snapshot.body!.length} characters of HTML`;
    },
  },
];
