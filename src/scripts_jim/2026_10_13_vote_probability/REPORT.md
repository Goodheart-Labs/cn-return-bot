# How often does a reader vote when the extension shows notes? (GOO-434)

Jim's question: "Whats the probability that a user votes on the note when they visit a page that has at least one note?"

**Answer: when the extension shows notes on a page, the reader votes on at least one of them in about 7.6% of visits (22 of 291 visits, 95% CI roughly 4% to 13%). These visits come from 70 browsers outside the team, between 2026-08-17 and 2026-10-12.** Per note, the rate is about 1 vote for every 50 notes shown (1.9%). Per browser, 12 of those 70 browsers (17%) have voted at least once.

## The question, pinned down

- **Visit.** A visit is one page where the extension displayed notes. The extension writes a `notes_shown` row to `everything_events` once it has mounted the notes on the page, and that row carries the page's item and the number of notes visible. So the data does record that notes were really displayed, and how many. It does not record whether the reader scrolled to them. A reload or a second tab of the same page within 30 minutes counts as one visit, because 786 events collapse to 512 visits that way. The website and minisites are left out, as Jim asked.
- **User.** A user here is one browser with the extension. The extension mints a random **device id**, which is a random id stored in the extension's own storage, and every event carries it. A person with two browsers counts twice.
- **Vote.** A vote is a Yes, Somewhat or No rating on any note of that page, cast from the extension (`everything_votes.platform = 'extension'`), during the visit. A visit "ended with a vote" if the reader voted on at least one note on that page before their next visit to the same page. Voting needs no sign-in: the first vote silently creates an anonymous account. The only readers who must sign in first are those whose browser has signed in before and is now signed out.
- **Team.** I left out 23 of the 93 browsers. 13 of them were ever signed in as Jim or Nathan, which I identified by the emails in `everything_admins` plus any `@goodheartlabs.com` address. 8 were development installs, meaning unpacked builds rather than store installs. 2 were Safari, which has no store listing yet, so only our own Macs run it.

## Results, browsers outside the team, 2026-08-17 to 2026-10-12

| Group | Visits | Browsers | Visits with a vote | P(vote) | 95% CI, browser bootstrap | Votes per note shown |
|---|---:|---:|---:|---:|---|---:|
| All | 291 | 70 | 22 | 7.6% | 3.7% to 12.6% | 1.9% (33 of 1,738) |
| Text pages (Substack, LessWrong, other sites) | 230 | 65 | 15 | 6.5% | 2.7% to 11.7% | 1.5% |
| YouTube videos | 61 | 20 | 7 | 11.5% | 3.2% to 20.0% | 3.8% |
| The browser's first page with notes | 70 | 70 | 6 | 8.6% | 2.9% to 15.7% | 1.4% |
| Later pages | 221 | 40 | 16 | 7.2% | 3.2% to 12.7% | 2.1% |
| Signed in | 29 | 7 | 2 | 6.9% | 0% to 23.5% | 1.1% |
| Not signed in | 262 | 64 | 20 | 7.6% | 3.3% to 12.9% | 2.0% |

The confidence interval resamples whole browsers rather than single visits. Visits from one browser are not independent, because a keen voter supplies several of the successes. Only 12 browsers ever voted, so this interval is wider than the Wilson interval on visits, which runs from 5.0% to 11.2%. None of the splits differ by more than their intervals allow. YouTube looks higher, but it rests on 7 voting visits from 5 browsers.

When the team is included, the rate is about the same: 37 of 512 visits, or 7.2%. Per note it is lower, 1.3%, because team browsers see many notes while testing. The last week alone, since 2026-10-06, gives 7 of 87 visits, or 8.0%. From that date on, every event says whether it came from a development install, so the team filter is at its most reliable there.

Among visits that ended with a vote, 15 voted on one note, 5 on two, 1 on three and 1 on five.

## How votes are matched to visits, and what that costs

An anonymous reader's events carry no account id. The extension leaves `user_id` empty for an anonymous session on purpose, so that the sign-up funnel stays clean. So nothing in the data directly says which browser cast an anonymous vote. I matched them by time. For each vote, the candidates are the browsers that had notes shown on the same page in the 6 hours before it. A voter's browser is the one that is a candidate for all of their votes. Where several browsers remain, a browser that already belongs to another voter is dropped. Signed-in voters are linked directly through the user id on their events.

18 of the 22 extension voters (72 of 86 votes) were linked this way. Every linked vote fell inside a visit of its browser. The 4 unlinked voters cast 14 votes on 4 pages. Each of them had a team browser among the candidates, and three also had a browser outside the team. So at most 3 more voting visits belong outside the team, and the rate would then be at most 25 of 291, or 8.6%.

## Biases and caveats

- **Shown is not seen.** `notes_shown` fires when the notes are mounted on the page. A reader who leaves before scrolling to the first highlight still counts as a visit. Visits where the notes failed to load are not counted at all, which is right.
- **Team browsers that were never signed in.** Before version 0.4.1 (2026-10-05), the events did not say whether they came from a development install. Our own test browsers from that period that were never signed in, and the headless screenshot runs, are counted as outside readers. They almost never vote, so they would push the rate down. The last week, which can filter them, gives a similar 8.0%.
- **Bots and crawlers** cannot appear, because an event needs an installed extension.
- **Retracted votes.** A retracted vote deletes its row. `everything_vote_history` keeps retractions only since 2026-10-06, and there has been 1 since then. So a few earlier votes that were cast and then retracted are missing. This makes the rate a slight undercount.
- **Votes without a platform.** 146 votes have no platform recorded. Nearly all are from July, before the column existed and before the extension had notes. 10 are from after 2026-08-15. These are left out.
- **Several voters per browser.** Signing out mints a new anonymous account, so one browser can hold several voters. The matching allows for that.

## What to log so that the next measurement is exact

The matching above is needed only because anonymous voters cannot be joined to their browser. Two small changes would make it exact:

1. Put the acting account id, anonymous accounts included, on extension events. This could go in `props` or in a new column, so that the signed-in funnel keeps reading `user_id` as it does now.
2. Write the device id on each vote, or log a `vote_cast` event with the item id. Then a vote joins its visit directly.

I have not added either. I can do that as a follow-up if you want it.
