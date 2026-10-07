/* The apps the explorer imitates. Each app draws its preview from the same
 * link text (LINK) and the selected image, and lists its crop rules with how
 * sure we are of each one:
 *   measured   - measured from a screenshot of the real app
 *   documented - stated by the app's own documentation
 *   approx     - from developer write-ups or our own reading of the app */

const LINK = {
  title: "Common Notes",
  description:
    "Common Notes is a Community Notes–inspired system that brings this feature to the whole web. See notes written by others on articles and YouTube videos.",
  domain: "commonnotes.net",
  url: "commonnotes.net/minisites",
  favicon: "assets/favicon-96.png",
  touchIcon: "assets/apple-touch-icon.png",
};

/* A box that shows the image at a fixed aspect ratio, filled and cropped from
 * the centre the way CSS object-fit: cover does. */
function coverBox(image, { width, aspect, radius = 0, extra = "" }) {
  return `<div style="width:${width};aspect-ratio:${aspect};border-radius:${radius}px;overflow:hidden;flex:none;${extra}">
    <img src="${image}" alt="" style="width:100%;height:100%;object-fit:cover;object-position:center;display:block"></div>`;
}

/* An image shown whole at its own aspect ratio, as apps that never crop do. */
function wholeImage(image, { maxWidth, radius = 0, extra = "" }) {
  return `<img src="${image}" alt="" style="display:block;width:100%;max-width:${maxWidth};height:auto;border-radius:${radius}px;${extra}">`;
}

const clamp = (lines) => `display:-webkit-box;-webkit-line-clamp:${lines};-webkit-box-orient:vertical;overflow:hidden`;

const slackMessage = (theme, inner) => `
  <div style="display:flex;gap:10px;font-family:Lato,'Slack-Lato',-apple-system,sans-serif;color:${theme.fg}">
    <div style="width:36px;height:36px;border-radius:8px;background:${theme.avatar};flex:none"></div>
    <div style="min-width:0;flex:1">
      <div style="font-size:15px"><b>Jim</b> <span style="color:${theme.muted};font-size:12px">5:23 PM</span></div>
      <div style="font-size:15px;color:${theme.link}">${LINK.url}</div>
      ${inner}
    </div>
  </div>`;

const SLACK_THEMES = {
  dark: { bg: "#1a1d21", fg: "#d1d2d3", muted: "#ababad", link: "#1d9bd1", line: "rgba(232,232,232,0.13)", tile: "#222529", avatar: "#4a3b2f", title: "#e8e8e8" },
  light: { bg: "#ffffff", fg: "#1d1c1d", muted: "#616061", link: "#1264a3", line: "rgba(29,28,29,0.13)", tile: "#f8f8f8", avatar: "#c9b8a6", title: "#1d1c1d" },
};

function slackCompact(themeName) {
  const theme = SLACK_THEMES[themeName];
  return (image) =>
    slackMessage(
      theme,
      `<div style="margin-top:8px;display:flex;height:120px;width:250px;border:1px solid ${theme.line};border-radius:12px;overflow:hidden">
        <div style="flex:1;min-width:0;background:${theme.tile};padding:12px 14px;display:flex;flex-direction:column;justify-content:center;gap:6px">
          <div style="font-weight:700;font-size:17px;line-height:1.25;color:${theme.title};${clamp(2)}">${LINK.title}</div>
          <div style="font-size:15px;color:${theme.muted};white-space:nowrap;overflow:hidden">${LINK.domain}</div>
        </div>
        ${coverBox(image, { width: "120px", aspect: "1 / 1", extra: `border-left:1px solid ${theme.line}` })}
      </div>`,
    );
}

function slackExpanded(themeName) {
  const theme = SLACK_THEMES[themeName];
  return (image) =>
    slackMessage(
      theme,
      `<div style="margin-top:6px;display:flex;gap:12px">
        <div style="width:4px;border-radius:4px;background:${themeName === "dark" ? "#35373b" : "#dddddd"};flex:none"></div>
        <div style="min-width:0;max-width:360px">
          <div style="display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700"><img src="${LINK.favicon}" alt="" style="width:16px;height:16px">${LINK.title}</div>
          <div style="font-size:15px;font-weight:700;color:${theme.link};margin-top:2px">${LINK.title}</div>
          <div style="font-size:15px;line-height:1.45;margin-top:2px">${LINK.description}</div>
          ${wholeImage(image, { maxWidth: "360px", radius: 8, extra: `margin-top:8px;border:1px solid ${theme.line}` })}
        </div>
      </div>`,
    );
}

