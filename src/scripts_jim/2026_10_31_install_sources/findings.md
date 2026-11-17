# Where the installs of 2026-10-29 and 2026-10-30 came from (GOO-678)

`main.py` produces every number here; its last output is in `output.md`. All numbers are aggregates over production data, read on 2026-10-31 around 04:00 UTC. Admin accounts are left out of the website numbers. Development builds are left out of the installs.

## Answer

The installs came from the website itself, not from links to single notes. Almost all of them trace back to one post: Scott Alexander's "Links For October 2026" on Astral Codex Ten (ACX), which went out at 16:33 UTC on 2026-10-29. Its item 7 ends with "use the browser extension Common Notes so other people can do this for you", and that link goes to `https://commonnotes.net/`, the homepage. The first install of the spike came six minutes later, at 16:39 UTC.

## The spike

| Period | Installs per day |
|---|---|
| 2026-10-21 to 2026-10-28 | 1 to 11 (median 5) |
| 2026-10-29 | 105 (103 after 16:00 UTC) |
| 2026-10-30 | 88 |

That makes 193 installs from 16:00 UTC on 2026-10-29 to 04:00 UTC on 2026-10-31: 130 in Chrome (or Edge, which reports itself as Chrome) and 63 in Firefox. Installs fell off within a day, the way traffic from one post does. The only bigger spike before it was on 2026-10-19 and 2026-10-20 (126 installs), with no click tracking yet.

## Sources

The website has counted clicks on its "Get the extension" buttons and its store buttons only since 2026-10-28 (migration 154). So the clicks can be compared with the installs for this spike.

| Source | Devices that clicked through to a store | Share of the 193 installs |
|---|---|---|
| Homepage, arrived without a tracking parameter (mostly ACX readers on the web) | 151 | 78% |
| Homepage, arrived through the ACX email (`utm_source=substack`) | 19 | 10% |
| A link to one note | 1 | under 1% |
| A minisite, the leaderboard or a list of notes | 0 | 0% |
| No click on our site at all (store search, a click in another browser, or a blocker that stopped our events) | about 22 | about 11% |

On the homepage, the main "Get the extension" button got 106 of the 171 clickers, the header button 32, and 33 clicked a store button in the install section without a button before it. The median visitor clicked within one minute of landing.

Note links did bring more visitors than usual (69 new devices since the spike against 25 in the two weeks before), but only one of them clicked through to a store.

## Countries

We do not store countries with our events. Supabase's request logs do have Cloudflare's country for each request. Counting the addresses that sent extension events after 16:00 on 2026-10-29 and never in the nine days before gives 242 new addresses. That overcounts installs, because an existing reader on a new network looks new, but the shares should hold: United States 52%, United Kingdom 10%, Germany 8%, Canada 5%, then France, Czechia, the Netherlands and others with 3% or less each. That matches ACX's readership.

## What the new installs did

175 of the 193 new installs have not yet been shown a note. The extension shows notes only on pages we checked, and these readers mostly have not visited one. Of the 18 that were shown notes, 8 first saw them on ACX and 7 on a page in "Around the web".

## How sure

Very sure about the main answer. Three independent facts agree: the ACX post links to the homepage, the first install came six minutes after the post went out, and 170 of the 171 devices that clicked through to a store had landed on the homepage. What the data cannot show is the referrer of the 151 homepage visitors without a tracking parameter. ACX is the only post that we know links to us in that window, so I attribute them to ACX, but some could be people it sent who shared the link elsewhere.

## What is missing, and the smallest fixes

1. **The website does not record where a visitor came from.** A pageview stores only our own URL. Storing the origin of `document.referrer` (for example `www.astralcodexten.com`, `t.co`, `www.google.com`) on the first pageview of a visit would have named the source of all 151 untagged visitors. It is one property in `capturePageviewNow` in `src/everything-web/src/lib/analytics.ts`, and it stores no more about the person than the URL already does.
2. **An install cannot be joined to the website visit that led to it.** The website and the extension have separate device ids, and the store does not pass anything through. Adding `utm_source=commonnotes&utm_medium=<button>` to our store links would let the store dashboards separate installs that came from our site from installs that came from store search. Firefox Add-ons reports installs per `utm_source`; I believe the Chrome Web Store dashboard does the same for listing visits, but I have not checked it.
