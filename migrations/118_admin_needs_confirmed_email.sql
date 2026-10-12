-- An admin's email must be confirmed (GOO-374).
--
-- Migration 117 read the caller's email from the sign-in token. That is only
-- safe while Supabase refuses unconfirmed addresses, which depends on two
-- dashboard settings ("Confirm email" and "Secure email change"). If either
-- were switched off, anyone could sign up with an admin's address. The check
-- now reads the account itself and counts the address only once its owner
-- confirmed it, whatever those settings say.

create or replace function everything_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from auth.users u
    join everything_admins a on a.email = lower(u.email)
    where u.id = auth.uid()
      and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous, false) = false
  );
$$;

revoke execute on function everything_is_admin() from public;
grant execute on function everything_is_admin() to anon, authenticated, service_role;
