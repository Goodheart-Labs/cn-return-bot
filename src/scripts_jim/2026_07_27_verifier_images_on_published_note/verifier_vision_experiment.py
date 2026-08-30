"""
Source verifier sandbox — the REAL verifier call, with everything hardcoded.

Same system prompt, same user message, same strict json_schema response format
and same provider routing the pipeline uses for note 2081121999158473097
(simple-bot, gemini-3-flash-preview, verifier_claim_based=classic,
verifier_citations=on). Images are inlined as base64 in the verifier's exact
content layout: text, then a heading per group, then that group's images.

Edit the constants and re-run. SEND_IMAGES also swaps the system prompt, because
production only appends the image rule when images are actually attached — so
False reproduces the text-only arm exactly, not a crippled version of the other.

Run (the venv lives in the main checkout, not this worktree):
    /Users/jimmaar/Github/cn-return-bot/.venv/bin/python \
        src/scripts_jim/2026_07_27_verifier_images_on_published_note/verifier_vision_experiment.py
"""

import base64
import json
import os
import sys

import requests
from dotenv import load_dotenv

MODEL = "google/gemini-3-flash-preview"

# False = the text-only arm (also drops the image rule from the system prompt).
SEND_IMAGES = True

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
REQUEST_TIMEOUT_S = 180
IMAGE_FETCH_TIMEOUT_S = 8
BYTES_PER_KIB = 1024
# Some CDNs serve a placeholder or 403 to non-browser agents; mirrors FETCH_UAS.desktop.
DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# --- Prompts: verbatim from the logged production call ------------------------

# The image rule (the line under test on PR #172) is the ONLY difference between
# these two — production appends it iff images were attached.
SYSTEM_PROMPT_TEXT_ONLY = r"""You verify whether the sources cited by a proposed community note support the claim made in that note, AND categorize each cited source as good or bad so the orchestrator can drop the bad ones from the final note.

Scope — what to ignore:
- Media, links, or videos embedded in the original post are NOT note sources. The post is shown only so you understand what the note is correcting. Do not evaluate whether the post's evidence is valid.
- If a "Research findings" section is present, it is background reasoning from an earlier pipeline step, not a source. Treat a URL there as a source only if it also appears under "Note's cited sources".
- Sources marked "[from search snippet]" were not fully fetched; evaluate them based on the available title and snippet text.

Classification rules for each cited source:
- Twitter/X links (x.com, twitter.com): the tweet's text and author are fetched and shown. Good only if that tweet content directly supports a factual claim in the note; otherwise bad. If a tweet is marked "could not be fetched", accept it as good — we can't read it, so don't penalize it.
- Any other source → good only if it (a) was successfully fetched (no "Fetch failed:" / "Fetch error:" / "Non-text content:" marker) AND (b) its content directly supports at least one factual claim in the note. Otherwise bad.
- Media URLs (videos, audio, images) may be presented with an automated content analysis block. For videos: title, uploader, content summary, on-screen text, audio transcript. For images: description and visible text. When present, treat that block as the source's content and evaluate it like any other fetched source. If the URL could not be analyzed as media, you'll see the raw web page instead (or a fetch error).

Output:
- sources: one entry per cited source (verbatim URL, exactly as listed), each with citations then a verdict.
For each source list its "citations" FIRST, each a { quote, explanation }:
- quote: text copied verbatim from that source's shown content (never invented or paraphrased).
- explanation: a concise, plain-language note (for readers not deep in the topic) on how the snippet supports — or fails to support — a factual claim in the note. Use "" when self-evident.
Gather the citations BEFORE the verdict, then judge "good"/"bad" from them. Leave citations empty only when the source failed to fetch or has nothing relevant.
- Every cited URL must appear in sources exactly once. Do not invent URLs.
- reasoning: why the note was accepted or rejected; name any unsupported claim.
- accepted: true iff the good sources together cover every factual claim in the note. Otherwise false."""

