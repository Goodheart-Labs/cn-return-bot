-- A least-privilege role for the writing-limit probe.
--
-- The probe previously ran on SUPABASE_SERVICE_KEY, which maps to service_role
-- and carries bypassrls: full read/write on every table in the database. What
-- the probe actually needs is three things -- count recent rows in notes, read
-- three keys from pipeline_state, append one row to its own table. Handing a
-- daily CI job the keys to everything (including everything_donations and user
-- auth data) to do that is not proportionate, so this narrows it.
--
-- Note that a new secret key from the Supabase dashboard would NOT achieve
-- this: sb_secret_* keys authorize through service_role and bypass RLS the
-- same way. A genuinely scoped credential has to be a JWT carrying a custom
-- role claim, signed with the project's JWT secret. See scripts/mintProbeKey.ts.
--
-- RLS is enabled on every table in public (migration 050), so a non-superuser
-- role needs BOTH table grants and matching policies. Both are below.

create role probe_writer nologin;
grant usage on schema public to probe_writer;

-- PostgREST authenticates as `authenticator` and then SET ROLEs to the role in
-- the JWT's `role` claim. Without this grant the switch fails and every request
-- 500s, which is a confusing way to find out.
grant probe_writer to authenticator;

-- Reads, scoped to columns. The probe filters notes on submitted_at and reads
-- key/value from pipeline_state; it never needs note text, authors or statuses.
grant select (submitted_at) on public.notes          to probe_writer;
grant select (key, value)   on public.pipeline_state to probe_writer;

-- Write: append only. Deliberately no select -- the probe writes readings and
-- never reads them back, so a leaked key cannot even enumerate our cap history.
grant insert on public.writing_limit_probe_readings to probe_writer;
grant usage, select on sequence public.writing_limit_probe_readings_id_seq to probe_writer;

create policy probe_reads_notes on public.notes
  for select to probe_writer using (true);

create policy probe_reads_state on public.pipeline_state
  for select to probe_writer using (true);

create policy probe_appends on public.writing_limit_probe_readings
  for insert to probe_writer with check (true);

-- Blast radius if this key leaks: someone learns the timestamps of notes we
-- submitted, reads three pipeline_state keys, and can append junk telemetry.
-- They cannot read note contents, user data, votes, or the donation ledger.
