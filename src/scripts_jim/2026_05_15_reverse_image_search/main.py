"""End-to-end: reverse-image-search a query image, then rank matches by
DINOv2/v3 cosine similarity computed by a hosted Modal endpoint.

Usage:
    .venv/bin/python src/scripts_jim/2026_05_15_reverse_image_search/main.py \\
        https://pbs.twimg.com/media/HIR6DJ0W4AACPXK.jpg

Or with a local file whose basename is an X media ID:
    .venv/bin/python src/scripts_jim/2026_05_15_reverse_image_search/main.py HIR6DJ0W4AACPXK.jpeg
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import sys
from dataclasses import asdict, dataclass

import requests

from reverse_search import LensMatch, ReverseSearchResult, reverse_search


MODAL_EMBED_URL = "https://jimmaar1--dino-embed-embedder-web-embed.modal.run"
TWITTER_MEDIA_ID = re.compile(r"^[A-Za-z0-9_-]{15}$")


@dataclass
class ScoredMatch:
    similarity: float
    match: LensMatch
    embedding_error: str | None = None


def resolve_image_argument(arg: str) -> tuple[str, bytes | None]:
    """Return (public_url, optional_local_bytes).

    Yandex needs a URL it can fetch. If the user passes a local file whose
    basename is an X media ID, rewrite to pbs.twimg.com (same convention as
    the existing lens_probe.py). Otherwise, require a URL.
    """
    if arg.startswith(("http://", "https://")):
        return arg, None
    stem = os.path.splitext(os.path.basename(arg))[0]
    if TWITTER_MEDIA_ID.match(stem) and os.path.exists(arg):
        with open(arg, "rb") as f:
            local_bytes = f.read()
        return f"https://pbs.twimg.com/media/{stem}.jpg", local_bytes
    raise SystemExit(
        f"'{arg}' is not a URL and its filename doesn't look like an X media ID. "
        "Pass an http(s) URL or a local file named after a public X media ID."
    )


def embed_url(url: str) -> tuple[list[float] | None, str | None]:
    """Call the Modal embedding endpoint with an image URL."""
    try:
        resp = requests.post(MODAL_EMBED_URL, json={"image_url": url}, timeout=120)
        resp.raise_for_status()
        body = resp.json()
        if "error" in body:
            return None, body["error"]
        return body.get("embedding"), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def embed_bytes(image_bytes: bytes) -> tuple[list[float] | None, str | None]:
    try:
        b64 = base64.b64encode(image_bytes).decode("ascii")
        resp = requests.post(MODAL_EMBED_URL, json={"image_b64": b64}, timeout=120)
        resp.raise_for_status()
        body = resp.json()
        if "error" in body:
            return None, body["error"]
        return body.get("embedding"), None
    except Exception as exc:  # pylint: disable=broad-except
        return None, str(exc)


def cosine(a: list[float], b: list[float]) -> float:
    # Embeddings are L2-normalized server-side, so cosine = dot product.
    return sum(x * y for x, y in zip(a, b))


async def run(image_arg: str, top_n: int) -> None:
    public_url, local_bytes = resolve_image_argument(image_arg)
    print(f"[1/4] Resolving query image: {public_url}")
    if local_bytes:
        query_emb, err = embed_bytes(local_bytes)
        print(f"      using local bytes ({len(local_bytes):,} bytes) for query embedding")
    else:
        query_emb, err = embed_url(public_url)
    if err or not query_emb:
        raise SystemExit(f"Query embedding failed: {err}")
    print(f"      query embedding dim={len(query_emb)}")

    print(f"[2/4] Reverse searching via Yandex Images…")
    rs: ReverseSearchResult = await reverse_search(public_url, top_n=top_n)
    print(f"      {len(rs.matches)} matches; object_summary={rs.object_summary[:120] if rs.object_summary else None!r}…")

    print(f"[3/4] Embedding match thumbnails and scoring…")
    scored: list[ScoredMatch] = []
    for i, m in enumerate(rs.matches):
        if not m.thumb_url:
            scored.append(ScoredMatch(similarity=float("nan"), match=m, embedding_error="no thumb_url"))
            continue
        emb, e = embed_url(m.thumb_url)
        if e or not emb:
            scored.append(ScoredMatch(similarity=float("nan"), match=m, embedding_error=e))
            continue
        sim = cosine(query_emb, emb)
        scored.append(ScoredMatch(similarity=sim, match=m))
        print(f"      [{i+1}/{len(rs.matches)}] sim={sim:.4f}  {m.source_domain}  {m.page_title[:60]}")

    scored.sort(key=lambda s: (-(s.similarity if s.similarity == s.similarity else -1)))

    print(f"\n[4/4] Final ranking (highest similarity first):")
    output = {
        "query_image_url": public_url,
        "object_summary": rs.object_summary,
        "scored_matches": [
            {
                "similarity": s.similarity if s.similarity == s.similarity else None,
                "embedding_error": s.embedding_error,
                **asdict(s.match),
            }
            for s in scored
        ],
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    arg = sys.argv[1]
    top_n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    asyncio.run(run(arg, top_n))


if __name__ == "__main__":
    main()