SYSTEM_PROMPT_WITH_IMAGES = r"""You verify whether the sources cited by a proposed community note support the claim made in that note, AND categorize each cited source as good or bad so the orchestrator can drop the bad ones from the final note.

Scope — what to ignore:
- Media, links, or videos embedded in the original post are NOT note sources. The post is shown only so you understand what the note is correcting. Do not evaluate whether the post's evidence is valid.
- If a "Research findings" section is present, it is background reasoning from an earlier pipeline step, not a source. Treat a URL there as a source only if it also appears under "Note's cited sources".
- Sources marked "[from search snippet]" were not fully fetched; evaluate them based on the available title and snippet text.

Classification rules for each cited source:
- Twitter/X links (x.com, twitter.com): the tweet's text and author are fetched and shown. Good only if that tweet content directly supports a factual claim in the note; otherwise bad. If a tweet is marked "could not be fetched", accept it as good — we can't read it, so don't penalize it.
- Any other source → good only if it (a) was successfully fetched (no "Fetch failed:" / "Fetch error:" / "Non-text content:" marker) AND (b) its content directly supports at least one factual claim in the note. Otherwise bad.
- Media URLs (videos, audio, images) may be presented with an automated content analysis block. For videos: title, uploader, content summary, on-screen text, audio transcript. For images: description and visible text. When present, treat that block as the source's content and evaluate it like any other fetched source. If the URL could not be analyzed as media, you'll see the raw web page instead (or a fetch error).
- Images are attached below the text under headings naming where each came from ("Post images", "Quoted post images", "Images from cited source <url>"). Sometimes a tweet and a source are about similar but different events. You can tell whether they are about the same event or not from the images.

Output:
- sources: one entry per cited source (verbatim URL, exactly as listed), each with citations then a verdict.
For each source list its "citations" FIRST, each a { quote, explanation }:
- quote: text copied verbatim from that source's shown content (never invented or paraphrased).
- explanation: a concise, plain-language note (for readers not deep in the topic) on how the snippet supports — or fails to support — a factual claim in the note. Use "" when self-evident.
Gather the citations BEFORE the verdict, then judge "good"/"bad" from them. Leave citations empty only when the source failed to fetch or has nothing relevant.
- Every cited URL must appear in sources exactly once. Do not invent URLs.
- reasoning: why the note was accepted or rejected; name any unsupported claim.
- accepted: true iff the good sources together cover every factual claim in the note. Otherwise false."""

