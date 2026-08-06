# Substack feed proxy

Cloudflare Worker serving Substack RSS feeds to the priority-feeds workflow.
Substack 403s GitHub runner IPs outright and rate-limits Workers' shared
egress (10–100% success depending on ambient congestion), so the worker keeps
a KV-cached copy of every requested feed fresh via a 5-min cron trigger and
serves requests from that cache instantly. Clients reject caches older than a
day (see `MAX_PROXY_CACHE_AGE_SECONDS` in `sources/substack.ts`), so a
fully-blocked worker fails loudly instead of serving frozen data.

Deployed on Jim's Cloudflare account (free tier: Workers, KV, and cron
triggers all included). One-time setup / redeploy:

```bash
cd src/everything/substack-proxy-worker
bunx wrangler login                                   # once per machine
bunx wrangler kv namespace create FEEDS               # once; id goes in wrangler.toml
bunx wrangler deploy                                  # → prints the worker URL
openssl rand -hex 24 | bunx wrangler secret put PROXY_KEY
```

Then set the repo's GitHub secrets:
- `SUBSTACK_PROXY_URL` — the deployed worker URL
- `SUBSTACK_PROXY_KEY` — the same value given to `wrangler secret put`

The pipeline uses the proxy only when those env vars are set (CI); local runs
fetch Substack directly. A feed's first-ever request registers it for
background refresh; feeds nobody requests for a week are dropped from the
refresh loop.
