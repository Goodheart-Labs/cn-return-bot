-- Checks for migration 118, run after 117 and 118 against the fixture in
-- README_114.md with `alter table auth.users add column email_confirmed_at
-- timestamptz;` (the fixture's auth.users stand-in leaves it out). The block
-- ends by raising an error that carries every result, so nothing it wrote
-- stays. Every value should be true.
do $$
declare
  confirmed uuid := gen_random_uuid();
  unconfirmed uuid := gen_random_uuid();
  r jsonb := '{}';
begin
  insert into auth.users (id, email, is_anonymous, email_confirmed_at) values
    (confirmed, 'JimMaar1@gmail.com', false, now()),
    (unconfirmed, 'nathanpmyoung@gmail.com', false, null);

  -- The token's email claim no longer matters: only the account counts.
  perform set_config('request.jwt.claims', json_build_object('sub', confirmed, 'role', 'authenticated', 'email', 'someone@example.com')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('confirmed_admin_is_admin', everything_is_admin());
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', unconfirmed, 'role', 'authenticated', 'email', 'nathanpmyoung@gmail.com')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('unconfirmed_admin_email_is_not_admin', not everything_is_admin());
  reset role;

  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  r := r || jsonb_build_object('anon_is_not_admin', not everything_is_admin());
  reset role;

  raise exception 'RESULT %', r;
end $$;
