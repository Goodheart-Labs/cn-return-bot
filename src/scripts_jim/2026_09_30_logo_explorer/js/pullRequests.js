/* The two logo pull requests, with the file each one ships for every place a
 * logo slot can stand. The server reads the files from the pushed branches
 * (see server.ts), so the page shows what the PRs would ship today. */

import { element } from "./dom.js";

const EXTENSION_ICONS = "src/everything-extension/public/icon";
const WEBSITE_ASSETS = "src/everything-web/src/assets";
const LOGO = "src/everything-ui/assets/logo.svg";

/** A file per slot role. A role with a light and a dark file differs between
 *  the two modes. A favicon of null means the website has none, and Chrome
 *  shows its globe. Small places get the 32 pixel file, which is what Chrome
 *  takes on a sharp screen. */
export const PULL_REQUESTS = [
  {
    number: 532,
    name: "Stacked notes",
    files: {
      store: `${EXTENSION_ICONS}/128.png`,
      header: LOGO,
      favicon: { light: `${WEBSITE_ASSETS}/favicon-32.png`, dark: `${WEBSITE_ASSETS}/favicon-dark-32.png` },
      toolbar: { light: `${EXTENSION_ICONS}/32.png`, dark: `${EXTENSION_ICONS}/tile-32.png` },
      menu: `${EXTENSION_ICONS}/menu-32.png`,
    },
  },
  {
    number: 533,
    name: "Today's logo, green first",
    files: {
      store: `${EXTENSION_ICONS}/128.png`,
      header: LOGO,
      favicon: null,
      toolbar: `${EXTENSION_ICONS}/32.png`,
      menu: `${EXTENSION_ICONS}/32.png`,
    },
  },
];

/** The image a pull request ships into one logo slot. */
export function shippedImage(pullRequest, pixels, role, theme) {
  const file = pullRequest.files[role];
  if (file === null) return element("span", { className: "chrome-globe", title: "This PR gives the website no favicon" });
  const repoPath = typeof file === "string" ? file : file[theme];
  return element("img", { className: "logo-image", alt: "", width: pixels, height: pixels, src: `/shipped/${pullRequest.number}/${repoPath}` });
}
