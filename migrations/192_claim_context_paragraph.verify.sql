-- Checks for migration 192. Run it after the migration. It changes nothing.
-- Every value should be true.
select
  everything_context_paragraph(E'First.\n\nSecond has The Passage here, ok.\n\nThird.', 'The Passage here')
    = 'Second has The Passage here, ok.' as finds_the_paragraph,
  everything_context_paragraph(E'First has the words.\n\nB', 'the words') = 'First has the words.'
    and everything_context_paragraph(E'A\n\nLast has the words.', 'the words') = 'Last has the words.' as finds_the_first_and_the_last_paragraph,
  everything_context_paragraph(E'A.\n\nThis paragraph holds the first forty characters of the passage[1] and more.\n\nC',
                               'this paragraph holds the first forty characters of the passage and more.')
    = 'This paragraph holds the first forty characters of the passage[1] and more.' as falls_back_to_the_opening_words_in_any_case,
  everything_context_paragraph(E'First.\r\n\r\nSecond has The Passage here, ok.\r\n\r\nThird.', 'The Passage here')
    = 'Second has The Passage here, ok.' as reads_windows_line_ends,
  everything_context_paragraph(E'A.\n\nStart of it, one.\n\nTwo, end of it. More.\n\nC', E'one.\n\nTwo, end of it.')
    = E'Start of it, one.\n\nTwo, end of it. More.' as keeps_every_paragraph_a_passage_spans,
  (select position('NEEDLE passage text' in x) > 0 and position('needle passage text' in x) = 0
     from (select everything_context_paragraph('  needle passage text ' || repeat('word ', 1000) || 'NEEDLE passage text ' || repeat('tail ', 1000), 'NEEDLE passage text') as x) s)
    as long_paragraph_is_cut_around_the_passage_itself,
  everything_context_paragraph('abc def', 'not in there at all') is null as none_for_a_passage_not_in_the_post,
  everything_context_paragraph(null, 'abc def') is null as none_for_a_post_without_text,
  everything_context_paragraph(E'A.\n\n The Whole paragraph. \n\nC', 'The Whole paragraph.') is null as none_when_the_passage_is_the_paragraph,
  (select length(x) between 1400 and 1600 and x like '… word %' and x like '% tail …' and position('NEEDLE passage text' in x) > 0
     from (select everything_context_paragraph(repeat('word ', 1000) || 'NEEDLE passage text ' || repeat('tail ', 1000), 'NEEDLE passage text') as x) s)
    as long_paragraph_is_cut_around_the_passage,
  exists (select 1 from pg_trigger where tgrelid = 'everything_claims'::regclass and tgname = 'everything_claims_context_paragraph') as trigger_is_on_claims,
  not has_function_privilege('anon', 'everything_context_paragraph(text, text)', 'execute') as anon_cannot_call,
  -- The newest notes have a paragraph wherever their post has one to give.
  (select count(*) filter (where c.context_paragraph is not null) > 0
     from (select claim_id from everything_notes order by created_at desc limit 50) n join everything_claims c on c.id = n.claim_id)
    as newest_notes_have_paragraphs;