USER_MESSAGE = r"""## Context
Current date (UTC): 2026-07-27T15:08:09.161Z

## Proposed community note
This photo is not from today. It is a PA/AP image captioned "Andy Burnham running near his house in Cheshire, Sunday, June 28, 2026," used widely in news coverage nearly a month before this post. https://www.nwaonline.com/news/2026/jun/30/uks-burnham-pledges-to-rebalance-power/

## Note's cited sources (verify these)
### https://ny1.com/nyc/all-boroughs/ap-top-news/2026/06/29/andy-burnham-to-set-out-his-economic-vision-as-he-speeds-toward-power-in-britain
# Andy Burnham to set out his economic vision as he speeds toward power in Britain

MANCHESTER, England (AP) — [Andy Burnham](https://apnews.com/article/uk-labour-andy-burnham-profile-c9fc2bd8b66d168de0b57408b397bff8), Britain’s presumptive next prime minister, will set out details on Monday to give more powers to local government as part of a plan to spread wealth and economic growth.

Burnham will set out a sweeping [economic vision](https://apnews.com/article/andy-burnham-prime-minister-starmer-uk-politics-3a7418c6bac69d631a3b25faa83936d9) in a key speech as he tries to bring voters, colleagues and financial markets up to speed with his ideas during his rapid progress toward power.

His office says Burnham will set out a 10-year vision for “good growth in every postcode,” in a country where wealth and power are concentrated in London and the south of England.

During the speech in Manchester, where he served for nine years as mayor, Burnham plans to outline plans to move part of his prime ministerial operation to the northwest England city. He’ll also commit to giving regional mayors more power over housing, welfare and education.

Burnham is aiming to replicate on a nationwide level the approach he took in Greater Manchester — harnessing private and public money to invest in transport, housing and infrastructure.

His speech is set to include a commitment to create new industrial jobs and better educational opportunities, and to reform of the U.K.’s inefficient and expensive privatized water and energy utilities.

Burnham won praise for his role in revitalizing and regenerating Manchester, but he has not served in a U.K. government for almost two decades, and may struggle to replicate “Manchesterism” on a U.K.-wide scale.

He’ll also be aware that Prime Minister [Keir Starmer](https://apnews.com/hub/keir-starmer) also announced a 10-year mission — the equivalent of two full terms in government —- to transform Britain soon after he was elected in a landslide in July 2024. Starmer is leaving after [two years](https://apnews.com/article/prime-minister-starmer-resign-burnham-mandelson-2cc8af7912e7f7c1df103f4b8b16bd6d) in office marred by missteps and judgment errors that eroded his standing with his party and the public.

Burnham won a [special election](https://apnews.com/article/uk-makerfield-election-burnham-starmer-ff06efb52a1f6593c94617cceeb9b603) for a seat in Parliament on June 18 and was sworn in as a lawmaker on June 22 — the same day Starmer announced [that he will resign](https://apnews.com/live/keir-starmer-resignation-uk-prime-minister-updates-06-22-2026) as soon as a successor is chosen.

Burnham is the strong favorite to replace him in a Labour Party leadership contest in the next few weeks. No other contenders have entered the race so far, and if no one does, Burnham will become prime minister by July 20.

While Burnham is considered more charismatic than the stolid Starmer, he will face many of the same political and economic challenges, including a sluggish economy, [tattered public services](https://apnews.com/article/doctors-strike-england-nhs-0a073410535f8790f0e700720a11c344) and a cost-of-living squeeze. He will also be constrained by the platform the center-left Labour Party was elected on in 2024, with its pledges not to increase taxes on working people.

And like other NATO countries, the U.K. is under pressure to dramatically increase defense spending to counter a more aggressive Russia and less reliable United States.

The government's long-awaited defense investment plan — which sparked the [resignation of Defense Secretary John Healey](https://apnews.com/article/britain-defense-secretary-john-healey-quits-533cb2637192f045ca6247ab5a402bac) on June 11 — is expected to be published before a NATO summit in Turkey on July 7 and 8. Starmer’s successor will be expected to stick to the commitments in the plan.

“Andy Burnham’s big idea is to shuffle power between politicians,” said opposition Conservative Party Chairman Kevin Hollinrake. “Not fix the welfare system. Not cut the taxes strangling working families and British business. Not fund the defense our country desperately needs.”

\_\_\_

Lawless reported from London.

Copyright 2026 The Associated Press. All rights reserved. This material may not be published, broadcast, rewritten or redistributed without permission.

### https://www.nwaonline.com/news/2026/jun/30/uks-burnham-pledges-to-rebalance-power/
# UK’s Burnham pledges to rebalance power

MANCHESTER, England -- Andy Burnham, top candidate to be the next U.K. prime minister, pledged Monday to give away a chunk of his power by handing greater autonomy to local leaders in a "circuit-breaker" for the sclerotic British state.

The former mayor of Greater Manchester also said he would move part of the prime minister's office from London's 10 Downing St. to northwest England as part of "the biggest rebalancing of power our country has seen."

"Growth cannot be ordered from the top down. Instead, it can only be nurtured from the bottom up," Burnham said in a speech aimed at bringing voters, Labour Party colleagues and financial markets up to speed with his economic vision.

Burnham is the strong favorite to replace Prime Minister Keir Starmer, who announced his resignation last week.

"If councils can't fix potholes, what chance do they have of bringing forward major regeneration schemes to get growth going?" Burnham said. He set out a 10-year plan to get "good growth in every postcode," in a country where wealth and power are concentrated in London and the south of England.

He said he would reverse almost two decades of low growth since the 2008 financial crisis through an approach dubbed "Manchesterism" -- harnessing private and public money to invest in areas like transport, housing and infrastructure. He also pledged to create new industrial jobs and better educational opportunities, and to reform the U.K.'s inefficient and expensive privatized water and energy utilities.

During the speech at the People's History Museum in the city where he spent nine years as mayor, Burnham said a new government office in Manchester -- dubbed "No. 10 North" -- would oversee regional development and become "the nerve center of a rewired Britain," tasked with equalizing living standards across the country. Regional mayors would get more power over housing, welfare and education as part of his planned reforms.

Burnham's rousing speech was short on specifics about where the government would find more money, and he didn't take questions from journalists.

Burnham won praise for his role in revitalizing and regenerating Manchester, but he has not served in a U.K. government for almost two decades, and may struggle to replicate Manchesterism on a U.K.-wide scale.

The Institute for Public Policy Research, a left-leaning think tank, said Burnham is right to focus on "rebalancing Britain."

"The U.K.'s concentration of power and opportunity in Westminster has held back growth, productivity and living standards for too long," said the institute's Executive Director Harry Quilter-Pinner. "The real test now is delivery."

Matthew Flinders, a politics professor at the University of Sheffield, said replicating Burnham's Manchester approach on a national level would require "a fundamental shift" in the way politics is done in Britain.

"And at the heart of that would be moving from a very traditional, elitist, centralized model of politics toward something that is in many ways far more European, far more based on power-sharing in order to develop long-term policymaking capacity," he said.

Burnham will be aware that Starmer also announced a 10-year mission -- the equivalent of two full terms in government -- to transform Britain soon after he was elected in a landslide in July 2024. Starmer is leaving after two years in office marred by missteps and judgment errors that eroded his standing with his party and the public.

Burnham won a special election for a seat in Parliament on June 18 and was sworn in as a lawmaker on June 22, the same day Starmer announced that he will resign as soon as a successor is chosen.

Burnham is so far the only contender in the Labour Party leadership contest. If no one challenges him, he will become prime minister by July 20.

While Burnham is considered more charismatic than the stolid Starmer, he will face many of the same political and economic challenges, including a sluggish economy, tattered public services and a cost-of-living squeeze.

Information for this article was contributed by Brian Melley of The Associated Press.

![Andy Burnham running near his house in Cheshire, England, Sunday, June 28, 2026. (Peter Powell/PA via AP)](https://wehco.media.clients.ellingtoncms.com/imports/adg/photos/213152999_213151177-e97a6b642fdb4a75aa4454050dc3e9d8_t800.jpg?90232451fbcadccc64a17de7521d859a8f88077d)

Andy Burnham running near his house in Cheshire, England, Sunday, June 28, 2026. (Peter Powell/PA via AP)

![Labour party's Andy Burnham delivers a speech at the People's History Museum in Manchester, England, Monday, June 29, 2026.(AP Photo/Alastair Grant)](https://wehco.media.clients.ellingtoncms.com/imports/adg/photos/213152999_213151177-0620bfbf616740c7b7702f08918fb397_t800.jpg?90232451fbcadccc64a17de7521d859a8f88077d)

Labour party's Andy Burnham delivers a speech at the People's History Museum in Manchester, England, Monday, June 29, 2026.(AP Photo/Alastair Grant)

![Labour party's Andy Burnham adjusts his glasses as he delivers a speech at the People's History Museum in Manchester, England, Monday, June 29, 2026.(AP Photo/Alastair Grant)](https://wehco.media.clients.ellingtoncms.com/imports/adg/photos/213152999_213151177-f60fc77a0981436dbbb16c6d043280ae_t800.jpg?90232451fbcadccc64a17de7521d859a8f88077d)

Labour party's Andy Burnham adjusts his glasses as he delivers a speech at the People's History Museum in Manchester, England, Monday, June 29, 2026.(AP Photo/Alastair Grant)

![Labour party's Andy Burnham delivers a speech at the People's History Museum in Manchester, England, Monday, June 29, 2026.(AP Photo/Alastair Grant)](https://wehco.media.clients.ellingtoncms.com/imports/adg/photos/213152999_213151177-c0e4510653294f388f5f032d384283f4_t800.jpg?90232451fbcadccc64a17de7521d859a8f88077d)

Labour party's Andy Burnham delivers a speech at the People's History Museum in Manchester, England, Monday, June 29, 2026.(AP Photo/Alastair Grant)

## Original post (background — not a source)
Current date: 2026-07-25
Current time: 20:51 UTC
Tweet posted: 2026-07-25T19:24:42.000Z
Tweet URL: https://x.com/i/status/2081098335385969129

Author: Politics UK — 493,601 followers — 22,247 posts
Author bio: The Home of UK Political News. Follow & turn on notifications for impartial coverage first. For global & U.S. coverage, follow @PolitlcsGlobal & @PolitlcsUS.
Engagement: 285,222 impressions — 2,407 likes — 49 retweets — 285 replies — 73 quotes

## Post

🚨 NEW: Andy Burnham spotted on a run near his Cheshire home earlier today https://t.co/qLIo43GgU6

## Media on post

### Image 1
Description: A man in a yellow long-sleeved athletic shirt and dark shorts is jogging towards the camera on a paved sidewalk. To his left is a tall, manicured green hedge. To his right, a white police vehicle with high-visibility yellow and orange chevron markings and the word 'POLICE' on the rear is parked on the street. Another dark-colored car is parked behind the police vehicle. The scene is set on a suburban street during the day.
Visible text: LM75 U
POLICE
adidas

## Comments and replies

- Booker Dewitt 💔 (@WrecklessGamer): (photo, no text) Likes=61, Reposts=1, Quotes=0, Replies=1, Bookmarks=1, Views=5709
- Billy©️ (@TheGrandfatherX): And? Why is this news? Does anybody care? Low news day? Likes=43, Reposts=0, Quotes=0, Replies=0, Bookmarks=0, Views=4361
- Richard (@RedWallPleb): Is he running away from serious scrutiny? Likes=28, Reposts=0, Quotes=0, Replies=0, Bookmarks=0, Views=1344
- Sarah Elsey (@sarah_elsey): I don't think he runs very far judging from his boobs Likes=1, Reposts=0, Quotes=0, Replies=0, Bookmarks=0, Views=10
- UnicornsAreReal (@GB101z): He should be wearing a bra. Likes=1, Reposts=0, Quotes=0, Replies=0, Bookmarks=0, Views=1
- Alan M (@amoore1091): Go Andy, all the gammons triggered 🤣 Likes=0, Reposts=0, Quotes=0, Replies=0, Bookmarks=0, Views=6
- Captain Scarlett🫡 ✝️🇬🇧🇬🇧 (@RobChar17748533): Hes got a good pair of boobs on him 😁👍🏻 Likes=0, Reposts=0, Quotes=0, Replies=0, Bookmarks=0, Views=4
- Jerome Blakey (@__JayBee00): Isn’t he supposed to live at Downing Street? Likes=0, Reposts=0, Quotes=0, Replies=0, Bookmarks=0, Views=N/A
- SEANIE (@SEANIE123456789): Classically running away from his illegal immigration blanket coverage. Likes=0, Reposts=0, Quotes=0, Replies=0, Bookmarks=0, Views=N/A
- Simon Evans (@TheHevo): Just a regular guy, going for a morning run. Not staged. No security detail nearby. "Spotted" aye. Likes=0, Reposts=0, Quotes=0, Replies=0, Bookmarks=0, Views=3

## Research findings (background — not a source)
The tweet ('Politics UK', posted July 25, 2026) claims Andy Burnham was 'spotted on a run near his Cheshire home earlier today.' The accompanying image matches a well-documented photo distributed by PA/AP with the caption 'Andy Burnham running near his house in Cheshire, England, Sunday, June 28, 2026' (Peter Powell/PA via AP), used in numerous news stories from that period, e.g. https://ny1.com/nyc/all-boroughs/ap-top-news/2026/06/29/andy-burnham-to-set-out-his-economic-vision-as-he-speeds-toward-power-in-britain, https://www.nwaonline.com/news/2026/jun/30/uks-burnham-pledges-to-rebalance-power/, https://courthousenews.com/burnham-in-sight-of-downing-street-wins-top-uk-union-support/, and https://www.wsls.com/news/world/2026/07/17/andy-burnham-a-mayor-from-englands-north-is-poised-to-become-britains-next-prime-minister/. This means the photo is nearly a month old, not from 'today' (July 25, 2026) as the tweet implies. Additionally, Andy Burnham became UK Prime Minister on July 20, 2026 (https://en.wikipedia.org/wiki/Prime_Minister_of_the_United_Kingdom, https://www.cbsnews.com/news/andy-burnham-new-uk-prime-minister-7th-in-decade-after-keir-starmer/), and as PM his official residence is now 10 Downing Street (with Chequers as a country retreat), not his old Cheshire home (https://en.wikipedia.org/wiki/Prime_Minister_of_the_United_Kingdom). No news outlet has reported a fresh sighting of Burnham running in Cheshire on July 25, 2026; all located matches point to the same late-June 2026 photo being recirculated with a new, misleading 'today' framing."""

