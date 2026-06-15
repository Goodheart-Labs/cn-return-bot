"""Extract trimmed, human-readable per-category rows from iter-06 bucket JSONs
so subagents get clean inputs (no giant `logs` blob, no search_results)."""
import json
import os

RUN = "dataset_runs/tryout-iter-06-cheap-bot-2026-05-28-1918"
OUT = "src/scripts_jim/2026_05_28_iter6_fp_analysis"
BRIEF_CAP = 3500

SOURCES = {
    "fp": "nnw_fp_published.json",            # 18 false positives
    "published_bad": "nw_published_bad.json",  # 16 note-worthy but bad note
    "good": "nw_success.json",                 # 23 good published notes
}


def get(d, *path):
    for p in path:
        if isinstance(d, dict):
            d = d.get(p)
        elif isinstance(d, list) and isinstance(p, int) and p < len(d):
            d = d[p]
        else:
            return None
    return d


def trim(row):
    logs = row.get("logs") or {}
    cheap = logs.get("cheapBot") or {}

    # writer first attempt
    writer = get(logs, "simpleBot", "writer", "attempts", "0") or get(logs, "simpleBot", "writer", "attempts", 0) or {}
    writer_resp = writer.get("response") or {}

    # judge decision
    judge = get(logs, "simpleBot", "judge", "messages", "1") or get(logs, "simpleBot", "judge", "messages", 1) or {}
    judge_content = judge.get("content") if isinstance(judge, dict) else None

    # source verifier final turn
    sv = logs.get("sourceVerifier") or {}
    sv_turns = sv.get("turn") or {}
    sv_last = None
    if isinstance(sv_turns, dict) and sv_turns:
        last_key = sorted(sv_turns.keys())[-1]
        sv_msgs = get(sv_turns[last_key], "messages") or {}
        if isinstance(sv_msgs, dict) and sv_msgs:
            sv_last = sv_msgs.get(sorted(sv_msgs.keys())[-1])
    sv_content = sv_last.get("content") if isinstance(sv_last, dict) else None

    brief = cheap.get("analyzedFindings") or cheap.get("searchAnalysis") or ""
    if isinstance(brief, str) and len(brief) > BRIEF_CAP:
        brief = brief[:BRIEF_CAP] + "\n…[truncated]"

    pub_verdict = row.get("_v2_published_note_verdict") or {}
    prop_verdict = row.get("_v2_proposed_note_verdict") or {}

    return {
        "url": row.get("url"),
        "tweet_text": row.get("text"),
        "needs_note_ground_truth": row.get("needs_note"),
        "ground_truth_note": row.get("ground_truth_note") or None,
        "judge_guidance": row.get("judge_guidance") or None,
        "original_note_text": row.get("original_note_text") or None,
        "original_note_failure_reason": row.get("failure_reason") or None,
        "published_note": row.get("note_text") or None,
        "stage_block": row.get("_v2_stage_block"),
        "eval_published_verdict": {"correct": pub_verdict.get("correct"), "reason": pub_verdict.get("reason")} if pub_verdict else None,
        "eval_proposed_verdict": {"correct": prop_verdict.get("correct"), "reason": prop_verdict.get("reason")} if prop_verdict else None,
        "pipeline": {
            "search_queries": cheap.get("queries"),
            "research_brief": brief or None,
            "writer_note": writer_resp.get("note_text"),
            "writer_sources": writer_resp.get("sources"),
            "judge_note_needed": get(judge_content, "note_needed") if isinstance(judge_content, dict) else None,
            "judge_reasoning": get(judge_content, "reasoning") if isinstance(judge_content, dict) else None,
            "verifier_accepted": get(sv_content, "accepted") if isinstance(sv_content, dict) else None,
            "verifier_good_sources": get(sv_content, "good_sources") if isinstance(sv_content, dict) else None,
            "verifier_bad_sources": get(sv_content, "bad_sources") if isinstance(sv_content, dict) else None,
            "verifier_reasoning": get(sv_content, "reasoning") if isinstance(sv_content, dict) else None,
        },
    }


for label, fname in SOURCES.items():
    rows = json.load(open(os.path.join(RUN, fname)))
    trimmed = [trim(r) for r in rows]
    out_path = os.path.join(OUT, f"{label}.json")
    json.dump(trimmed, open(out_path, "w"), indent=2, ensure_ascii=False)
    sizes = os.path.getsize(out_path)
    print(f"{label:14s} {len(trimmed):3d} rows -> {out_path} ({sizes//1024} KB)")
