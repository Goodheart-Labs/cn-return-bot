/**
 * Mints the scoped API key the writing-limit probe runs on.
 *
 * Supabase authorizes a Data API request by the `role` claim in its JWT, so a
 * key scoped to the probe_writer role (migration 082) is just a JWT carrying
 * that claim, signed with the project's JWT secret. There is no dashboard
 * button for this: keys created there authorize through service_role and
 * bypass RLS, which is the thing we are trying not to hand a CI job.
 *
 * The JWT secret is the most dangerous credential in the project -- it can mint
 * a token for ANY role, service_role included. So this script takes it from the
 * environment and never writes it anywhere, and by default pipes the minted
 * token straight into the GitHub secret rather than printing it.
 *
 *   SUPABASE_JWT_SECRET=... bun run src/scripts/mintProbeKey.ts          # sets the repo secret
 *   SUPABASE_JWT_SECRET=... bun run src/scripts/mintProbeKey.ts --print  # prints instead (avoid)
 *
 * Get the secret from: Supabase dashboard -> Settings -> API -> JWT Secret.
 * Rotating it invalidates every legacy key including service_role, so copy it,
 * run this, and close the tab.
 */

import { createHmac } from "node:crypto";

const secret = process.env.SUPABASE_JWT_SECRET;
if (!secret) {
  console.error("SUPABASE_JWT_SECRET is not set. Settings -> API -> JWT Secret.");
  process.exit(1);
}

const ROLE = "probe_writer";
const YEARS = 5;

const b64url = (input: string | Buffer): string =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const now = Math.floor(Date.now() / 1000);
const header = { alg: "HS256", typ: "JWT" };
const payload = {
  role: ROLE,
  iss: "supabase",
  iat: now,
  exp: now + YEARS * 365 * 24 * 60 * 60,
};

const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
const signature = b64url(createHmac("sha256", secret).update(signingInput).digest());
const token = `${signingInput}.${signature}`;

const expiry = new Date(payload.exp * 1000).toISOString().slice(0, 10);
console.log(`Minted a ${ROLE} key, expires ${expiry}.`);

if (process.argv.includes("--print")) {
  console.log("");
  console.log(token);
  console.log("");
  console.log("Set it as the SUPABASE_PROBE_KEY repo secret. Do not commit it.");
} else {
  // `gh secret set` reads from stdin and encrypts client-side, so the token
  // never appears in the terminal, in shell history, or in a file.
  const proc = Bun.spawn(
    ["gh", "secret", "set", "SUPABASE_PROBE_KEY", "--repo", "Goodheart-Labs/cn-return-bot"],
    { stdin: new TextEncoder().encode(token), stdout: "inherit", stderr: "inherit" },
  );
  const code = await proc.exited;
  if (code !== 0) {
    console.error("");
    console.error("Could not set the secret (is gh authenticated with repo admin?).");
    console.error("Re-run with --print to get the token and paste it in by hand.");
    process.exit(code);
  }
  console.log("Set as the SUPABASE_PROBE_KEY repo secret. The token was never printed.");
}