# --- Response format: the real strict schema (VERIFY_CITATIONS_RESPONSE_FORMAT) ---

CITATIONS_SCHEMA = {
    "type": "array",
    "description": (
        "Most relevant verbatim snippets from this source, gathered BEFORE the verdict. "
        "Empty only when the source failed to fetch or has nothing relevant."
    ),
    "items": {
        "type": "object",
        "properties": {
            "quote": {
                "type": "string",
                "description": "Text copied verbatim from the shown source content. Never invent or paraphrase.",
            },
            "explanation": {
                "type": "string",
                "description": (
                    "Concise, plain-language note (for non-experts) on how this snippet supports "
                    'or fails to support the note. "" when self-evident.'
                ),
            },
        },
        "required": ["quote", "explanation"],
        "additionalProperties": False,
    },
}

EVALUATED_SOURCE_SCHEMA = {
    "type": "object",
    "properties": {
        "url": {"type": "string", "description": "Verbatim cited URL."},
        "citations": CITATIONS_SCHEMA,
        "verdict": {
            "type": "string",
            "enum": ["good", "bad"],
            "description": "Final judgement after weighing the citations.",
        },
    },
    "required": ["url", "citations", "verdict"],
    "additionalProperties": False,
}

RESPONSE_FORMAT = {
    "type": "json_schema",
    "json_schema": {
        "name": "source_verification_cited",
        "strict": True,
        "schema": {
            "type": "object",
            "properties": {
                "sources": {
                    "type": "array",
                    "description": "One entry per cited source, in the order listed. Do not invent or omit URLs.",
                    "items": EVALUATED_SOURCE_SCHEMA,
                },
                "reasoning": {
                    "type": "string",
                    "description": "Overall: which claims are covered; name any unsupported claim.",
                },
                "accepted": {
                    "type": "boolean",
                    "description": "True iff the good sources together cover every factual claim in the note.",
                },
            },
            "required": ["sources", "reasoning", "accepted"],
            "additionalProperties": False,
        },
    },
}