function slackHover(image) {
  const theme = SLACK_THEMES.dark;
  return `<div style="max-width:380px;border-radius:12px;overflow:hidden;border:1px solid ${theme.line};font-family:Lato,-apple-system,sans-serif;background:#1f2124">
      <div style="padding:14px 16px 12px;color:${theme.fg}">
        <div style="font-weight:700;font-size:16px;color:${theme.title}">${LINK.title}</div>
        <div style="font-size:14px;line-height:1.4;margin-top:4px;${clamp(3)}">${LINK.description}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:10px;font-size:14px;color:${theme.muted}"><img src="${LINK.favicon}" alt="" style="width:16px;height:16px">${LINK.domain}</div>
      </div>
      ${wholeImage(image, { maxWidth: "100%" })}
    </div>`;
}

function xLarge(image) {
  return `<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:500px">
      <div style="position:relative;border:1px solid #2f3336;border-radius:16px;overflow:hidden">
        ${coverBox(image, { width: "100%", aspect: "2 / 1" })}
        <div style="position:absolute;left:12px;bottom:12px;max-width:calc(100% - 24px);background:rgba(0,0,0,0.77);color:#fff;font-size:13px;padding:0 4px;border-radius:4px;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${LINK.title}</div>
      </div>
      <div style="color:#71767b;font-size:13px;margin-top:4px">From ${LINK.domain}</div>
    </div>`;
}

function xSummary(image) {
  return `<div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:500px;display:flex;border:1px solid #2f3336;border-radius:16px;overflow:hidden;color:#e7e9ea">
      ${coverBox(image, { width: "130px", aspect: "1 / 1", extra: "border-right:1px solid #2f3336" })}
      <div style="padding:12px;display:flex;flex-direction:column;justify-content:center;gap:2px;min-width:0;font-size:15px">
        <div style="color:#71767b">${LINK.domain}</div>
        <div style="${clamp(1)}">${LINK.title}</div>
        <div style="color:#71767b;${clamp(2)}">${LINK.description}</div>
      </div>
    </div>`;
}

function discord(image) {
  return `<div style="font-family:'gg sans','Noto Sans',-apple-system,sans-serif;max-width:432px;background:#2b2d31;border-left:4px solid #1e1f22;border-radius:4px;padding:8px 16px 16px 12px;color:#dbdee1">
      <div style="font-size:12px;color:#b5bac1;margin-top:8px">${LINK.title}</div>
      <div style="font-size:16px;font-weight:600;color:#00a8fc;margin-top:8px">${LINK.title}</div>
      <div style="font-size:14px;line-height:1.375;margin-top:8px">${LINK.description}</div>
      ${wholeImage(image, { maxWidth: "400px", radius: 4, extra: "margin-top:16px;max-height:300px;object-fit:contain" })}
    </div>`;
}

function iMessage(image) {
  return `<div style="font-family:-apple-system,'SF Pro Text',sans-serif;display:flex;justify-content:flex-end">
      <div style="width:260px;border-radius:18px;overflow:hidden;background:#e9e9eb">
        ${coverBox(image, { width: "100%", aspect: "1200 / 630" })}
        <div style="padding:8px 12px 10px">
          <div style="font-size:14px;font-weight:600;color:#000;${clamp(2)}">${LINK.title}</div>
          <div style="font-size:13px;color:#8e8e93">${LINK.domain}</div>
        </div>
      </div>
    </div>`;
}

function linkedIn(image) {
  return `<div style="font-family:-apple-system,system-ui,sans-serif;max-width:520px;border:1px solid #e0dfdc;border-radius:8px;overflow:hidden;background:#fff">
      ${coverBox(image, { width: "100%", aspect: "1.91 / 1" })}
      <div style="padding:8px 12px;background:#fff;border-top:1px solid #e0dfdc">
        <div style="font-size:14px;font-weight:600;color:rgba(0,0,0,0.9);${clamp(2)}">${LINK.title}</div>
        <div style="font-size:12px;color:rgba(0,0,0,0.6);margin-top:2px">${LINK.domain}</div>
      </div>
    </div>`;
}

