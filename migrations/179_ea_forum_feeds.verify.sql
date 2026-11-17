-- Checks for migration 179. Run it after the migration, inside a transaction
-- that must not commit. The block ends by raising an error that carries every
-- result, so whatever it created is always rolled back.
do $$
declare
  lesswrong_author uuid;
  ea_author uuid;
  ea_again uuid;
  ea_row everything_projects%rowtype;
  www_refused boolean := false;
begin
  insert into everything_projects (slug, name, feed_url)
  values ('goo745probe', 'A LessWrong author', 'https://www.lesswrong.com/users/goo745probe')
  returning id into lesswrong_author;

  set local role authenticated;
  ea_author := everything_creator_project('https://forum.effectivealtruism.org/users/GOO745probe/');
  ea_again := everything_creator_project('https://forum.effectivealtruism.org/users/goo745probe');
  begin
    perform everything_creator_project('https://www.forum.effectivealtruism.org/users/goo745probe');
  exception when check_violation then
    www_refused := true;
  end;
  reset role;

  select * into ea_row from everything_projects where id = ea_author;
  raise exception 'RESULT %', json_build_object(
    'ea_slug', everything_feed_slug('https://forum.effectivealtruism.org/users/toby-tremlett'),
    'lesswrong_slug_unchanged', everything_feed_slug('https://www.lesswrong.com/users/zvi'),
    'alignment_forum_slug_unchanged', everything_feed_slug('https://www.alignmentforum.org/users/zvi'),
    'ea_post_is_no_feed', everything_feed_slug('https://forum.effectivealtruism.org/posts/abc/title') is null,
    'ea_is_its_own_creator', ea_author <> lesswrong_author,
    'ea_slug_given_way', ea_row.slug,
    'ea_feed_stored', ea_row.feed_url,
    'same_ea_author_twice_one_project', ea_author = ea_again,
    'www_variant_refused', www_refused
  );
end
$$;
