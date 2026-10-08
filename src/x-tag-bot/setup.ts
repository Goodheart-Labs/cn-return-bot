/**
 * One-time setup of the bot's X Activity API subscriptions. Run it by hand
 * once the @CommonNotesBot account and its developer app exist (GOO-368).
 *
 *   bun run src/x-tag-bot/setup.ts
 *
 * Mentions and replies are private events, so X creates their subscriptions
 * only with a login of the bot account itself: an OAuth 2.0 user token with the
 * tweet.read scope. The script prints a login link, you open it while logged
 * in as @CommonNotesBot, and you paste back the address the browser lands on.
 * It then creates both subscriptions and prints the account's user id, which
 * goes into X_TAG_BOT_USER_ID. The stream itself runs on the app's bearer
 * token, so this login is never needed again.
 *
 * Needs X_TAG_BOT_CLIENT_ID, X_TAG_BOT_CLIENT_SECRET and X_TAG_BOT_REDIRECT_URI
 * (the callback address registered in the app; it doesn't have to load).
 */

import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const ME_URL = "https://api.x.com/2/users/me";
const SUBSCRIPTIONS_URL = "https://api.x.com/2/activity/subscriptions";
const SCOPES = "tweet.read users.read";
const EVENT_TYPES = ["post.mention.create", "post.reply.create"];

const clientId = requiredEnv("X_TAG_BOT_CLIENT_ID");
const clientSecret = requiredEnv("X_TAG_BOT_CLIENT_SECRET");
const redirectUri = requiredEnv("X_TAG_BOT_REDIRECT_URI");

const verifier = randomBytes(32).toString("base64url");
const state = randomBytes(16).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const login = new URL(AUTHORIZE_URL);
for (const [key, value] of Object.entries({
  response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: SCOPES, state,
  code_challenge: challenge, code_challenge_method: "S256",
})) login.searchParams.set(key, value);

console.log(`Open this link while logged in as @CommonNotesBot and allow access:\n\n${login}\n`);
const lines = createInterface({ input: process.stdin, output: process.stdout });
const landed = new URL(await lines.question("Paste the address the browser landed on: "));
lines.close();
if (landed.searchParams.get("state") !== state) throw new Error("The pasted address belongs to a different login.");
const code = landed.searchParams.get("code");
if (!code) throw new Error("The pasted address has no code.");

const token = await call(TOKEN_URL, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }),
});
const userHeaders = { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json" };

const me = (await call(ME_URL, { headers: userHeaders })).data;
console.log(`\nLogged in as @${me.username}. Set X_TAG_BOT_USER_ID=${me.id}`);

for (const eventType of EVENT_TYPES) {
  const subscription = await call(SUBSCRIPTIONS_URL, {
    method: "POST",
    headers: userHeaders,
    body: JSON.stringify({ event_type: eventType, filter: { user_id: me.id }, tag: "x-tag-bot" }),
  });
  console.log(`Subscribed to ${eventType}: ${JSON.stringify(subscription.data)}`);
}

async function call(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${url} answered ${response.status}: ${body.slice(0, 500)}`);
  return JSON.parse(body);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
