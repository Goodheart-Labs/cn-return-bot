"""The Haiku filter and its backtest runs (GOO-835).

One Claude Haiku 5.5 call per tweet, through OpenRouter, answers how likely a
note on the tweet ends up rated helpful. The tweet is shown as a short text
card: the author, the numbers the X run saw, the text, the tweet it quotes or
replies to, and Gemini's descriptions of its images and videos. We never send
the images themselves (see fetch_run_extras.py for why).

Variants, picked with --variant:
- plain: the card and the prompt, no tools.
- neighbours: the card plus the 8 most similar tweets we saw at least 3 days
  earlier, each with what happened to it, including the text of a helpful
  note when one exists. This is the retrieval idea from the ticket. The name
  for this lookup in these scripts is "neighbours".
- search: the card and the web search tool, which Haiku may use when it cannot
  judge the post otherwise.
- neighbours_search: both.

Every answer is appended to one JSON lines file per run, so an interrupted run
resumes where it stopped.

Run from the worktree root, for example:
  uv run --with pandas --with pyarrow --with httpx --with python-dotenv \\
    src/scripts_jim/2026_11_20_tweet_note_prefilter/haiku_filter.py --variant plain --split dev --sample 1500
"""

import argparse
import asyncio
import json
import os
import random
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
from dotenv import load_dotenv

DATA_DIR = Path("/home/jim/dev/data/goo-835")
RUNS_DIR = DATA_DIR / "runs"
MODEL = "anthropic/claude-haiku-5.5"
CONCURRENCY = 24
MAX_ATTEMPTS = 6
REQUEST_TIMEOUT_SECONDS = 180
MAX_TEXT_CHARS = 1500
MAX_MEDIA_CHARS = 600
MAX_BIO_CHARS = 200
NEIGHBOURS_SHOWN = 8
MAX_NEIGHBOUR_TEXT_CHARS = 300
MAX_NEIGHBOUR_NOTE_CHARS = 280
SEARCH_MAX_RESULTS = 5
MISLEADING = "MISINFORMED_OR_POTENTIALLY_MISLEADING"
HELPFUL = "CURRENTLY_RATED_HELPFUL"

# v1 described what a helpful note needs in the abstract, and told Haiku that
# jokes and satire never get one. On the development tweets that scored an AUC
# of 0.56, because many helpful notes in this feed are about fake media, made-up
# stories from parody accounts and scams, on posts that look like harmless fun.
# v2 lists the kinds of notes that actually end up helpful here.
SYSTEM_PROMPTS = {
    "v1": """You screen X posts before an expensive Community Notes writer looks at them. A Community Note adds context to a misleading post, and it is shown only when raters who usually disagree with each other both rate it helpful.

Estimate the probability that a note on this post ends up rated helpful. That needs a claim that is false or misleading in a way sources can show, readers who care about it, and a topic where raters from both political sides can agree. Opinions, jokes, satire and accurate posts get no helpful note.

Answer in JSON: {"probability": <number from 0 to 1>, "reason": "<at most 15 words>"}""",
    "v2": """You screen X posts before an expensive Community Notes writer looks at them. A Community Note adds context to a misleading post, and it is shown only when raters who usually disagree with each other both rate it helpful. About 1 in 9 posts you see ends up with a helpful note.

Estimate the probability that this post ends up with a helpful note. Helpful notes here often say that a video or image is AI-generated, edited, old, or shows someone else; that a quote or story is made up, often by a parody or engagement account; that an ad is a scam; or that a factual claim is false or leaves out key context. Posts with nothing checkable rarely get one, and notes on bitterly partisan claims often stall because raters split.

Answer in JSON: {"probability": <number from 0 to 1>, "reason": "<at most 15 words>"}""",
    # v3 asks for the parts separately. Each part is a probability, and the
    # combination step in combine.py learns how much each one matters.
    "v3": """You screen X posts before an expensive Community Notes writer looks at them. A Community Note adds context to a misleading post, and it is shown only when raters who usually disagree with each other both rate it helpful. About 1 in 9 posts you see ends up with a helpful note.

Give five probabilities from 0 to 1:
- fake_media: the post's video or image is AI-generated, edited, old, or shows someone or something else.
- made_up: a quote, story or event in the post is made up, for example by a parody or engagement account, or an ad is a scam.
- false_claim: the post makes another factual claim that sources can show is false or leaves out key context.
- partisan: the topic is so politically divisive that raters from the two sides would disagree about any note.
- raters_care: ordinary readers would care enough about the topic to rate a note on it.
Then give probability: that this post ends up with a helpful note.

Answer in JSON with those six numbers and "reason": at most 15 words.""",
}

PART_NAMES = ("fake_media", "made_up", "false_claim", "partisan", "raters_care")

SEARCH_LINE = "\n\nYou may search the web, but only when you cannot judge the post without it."
NEIGHBOUR_LINE = "\n\nYou also see similar earlier posts and whether they got a helpful note."

