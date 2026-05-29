import json

with open("src/scripts_jim/2026_05_28_judge_iter7_replay/judge_replay_results.json") as f:
    data = json.load(f)

targets = {
    "2016932474081657121": "pancreatic-cancer-mice",
    "2039395207213670691": "April-1 joke",
    "2004909604052889910": "Minnesota election law",
    "2039707797244215475": "Trump 29% approval",
    "2044830697127321794": "Brazil Africans",
}
by_id = {r.get("tweetId"): r for r in data}

for tid, label in targets.items():
    r = by_id.get(tid)
    print("=" * 100)
    bucket = r.get("bucket") if r else "MISSING"
    print(f"[{label}]  tweet {tid}  bucket={bucket}")
    if not r:
        print("  NOT FOUND IN RESULTS")
        continue
    print(f"  needsNote(GT)={r.get('needsNote')}  iter06={r.get('iter06NoteNeeded')}  iter07={r.get('newNoteNeeded')}")
    print("\n--- POST CONTEXT ---")
    print((r.get("userMessage") or "")[:1800])
    print("\n--- NOTE TEXT ---")
    print(r.get("noteText") or "")
    print("\n--- SOURCES ---")
    for s in (r.get("sources") or []):
        print("   ", s)
    print("\n--- NEW JUDGE REASONING (why it now KILLS) ---")
    print(r.get("reasoning") or "")
    print()