# --- Images -------------------------------------------------------------------

NWAONLINE = "https://www.nwaonline.com/news/2026/jun/30/uks-burnham-pledges-to-rebalance-power/"
CMS = "https://wehco.media.clients.ellingtoncms.com/imports/adg/photos/213152999_213151177"
CACHE_BUST = "?90232451fbcadccc64a17de7521d859a8f88077d"

# (heading, [urls]) in the order the verifier renders them. The nwaonline running
# photo is a DIFFERENT photograph from the post's (navy quarter-zip vs yellow
# adidas top) — which is the whole point: the note claims they are the same.
IMAGE_GROUPS = [
    ("Post images", ["https://pbs.twimg.com/media/HOGLSu7WYAAemkq.jpg"]),
    (
        "Images from cited source " + NWAONLINE,
        [
            CMS + "-e97a6b642fdb4a75aa4454050dc3e9d8_t800.jpg" + CACHE_BUST,  # running (navy top)
            CMS + "-0620bfbf616740c7b7702f08918fb397_t800.jpg" + CACHE_BUST,  # speech
            CMS + "-f60fc77a0981436dbbb16c6d043280ae_t800.jpg" + CACHE_BUST,  # speech
        ],
    ),
]


def to_data_url(url: str) -> str | None:
    """Download an image and inline it as base64, or None if it can't be had.
    Bytes rather than a link because the provider fetches remote URLs itself and
    one hotlink-protected image 400s the entire completion."""
    try:
        response = requests.get(
            url,
            headers={"User-Agent": DESKTOP_UA, "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"},
            timeout=IMAGE_FETCH_TIMEOUT_S,
        )
    except requests.RequestException as err:
        print(f"    FAILED {url} — {err}")
        return None

    mime = response.headers.get("content-type", "").split(";")[0].strip()
    if not response.ok or not mime.startswith("image/") or mime == "image/svg+xml":
        print(f"    FAILED {url} — HTTP {response.status_code} {mime}")
        return None

    kib = len(response.content) / BYTES_PER_KIB
    print(f"    {url.split('/')[-1][:58]}  {mime}  {kib:.1f} KiB")
    return f"data:{mime};base64,{base64.b64encode(response.content).decode()}"