def response_format(prompt: str) -> dict:
    numbers = ["probability", *(PART_NAMES if prompt == "v3" else ())]
    properties = {name: {"type": "number"} for name in numbers} | {"reason": {"type": "string"}}
    return {
        "type": "json_schema",
        "json_schema": {
            "name": "verdict",
            "strict": True,
            "schema": {"type": "object", "properties": properties, "required": list(properties), "additionalProperties": False},
        },
    }


def format_count(value) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "?"
    value = float(value)
    for limit, suffix in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
        if value >= limit:
            return f"{value / limit:.1f}{suffix}"
    return str(int(value))


def media_lines(label: str, media) -> list[str]:
    if media is None or len(media) == 0:
        return []
    lines = []
    for item in media:
        parts = [item.get("description") or ""]
        if item.get("ocr"):
            parts.append(f"Text in it: {item['ocr']}")
        if item.get("transcript"):
            parts.append(f"Speech: {item['transcript']}")
        lines.append(f"{label} {item.get('type') or 'media'}: {' '.join(parts)[:MAX_MEDIA_CHARS]}")
    return lines


def referenced_kind(row) -> str:
    kinds = str(row["referenced_tweets"])
    if "quoted" in kinds:
        return "Quoted post"
    if "replied_to" in kinds:
        return "Post it replies to"
    return "Referenced post"


def author_label(row) -> str:
    return f"{row['author_name']} (@{row['author_handle']})" if row["author_handle"] else str(row["author_name"])


def tweet_card(row) -> str:
    seen = row["first_seen_at"]
    age_hours = (seen - row["posted_at"]).total_seconds() / 3600 if pd.notna(row["posted_at"]) else None
    bio = (row["author_description"] or "").replace("\n", " ")[:MAX_BIO_CHARS]
    lines = [
        f"Today is {seen:%Y-%m-%d}.",
        f"Author: {author_label(row)}, {format_count(row['author_followers'])} followers. Bio: {bio}",
        f"Posted {age_hours:.1f} hours ago. {format_count(row['impressions'])} views, {format_count(row['likes'])} likes, "
        f"{format_count(row['retweets'])} reposts, {format_count(row['replies'])} replies, {format_count(row['quotes'])} quotes."
        if age_hours is not None else "",
        "",
        f"Post: {(row['text'] or '')[:MAX_TEXT_CHARS]}",
    ]
    lines += media_lines("Attached", row["tweet_media"])
    referenced = row["referenced_tweet_data"]
    if isinstance(referenced, dict) and referenced.get("text"):
        lines += ["", f"{referenced_kind(row)}: {referenced['text'][:MAX_TEXT_CHARS]}"]
        lines += media_lines("Its attached", row["quoted_media"])
    return "\n".join(line for line in lines if line is not None)


def helpful_note_texts() -> dict[str, str]:
    notes = pd.read_parquet(DATA_DIR / "public_notes_since_2026_08.parquet", columns=["tweetId", "classification", "currentStatus", "summary"])
    helpful = notes[(notes["classification"] == MISLEADING) & (notes["currentStatus"] == HELPFUL)]
    return helpful.drop_duplicates("tweetId").set_index("tweetId")["summary"].to_dict()


def neighbour_outcome(row, note_texts: dict[str, str]) -> str:
    if row["helpful"]:
        note = (note_texts.get(row["tweet_id"]) or "").replace("\n", " ")[:MAX_NEIGHBOUR_NOTE_CHARS]
        return f"A note was rated helpful: {note}"
    if row["notes"] > 0:
        return f"{row['notes']} note(s) written, none rated helpful (most-rated note had {int(row['max_ratings'] or 0)} ratings)."
    return "No notes written."


def neighbour_block(position: int, df: pd.DataFrame, neighbour_index: np.ndarray, note_texts: dict[str, str]) -> str:
    lines = ["Similar earlier posts:"]
    for index in neighbour_index[position][:NEIGHBOURS_SHOWN]:
        if index < 0:
            break
        neighbour = df.iloc[index]
        text = (neighbour["text"] or "").replace("\n", " ")[:MAX_NEIGHBOUR_TEXT_CHARS]
        lines.append(f"- {author_label(neighbour)}: {text}\n  Outcome: {neighbour_outcome(neighbour, note_texts)}")
    return "\n".join(lines) if len(lines) > 1 else ""


def build_request(card: str, variant: str, neighbours: str, reasoning: str, prompt: str, model: str = MODEL) -> dict:
    system = SYSTEM_PROMPTS[prompt]
    user = card
    if "neighbours" in variant and neighbours:
        system += NEIGHBOUR_LINE
        user = f"{card}\n\n{neighbours}"
    body = {
        "model": model,
        "usage": {"include": True},
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": response_format(prompt),
        "reasoning": {"enabled": False} if reasoning == "off" else {"effort": reasoning},
    }
    if "search" in variant:
        body["messages"][0]["content"] += SEARCH_LINE
        body["tools"] = [{"type": "openrouter:web_search", "parameters": {"engine": "native", "max_results": SEARCH_MAX_RESULTS}}]
    return body


