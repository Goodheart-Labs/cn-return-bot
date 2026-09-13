import axios from "axios";
import { resolve4 } from "node:dns/promises";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import LinkifyIt from "linkify-it";

export interface DiscussionSource {
  url: string;
  fetchedUrl?: string;
  ok: boolean;
  content: string;
}

const linkify = new LinkifyIt().set({ fuzzyLink: false, fuzzyEmail: false });
const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
  ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(network, prefix, "ipv4");

/** Pasted sources are public web URLs; credentials and custom ports are never fetched. */
export function isPublicSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    if (url.port && url.port !== "80" && url.port !== "443") return false;
    if (!host.includes(".") || /\.(?:localhost|local|internal|home|lan)\.?$/.test(host)) return false;
    if (host.includes(":")) return false; // Only vetted and pinned IPv4 connections below.
    return !isIP(host) || !blocked.check(host, "ipv4");
  } catch {
    return false;
  }
}

export function discussionSourceUrls(message: string, limit = 3): string[] {
  return [...new Set((linkify.match(message) ?? []).map((match) => match.url))]
    .filter(isPublicSourceUrl).slice(0, limit);
}

async function publicAddress(host: string): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = isIP(host) ? [host] : await Promise.race([
      resolve4(host),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("DNS lookup timed out")), 5_000); }),
    ]);
    if (!addresses.length || addresses.some((address) => blocked.check(address, "ipv4"))) {
      throw new Error("Source resolves to a non-public address");
    }
    return addresses[0]!;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read bounded source content without a browser or ambient proxy. Every redirect
 * is checked, and the DNS result is pinned to the connection to avoid rebinding.
 * Pages that require login/JavaScript remain explicitly unread.
 */
export async function readDiscussionSource(originalUrl: string): Promise<DiscussionSource> {
  try {
    let url = new URL(originalUrl);
    for (let redirects = 0; redirects <= 3; redirects++) {
      if (!isPublicSourceUrl(url.href)) throw new Error("Only public HTTP(S) sources are allowed");
      const address = await publicAddress(url.hostname);
      const lookup = ((_hostname: unknown, options: { all?: boolean }, callback: (...args: any[]) => void) => {
        callback(null, options.all ? [{ address, family: 4 }] : address, 4);
      }) as NonNullable<ConstructorParameters<typeof HttpAgent>[0]>["lookup"];
      const httpAgent = new HttpAgent({ lookup, family: 4 });
      const httpsAgent = new HttpsAgent({ lookup, family: 4 });
      let response;
      try {
        response = await axios.get<ArrayBuffer>(url.href, {
          httpAgent, httpsAgent, proxy: false, maxRedirects: 0,
          timeout: 8_000, signal: AbortSignal.timeout(10_000),
          responseType: "arraybuffer", maxContentLength: 1_000_000,
          headers: { "User-Agent": "CommunityNotesSignalBot/1.0", Accept: "text/html,text/plain,application/pdf" },
          validateStatus: () => true,
        });
      } finally {
        httpAgent.destroy();
        httpsAgent.destroy();
      }
      if ([301, 302, 303, 307, 308].includes(response.status) && response.headers.location) {
        url = new URL(response.headers.location, url);
        continue;
      }
      if (response.status !== 200) throw new Error(`Source returned HTTP ${response.status}`);
      const type = String(response.headers["content-type"] ?? "");
      let content: string;
      if (type.includes("application/pdf")) {
        const { extractText } = await import("unpdf");
        content = (await extractText(new Uint8Array(response.data), { mergePages: true })).text;
      } else if (/text\/(?:html|plain)|application\/xhtml\+xml/.test(type)) {
        const raw = Buffer.from(response.data).toString("utf8");
        if (type.includes("html")) {
          const { document } = parseHTML(raw);
          content = new Readability(document as unknown as Document).parse()?.textContent ?? "";
        } else content = raw;
      } else throw new Error("Source is not an HTML, text, or PDF document");
      content = content.trim().slice(0, 12_000);
      if (content.length < 80) throw new Error("Too little readable source content; it may require login or JavaScript");
      return { url: originalUrl, fetchedUrl: url.href, ok: true, content };
    }
    throw new Error("Source redirected too many times");
  } catch (error) {
    return { url: originalUrl, ok: false, content: error instanceof Error ? error.message.slice(0, 200) : "Source could not be read" };
  }
}
