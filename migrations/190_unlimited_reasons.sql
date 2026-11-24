-- Skip reasons and failure reasons have no length limit any more (Jim,
-- 2026-11-19). Migration 184 capped both at 500 characters. A skip reason is
-- the notewriter's own words, and Claude's skip reasons were already up to
-- 455 characters. A failure reason can be an error message. A reason over the
-- cap made the finish or fail call answer 400, and on the ai-box runner that
-- crashed the whole runner. The 10 KB cap on a finish summary stays.

alter table everything_reservations drop constraint everything_reservations_reason_check;

create or replace function everything_finish_reservation(r everything_reservations, p_summary jsonb, p_skip_reason text) returns jsonb
language plpgsql set search_path = public as $$
declare
  w everything_notewriters;
  v_answered int := 0;
  v_later timestamptz;
begin
  if pg_column_size(p_summary) > 10240 then raise exception 'A summary has at most 10 KB' using errcode = 'PT400'; end if;
  select * into w from everything_notewriters where id = r.notewriter_id;
  update everything_reservations
     set ended_at = now(), outcome = case when p_skip_reason is null then 'done' else 'skipped' end,
         reason = p_skip_reason, summary = p_summary
   where id = r.id;
  if w.outside then return jsonb_build_object('answered', 0, 'post', 'done'); end if;
  update everything_note_requests q
     set status = 'done',
         status_reason = case when exists (
           select 1 from everything_claims c join everything_notes n on n.claim_id = c.id
            where c.item_id = r.item_id and n.created_at >= r.started_at
              and everything_passages_overlap(coalesce(c.context_quote, c.claim), q.selection))
           then 'the selected passage got a note' else 'the selected passage needs no note' end
   where q.item_id = r.item_id and q.status = 'enqueued' and q.status_reason = 'checking the selected passage'
     and q.selection is not null and q.created_at <= r.started_at;
  get diagnostics v_answered = row_count;
  select min(q.created_at) into v_later from everything_note_requests q
   where q.item_id = r.item_id and q.status = 'enqueued' and q.status_reason = 'checking the selected passage'
     and q.selection is not null;
  update everything_items
     set status = case when v_later is null then 'done' else 'queued' end,
         requested_since = v_later,
         error = null, progress = null, skip_reason = p_skip_reason, processed_at = now()
   where id = r.item_id;
  return jsonb_build_object('answered', v_answered, 'post', case when v_later is null then 'done' else 'back_in_queue' end);
end;
$$;

create or replace function everything_fail_reservation(r everything_reservations, p_outcome text, p_reason text) returns jsonb
language plpgsql set search_path = public as $$
declare
  i everything_items;
begin
  update everything_reservations set ended_at = now(), outcome = p_outcome, reason = p_reason where id = r.id;
  update everything_items set status = 'queued', progress = null where id = r.item_id and status = 'processing';
  select * into i from everything_items where id = r.item_id for update;
  if i.requested_since is not null and not exists (
       select 1 from everything_notewriters w
        where w.takes_reader_requests and not w.outside and w.disabled_at is null
          and not exists (select 1 from everything_reservations f
                           where f.item_id = i.id and f.notewriter_id = w.id and f.outcome in ('failed', 'expired')
                             and f.started_at >= i.requested_since)) then
    update everything_items
       set status = 'error', error = 'Every notewriter that takes reader requests failed on it. The last failure: ' || p_reason,
           requested_since = null, progress = null, processed_at = now()
     where id = i.id;
    return jsonb_build_object('post', 'failed');
  end if;
  return jsonb_build_object('post', 'back_in_queue');
end;
$$;

create or replace function notewriter_api_fail(p_reservation uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  w everything_notewriters := everything_notewriter_from_key();
  r everything_reservations;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A failure needs its reason' using errcode = 'PT400';
  end if;
  r := everything_open_reservation(p_reservation, w.id);
  perform everything_fail_reservation(r, 'failed', p_reason);
  return '{}'::jsonb;
end;
$$;

notify pgrst, 'reload schema';