def parse_answer(response: dict) -> dict:
    content = response["choices"][0]["message"].get("content") or ""
    start, end = content.find("{"), content.rfind("}")
    answer = json.loads(content[start:end + 1])
    usage = response.get("usage", {})
    return {
        "probability": float(answer["probability"]),
        "reason": answer.get("reason", ""),
        **{name: float(answer[name]) for name in PART_NAMES if name in answer},
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
        "searches": (usage.get("server_tool_use_details") or {}).get("web_search_requests", 0),
        "cost": usage.get("cost"),
    }


async def judge(client: httpx.AsyncClient, body: dict, semaphore: asyncio.Semaphore) -> dict:
    async with semaphore:
        last_error = ""
        for attempt in range(MAX_ATTEMPTS):
            try:
                response = await client.post("https://openrouter.ai/api/v1/chat/completions", json=body)
                payload = response.json()
                if response.status_code == 200 and "choices" in payload:
                    return parse_answer(payload)
                last_error = str(payload)[:300]
            except (httpx.HTTPError, json.JSONDecodeError, KeyError, ValueError) as error:
                last_error = repr(error)[:300]
            await asyncio.sleep(2 ** attempt + random.random())
        return {"error": last_error}


def load_dataset() -> pd.DataFrame:
    # The neighbour arrays are indexed by row position, so the index must be 0..n-1.
    return pd.read_parquet(DATA_DIR / "dataset.parquet").reset_index(drop=True)


def pick_rows(df: pd.DataFrame, split: str, sample: int, seed: int) -> pd.DataFrame:
    part = df[df["split"] == split]
    return part.sample(n=min(sample, len(part)), random_state=seed) if sample else part


async def run(args) -> None:
    load_dotenv(".env")
    df = load_dataset()
    neighbour_index = np.load(DATA_DIR / "neighbour_index.npy")
    note_texts = helpful_note_texts() if "neighbours" in args.variant else {}
    rows = pick_rows(df, args.split, args.sample, args.seed)
    RUNS_DIR.mkdir(exist_ok=True)
    model_tag = "" if args.model == MODEL else args.model.split("/")[-1] + "_"
    out_path = RUNS_DIR / f"{model_tag}{args.prompt}_{args.variant}_{args.reasoning}_{args.split}_{args.sample}_{args.seed}.jsonl"
    done = {json.loads(line)["tweet_id"] for line in open(out_path)} if out_path.exists() else set()
    todo = [(position, row) for position, row in rows.iterrows() if row["tweet_id"] not in done]
    print(f"{len(todo)} of {len(rows)} tweets to judge into {out_path}", flush=True)

    headers = {"Authorization": f"Bearer {os.environ['OPENROUTER_TESTING_KEY']}"}
    semaphore = asyncio.Semaphore(CONCURRENCY)
    async with httpx.AsyncClient(headers=headers, timeout=REQUEST_TIMEOUT_SECONDS) as client:
        async def one(position, row):
            neighbours = neighbour_block(position, df, neighbour_index, note_texts) if "neighbours" in args.variant else ""
            body = build_request(tweet_card(row), args.variant, neighbours, args.reasoning, args.prompt, args.model)
            result = await judge(client, body, semaphore)
            return {"tweet_id": row["tweet_id"], **result}

        with out_path.open("a") as out:
            for finished, task in enumerate(asyncio.as_completed([one(p, r) for p, r in todo]), 1):
                out.write(json.dumps(await task) + "\n")
                if finished % 200 == 0:
                    out.flush()
                    print(f"{finished} done", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--variant", choices=["plain", "neighbours", "search", "neighbours_search"], required=True)
    parser.add_argument("--split", choices=["dev", "test"], required=True)
    parser.add_argument("--sample", type=int, default=0, help="0 means every tweet of the split")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--reasoning", choices=["off", "low", "medium"], default="low")
    parser.add_argument("--model", default=MODEL, help="an OpenRouter model id; the default is the filter's model")
    parser.add_argument("--prompt", choices=sorted(SYSTEM_PROMPTS), default="v2")
    parser.add_argument("--show", type=int, default=0, help="print this many requests and exit")
    args = parser.parse_args()
    if args.show:
        df = load_dataset()
        neighbour_index = np.load(DATA_DIR / "neighbour_index.npy")
        note_texts = helpful_note_texts()
        for position, row in pick_rows(df, args.split, args.show, args.seed).iterrows():
            body = build_request(tweet_card(row), args.variant, neighbour_block(position, df, neighbour_index, note_texts), args.reasoning, args.prompt)
            print(body["messages"][1]["content"], "\n---- label:", row["helpful"], "\n========")
        return
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
