/**
 * Small X API helper for the GOO-289 experiments. Every response is saved under
 * data/ so the write-up can quote real numbers without paying for a call twice.
 *
 * All calls use Jim's developer app (the X_JIMMAAR1 keys), the only key set that
 * still authenticates on 2026-10-01. Two kinds of authentication are used.
 * "user" signs the request with OAuth 1.0a as @JimMaar1. "app" uses the app's
 * own bearer token, which some endpoints such as trends demand. We get that
 * token from X's OAuth 2 client-credentials endpoint with the app's key and
 * secret.
 */
import "dotenv/config";
import crypto from "crypto";
import OAuth from "oauth-1.0a";
import { mkdirSync, writeFileSync } from "fs";

const DATA_DIR = `${import.meta.dir}/data`;
mkdirSync(DATA_DIR, { recursive: true });

type Auth = "app" | "user";

const KEY = process.env.X_JIMMAAR1_API_KEY!;
const SECRET = process.env.X_JIMMAAR1_API_KEY_SECRET!;

function userHeaders(url: string, method: string) {
  const oauth = new OAuth({
    consumer: { key: KEY, secret: SECRET },
    signature_method: "HMAC-SHA1",
    hash_function: (base, key) => crypto.createHmac("sha1", key).update(base).digest("base64"),
  });
  const token = { key: process.env.X_JIMMAAR1_ACCESS_TOKEN!, secret: process.env.X_JIMMAAR1_ACCESS_TOKEN_SECRET! };
  return oauth.toHeader(oauth.authorize({ url, method }, token)) as unknown as Record<string, string>;
}

let appBearer: string | undefined;
async function appHeaders() {
  if (!appBearer) {
    const response = await fetch("https://api.x.com/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });
    appBearer = ((await response.json()) as { access_token: string }).access_token;
  }
  return { Authorization: `Bearer ${appBearer}` };
}

export async function xGet(path: string, params: Record<string, string | number>, auth: Auth, saveAs?: string) {
  const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
    .toString()
    .replace(/\+/g, "%20");
  const url = `https://api.x.com${path}${query ? `?${query}` : ""}`;
  const headers = auth === "app" ? await appHeaders() : userHeaders(url, "GET");
  const response = await fetch(url, { headers });
  const body = await response.json();
  if (saveAs) writeFileSync(`${DATA_DIR}/${saveAs}.json`, JSON.stringify(body, null, 2));
  if (!response.ok) console.log(`[x] ${response.status} ${path}: ${JSON.stringify(body).slice(0, 600)}`);
  return { status: response.status, body };
}
