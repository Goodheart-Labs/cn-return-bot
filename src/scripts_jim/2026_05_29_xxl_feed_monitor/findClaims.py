"""Keyword-filter the XXL feed dump into per-topic candidate sets for misinfo review."""
import json
import re
from pathlib import Path

HERE = Path(__file__).parent
DUMP = HERE / "from_actions" / "feed_dump.jsonl"
OUT = HERE / "candidates"
OUT.mkdir(exist_ok=True)

posts = []
with DUMP.open() as f:
    for line in f:
        line = line.strip()
        if line:
            posts.append(json.loads(line))

def blob(p: str) -> str:
    return f"{p.get('text') or ''}\n{p.get('quoted_text') or ''}".lower()

AI = r"(\bai\b|\ba\.i\.?|chatgpt|chat gpt|openai|\bllm\b|artificial intelligence|\bgpt\b|gemini|\bgrok\b|chatbot|data ?cent(er|re))"
ENERGY = r"(energy|electricit|\bkwh\b|\bwatt|carbon|emission|\bco2\b|climate|power grid|fossil|environment|footprint|greenhouse)"

TOPICS = {
    "1_ai_water": lambda t: re.search(r"\bwater\b", t) and re.search(AI, t),
    "2_datacenter_land": lambda t: re.search(r"data ?cent(er|re)", t)
        and re.search(r"(farmland|farm land|\bfarms?\b|\bacres?\b|agricultur|cropland|\bland use\b|\bfarmer)", t),
    "3_ai_energy_carbon": lambda t: re.search(r"(chatgpt|chat gpt|openai|\bllm\b|chatbot|\bprompt|\bquer)", t)
        and re.search(ENERGY, t),
    "4_openai_dod_lawful": lambda t: re.search(r"(openai|chatgpt|sam altman|anthropic|\bai\b)", t)
        and re.search(r"(pentagon|department of defense|\bdod\b|defense department|\bmilitary\b|warfight|surveillance|autonomous weapon|lawful use)", t),
    "5_save_our_bacon": lambda t: re.search(r"(save our bacon|\bsob act\b|prop(osition)? ?12|question 3|gestation crate|veal crate|(farm bill).{0,40}(animal|pork|\bpig|\bhog))", t),
}

summary = {}
for name, pred in TOPICS.items():
    matched = [p for p in posts if pred(blob(p))]
    summary[name] = len(matched)
    with (OUT / f"{name}.txt").open("w") as out:
        for p in matched:
            out.write(f"=== {p['id']} | @{p.get('author_name')} | impressions={p.get('impressions')} ===\n")
            out.write("TWEET: " + (p.get("text") or "") + "\n")
            if p.get("quoted_text"):
                out.write("QUOTED: " + p["quoted_text"] + "\n")
            out.write("\n")

print(f"total posts: {len(posts)}")
for name, n in summary.items():
    print(f"  {name}: {n} candidate posts")