function whatsAppLarge(image) {
  return `<div style="font-family:-apple-system,'Segoe UI',Helvetica,sans-serif;display:flex;justify-content:flex-end">
      <div style="width:330px;background:#d9fdd3;border-radius:8px;padding:4px;box-shadow:0 1px 0.5px rgba(11,20,26,0.13)">
        <div style="background:#d1f4cc;border-radius:6px;overflow:hidden">
          ${coverBox(image, { width: "100%", aspect: "1.91 / 1" })}
          <div style="padding:6px 10px 8px">
            <div style="font-size:14px;font-weight:600;color:#111b21">${LINK.title}</div>
            <div style="font-size:12px;color:#667781;${clamp(2)}">${LINK.description}</div>
            <div style="font-size:12px;color:#667781;margin-top:2px">${LINK.domain}</div>
          </div>
        </div>
        <div style="font-size:14px;color:#027eb5;padding:6px 6px 2px">https://${LINK.url}</div>
      </div>
    </div>`;
}

function whatsAppSmall(image) {
  return `<div style="font-family:-apple-system,'Segoe UI',Helvetica,sans-serif;display:flex;justify-content:flex-end">
      <div style="width:330px;background:#d9fdd3;border-radius:8px;padding:4px;box-shadow:0 1px 0.5px rgba(11,20,26,0.13)">
        <div style="background:#d1f4cc;border-radius:6px;overflow:hidden;display:flex">
          ${coverBox(image, { width: "86px", aspect: "1 / 1" })}
          <div style="padding:6px 10px;min-width:0">
            <div style="font-size:14px;font-weight:600;color:#111b21">${LINK.title}</div>
            <div style="font-size:12px;color:#667781;${clamp(2)}">${LINK.description}</div>
            <div style="font-size:12px;color:#667781">${LINK.domain}</div>
          </div>
        </div>
        <div style="font-size:14px;color:#027eb5;padding:6px 6px 2px">https://${LINK.url}</div>
      </div>
    </div>`;
}

function facebook(image) {
  return `<div style="font-family:-apple-system,'Segoe UI',Helvetica,sans-serif;max-width:500px;border:1px solid #dadde1;overflow:hidden;background:#fff">
      ${coverBox(image, { width: "100%", aspect: "1.91 / 1" })}
      <div style="padding:10px 12px;background:#f0f2f5">
        <div style="font-size:13px;color:#65676b;text-transform:uppercase">${LINK.domain}</div>
        <div style="font-size:17px;font-weight:600;color:#050505;margin-top:2px;${clamp(1)}">${LINK.title}</div>
        <div style="font-size:15px;color:#65676b;${clamp(1)}">${LINK.description}</div>
      </div>
    </div>`;
}

function telegram(image) {
  return `<div style="font-family:-apple-system,Roboto,sans-serif;display:flex;justify-content:flex-end">
      <div style="width:330px;background:#effdde;border-radius:12px;padding:8px 10px">
        <div style="font-size:15px;color:#168acd">https://${LINK.url}</div>
        <div style="margin-top:6px;border-left:3px solid #5dc452;padding-left:8px">
          <div style="font-size:14px;font-weight:600;color:#3a8e26">${LINK.title}</div>
          <div style="font-size:14px;color:#000;line-height:1.35">${LINK.description}</div>
          ${wholeImage(image, { maxWidth: "100%", radius: 6, extra: "margin-top:6px" })}
        </div>
      </div>
    </div>`;
}

function google(image) {
  return `<div style="font-family:Arial,sans-serif;max-width:600px;background:#fff">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:28px;height:28px;border-radius:50%;background:#f1f3f4;border:1px solid #ecedef;display:grid;place-items:center"><img src="${LINK.favicon}" alt="" style="width:18px;height:18px"></div>
        <div><div style="font-size:14px;color:#202124">${LINK.title}</div><div style="font-size:12px;color:#4d5156">https://${LINK.domain}</div></div>
      </div>
      <div style="font-size:20px;color:#1a0dab;margin-top:6px;line-height:1.3">Common Notes: Community Notes 4 Everything</div>
      <div style="display:flex;gap:16px;margin-top:4px">
        <div style="font-size:14px;color:#4d5156;line-height:1.58;flex:1">${LINK.description}</div>
        ${coverBox(image, { width: "92px", aspect: "1 / 1", radius: 8, extra: "align-self:flex-start" })}
      </div>
    </div>`;
}

