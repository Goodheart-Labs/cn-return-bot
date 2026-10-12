-- A note request's page_url must be an http or https address (GOO-254).
--
-- Anyone may insert a note request, signed in or not. When the request carries
-- no page text, the pipeline fetches page_url itself, and it only ever fetches
-- web pages. The fetch code refuses every other scheme (isWebUrl in
-- src/pipeline/utils/webUrl.ts), and on the services machine the fetch runs in
-- a sandbox (ops/cn-fetch.service). This check stops a request with another
-- scheme before it is stored at all.
--
-- Every existing row passes: all 51 requests on 2026-09-28 were http or https.

alter table everything_note_requests
  add constraint everything_note_requests_page_url_is_web check (page_url ~* '^https?://');
