# /// script
# dependencies = []
# ///
"""Writes a schema-only copy of production tables, for testing a migration in a
throwaway Postgres before it touches production.

    uv run scripts/schema_fixture.py <out.sql> <table> [<table> ...]

The copy holds each table's columns, constraints, indexes, row level security
policies, grants to anon, authenticated and service_role, and triggers. It also
holds every public function whose name starts with everything_, with its
execute grants. It holds no rows. Supabase's auth schema is replaced by a small
stand-in: auth.users, auth.identities, and auth.uid(), auth.role() and
auth.jwt(), which read the request's claims the way Supabase's do. A test sets
the claims with set_config('request.jwt.claims', ...).

Foreign keys to tables outside the list are left out, so a test only has to
create the rows it needs.

It reads production through Supabase's management API, authenticated with the
CLI's access token (`supabase login`). Every query is sent read-only.
"""
import json, sys, time, urllib.error, urllib.request
from pathlib import Path

PROJECT_REF = "ugytvkevhsmcpunfvncw"
PUBLIC_ROLES = ("anon", "authenticated", "service_role")

AUTH_STAND_IN = """
do $$ begin
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;
grant anon, authenticated, service_role to postgres;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, is_anonymous boolean default false);
create table auth.identities (user_id uuid references auth.users(id), provider text, identity_data jsonb);
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                         nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')::uuid $f$;
create function auth.role() returns text language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') $f$;
create function auth.jwt() returns jsonb language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim', true), ''),
                  nullif(current_setting('request.jwt.claims', true), ''))::jsonb $f$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
"""


RATE_LIMIT_WAITS_SECONDS = (5, 15, 45)


def query(sql: str) -> list[dict]:
    token = Path.home().joinpath(".supabase/access-token").read_text().strip()
    request = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql, "read_only": True}).encode(),
        # Cloudflare in front of the API refuses Python's default user agent.
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "curl/8.5.0"},
    )
    for wait in (*RATE_LIMIT_WAITS_SECONDS, None):
        try:
            return json.load(urllib.request.urlopen(request))
        except urllib.error.HTTPError as err:
            if err.code != 429 or wait is None:
                raise
            time.sleep(wait)
    raise AssertionError("unreachable")


def by_table(rows: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["tbl"], []).append(row)
    return grouped


def functions() -> list[str]:
    return [r["d"] + ";" for r in query("""
        select pg_get_functiondef(p.oid) d from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname like 'everything\\_%'
         order by p.proname""")]


def tables(names: list[str]) -> list[str]:
    """One query per kind of object, for all tables at once, because the
    management API rate-limits bursts of small queries."""
    in_list = ", ".join(f"'public.{n}'::regclass" for n in names)
    name_list = ", ".join(f"'{n}'" for n in names)
    roles = ", ".join(f"'{r}'" for r in PUBLIC_ROLES)
    columns = by_table(query(f"""
        select a.attrelid::regclass::text tbl, a.attname, format_type(a.atttypid, a.atttypmod) type,
               pg_get_expr(d.adbin, d.adrelid) def, a.attnotnull not_null
          from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
         where a.attrelid in ({in_list}) and a.attnum > 0 and not a.attisdropped
         order by a.attrelid, a.attnum"""))
    constraints = by_table(query(f"""
        select conrelid::regclass::text tbl, conname, pg_get_constraintdef(oid) d, contype, confrelid::regclass::text ref
          from pg_constraint where conrelid in ({in_list}) order by contype desc"""))
    indexes = by_table(query(f"""
        select i.indrelid::regclass::text tbl, pg_get_indexdef(i.indexrelid) d from pg_index i
         where i.indrelid in ({in_list})
           and not exists (select 1 from pg_constraint c where c.conindid = i.indexrelid)"""))
    rls = {r["tbl"] for r in query(f"select oid::regclass::text tbl from pg_class where oid in ({in_list}) and relrowsecurity")}
    policies = by_table(query(f"""
        select tablename tbl, policyname, permissive, cmd, roles, qual, with_check from pg_policies
         where schemaname = 'public' and tablename in ({name_list})"""))
    table_grants = by_table(query(f"""
        select c.oid::regclass::text tbl, a.grantee::regrole::text grantee, a.privilege_type
          from pg_class c, aclexplode(c.relacl) a
         where c.oid in ({in_list}) and a.grantee::regrole::text in ({roles})"""))
    column_grants = by_table(query(f"""
        select att.attrelid::regclass::text tbl, att.attname, a.grantee::regrole::text grantee, a.privilege_type
          from pg_attribute att, aclexplode(att.attacl) a
         where att.attrelid in ({in_list}) and att.attacl is not null and a.grantee::regrole::text in ({roles})"""))
    triggers = by_table(query(f"""
        select tgrelid::regclass::text tbl, pg_get_triggerdef(oid) d from pg_trigger
         where tgrelid in ({in_list}) and not tgisinternal"""))

    out = []
    for name in names:
        lines = []
        for c in columns.get(name, []):
            line = f'  "{c["attname"]}" {c["type"]}'
            if c["def"]:
                line += f' default {c["def"]}'
            if c["not_null"]:
                line += " not null"
            lines.append(line)
        out.append(f"create table {name} (\n" + ",\n".join(lines) + "\n);")
    for name in names:
        for c in constraints.get(name, []):
            if c["contype"] == "f" and c["ref"] not in names and c["ref"] != "auth.users":
                continue
            out.append(f'alter table {name} add constraint "{c["conname"]}" {c["d"]};')
        out += [i["d"] + ";" for i in indexes.get(name, [])]
        if name in rls:
            out.append(f"alter table {name} enable row level security;")
        for p in policies.get(name, []):
            policy = f'create policy "{p["policyname"]}" on {name} as {p["permissive"]} for {p["cmd"]} to {p["roles"].strip("{}")}'
            if p["qual"]:
                policy += f' using ({p["qual"]})'
            if p["with_check"]:
                policy += f' with check ({p["with_check"]})'
            out.append(policy + ";")
        out += [f'grant {g["privilege_type"]} on {name} to {g["grantee"]};' for g in table_grants.get(name, [])]
        out += [f'grant {g["privilege_type"]} ("{g["attname"]}") on {name} to {g["grantee"]};' for g in column_grants.get(name, [])]
        out += [t["d"] + ";" for t in triggers.get(name, [])]
    return out


def function_grants() -> list[str]:
    """Postgres lets everyone execute a new function, so the copy revokes that
    and grants back exactly what production grants."""
    out = []
    rows = query("""
        select p.oid::regprocedure::text signature,
               coalesce(nullif(a.grantee::regrole::text, '-'), 'public') grantee
          from pg_proc p, aclexplode(p.proacl) a
         where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname like 'everything\\_%'
           and a.privilege_type = 'EXECUTE'""")
    for signature in sorted({r["signature"] for r in rows}):
        out.append(f"revoke all on function {signature} from public;")
    for r in rows:
        if r["grantee"] in PUBLIC_ROLES or r["grantee"] == "public":
            out.append(f'grant execute on function {r["signature"]} to {r["grantee"]};')
    return out


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out_path, table_names = sys.argv[1], sys.argv[2:]
    # Function bodies may name tables that are not created yet, or not at all.
    out = ["set check_function_bodies = off;", "set client_min_messages = warning;", AUTH_STAND_IN]
    out += functions()
    out += tables(table_names)
    out += function_grants()
    Path(out_path).write_text("\n".join(out) + "\n")
    print(f"wrote {out_path}")


if __name__ == "__main__":
    main()
