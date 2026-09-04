/**
 * The HTTP shell both services share: authentication, routing, health, and the
 * long-response handling that keeps a slow answer from being cut off.
 */

import {
  HEALTH_PATH,
  SERVICE_AUTH_HEADER,
  type HealthResponse,
  type ServiceErrorResponse,
  type ServiceName,
  type WorkPriority,
} from "./contract";
import { WorkQueue, type WorkQueueOptions } from "./workQueue";

/** A served answer can take minutes, and the server closes a connection that
 *  has been idle too long. So the response is streamed, and while the work runs
 *  we send a newline at this interval. The newline keeps the connection busy
 *  and is harmless in front of JSON, which ignores leading whitespace. It also
 *  tells the caller early that the service is alive. */
const KEEPALIVE_INTERVAL_MS = 15_000;

/** The longest a connection may sit with nothing sent on it. Our keepalive is
 *  well inside this, so reaching it means the process is wedged rather than
 *  slow. Bun caps this value at 255 seconds. */
const IDLE_TIMEOUT_SECONDS = 120;

export interface ServiceRoute<Body, Answer> {
  path: string;
  /** Reads the priority off a parsed body, so the queue knows how urgent the
   *  call is before the work starts. */
  priorityOf: (body: Body) => WorkPriority;
  handle: (body: Body) => Promise<Answer>;
}

export interface ServiceOptions<Body, Answer> extends WorkQueueOptions {
  name: ServiceName;
  port: number;
  route: ServiceRoute<Body, Answer>;
}

export function startService<Body, Answer>(options: ServiceOptions<Body, Answer>) {
  const queue = new WorkQueue(options);
  const secret = requiredEnv("SERVICE_AUTH_SECRET");

  const server = Bun.serve({
    port: options.port,
    idleTimeout: IDLE_TIMEOUT_SECONDS,
    fetch: async (request) => {
      const url = new URL(request.url);

      if (request.headers.get(SERVICE_AUTH_HEADER) !== secret) {
        return errorResponse("Wrong or missing service key", 401);
      }
      if (url.pathname === HEALTH_PATH) {
        return Response.json(queue.health(options.name) satisfies HealthResponse);
      }
      if (url.pathname !== options.route.path) {
        return errorResponse(`No such path: ${url.pathname}`, 404);
      }
      if (request.method !== "POST") {
        return errorResponse(`${options.route.path} takes POST`, 405);
      }

      let body: Body;
      try {
        body = (await request.json()) as Body;
      } catch {
        return errorResponse("Body is not valid JSON", 400);
      }

      return streamWhileWorking(() => queue.run(options.route.priorityOf(body), () => options.route.handle(body)));
    },
  });

  console.log(
    `[${options.name}] listening on ${server.port}, ${options.concurrency} at a time, ` +
      `${options.reservedForReader} reserved for readers`,
  );
  return server;
}

/** Answers with a stream that stays alive while the work runs and ends with the
 *  JSON answer. A failure becomes an error answer on the same stream, because
 *  by then the status line has already gone out and cannot be changed. The
 *  caller tells the two apart by looking for the `error` field. */
function streamWhileWorking<Answer>(work: () => Promise<Answer>): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const keepalive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode("\n"));
        } catch {
          // The caller hung up. The work itself carries on and its result is
          // simply dropped, which is what a retry from the caller expects.
        }
      }, KEEPALIVE_INTERVAL_MS);
      try {
        const answer = await work();
        controller.enqueue(encoder.encode(JSON.stringify(answer)));
      } catch (err: any) {
        const failure: ServiceErrorResponse = { error: err?.message ?? String(err) };
        controller.enqueue(encoder.encode(JSON.stringify(failure)));
      } finally {
        clearInterval(keepalive);
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/json" } });
}

function errorResponse(message: string, status: number): Response {
  return Response.json({ error: message } satisfies ServiceErrorResponse, { status });
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number, got "${raw}"`);
  return value;
}
