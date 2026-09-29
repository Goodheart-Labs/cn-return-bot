// @ts-nocheck
// This file is a Deno edge function. It uses Deno globals and imports from
// esm.sh, and those only resolve on Supabase's Deno runtime once the function is
// deployed. The repo's Node tsc cannot check them, which is why checking is
// turned off above.
//
// youtube-websub is where YouTube tells us that a channel has published
// something (GOO-225). WebSub is a web standard, formerly called PubSubHubbub.
// The creator walk subscribes each YouTube channel it reaches at Google's hub
// (src/everything/youtubeChannels.ts), and gives this function's address as
// the place to send news to. The hub then talks to us in two ways.
//
// A GET asks us to confirm a subscription. We answer with the challenge the hub
// sent, which is how the standard proves we asked for it.
//
// A POST carries a short Atom XML document about one video: it was uploaded,
// or its title or description changed. We stamp notified_at on the channel's
// row in everything_youtube_channels. The walk then asks the Data API for that
// channel's uploads the next time it passes it. Nothing else happens here, so
// a notification about a Short or an edit costs one listing at most.
//
// Every POST is signed. The walk sends a shared secret with each subscription,
// and the hub puts an HMAC-SHA1 of the body under that secret in the
// X-Hub-Signature header. A POST without a valid signature did not come from
// the hub and is ignored. The standard asks us to answer it with a success
// anyway, so a sender cannot tell whether its forgery was noticed.
//
// Deploy: supabase functions deploy youtube-websub --no-verify-jwt
// Secret: supabase secrets set YOUTUBE_WEBSUB_SECRET=... (the same value the
// feed workflow has as a repository secret)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function hmacSha1Hex(secret: string, body: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function isSignedByHub(request: Request, body: Uint8Array): Promise<boolean> {
  const header = request.headers.get("x-hub-signature") ?? "";
  const expected = `sha1=${await hmacSha1Hex(Deno.env.get("YOUTUBE_WEBSUB_SECRET")!, body)}`;
  return header === expected;
}

function confirmSubscription(url: URL): Response {
  const challenge = url.searchParams.get("hub.challenge");
  if (!challenge) return new Response("missing hub.challenge", { status: 400 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

async function recordNotification(request: Request): Promise<Response> {
  const body = new Uint8Array(await request.arrayBuffer());
  if (!(await isSignedByHub(request, body))) {
    console.warn("[youtube-websub] ignored a notification without a valid signature");
    return new Response(null, { status: 204 });
  }
  // A notification about a deleted video carries no yt:channelId element and
  // is ignored, because a deletion never gives the walk anything to check.
  const channelId = new TextDecoder().decode(body).match(/<yt:channelId>(UC[\w-]{22})<\/yt:channelId>/)?.[1];
  if (!channelId) return new Response(null, { status: 204 });
  const { error } = await db
    .from("everything_youtube_channels")
    .update({ notified_at: new Date().toISOString() })
    .eq("channel_id", channelId);
  // A failed write answers with an error, so the hub retries the delivery.
  if (error) return new Response(error.message, { status: 500 });
  return new Response(null, { status: 204 });
}

Deno.serve((request) => {
  if (request.method === "GET") return confirmSubscription(new URL(request.url));
  if (request.method === "POST") return recordNotification(request);
  return new Response("method not allowed", { status: 405 });
});
