/**
 * End-to-end test: feed a few PDF URLs through fetchWebPage and check that
 * we get extracted text back instead of "Non-text content".
 */

import "dotenv/config";
import { fetchWebPage } from "../../pipeline/tool-calling/tools";
import { closeBrowser } from "../../pipeline/utils/browserManager";

const URLS = [
  // BLS — known to 403 (anti-bot at HTTP layer, not a PDF issue)
  "https://www.bls.gov/news.release/pdf/cpi.pdf",
  // CBO publishes PDFs with permissive headers
  "https://www.cbo.gov/system/files/2024-01/59544-CPI.pdf",
  // arXiv — standard test target
  "https://arxiv.org/pdf/1706.03762",
];

for (const url of URLS) {
  console.log(`\n=== ${url}`);
  const t0 = Date.now();
  const r = await fetchWebPage(url);
  const took = Date.now() - t0;
  const out = r.content;
  console.log(`  ${r.ok ? "✓" : "✗"}  ${out.length}c  ${took}ms`);
  console.log(`  preview: ${out.slice(0, 250).replace(/\s+/g, " ")}`);
}

await closeBrowser().catch(() => {});