const SRC = {
  slackRobots: "https://api.slack.com/robots",
  slackUnfurl: "https://docs.slack.dev/messaging/unfurling-links-in-messages/",
  slackRepos: "https://github.com/chio-labs/sqlbuild/pull/828",
  xLarge: "https://developer.x.com/en/docs/x-for-websites/cards/overview/summary-card-with-large-image",
  xHeadline: "https://alternativeto.net/news/2024/1/x-brings-back-headlines-in-link-previews-but-you-might-not-even-notice",
  xSummary: "https://web-wp.archive.org/web/20140702005249/https:/dev.twitter.com/docs/cards/types/summary-card",
  discord: "https://opengraphplus.com/consumers/discord/images",
  apple: "https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages",
  linkedin: "https://www.linkedin.com/help/linkedin/answer/a521928",
  whatsapp: "https://developers.facebook.com/documentation/business-messaging/whatsapp/link-previews/",
  facebook: "https://developers.facebook.com/docs/sharing/webmasters/images",
  telegram: "https://telegram.org/blog/reply-revolution",
  googleFavicon: "https://developers.google.com/search/docs/appearance/favicon-in-search",
  googleImages: "https://developers.google.com/search/docs/appearance/google-images",
};

const SLACK_SMALL_RULES = [
  { text: "The card is about 2.08 to 1. The left 52% holds the title on up to two lines and the domain, cut off at the edge. There is no description and no icon.", confidence: "measured" },
  { text: "The image tile is a square as tall as the card, about 120 CSS pixels. It shows the full height of the image and the middle 52% of its width (x 285 to 915 of 1200). This is a centred \"cover\" crop.", confidence: "measured" },
  { text: "Slack uses this layout even though our tags ask for summary_large_image. When Slack picks the small card and when the large one is not documented. Four public repos fixed their cards for exactly this crop between 25 September and 6 October 2026, so it looks like a recent change.", confidence: "approx", source: SRC.slackRepos },
  { text: "Slack reads oEmbed first, then the Twitter or Open Graph tags, whichever comes first in the page. It caches a page for about 30 minutes, so add ?v=2 to the link to see a change.", confidence: "documented", source: SRC.slackRobots },
];

const SLACK_LARGE_RULES = [
  { text: "The older attachment layout: a grey bar, the site name with its icon, the title as a link, the description, and the image below at its own aspect ratio, about 360 pixels wide at most. Nothing is cropped.", confidence: "approx", source: SRC.slackUnfurl },
  { text: "Whether today's Slack still shows this layout for a link like ours, and when, is not documented. Your screenshot shows the small card instead.", confidence: "approx" },
];

