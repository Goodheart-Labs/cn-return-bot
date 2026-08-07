/**
 * Dump the claim-extraction I/O for one Zvi post: raw text (with image
 * markers), rendered input (image description blocks inline), per-call chunks,
 * and the extracted claims. Relies on the TEMP debug dump in extractClaims.ts
 * (EXTRACTION_DEBUG_DIR).
 */
import { fetchSubstackPost } from "../../everything/sources/substack";
import { extractClaims } from "../../everything/pipeline/extractClaims";

const POST_URL = "https://thezvi.substack.com/p/on-kimi-k3-its-capabilities-and-related";
const dir = import.meta.dir;
process.env.EXTRACTION_DEBUG_DIR = dir;

const content = await fetchSubstackPost(POST_URL);
const imageCount = [...content.text.matchAll(/\[\[IMAGE:/g)].length;
console.log(`Fetched "${content.title}" — ${content.text.length} chars, ${imageCount} images`);
await Bun.write(`${dir}/raw.md`, content.text);

const t0 = Date.now();
const claims = await extractClaims(content, 4);
await Bun.write(`${dir}/claims.json`, JSON.stringify(claims, null, 2));
console.log(`${claims.length} claims in ${Math.round((Date.now() - t0) / 1000)}s → claims.json`);
