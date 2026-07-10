// video.twimg.com tarpits cross-origin <video> requests (Sec-Fetch-Site:
// cross-site): the connection opens but no bytes ever arrive, so players hang
// at readyState 0 forever with no error. Server-to-server fetches are
// unrestricted, so the dashboards' local servers re-serve the mp4 same-origin
// through this proxy. Clients build the src with proxiedVideoUrl; servers
// answer VIDEO_PROXY_PATH with fetchProxiedVideo.

export const VIDEO_PROXY_PATH = "/video-proxy";

export function proxiedVideoUrl(videoUrl: string): string {
  return `${VIDEO_PROXY_PATH}?url=${encodeURIComponent(videoUrl)}`;
}

const ALLOWED_HOSTS = new Set(["video.twimg.com"]);

const FORWARDED_RESPONSE_HEADERS = ["content-type", "content-length", "content-range", "accept-ranges"];

export async function fetchProxiedVideo(rawUrl: string | null, rangeHeader: string | null): Promise<Response> {
  let target: URL;
  try {
    target = new URL(rawUrl ?? "");
  } catch {
    return new Response("invalid url", { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(target.hostname)) return new Response("host not allowed", { status: 403 });

  const upstream = await fetch(target, { headers: rangeHeader ? { Range: rangeHeader } : {} });
  const headers = new Headers();
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
