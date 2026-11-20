/** Reproduces the site check "Our rows appear in a video card's three-dot
 *  menu" and prints what the card and the opened menu look like. */
import { launchWithExtension, openPage } from "../../everything-extension/scripts/browser";
import { YOUTUBE_CARD, YOUTUBE_MENU_TRIGGER } from "../../everything-extension/utils/menuTriggers";

const url = process.argv[2] ?? "https://www.youtube.com/@veritasium/videos";
const context = await launchWithExtension();
const lines: string[] = [];
const page = await openPage(context, url, (line) => lines.push(line));
await page.waitForTimeout(6000);
const card = page.locator(YOUTUBE_CARD).locator("visible=true").first();
console.log("card tag:", await card.evaluate((el) => el.tagName));
console.log("card links:", await card.evaluate((el) => [...el.querySelectorAll("a[href]")].map((a) => `${(a as HTMLAnchorElement).href} | ${a.textContent?.trim().slice(0, 40)}`)));
await card.hover();
const triggers = card.locator(YOUTUBE_MENU_TRIGGER).locator("visible=true");
console.log("visible triggers:", await triggers.count());
for (let i = 0; i < (await triggers.count()); i++) console.log("  trigger", i, await triggers.nth(i).evaluate((el) => el.outerHTML.slice(0, 200)));
await triggers.last().click();
await page.waitForTimeout(5000);
console.log("menus:", await page.evaluate(() => [...document.querySelectorAll('ytd-popup-container yt-list-view-model[role="menu"], ytd-popup-container ytd-menu-popup-renderer #items')].map((m) => `${m.tagName} visible=${m.getClientRects().length > 0} text=${(m as HTMLElement).innerText.replace(/\s+/g, " ").slice(0, 200)}`)));
console.log("popup html:", await page.evaluate(() => document.querySelector("ytd-popup-container")?.innerHTML.replace(/\s+/g, " ").slice(0, 1500)));
console.log("rows:", await page.locator(".cn-menu-row").allTextContents());
console.log("extension log:", lines.filter((l) => /menu/i.test(l)).slice(-10));
await context.close();
