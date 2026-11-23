# Self-hosted Jina Reader against hosted Jina (GOO-853, GOO-855)

The question: does the open-source Jina Reader, run in Docker on the services
box with DataImpulse as its proxy, read pages as well as Jina's hosted copy
(r.jina.ai)?

## Test set

The read log of GOO-766 (2026-11-12 to 2026-11-19) has 563 page reads that went
through the whole fetch ladder and then reached hosted Jina. Hosted Jina read
323 of them and failed on 240. `compare.ts` read every one of the 563 again on
2026-11-23 through the self-hosted copy on the services box, with the client of
this branch: one request that lets Jina fetch directly, and when that gives no
usable page, a second request with `X-Proxy: auto`. `summarize.ts` prints the
numbers. The data is in `~/dev/data/goo-853/` on the devbox, not in the
repository, because it holds the pages' text.

## Results

| | Pages |
|---|---|
| Hosted Jina read | 323 |
| of those, self-hosted read too | 217 (67%) |
| Hosted Jina failed on | 240 |
| of those, self-hosted read | 60 |
| Self-hosted read in total | 277, which is 86% of hosted's 323 |
| Either of the two read | 383 |

The bar Jim set was 90% of the pages hosted Jina read. Self-hosted reached 67%,
so it does not pass.

When both read a page, the text is the same on articles: the median share of
hosted's distinct words that self-hosted also has is 0.95 over 162 article
pages. On 55 social pages (Instagram, Reddit, Facebook, X) it is 0.47, because
their comments and feeds changed in the ten days between the two reads.

Self-hosted's texts are longer: 9.5 million characters against hosted's 5.2
million on the same 217 pages, and 36 pages came back more than three times
longer. Every extra character is a token for the model that reads the source.

What self-hosted got on the 106 pages hosted read and it did not: 57 times the
site's 403, 22 times a 404, 8 thin texts, and a few errors. Two causes are
known. DataImpulse refuses some sites outright with `403
SITE_PERMANENTLY_BLOCKED`, among them every .gov site we tried. And some sites,
such as politico.com, refuse DataImpulse's addresses too. Hosted Jina uses its
own proxy pools, which get through more often.

## Running it

- Jina's Node process grows by about 20 MB per read and does not give the
  memory back, also with a V8 heap limit. The container reached its 4 GB limit
  and was killed 3 times in the 563 reads, so about once per 190 reads.
- A read takes 10 seconds in the median, and up to 60 when both requests time
  out.

## Cost

Hosted Jina returned about 7.8 million characters in the logged week, about 2
million tokens. At $0.05 per million tokens that is about $0.10 a week. Self-
hosting does not save money worth the work: the proxy's traffic for the second
requests costs about as much.