const APPS = [
  {
    id: "slack-compact-dark",
    name: "Slack, small card (dark)",
    stageBackground: SLACK_THEMES.dark.bg,
    render: slackCompact("dark"),
    rules: SLACK_SMALL_RULES,
  },
  {
    id: "slack-compact-light",
    name: "Slack, small card (light)",
    stageBackground: SLACK_THEMES.light.bg,
    render: slackCompact("light"),
    rules: SLACK_SMALL_RULES,
  },
  {
    id: "slack-hover",
    name: "Slack, hover card",
    stageBackground: SLACK_THEMES.dark.bg,
    render: slackHover,
    rules: [
      { text: "Shown when you hover the link. The title on one line, the description on up to three lines, the icon and the domain, then the whole image at its own aspect ratio, about 390 CSS pixels wide.", confidence: "measured" },
      { text: "Nothing is cropped here, which is why this view looks right in your screenshot.", confidence: "measured" },
    ],
  },
  {
    id: "slack-expanded-dark",
    name: "Slack, classic large unfurl (dark)",
    stageBackground: SLACK_THEMES.dark.bg,
    render: slackExpanded("dark"),
    rules: SLACK_LARGE_RULES,
  },
  {
    id: "slack-expanded-light",
    name: "Slack, classic large unfurl (light)",
    stageBackground: SLACK_THEMES.light.bg,
    render: slackExpanded("light"),
    rules: SLACK_LARGE_RULES,
  },
  {
    id: "x-large",
    name: "X, large image card",
    stageBackground: "#000",
    render: xLarge,
    rules: [
      { text: "Used for twitter:card summary_large_image, which is what we set. The image is cropped from the centre to 2 to 1, so a 1200 × 630 card loses 15 pixels at the top and the bottom.", confidence: "documented", source: SRC.xLarge },
      { text: "Since October 2023 there is no title or description under the image. The web app puts the title in a small dark box at the bottom left, and \"From commonnotes.net\" under the card. Keep the bottom left corner free.", confidence: "approx", source: SRC.xHeadline },
      { text: "The image must carry the brand itself here, because the card may show no other text.", confidence: "approx" },
    ],
  },
  {
    id: "x-summary",
    name: "X, small card",
    stageBackground: "#000",
    render: xSummary,
    rules: [
      { text: "Used for twitter:card summary. We don't set that, so this only matters if we ever switch. The image is cropped to a centred square, like Slack's small card.", confidence: "documented", source: SRC.xSummary },
      { text: "The domain, the title and the description sit next to the square.", confidence: "approx" },
    ],
  },
  {
    id: "discord",
    name: "Discord",
    stageBackground: "#313338",
    render: discord,
    rules: [
      { text: "The large image appears only with summary_large_image. Otherwise Discord shows a thumbnail of about 80 pixels at the top right.", confidence: "approx", source: SRC.discord },
      { text: "The image is scaled to fit inside about 400 × 300 pixels and is never cropped.", confidence: "approx", source: SRC.discord },
      { text: "The coloured bar on the left takes the theme-color meta tag. We don't set one, so it stays grey. Discord caches a link for about 30 minutes.", confidence: "approx" },
    ],
  },
  {
    id: "imessage",
    name: "iMessage",
    stageBackground: "#fff",
    render: iMessage,
    rules: [
      { text: "The image is shown whole at its own aspect ratio, with corners rounded by about 18 points, and the title and the domain below it.", confidence: "approx", source: SRC.apple },
      { text: "Apple asks for images at least 900 pixels wide. Below 150 pixels an image may be ignored or shown as an icon. The apple-touch-icon is used only when there is no image.", confidence: "documented", source: SRC.apple },
      { text: "Apple advises against text in the image and against repeating the site name in og:title.", confidence: "documented", source: SRC.apple },
    ],
  },
  {
    id: "whatsapp-large",
    name: "WhatsApp, large preview",
    stageBackground: "#efeae2",
    render: whatsAppLarge,
    rules: [
      { text: "The large banner needs an image at least 300 pixels wide, no wider than 4 to 1, and under 600 KB. Ours is about 100 KB, so it qualifies.", confidence: "documented", source: SRC.whatsapp },
      { text: "The banner keeps the card's 1.91 to 1 shape, with the title, the description and the domain under it.", confidence: "approx" },
    ],
  },
  {
    id: "whatsapp-small",
    name: "WhatsApp, small preview",
    stageBackground: "#efeae2",
    render: whatsAppSmall,
    rules: [
      { text: "If the image breaks a rule (for example above 600 KB), WhatsApp falls back to a small square thumbnail cropped from the centre.", confidence: "documented", source: SRC.whatsapp },
    ],
  },
  {
    id: "linkedin",
    name: "LinkedIn",
    stageBackground: "#f4f2ee",
    render: linkedIn,
    rules: [
      { text: "LinkedIn asks for at least 1200 × 627 at 1.91 to 1, under 5 MB. Our card fits, so it is shown whole above the title and the domain.", confidence: "documented", source: SRC.linkedin },
      { text: "Images under 401 pixels wide become a small thumbnail. The Post Inspector tool refreshes LinkedIn's copy.", confidence: "approx" },
    ],
  },
  {
    id: "facebook",
    name: "Facebook",
    stageBackground: "#f0f2f5",
    render: facebook,
    rules: [
      { text: "Facebook asks for 1200 × 630. Images of at least 600 × 315 get this large layout; smaller ones become a small square.", confidence: "documented", source: SRC.facebook },
      { text: "Below the image: the domain in capitals, the title, and one line of the description. The Sharing Debugger refreshes Facebook's copy.", confidence: "approx" },
    ],
  },
  {
    id: "telegram",
    name: "Telegram",
    stageBackground: "#8fb48a",
    render: telegram,
    rules: [
      { text: "Each reader can choose larger or smaller media for a preview. Larger shows the whole image under the text, as here. Smaller shows a roughly square thumbnail cropped from the centre.", confidence: "approx", source: SRC.telegram },
    ],
  },
  {
    id: "google",
    name: "Google result (mobile)",
    stageBackground: "#fff",
    render: google,
    rules: [
      { text: "The icon is our favicon. It must be square, and above 48 × 48 is best. Ours is 96 × 96.", confidence: "documented", source: SRC.googleFavicon },
      { text: "Google sometimes adds a small, roughly square thumbnail on mobile, picked by Google itself and cropped from the centre. It advises against logos and text in it.", confidence: "approx", source: SRC.googleImages },
      { text: "The blue title is the page's &lt;title&gt; tag, not og:title.", confidence: "documented" },
    ],
  },
];

