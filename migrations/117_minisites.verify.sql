-- Checks for migration 117. Run it after the migration, against the schema-only
-- fixture described in README_114.md (tables everything_projects,
-- everything_items). The block ends by raising an error that carries every
-- result, so whatever it created is always rolled back. Every value in the
-- result should be true.
do $$
declare
  admin_user uuid := gen_random_uuid();
  reader_user uuid := gen_random_uuid();
  anon_user uuid := gen_random_uuid();
  v_job uuid;
  v_job2 uuid;
  v_site uuid;
  v_item uuid;
  v_existing uuid;
  r jsonb := '{}';
  refused boolean;
  n int;
  slug_back text;
begin
  insert into auth.users (id, email, is_anonymous) values
    (admin_user, 'jimmaar1@gmail.com', false), (reader_user, 'someone@example.com', false), (anon_user, null, true);
  insert into everything_projects (slug, name) values ('web', 'Around the web') on conflict do nothing;
  insert into everything_items (project_id, source, url, title, status, full_text, checked_scope)
    values ((select id from everything_projects where slug = 'web'), 'web', 'https://example.com/known', 'Known', 'done', 'old text', 'page')
    returning id into v_existing;

  -- 1. Who is an admin.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_user, 'role', 'authenticated', 'email', 'JimMaar1@gmail.com')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('admin_by_email_any_case', everything_is_admin());
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', reader_user, 'role', 'authenticated', 'email', 'someone@example.com')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('reader_is_not_admin', not everything_is_admin());
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', anon_user, 'role', 'authenticated', 'is_anonymous', true, 'email', 'jimmaar1@gmail.com')::text, true);
  set local role authenticated;
  r := r || jsonb_build_object('anonymous_never_admin', not everything_is_admin());
  refused := false;
  begin perform 1 from everything_admins; exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('admin_table_hidden', refused);
  reset role;

  -- 2. A reader cannot write a job or create a minisite.
  perform set_config('request.jwt.claims', json_build_object('sub', reader_user, 'role', 'authenticated', 'email', 'someone@example.com')::text, true);
  set local role authenticated;
  refused := false;
  begin insert into everything_minisite_jobs (kind, url) values ('read_page', 'https://example.com/x');
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('reader_cannot_write_job', refused);
  reset role;

  -- 3. An admin writes a read_page job the way the website does.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_user, 'role', 'authenticated', 'email', 'jimmaar1@gmail.com')::text, true);
  set local role authenticated;
  insert into everything_minisite_jobs (kind, url) values ('read_page', 'https://example.com/new-post') returning id into v_job;
  select count(*) into n from everything_minisite_jobs where id = v_job;
  r := r || jsonb_build_object('admin_reads_own_job', n = 1);
  refused := false;
  begin insert into everything_minisite_jobs (kind, minisite_id) values ('fact_check', null);
  exception when insufficient_privilege or check_violation then refused := true; end;
  r := r || jsonb_build_object('admin_cannot_write_fact_check_job_directly', refused);
  refused := false;
  begin perform everything_create_minisite(v_job, 'too-early', 'T', '', '{}');
  exception when check_violation then refused := true; end;
  r := r || jsonb_build_object('create_needs_finished_job', refused);
  reset role;

  -- The intake service (service role) writes the result.
  update everything_minisite_jobs set status = 'done', result = jsonb_build_object(
    'title', 'New post', 'description', 'A summary', 'byline', 'A Writer · example.com', 'published_at', '2026-10-01T00:00:00Z',
    'image_url', 'https://example.com/cover.png', 'content', 'Hello [world](https://example.com).', 'plain_text', 'Hello world.')
  where id = v_job;
  insert into everything_minisite_jobs (kind, url, requested_by, status, result) values ('read_page', 'https://example.com/known/', admin_user, 'done',
    jsonb_build_object('title', 'Known', 'content', 'Rich known text', 'plain_text', 'new plain text')) returning id into v_job2;

  -- 4. An admin creates minisites: one for a new page, one for a known page.
  set local role authenticated;
  slug_back := everything_create_minisite(v_job, 'new-post', 'New post', 'A summary', array['notes', 'highlight']);
  select m.id, m.item_id into v_site, v_item from everything_minisites m where m.slug = 'new-post';
  r := r || jsonb_build_object('create_returns_slug', slug_back = 'new-post');
  reset role;
  select count(*) into n from everything_items where id = v_item and status = 'done' and checked_scope is null and full_text = 'Hello world.' and source = 'web';
  r := r || jsonb_build_object('new_item_is_unchecked_with_plain_text', n = 1);
  set local role authenticated;
  perform everything_create_minisite(v_job2, 'known', 'Known', '', '{}');
  reset role;
  select count(*) into n from everything_minisites where slug = 'known' and item_id = v_existing and content = 'Rich known text';
  r := r || jsonb_build_object('known_item_reused', n = 1);
  select count(*) into n from everything_items where id = v_existing and full_text = 'old text';
  r := r || jsonb_build_object('known_item_text_untouched', n = 1);

  set local role authenticated;
  refused := false;
  begin perform everything_create_minisite(v_job, 'new', 'x', '', '{}');
  exception when check_violation then refused := true; end;
  r := r || jsonb_build_object('slug_new_reserved', refused);
  -- An admin edits features; a reader cannot.
  update everything_minisites set features = array['notes'] where id = v_site;
  reset role;
  select count(*) into n from everything_minisites where id = v_site and features = array['notes'];
  r := r || jsonb_build_object('admin_edits_features', n = 1);

  perform set_config('request.jwt.claims', json_build_object('sub', reader_user, 'role', 'authenticated', 'email', 'someone@example.com')::text, true);
  set local role authenticated;
  update everything_minisites set features = '{}' where id = v_site;
  refused := false;
  begin perform everything_create_minisite(v_job, 'sneaky', 'x', '', '{}');
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('reader_cannot_create', refused);
  refused := false;
  begin perform everything_start_minisite_check(v_site);
  exception when insufficient_privilege then refused := true; end;
  r := r || jsonb_build_object('reader_cannot_start_check', refused);
  reset role;
  select count(*) into n from everything_minisites where id = v_site and features = array['notes'];
  r := r || jsonb_build_object('reader_update_ignored', n = 1);

  -- 5. Anyone can read minisites.
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  select count(*) into n from everything_minisites where slug in ('new-post', 'known');
  r := r || jsonb_build_object('anon_reads_minisites', n = 2);
  reset role;

  -- 6. The fact-check queues the new item and keeps its text.
  perform set_config('request.jwt.claims', json_build_object('sub', admin_user, 'role', 'authenticated', 'email', 'jimmaar1@gmail.com')::text, true);
  set local role authenticated;
  perform everything_start_minisite_check(v_site);
  reset role;
  select count(*) into n from everything_items where id = v_item and status = 'queued' and priority = 2 and checked_scope = 'page' and full_text = 'Hello world.';
  r := r || jsonb_build_object('check_queues_item_keeping_text', n = 1);
  select count(*) into n from everything_minisite_jobs where kind = 'fact_check' and minisite_id = v_site and status = 'pending';
  r := r || jsonb_build_object('check_writes_wake_job', n = 1);
  set local role authenticated;
  refused := false;
  begin perform everything_start_minisite_check((select id from everything_minisites where slug = 'known'));
  exception when check_violation then refused := true; end;
  r := r || jsonb_build_object('checked_article_refused', refused);
  reset role;

  raise exception 'RESULT %', r;
end $$;
