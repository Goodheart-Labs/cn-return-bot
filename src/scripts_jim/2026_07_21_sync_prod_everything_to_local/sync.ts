// Sync prod everything_* data → local Supabase so the rating leaderboard can be
// tested locally with real data. Copies the six tables that exist on prod
// (projects, items, claims, notes, note_sources, votes) plus the auth.users
// rows they reference (votes.voter_id / notes.author_id / claims.created_by —
// the FKs and the leaderboard RPC's name join need them). Local everything_*
// data is replaced; local-only tables from 058-061 (comments, donations) are
// cascade-cleared. Run from the repo root: bun run src/scripts_jim/2026_07_21_sync_prod_everything_to_local/sync.ts

import { SQL } from "bun";

const PROD_URL = process.env.SUPABASE_URL!;
const PROD_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_SERVICE_KEY = process.env.LOCAL_SUPABASE_SERVICE_KEY!;
if (!PROD_URL || !PROD_SERVICE_KEY || !LOCAL_SERVICE_KEY) throw new Error("missing env");

const sql = new SQL("postgres://postgres:postgres@127.0.0.1:54322/postgres");

const FETCH_PAGE_SIZE = 1000;
const INSERT_CHUNK_SIZE = 200; // items carry large full_text blobs; keep requests modest

// Insert order respects FKs: parents before children.
const TABLES = [
  "everything_projects",
  "everything_items",
  "everything_claims",
  "everything_notes",
  "everything_note_sources",
  "everything_votes",
] as const;

function prodHeaders() {
  return { apikey: PROD_SERVICE_KEY, Authorization: `Bearer ${PROD_SERVICE_KEY}` };
}

