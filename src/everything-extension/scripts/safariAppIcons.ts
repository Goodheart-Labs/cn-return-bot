// Draws the Safari container app's icons from the logo. Run it again whenever
// src/everything-ui/assets/logo.svg changes:
//
//   bun run src/everything-extension/scripts/safariAppIcons.ts
//
// It renders the SVG in headless Chromium, because the devbox has no other
// SVG rasteriser. See preview.ts for the background on the library path.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const LOGO_PATH = path.resolve(import.meta.dir, "../../everything-ui/assets/logo.svg");
const APP_DIR = path.resolve(import.meta.dir, "../safari/Common Notes");
const APP_ICON_SET_DIR = path.join(APP_DIR, "Assets.xcassets/AppIcon.appiconset");

/** The sizes of a macOS app icon set, in points. Each exists at 1x and 2x. */
const APP_ICON_POINT_SIZES = [16, 32, 128, 256, 512];
const APP_ICON_SCALES = [1, 2];

/** Apple's macOS icon grid leaves a transparent margin around the artwork: a
 *  square app icon fills 824 of the canvas's 1024 pixels. Without the margin
 *  our icon would look larger than every other icon in the Dock. The logo is
 *  wider than it is tall and covers little of its square, so at 824 it would
 *  look smaller than the others instead. It gets the share the Chrome Web
 *  Store icon has, 112 of 128 (scripts/generate-logo-assets.ts). */
const ARTWORK_SHARE_OF_CANVAS = 112 / 128;

/** The picture the app's window shows at 128 points, drawn at 2x for Retina
 *  screens. It has no margin because it sits on the window's own background. */
const WINDOW_ICON_PIXELS = 256;

const localLibs = path.join(os.homedir(), ".cache/cn-playwright-libs/usr/lib/x86_64-linux-gnu");
const browser = await chromium.launch({
  env: {
    ...process.env,
    ...(fs.existsSync(localLibs)
      ? { LD_LIBRARY_PATH: [localLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") }
      : {}),
  },
});
const page = await browser.newPage();
const logoDataUrl = `data:image/svg+xml;base64,${fs.readFileSync(LOGO_PATH).toString("base64")}`;

async function drawLogo(filePath: string, canvasPixels: number, artworkShare: number) {
  const artworkPixels = Math.round(canvasPixels * artworkShare);
  await page.setViewportSize({ width: canvasPixels, height: canvasPixels });
  await page.setContent(
    `<body style="margin:0;display:flex;align-items:center;justify-content:center;width:${canvasPixels}px;height:${canvasPixels}px">
       <img src="${logoDataUrl}" width="${artworkPixels}" height="${artworkPixels}">
     </body>`,
  );
  await page.screenshot({ path: filePath, omitBackground: true });
}

for (const points of APP_ICON_POINT_SIZES) {
  for (const scale of APP_ICON_SCALES) {
    await drawLogo(path.join(APP_ICON_SET_DIR, `mac-icon-${points}@${scale}x.png`), points * scale, ARTWORK_SHARE_OF_CANVAS);
  }
}
await drawLogo(path.join(APP_DIR, "Resources/Icon.png"), WINDOW_ICON_PIXELS, 1);

await browser.close();
