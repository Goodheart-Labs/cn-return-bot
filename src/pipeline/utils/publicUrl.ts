/**
 * The guard for every server-side fetch of an address that came from outside:
 * a page a reader asked for, a link the model chose, an image found in a post.
 * Such an address must be http or https, and its host must resolve only to
 * public addresses. That keeps the server from fetching its own local ports,
 * files on its disk, or the cloud provider's metadata service, whose answers
 * could otherwise end up in a published note.
 *
 * The check looks the host up before the fetch, and the fetch looks it up
 * again. A hostile DNS server could answer differently the second time. The
 * service units close that gap for the metadata service at the network level
 * (IPAddressDeny=link-local in ops/*.service), so this guard is the first
 * line, not the only one.
 */

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export class NonPublicUrlError extends Error {}

const MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Address ranges that are not on the public internet. BlockList also matches
 *  an IPv4 address written in its IPv6 form (::ffff:127.0.0.1) against the
 *  IPv4 ranges. */
const NON_PUBLIC_RANGES: Array<[network: string, prefix: number, type: "ipv4" | "ipv6"]> = [
  ["0.0.0.0", 8, "ipv4"], // "this network"
  ["10.0.0.0", 8, "ipv4"], // private
  ["100.64.0.0", 10, "ipv4"], // shared by carrier-grade NAT
  ["127.0.0.0", 8, "ipv4"], // loopback
  ["169.254.0.0", 16, "ipv4"], // link-local, where cloud metadata services live
  ["172.16.0.0", 12, "ipv4"], // private
  ["192.0.0.0", 24, "ipv4"], // IETF protocol assignments
  ["192.168.0.0", 16, "ipv4"], // private
  ["198.18.0.0", 15, "ipv4"], // benchmarking
  ["224.0.0.0", 4, "ipv4"], // multicast
  ["240.0.0.0", 4, "ipv4"], // reserved, including broadcast
  ["::", 128, "ipv6"], // unspecified
  ["::1", 128, "ipv6"], // loopback
  ["64:ff9b::", 96, "ipv6"], // NAT64, which reaches IPv4 addresses through a gateway
  ["fc00::", 7, "ipv6"], // unique local, the IPv6 counterpart of private
  ["fe80::", 10, "ipv6"], // link-local
  ["ff00::", 8, "ipv6"], // multicast
];

const nonPublicAddresses = new BlockList();
for (const [network, prefix, type] of NON_PUBLIC_RANGES) nonPublicAddresses.addSubnet(network, prefix, type);

function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && !nonPublicAddresses.check(address, family === 4 ? "ipv4" : "ipv6");
}

/** Throws NonPublicUrlError unless the URL is http or https and every address
 *  its host resolves to is public. A host that does not resolve at all throws
 *  the lookup's own error instead, because a dead domain is not an attack and
 *  its archived copies are still worth fetching. */
export async function assertPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new NonPublicUrlError(`Refusing to fetch a ${parsed.protocol} URL`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  const nonPublic = addresses.find((address) => !isPublicAddress(address));
  if (nonPublic) throw new NonPublicUrlError(`Refusing to fetch ${parsed.host}: it resolves to the non-public address ${nonPublic}`);
}

/** fetch() for an outside address. It checks the URL, and it follows redirects
 *  itself so that it can check every address a redirect points to as well.
 *  Without that, a public page could redirect the server to an internal one. */
export async function fetchPublicUrl(url: string, init: RequestInit = {}): Promise<{ response: Response; finalUrl: string }> {
  let current = url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await assertPublicUrl(current);
    const response = await fetch(current, { ...init, redirect: "manual" });
    const location = response.headers.get("location");
    if (!REDIRECT_STATUSES.has(response.status) || !location) return { response, finalUrl: current };
    await response.body?.cancel();
    current = new URL(location, current).href;
  }
  throw new Error(`Gave up after ${MAX_REDIRECTS} redirects from ${url}`);
}