async function fetchAllRows(table: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += FETCH_PAGE_SIZE) {
    // Order by a unique column — created_at collides across batch-inserted rows,
    // which makes Range pagination overlap. Votes have no id; their composite
    // PK's first column is unique enough per page window when paired with voter.
    const orderCol = table === "everything_votes" ? "note_id.asc,voter_id.asc" : "id.asc";
    const res = await fetch(`${PROD_URL}/rest/v1/${table}?select=*&order=${orderCol}`, {
      headers: { ...prodHeaders(), Range: `${from}-${from + FETCH_PAGE_SIZE - 1}` },
    });
    if (!res.ok) throw new Error(`fetch ${table}: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < FETCH_PAGE_SIZE) return rows;
  }
}

async function insertLocalRows(table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + INSERT_CHUNK_SIZE);
    const res = await fetch(`${LOCAL_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: {
        apikey: LOCAL_SERVICE_KEY,
        Authorization: `Bearer ${LOCAL_SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`insert ${table} rows ${i}-${i + chunk.length}: ${res.status} ${await res.text()}`);
  }
}

// GoTrue admin API: the only way to read prod auth.users with the service key.
type AdminUser = {
  id: string;
  aud: string | null;
  role: string | null;
  email: string | null;
  email_confirmed_at: string | null;
  created_at: string;
  updated_at: string;
  app_metadata: Record<string, unknown> | null;
  user_metadata: Record<string, unknown> | null;
  identities: {
    id: string;
    provider: string;
    identity_data: Record<string, unknown> | null;
    created_at?: string;
    updated_at?: string;
  }[] | null;
};

async function fetchProdAuthUsers(): Promise<AdminUser[]> {
  const users: AdminUser[] = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${PROD_URL}/auth/v1/admin/users?page=${page}&per_page=${FETCH_PAGE_SIZE}`, {
      headers: prodHeaders(),
    });
    if (!res.ok) throw new Error(`fetch auth users: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { users: AdminUser[] };
    users.push(...body.users);
    if (body.users.length < FETCH_PAGE_SIZE) return users;
  }
}

// Mirror one prod user into local auth.users (+ identities). An existing local
// account with the same email but a different id is replaced — GoTrue matches
// logins by email, so keeping both would break magic-link sign-in.
async function upsertLocalAuthUser(u: AdminUser): Promise<void> {
  if (u.email) {
    await sql`delete from auth.users where lower(email) = lower(${u.email}) and id <> ${u.id}::uuid`;
  }
  await sql`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', ${u.id}::uuid,
      ${u.aud ?? "authenticated"}, ${u.role ?? "authenticated"}, ${u.email}, '',
      -- ::text::jsonb, not ::jsonb: with a jsonb-typed parameter Bun.sql encodes
      -- the JS string as a jsonb *string* (double-encoding); going through text
      -- makes Postgres parse it into an object. GoTrue crashes on string-typed
      -- metadata ("cannot unmarshal string into models.JSONMap").
      ${u.email_confirmed_at}, ${JSON.stringify(u.app_metadata ?? {})}::text::jsonb,
      ${JSON.stringify(u.user_metadata ?? {})}::text::jsonb, ${u.created_at}, ${u.updated_at},
      false, '', '', '', '', '', '', '', ''
    )
    on conflict (id) do update set
      email = excluded.email,
      raw_app_meta_data = excluded.raw_app_meta_data,
      raw_user_meta_data = excluded.raw_user_meta_data,
      updated_at = excluded.updated_at,
      -- GoTrue crashes ("Database error finding user") scanning NULL token
      -- columns; pre-existing local rows may carry NULLs, so normalize them.
      confirmation_token = coalesce(auth.users.confirmation_token, ''),
      recovery_token = coalesce(auth.users.recovery_token, ''),
      email_change = coalesce(auth.users.email_change, ''),
      email_change_token_new = coalesce(auth.users.email_change_token_new, ''),
      email_change_token_current = coalesce(auth.users.email_change_token_current, ''),
      phone_change = coalesce(auth.users.phone_change, ''),
      phone_change_token = coalesce(auth.users.phone_change_token, ''),
      reauthentication_token = coalesce(auth.users.reauthentication_token, '')
  `;
  for (const ident of u.identities ?? []) {
    const providerId = (ident.identity_data?.sub as string | undefined) ?? ident.id ?? u.id;
    await sql`
      insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
      values (${providerId}, ${u.id}::uuid, ${JSON.stringify(ident.identity_data ?? { sub: u.id, email: u.email })}::text::jsonb,
              ${ident.provider}, ${ident.created_at ?? u.created_at}, ${ident.updated_at ?? u.updated_at}, ${u.created_at})
      on conflict (provider_id, provider) do nothing
    `;
  }
}

console.log("Fetching prod data…");
const data = new Map<string, Record<string, unknown>[]>();
for (const table of TABLES) {
  data.set(table, await fetchAllRows(table));
  console.log(`  ${table}: ${data.get(table)!.length} rows`);
}

const referencedUserIds = new Set<string>();
for (const vote of data.get("everything_votes")!) referencedUserIds.add(vote.voter_id as string);
for (const note of data.get("everything_notes")!) if (note.author_id) referencedUserIds.add(note.author_id as string);
for (const claim of data.get("everything_claims")!) if (claim.created_by) referencedUserIds.add(claim.created_by as string);

const authUsers = (await fetchProdAuthUsers()).filter((u) => referencedUserIds.has(u.id));
console.log(`Auth users referenced: ${referencedUserIds.size}, fetched: ${authUsers.length}`);
const missing = [...referencedUserIds].filter((id) => !authUsers.some((u) => u.id === id));
if (missing.length > 0) throw new Error(`prod auth users not found for ids: ${missing.join(", ")}`);

console.log("Clearing local everything_* data…");
// Cascades into the local-only 058-061 tables (comments, comment votes, donations).
await sql`truncate everything_projects, everything_items, everything_claims,
          everything_notes, everything_note_sources, everything_votes cascade`;
await sql`delete from everything_rater_prefs`;

console.log("Mirroring auth users…");
for (const u of authUsers) await upsertLocalAuthUser(u);

console.log("Inserting data…");
// Two triggers would corrupt a verbatim copy: the vote counter would re-apply
// every vote on top of the copied helpful/not_helpful counts, and the author
// self-upvote (058_note_improved_from) would mint fresh votes on note insert
// that collide with the real prod vote rows. Disable both for the import.
await sql`alter table everything_votes disable trigger user`;
await sql`alter table everything_notes disable trigger user`;
try {
  for (const table of TABLES) {
    await insertLocalRows(table, data.get(table)!);
    console.log(`  ${table}: inserted ${data.get(table)!.length}`);
  }
} finally {
  await sql`alter table everything_votes enable trigger user`;
  await sql`alter table everything_notes enable trigger user`;
}

console.log("\nVerification:");
for (const table of TABLES) {
  const [{ count }] = await sql`select count(*)::int as count from ${sql(table)}`;
  console.log(`  ${table}: ${count} rows locally`);
}
console.log("\neverything_leaderboard():");
for (const row of await sql`select * from everything_leaderboard()`) {
  console.log(`  ${row.rating_count}  ${row.name}`);
}
await sql.end();
