import { openPageWithExtension } from "./browser";
const { context, page } = await openPageWithExtension("https://www.astralcodexten.com/");
await page.waitForTimeout(15000);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(10000);
const info = await page.evaluate(() => [...document.querySelectorAll(".cn-coverage-badge")].slice(0, 3).map((b) => {
  const chain: string[] = [];
  let el: Element | null = b.parentElement;
  for (let i = 0; el && i < 6; i++, el = el.parentElement) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    chain.push(`${el.tagName.toLowerCase()}.${(el.getAttribute("class") ?? "").split(/\s+/).slice(0, 2).join(".")} display=${cs.display} pos=${cs.position} overflow=${cs.overflow} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  const imgs = [...(b.parentElement?.querySelectorAll("img, picture, source") ?? [])].map((i) => `${i.tagName.toLowerCase()} pos=${getComputedStyle(i).position} display=${getComputedStyle(i).display}`);
  return { badgeRect: JSON.stringify(b.getBoundingClientRect()), chain, siblings: [...(b.parentElement?.children ?? [])].map((c) => c.tagName.toLowerCase()), imgs };
}));
console.log(JSON.stringify(info, null, 1));
await context.close();
