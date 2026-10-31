-- Migration 161: the Safari waitlist (GOO-677).
--
-- The homepage's install section has a Safari tab, and the Safari version of
-- the extension is not out yet. A visitor can leave an email address there.
-- When the Safari version is out, Jim writes one email to every address on the
-- list. `bun run safari-waitlist` prints the list with the service key.
--
-- The addresses are personal data, so the public key can neither read nor
-- list them. The table has row level security and no policy, so only the
-- service key reaches it. Visitors add an address only through
-- everything_join_safari_waitlist, which checks the address first.

create table everything_safari_waitlist (
  id bigint generated always as identity primary key,
  email text not null,
  created_at timestamptz not null default now()
);

-- One row per address, whatever its capitals. A second sign-up with the same
-- address changes nothing, and the visitor is not told that it was already on
-- the list.
create unique index everything_safari_waitlist_email on everything_safari_waitlist (lower(email));

-- The hourly cap below counts the latest rows.
create index everything_safari_waitlist_created_at on everything_safari_waitlist (created_at);

alter table everything_safari_waitlist enable row level security;
revoke all on table everything_safari_waitlist from anon, authenticated;
grant all on everything_safari_waitlist to service_role;

-- Adds an address to the waitlist. An address must have the shape
-- name@domain.tld and at most 254 characters, the longest address email
-- allows. Anyone may call this with the public key, so a script could flood
-- the list with made-up addresses. Mail to such addresses bounces, and many
-- bounces make email services treat the sender as a spammer. So the function
-- refuses new sign-ups once 300 arrived within the last hour, far more than
-- the site has ever seen.
create function everything_join_safari_waitlist(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  max_email_length constant int := 254;
  max_signups_per_hour constant int := 300;
  v_email text := btrim(p_email);
begin
  if v_email is null
     or length(v_email) > max_email_length
     or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Not an email address' using errcode = '22023';
  end if;
  if (select count(*) from everything_safari_waitlist where created_at > now() - interval '1 hour') >= max_signups_per_hour then
    raise exception 'Too many sign-ups in the last hour';
  end if;
  insert into everything_safari_waitlist (email) values (v_email)
  on conflict ((lower(email))) do nothing;
end;
$$;

revoke all on function everything_join_safari_waitlist(text) from public, anon, authenticated;
grant execute on function everything_join_safari_waitlist(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
