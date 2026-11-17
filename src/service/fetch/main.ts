/**
 * The fetcher. On the services machine it is the only process that fetches
 * pages, API answers and images from addresses a stranger or a model chose.
 * The other services ask it over a Unix socket (see readPage and askFetcher).
 *
 * It runs in a sandbox that systemd builds from ops/cn-fetch.service. It holds
 * no keys, it cannot see the secret files, and the kernel lets it reach public
 * internet addresses only. So a page that tricks the fetch code into reading
 * something on this machine finds nothing worth taking.
 *
 * It listens on a Unix socket, which is a file that local processes connect
 * to, rather than on a network port. The kernel's address rules do not apply
 * to Unix sockets, so the services can reach the fetcher while the fetcher
 * cannot reach them.
 *
 *   FETCH_SERVICE_SOCKET=/tmp/cn-fetch.sock bun run src/service/fetch/main.ts
 */

import { chmodSync } from "node:fs";
import { downloadImageInlineData } from "../../pipeline/media/mediaAnalysisGemini";
import { minisitePageAnswer } from "../../everything/minisites/readPage";
import { fetchApiInBrowser, fetchApiPlain } from "../../pipeline/fetch/fetchApi";
import { fetchPageWithLadder } from "../../pipeline/fetch/fetchLadder";
import {
  FETCH_API_IN_BROWSER_PATH,
  FETCH_API_PATH,
  FETCH_IMAGE_PATH,
  FETCH_PAGE_PATH,
  MINISITE_PAGE_PATH,
  FETCH_SERVICE_SOCKET_VARIABLE,
  type FetchUrlRequest,
  type MinisitePageRequest,
  type ServiceErrorResponse,
} from "../contract";
import { requiredEnv } from "../serve";

/** The fetch ladder needs about two minutes in the worst case, and the answer
 *  is only sent at the end. Bun caps this value at 255 seconds. Bun's types
 *  leave idleTimeout out for Unix sockets, but Bun applies it to them, and
 *  without it Bun cuts every answer off after 10 seconds (checked with Bun
 *  1.3.14). Hence the cast below. */
const IDLE_TIMEOUT_SECONDS = 255;

/** Anyone on the machine may connect. The fetcher has nothing to protect, and
 *  the services run as a different user than the fetcher does. */
const SOCKET_MODE = 0o666;

const routes: Record<string, (body: any) => Promise<unknown>> = {
  [FETCH_PAGE_PATH]: (body: FetchUrlRequest) => fetchPageWithLadder(body.url),
  [FETCH_API_PATH]: (body: FetchUrlRequest) => fetchApiPlain(body.url),
  [FETCH_API_IN_BROWSER_PATH]: (body: FetchUrlRequest) => fetchApiInBrowser(body.url),
  [MINISITE_PAGE_PATH]: (body: MinisitePageRequest) => minisitePageAnswer(body.url, body.page),
  [FETCH_IMAGE_PATH]: (body: FetchUrlRequest) => downloadImageInlineData(body.url),
};

export function startFetchService(socketPath: string) {
  const server = Bun.serve(<Parameters<typeof Bun.serve>[0]>{
    unix: socketPath,
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    fetch: async (request) => {
      const { pathname } = new URL(request.url);
      const route = routes[pathname];
      if (!route || request.method !== "POST") {
        return Response.json({ code: "rejected", error: `No such route: ${request.method} ${pathname}` } satisfies ServiceErrorResponse, { status: 404 });
      }
      try {
        return Response.json(await route(await request.json()));
      } catch (err: any) {
        return Response.json({ code: "failed", error: err?.message ?? String(err) } satisfies ServiceErrorResponse, { status: 500 });
      }
    },
  });
  chmodSync(socketPath, SOCKET_MODE);
  return server;
}

if (import.meta.main) {
  const socketPath = requiredEnv(FETCH_SERVICE_SOCKET_VARIABLE);
  startFetchService(socketPath);
  console.log(`[fetch] listening on ${socketPath}`);
}
