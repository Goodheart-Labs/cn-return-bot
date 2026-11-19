#!/usr/bin/env bash
# Calls the notewriter API through a real PostgREST 14.5, the version
# production runs, against the throwaway Postgres of migration 184's fixture
# (port 55484, see 184_notewriter_api.fixture.sql), and prints each HTTP
# status. Also races 20 reserves of one post, and v1 against v2.
#
#   bash src/scripts_jim/2026_11_19_notewriter_api_v2/http_test.sh
set -u
export PGPASSWORD=test
PSQL="psql -h 127.0.0.1 -p 55484 -U postgres -q -t -A -v ON_ERROR_STOP=1"
SECRET=a-jwt-secret-of-at-least-thirty-two-characters
BASE=http://localhost:55485/rpc
OUT=$(mktemp -d)

b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() {
  local header payload sig
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64)
  payload=$(printf '{"role":"%s"}' "$1" | b64)
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$SECRET" -binary | b64)
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}
SERVICE=$(jwt service_role)

$PSQL <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login password 'test' noinherit;
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;
SQL

sudo docker rm -f cn-postgrest-test-184 >/dev/null 2>&1
sudo docker run -d --rm --name cn-postgrest-test-184 --network host \
  -e PGRST_DB_URI="postgres://authenticator:test@127.0.0.1:55484/postgres" \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_DB_SCHEMAS=public -e PGRST_SERVER_PORT=55485 \
  -e PGRST_JWT_SECRET="$SECRET" -e PGRST_DB_POOL=30 postgrest/postgrest:v14.5 >/dev/null
until curl -s -o /dev/null http://localhost:55485/; do sleep 0.5; done

# Twenty of our own notewriters, one outside one, and a post in the list.
POST=00000000-0000-0000-0000-0000000003a1
$PSQL <<SQL >/dev/null
insert into everything_notewriters (id, name, owner) select 'racer-' || n, 'Racer ' || n, 'test' from generate_series(1, 20) n;
insert into everything_items (id, url, full_text, published_at) values
  ('$POST', 'https://race.example', 'The race post says the study had 40 participants in total.', current_date),
  ('00000000-0000-0000-0000-0000000003a2', 'https://race.example/2', 'The second race post says the bridge was built in 1850.', current_date);
SQL
for n in $(seq 1 20); do $PSQL -c "select notewriter_admin_new_key('racer-$n')" > "$OUT/key-$n"; done
DEVBOX=$($PSQL -c "select notewriter_admin_new_key('claude-devbox')")
OUTSIDE=$($PSQL -c "select notewriter_admin_create('jackson-hurley', 'Jackson', 'Jackson', 'j@example.com')")

call() { # label, function, body, [notewriter key], [bearer]
  local args=(-s -o "$OUT/body.json" -w '%{http_code}' "$BASE/$2" -H "Content-Type: application/json" -d "$3")
  [ -n "${4:-}" ] && args+=(-H "X-Notewriter-Key: $4")
  [ -n "${5:-}" ] && args+=(-H "Authorization: Bearer $5")
  local code; code=$(curl "${args[@]}")
  printf '%-48s %s  %s\n' "$1" "$code" "$(head -c 160 "$OUT/body.json")"
}

echo "── statuses"
call "me, no key" notewriter_api_me '{}'
call "me, wrong key" notewriter_api_me '{}' cnw_wrong
call "me, good key" notewriter_api_me '{}' "$DEVBOX"
call "me, our key with the secret key" notewriter_api_me '{}' "$DEVBOX" "$SERVICE"
call "posts, limit 0" notewriter_api_posts '{"p_limit":0}' "$DEVBOX"
call "posts, one" notewriter_api_posts '{"p_limit":1}' "$DEVBOX"
call "post, unknown address" notewriter_api_post '{"p_url":"https://nowhere.example"}' "$DEVBOX"
call "reserve, no such post" notewriter_api_reserve '{"p_post":"00000000-0000-0000-0000-00000000ffff"}' "$DEVBOX"
call "v1 next_post with the public key" notewriter_next_post '{"p_notewriter":"claude-ai-box"}'
call "admin function with the public key" notewriter_admin_new_key '{"p_notewriter":"pipeline"}'
call "note without a reservation of its own" notewriter_api_add_note '{"p_reservation":"00000000-0000-0000-0000-00000000ffff","p_note":{}}' "$DEVBOX"

echo "── 20 notewriters reserve one post at once, at_most 1"
for n in $(seq 1 20); do
  curl -s "$BASE/notewriter_api_reserve" -H "Content-Type: application/json" -H "X-Notewriter-Key: $(cat "$OUT/key-$n")" \
    -d "{\"p_post\":\"$POST\",\"p_at_most\":1}" > "$OUT/race-$n.json" &
done
wait
echo "reserved: $(cat "$OUT"/race-*.json | grep -o '"kind": *"reserved"' | wc -l) · taken: $(cat "$OUT"/race-*.json | grep -o '"kind": *"taken"' | wc -l) · rows: $($PSQL -c "select count(*) from everything_reservations where item_id = '$POST'")"
RES=$($PSQL -c "select id from everything_reservations where item_id = '$POST' limit 1")
HOLDER=$($PSQL -c "select notewriter_id from everything_reservations where item_id = '$POST' limit 1")
HOLDER_KEY=$(cat "$OUT/key-${HOLDER#racer-}")

