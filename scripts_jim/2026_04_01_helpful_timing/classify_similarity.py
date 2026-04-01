"""
Classify whether each (helpful, NMR) note pair addresses the same claim/issue.
Uses Haiku for speed/cost.
"""
import os, json, time
from pathlib import Path
from dotenv import load_dotenv
import httpx

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

API_KEY = os.environ["OPENROUTER_API_KEY"]
MODEL = "anthropic/claude-haiku-4.5"
URL = "https://openrouter.ai/api/v1/chat/completions"

pairs = json.loads((Path(__file__).parent / "march_pairs.json").read_text())
print(f"Classifying {len(pairs)} pairs...")

def classify(pair):
    prompt = f"""Two community notes on the same tweet. Do they make essentially the same correction/claim? Reply with JSON: {{"similar": true/false}}

Note A (helpful): {pair['helpful_text'][:500]}

Note B (NMR): {pair['nmr_text'][:500]}"""

    resp = httpx.post(URL, headers={"Authorization": f"Bearer {API_KEY}"},
        json={"model": MODEL, "messages": [{"role": "user", "content": prompt}],
              "response_format": {"type": "json_object"}},
        timeout=30)
    data = resp.json()
    if "choices" not in data:
        raise ValueError(f"API error: {json.dumps(data)[:200]}")
    return json.loads(data["choices"][0]["message"]["content"])["similar"]

for i, p in enumerate(pairs):
    if not p["helpful_text"] or not p["nmr_text"]:
        p["similar"] = None
        continue
    try:
        p["similar"] = classify(p)
    except Exception as e:
        print(f"  Pair {i} error: {e}")
        p["similar"] = None
    if (i + 1) % 20 == 0:
        print(f"  {i+1}/{len(pairs)}")

out = Path(__file__).parent / "march_pairs_classified.json"
out.write_text(json.dumps(pairs, indent=2))

similar = [p for p in pairs if p.get("similar") is True]
not_similar = [p for p in pairs if p.get("similar") is False]
null = [p for p in pairs if p.get("similar") is None]

print(f"\nSimilar: {len(similar)}, Not similar: {len(not_similar)}, Unknown: {len(null)}")

# Analysis on similar pairs only
h_first = sum(1 for p in similar if p["helpful_first"])
n_first = len(similar) - h_first
print(f"\n=== SIMILAR PAIRS ONLY (n={len(similar)}) ===")
if similar:
    print(f"Helpful written earlier: {h_first} ({h_first/len(similar):.1%})")
    print(f"NMR written earlier:     {n_first} ({n_first/len(similar):.1%})")

# Also break out by whether ours is helpful or NMR
our_h = [p for p in similar if p["helpful_is_ours"]]
our_n = [p for p in similar if p["nmr_is_ours"]]
print(f"\n  Our note is the helpful one: {len(our_h)}")
print(f"  Our note is the NMR one:     {len(our_n)}")
