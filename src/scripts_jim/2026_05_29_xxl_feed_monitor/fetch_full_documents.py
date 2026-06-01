"""Fetch the full ground-truth articles for each misinfo topic and write the
clean article body (markdown) to misinfo-monitoring/documents/<id>.md.

The briefs stay as the distilled selection-LLM input; only the documents become
the full undistilled articles injected into the research step.

Run: uv run --with trafilatura src/scripts_jim/2026_05_29_xxl_feed_monitor/fetch_full_documents.py
Pass a topic id to fetch only that one (avoids clobbering already-trimmed docs):
     uv run --with trafilatura ...fetch_full_documents.py ai_training_emissions
"""

import sys
from pathlib import Path
import trafilatura

DOCS = Path("src/pipeline/misinfo-monitoring/documents")

URLS = {
    "ai_water": "https://blog.andymasley.com/p/the-ai-water-issue-is-fake",
    "datacenter_land": "https://blog.andymasley.com/p/data-center-land-use-issues-are-fake",
    "ai_energy_carbon": "https://blog.andymasley.com/p/a-cheat-sheet-for-conversations-about",
    "ai_training_emissions": "https://blog.andymasley.com/p/training-ai-models-doesnt-emit-that",
    "ea_achievements": "https://willmacaskill.substack.com/p/300000-lives-100-million-hens-and",
    "openai_dod": "https://www.techpolicy.press/five-unresolved-issues-in-openais-deal-with-the-department-of-defense/",
    "save_our_bacon": "https://forum.effectivealtruism.org/posts/vsYphZaBcXpmtNizp/time-sensitive-stop-one-of-biggest-threats-for-animal",
}

only = sys.argv[1] if len(sys.argv) > 1 else None
urls = {only: URLS[only]} if only else URLS

for topic_id, url in urls.items():
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        print(f"{topic_id}: FETCH FAILED")
        continue
    text = trafilatura.extract(
        downloaded,
        output_format="markdown",
        include_links=True,
        include_comments=False,
        favor_recall=True,
    )
    if not text:
        print(f"{topic_id}: EXTRACT FAILED")
        continue
    out = DOCS / f"{topic_id}.md"
    out.write_text(text.strip() + "\n", encoding="utf-8")
    print(f"{topic_id}: {len(text)} chars -> {out}")