def build_content() -> str | list[dict]:
    """Text, then each heading followed by its images. Returns a plain string when
    nothing is attached, so the control run is byte-identical to the text-only arm."""
    if not SEND_IMAGES:
        return USER_MESSAGE

    parts: list[dict] = [{"type": "text", "text": USER_MESSAGE}]
    for label, urls in IMAGE_GROUPS:
        print(f"  {label}")
        data_urls = [d for d in (to_data_url(u) for u in urls) if d]
        if not data_urls:
            continue
        parts.append({"type": "text", "text": f"## {label}"})
        parts += [{"type": "image_url", "image_url": {"url": d}} for d in data_urls]
    return parts


def print_verdict(result: dict) -> None:
    print("=" * 78)
    print(f"accepted: {result['accepted']}")
    print(f"reasoning: {result['reasoning']}\n")
    for source in result["sources"]:
        print(f"[{source['verdict'].upper()}] {source['url']}")
        for citation in source["citations"]:
            print(f'    quote: "{citation["quote"]}"')
            if citation["explanation"]:
                print(f"    why:   {citation['explanation']}")
        print()
    print("=" * 78)


def main() -> None:
    load_dotenv()
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        sys.exit("OPENROUTER_API_KEY not set (expected in .env)")

    system_prompt = SYSTEM_PROMPT_WITH_IMAGES if SEND_IMAGES else SYSTEM_PROMPT_TEXT_ONLY
    print(f"model: {MODEL}   images: {'on' if SEND_IMAGES else 'off'}\n")
    content = build_content()
    image_count = sum(1 for p in content if p.get("type") == "image_url") if isinstance(content, list) else 0
    print(f"\nsending {image_count} image(s), system prompt {len(system_prompt)} chars\n")

    response = requests.post(
        OPENROUTER_URL,
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content},
            ],
            "response_format": RESPONSE_FORMAT,
            # llm.ts routes every call with this: providers that would ignore
            # response_format are excluded rather than silently returning prose.
            "provider": {"require_parameters": True},
        },
        timeout=REQUEST_TIMEOUT_S,
    )
    response.raise_for_status()
    body = response.json()
    raw = body["choices"][0]["message"]["content"]

    try:
        print_verdict(json.loads(raw))
    except (json.JSONDecodeError, KeyError) as err:
        print(f"!! response was not the expected JSON ({err}); raw below\n")
        print(raw)

    usage = body.get("usage", {})
    tokens = f"{usage.get('prompt_tokens')}/{usage.get('completion_tokens')}"
    print(f"tokens in/out: {tokens}   cost: ${usage.get('cost', 0):.4f}")


if __name__ == "__main__":
    main()