echo "── notes"
call "note on another notewriter's reservation" notewriter_api_add_note "{\"p_reservation\":\"$RES\",\"p_note\":{\"passage\":\"the study had 40 participants\",\"note\":\"n\",\"sources\":[{\"url\":\"https://a.example\"}]}}" "$DEVBOX"
call "note, passage not in the post" notewriter_api_add_note "{\"p_reservation\":\"$RES\",\"p_note\":{\"passage\":\"the study had 5,000 participants\",\"note\":\"n\",\"sources\":[{\"url\":\"https://a.example\"}]}}" "$HOLDER_KEY"
call "note, posted" notewriter_api_add_note "{\"p_reservation\":\"$RES\",\"p_note\":{\"passage\":\"the study had 40 participants\",\"note\":\"It had 4,000.\",\"sources\":[{\"url\":\"https://a.example\"}]}}" "$HOLDER_KEY"
call "note, same passage again" notewriter_api_add_note "{\"p_reservation\":\"$RES\",\"p_note\":{\"passage\":\"the study had 40 participants\",\"note\":\"again\",\"sources\":[{\"url\":\"https://a.example\"}]}}" "$HOLDER_KEY"
call "finish" notewriter_api_finish "{\"p_reservation\":\"$RES\"}" "$HOLDER_KEY"
call "note after finishing" notewriter_api_add_note "{\"p_reservation\":\"$RES\",\"p_note\":{\"passage\":\"The race post says the study\",\"note\":\"n\",\"sources\":[{\"url\":\"https://a.example\"}]}}" "$HOLDER_KEY"
OUTRES=$(curl -s "$BASE/notewriter_api_reserve" -H "Content-Type: application/json" -H "X-Notewriter-Key: $OUTSIDE" -d '{"p_post":"00000000-0000-0000-0000-0000000003a2","p_at_most":2}' | sed -E 's/.*"reservation": *"([^"]+)".*/\1/')
$PSQL -c "update everything_notewriters set notes_per_day = 0 + 1 where id = 'jackson-hurley'; insert into everything_claims (id, item_id, claim, judgement, context_quote) values ('00000000-0000-0000-0000-0000000003c1', '$POST', 'zzzz', 'notewriter', 'zzzz'); insert into everything_notes (claim_id, note, notewriter_id) values ('00000000-0000-0000-0000-0000000003c1', 'n', 'jackson-hurley');" >/dev/null
call "outside note over its daily cap" notewriter_api_add_note "{\"p_reservation\":\"$OUTRES\",\"p_note\":{\"passage\":\"the bridge was built in 1850\",\"note\":\"n\",\"sources\":[{\"url\":\"https://a.example\"}]}}" "$OUTSIDE"
$PSQL -c "update everything_reservations set deadline = now() - interval '1 second' where id = '$OUTRES'" >/dev/null
call "note after the deadline" notewriter_api_add_note "{\"p_reservation\":\"$OUTRES\",\"p_note\":{\"passage\":\"the bridge was built in 1850\",\"note\":\"n\",\"sources\":[{\"url\":\"https://a.example\"}]}}" "$OUTSIDE"
$PSQL -c "select notewriter_admin_switch('jackson-hurley', false, 'test')" >/dev/null
call "switched off" notewriter_api_me '{}' "$OUTSIDE"

echo "── v1 and v2 at the same moment, 10 rounds"
both_first=0
for round in $(seq 1 10); do
  ITEM=$($PSQL -c "insert into everything_items (url, full_text, published_at) values ('https://round.example/$round', 'Round $round has a post that both want to be first on.', current_date + 1) returning id" | head -1)
  $PSQL -c "update everything_reservations set started_at = now() - interval '1 day' where notewriter_id = 'claude-ai-box'; update everything_notewriters set every_minutes = 1, takes_reader_requests = false where id = 'claude-ai-box'" >/dev/null
  curl -s "$BASE/notewriter_next_post" -H "Content-Type: application/json" -H "Authorization: Bearer $SERVICE" -d '{"p_notewriter":"claude-ai-box"}' > "$OUT/v1.json" &
  curl -s "$BASE/notewriter_api_reserve" -H "Content-Type: application/json" -H "X-Notewriter-Key: $DEVBOX" -d "{\"p_post\":\"$ITEM\",\"p_at_most\":1}" > "$OUT/v2.json" &
  wait
  firsts=$($PSQL -c "select count(*) from everything_reservations where item_id = '$ITEM' and place = 1")
  echo "  round $round: $($PSQL -c "select string_agg(notewriter_id || ' place ' || place, ', ' order by started_at) from everything_reservations where item_id = '$ITEM'") · v2 answered $(grep -o '"kind": *"[a-z]*"' "$OUT/v2.json")"
  [ "$firsts" -gt 1 ] && both_first=$((both_first + 1))
  $PSQL -c "update everything_reservations set ended_at = now(), outcome = 'done' where item_id = '$ITEM' and ended_at is null" >/dev/null
done
echo "rounds where both got place 1: $both_first of 10"

sudo docker rm -f cn-postgrest-test-184 >/dev/null