const EXPLANATION = `
<h3>Who makes the preview</h3>
<p>When you paste a link, the app's server, not your computer, downloads the page. This program is called a crawler (Slack's is named <code>Slackbot-LinkExpanding</code>). It reads a few <code>&lt;meta&gt;</code> tags from the page's <code>&lt;head&gt;</code>, downloads the image they name, and the app draws its own card from those pieces. The page itself has no say in the layout. It only supplies a title, a description, an image and an icon.</p>
<h3>Which tags</h3>
<ul>
  <li><code>og:title</code>, <code>og:description</code> and <code>og:image</code> come from the Open Graph protocol, a standard Facebook published in 2010 that almost every app now reads.</li>
  <li><code>twitter:card</code> and <code>twitter:image</code> are X's own variant. <code>summary_large_image</code> asks for the wide card; <code>summary</code> asks for the small square one.</li>
  <li>The favicon (<code>&lt;link rel="icon"&gt;</code>) is the small logo that Slack, Google and others print next to the domain.</li>
</ul>
<p>The crawlers do not run JavaScript. commonnotes.net is a single-page app: every address, including /minisites and every note page, returns the same <code>index.html</code>, and JavaScript draws the page afterwards. So every link to the site gets the home page's preview. /privacy and /terms are plain pages without any preview tags.</p>
<h3>Why one image looks right in one place and wrong in another</h3>
<p>Each app puts the image into a box of its own shape and fills that box. If the shapes differ, the app scales the image until it covers the box and cuts off whatever sticks out, keeping the centre. This is the "cover" crop, named after the CSS rule <code>object-fit: cover</code>. A 1.91 to 1 image in a 1.91 to 1 box loses nothing. The same image in a square box loses about a quarter of its width on each side.</p>
<h3>What went wrong in Slack</h3>
<p>Our card is 1200 × 630 and is drawn by <code>src/everything-web/og-card.html</code> (PR #549). Its text runs almost from edge to edge. Slack's new small card is a text tile on the left and a square image tile on the right. The square keeps only the middle 630 pixels of the 1200, so it cuts "Community Notes 4 Everything" and the rating pills in half. The hover card shows the whole image, which is why it looks right. Slack shows the small card even though we ask for the large one. This layout appears to be recent: other projects began fixing their cards for exactly this crop in late September 2026.</p>
<h3>The fix</h3>
<p>Keep everything that matters inside the middle square, roughly x 330 to 870 and y 60 to 570 of the 1200 × 630 card. Content outside it may show in the wide layouts, but it must be fine to lose. The square is drawn at only about 120 pixels in Slack, so anything in it needs to be large.</p>
<h3>Testing a change</h3>
<p>Apps cache previews. Slack keeps a page for about 30 minutes and an image for as long as its address stays the same. So a new image needs a new file name (for example <code>og-2.png</code>). When testing, add a throwaway query to the link, such as <code>commonnotes.net/?v=3</code>, so Slack treats it as a new page. Facebook and LinkedIn have refresh tools: the Sharing Debugger and the Post Inspector.</p>
`;
