-- Every reservation by our own notewriters since 2026-11-14: the real checking capacity.
select r.item_id, w.name as notewriter, r.requested, r.outcome,
       r.started_at, r.ended_at
  from everything_reservations r join everything_notewriters w on w.id = r.notewriter_id
 where not w.outside and r.started_at >= '2026-11-14'
 order by r.started_at;
