import json

with open("src/scripts_jim/2026_05_28_judge_iter7_replay/judge_replay_results.json") as f:
    data = json.load(f)

no_rows = [r for r in data if not r.get("needsNote")]
yes_rows = [r for r in data if r.get("needsNote")]

fp_iter06 = sum(1 for r in no_rows if r.get("iter06NoteNeeded") is True)
fp_new = sum(1 for r in no_rows if r.get("newNoteNeeded") is True)
rec_iter06 = sum(1 for r in yes_rows if r.get("iter06NoteNeeded") is True)
rec_new = sum(1 for r in yes_rows if r.get("newNoteNeeded") is True)

print(f"writer_done rows: {len(data)}  (NO={len(no_rows)}, YES={len(yes_rows)})")
print()
print("=== FP side (needs_note=NO, judge would publish — LOWER better) ===")
print(f"  iter06={fp_iter06}  ->  new(superlative-fix)={fp_new}")
print()
print("=== Recall side (needs_note=YES, judge keeps note — HIGHER better) ===")
print(f"  iter06={rec_iter06}  ->  new(superlative-fix)={rec_new}")
print()

# Did the 2 targeted recoveries land?
targets = {
    "2004909604052889910": "Minnesota election law (TARGET)",
    "2039707797244215475": "Trump 29% approval (TARGET)",
    "2039395207213670691": "April-1 joke",
    "2016932474081657121": "pancreatic-cancer-mice",
    "2044830697127321794": "Brazil Africans",
}
by_id = {r.get("tweetId"): r for r in data}
print("=== The 5 previously-killed good notes — recovered? ===")
for tid, label in targets.items():
    r = by_id.get(tid)
    nn = r.get("newNoteNeeded") if r else None
    status = "RECOVERED (approves)" if nn is True else ("still killed" if nn is False else "missing")
    print(f"  {label:38s} iter06={r.get('iter06NoteNeeded') if r else '?'}  new={nn}  -> {status}")
