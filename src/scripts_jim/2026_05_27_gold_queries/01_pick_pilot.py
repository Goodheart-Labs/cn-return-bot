"""Pick a 20-row stratified pilot from the train pool for gold-query discovery."""
import json, collections, random
random.seed(42)

ROWS = [json.loads(l) for l in open("datasets/query_writer_eval/train.jsonl")]

# Target counts per category (sum ~20, stratified by frequency, floor 1 for top tail)
TARGETS = {
    "misattributed_or_miscontextualized_media": 5,
    "conspiracy_and_viral_hoax": 3,
    "politics_and_policy": 2,
    "ai_generated_media": 2,
    "breaking_news_and_war": 2,
    "statistical_or_numerical_claim": 2,
    "manipulated_or_fabricated_evidence": 1,
    "health_medical_science": 1,
    "celebrity_entertainment_sports": 1,
    "scams_fraud_finance": 1,
}

by_cat = collections.defaultdict(list)
for r in ROWS:
    by_cat[r["primary_category"]].append(r)

picked = []
for cat, n in TARGETS.items():
    pool = by_cat.get(cat, [])
    random.shuffle(pool)
    picked.extend(pool[:n])

print(f"Picked {len(picked)} pilot rows:")
for r in picked:
    print(f"  {r['tweet_id']}  {r['primary_category']:50s}  {r['tweet_text'][:60].replace(chr(10), ' ')}...")

with open("src/scripts_jim/2026_05_27_gold_queries/pilot_rows.jsonl", "w") as f:
    for r in picked:
        f.write(json.dumps(r) + "\n")
print(f"\nWrote {len(picked)} rows.")
