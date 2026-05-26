"""
Phase 6b: normalize annotation files to v2 taxonomy.

- Role names: collapse mixed camelCase + snake_case variants to the v2 form
  (`unhelpful_<snake_case_reason>`).
- Categories: map every entry to the 18 v2 territory categories
  (13 originals + 5 promoted) listed in datasets/big_eval/CATEGORIES.md.
  Entries that don't fit any territory category are dropped (they're already
  captured by no_note_reason or role).
- Backfill missing v2 fields on the few pilot annotations
  (`provisional_role`, `disagrees_with_provisional`, `no_note_reason`,
  `media_confidence`). `provisional_role` is read from selected.jsonl.

Idempotent. Writes a one-shot summary; rewrites every annotation in place.

  uv run src/scripts_jim/2026_05_25_big_eval_dataset/07_normalize_categories.py
  uv run .../07_normalize_categories.py --dry-run     # report only, write nothing
"""
import argparse
import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
BIG_EVAL = HERE.parent.parent.parent / "datasets" / "big_eval"
ANN_DIR = BIG_EVAL / "annotations"
SELECTED = BIG_EVAL / "selected.jsonl"

V2_CATEGORIES = {
    "ai_generated_media",
    "misattributed_or_miscontextualized_media",
    "manipulated_or_fabricated_evidence",
    "staged_or_scripted_content",
    "breaking_news_and_war",
    "statistical_or_numerical_claim",
    "conspiracy_and_viral_hoax",
    "politics_and_policy",
    "health_medical_science",
    "overhyped_research_or_product",
    "scams_fraud_finance",
    "platform_manipulation",
    "celebrity_entertainment_sports",
    "joke_or_satire",
    "real_media_falsely_called_ai",
    "antisemitic_conspiracy",
    "legal_or_court_claim",
    "fabricated_quote",
}

ROLE_REMAP = {
    "unhelpful_notHelpfulMissingKeyPoints": "unhelpful_missing_key_points",
    "unhelpful_notHelpfulOpinionSpeculation": "unhelpful_opinion_speculation",
    "unhelpful_notHelpfulIncorrect": "unhelpful_incorrect",
    "unhelpful_notHelpfulSourcesMissingOrUnreliable": "unhelpful_sources_missing_or_unreliable",
    "unhelpful_notHelpfulNoteNotNeeded": "unhelpful_note_not_needed",
    "unhelpful_notHelpfulIrrelevantSources": "unhelpful_irrelevant_sources",
    "unhelpful_notHelpfulHardToUnderstand": "unhelpful_hard_to_understand",
    "unhelpful_incorrect_detail": "unhelpful_incorrect",
    "unhelpful_incorrect_numbers": "unhelpful_incorrect",
    "unhelpful_unreliable_sources": "unhelpful_sources_missing_or_unreliable",
    "unhelpful_sources": "unhelpful_sources_missing_or_unreliable",
    "unhelpful_needs_more_ratings": "unhelpful_other",
}

CATEGORY_REMAP = {
    "humor_meme": "joke_or_satire",
    "joke_or_meme": "joke_or_satire",
    "satire_parody": "joke_or_satire",
    "satire_or_joke_misread": "joke_or_satire",
    "satire_or_joke": "joke_or_satire",
    "satire_mistaken_as_real": "joke_or_satire",
    "satire_or_parody": "joke_or_satire",
    "satire_or_persona_critique": "joke_or_satire",
    "satire_or_comedy": "joke_or_satire",
    "ai_generated_or_manipulated_media": "ai_generated_media",
    "ai_generated_video": "ai_generated_media",
    "accurate_reporting_of_ai_image": "real_media_falsely_called_ai",
    "political_misinformation": "politics_and_policy",
    "us_politics": "politics_and_policy",
    "government_politics": "politics_and_policy",
    "political_misframing_or_misleading_context": "politics_and_policy",
    "political_domestic": "politics_and_policy",
    "historically_false_political_claim": "politics_and_policy",
    "election_misinformation": "politics_and_policy",
    "election_integrity": "politics_and_policy",
    "politics_elections": "politics_and_policy",
    "us_immigration_ice": "politics_and_policy",
    "immigration_demographics": "politics_and_policy",
    "economic_or_market_claim": "statistical_or_numerical_claim",
    "economic_misinformation": "statistical_or_numerical_claim",
    "misquoted_per_year_vs_total": "statistical_or_numerical_claim",
    "court_case_legal_claim": "legal_or_court_claim",
    "crime_legal": "legal_or_court_claim",
    "impersonation_or_fake_account": "platform_manipulation",
    "impersonation_or_false_authority": "platform_manipulation",
    "religion_prophecy": "conspiracy_and_viral_hoax",
    "fabricated_event_claim": "manipulated_or_fabricated_evidence",
    "out_of_context_quote": "fabricated_quote",
    "health_and_medical_misinformation": "health_medical_science",
    "health_and_science_misinformation": "health_medical_science",
    "climate_environment_science": "health_medical_science",
    "scaremongering_chemical_claim": "health_medical_science",
    "science_physics_demo": "health_medical_science",
    "tech_ai_safety": "overhyped_research_or_product",
    "ai_tech_industry": "overhyped_research_or_product",
    "outdated_news_recirculated": "misattributed_or_miscontextualized_media",
    "business_finance": "scams_fraud_finance",
}

DROP_CATEGORIES = {
    "tech_business",
    "insider_reporting_framing",
    "opinion_listicle",
    "snarky_reply_no_claim",
    "feel_good_viral_unverified",
    "rival_community_banter",
    "insinuation_framed_as_question",
    "wholesome_anecdote_unverifiable",
    "viral_lifestyle_trend",
    "media_press_relations",
    "obvious_satire_greenwashing_parody",
    "unverifiable_deleted_screenshot",
    "anecdotal_personal_story",
    "personal_anecdote",
    "personal_anecdote_engagement_bait",
    "science_curiosity_post",
}


def normalize_role(role: str) -> str:
    return ROLE_REMAP.get(role, role)


def normalize_categories(cats: list[str]) -> list[str]:
    out: list[str] = []
    for c in cats or []:
        if c in V2_CATEGORIES:
            mapped = c
        elif c in CATEGORY_REMAP:
            mapped = CATEGORY_REMAP[c]
        elif c in DROP_CATEGORIES:
            continue
        else:
            continue
        if mapped not in out:
            out.append(mapped)
    return out


def load_provisional_roles() -> dict[str, str]:
    return {str(json.loads(ln)["tweet_id"]): json.loads(ln).get("role", "") for ln in SELECTED.open()}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    provisional_by_tid = load_provisional_roles()

    changed = 0
    dropped_cats: Counter[str] = Counter()
    role_changes: Counter[tuple[str, str]] = Counter()
    cat_changes: Counter[tuple[str, str]] = Counter()
    backfilled_fields: Counter[str] = Counter()
    summary_roles: Counter[str] = Counter()
    summary_cats: Counter[str] = Counter()
    summary_no_note: Counter[str] = Counter()

    for fp in sorted(ANN_DIR.glob("*.json")):
        a = json.loads(fp.read_text())
        original = json.dumps(a, sort_keys=True)

        old_role = a.get("role", "")
        new_role = normalize_role(old_role)
        if new_role != old_role:
            role_changes[(old_role, new_role)] += 1
            a["role"] = new_role

        old_cats = list(a.get("categories", []))
        new_cats = normalize_categories(old_cats)
        for c in old_cats:
            if c not in new_cats:
                norm = CATEGORY_REMAP.get(c, c if c in V2_CATEGORIES else None)
                if norm is None:
                    dropped_cats[c] += 1
                elif norm != c:
                    cat_changes[(c, norm)] += 1
        a["categories"] = new_cats

        if "provisional_role" not in a:
            prov = provisional_by_tid.get(str(a.get("tweet_id", "")), "")
            a["provisional_role"] = normalize_role(prov) if prov else new_role
            backfilled_fields["provisional_role"] += 1
        else:
            a["provisional_role"] = normalize_role(a["provisional_role"])

        if "disagrees_with_provisional" not in a:
            a["disagrees_with_provisional"] = a["role"] != a["provisional_role"]
            backfilled_fields["disagrees_with_provisional"] += 1
        if "no_note_reason" not in a:
            a["no_note_reason"] = ""
            backfilled_fields["no_note_reason"] += 1
        if "media_confidence" not in a:
            a["media_confidence"] = "high"
            backfilled_fields["media_confidence"] += 1

        summary_roles[a["role"]] += 1
        for c in a["categories"]:
            summary_cats[c] += 1
        if a.get("needs_note") == "no":
            summary_no_note[a.get("no_note_reason", "")] += 1

        if json.dumps(a, sort_keys=True) != original:
            changed += 1
            if not args.dry_run:
                fp.write_text(json.dumps(a, indent=2))

    print(f"Files: {sum(summary_roles.values())} total, {changed} {'would change' if args.dry_run else 'rewritten'}.")
    print("\n== role remaps applied ==")
    for (a, b), c in role_changes.most_common():
        print(f"  {c:4d}  {a}  →  {b}")
    print("\n== category remaps applied ==")
    for (a, b), c in cat_changes.most_common():
        print(f"  {c:4d}  {a}  →  {b}")
    print("\n== categories dropped (no v2 fit) ==")
    for c, n in dropped_cats.most_common():
        print(f"  {n:4d}  {c}")
    print("\n== fields backfilled ==")
    for k, c in backfilled_fields.most_common():
        print(f"  {c:4d}  {k}")
    print("\n== POST-NORMALIZATION roles ==")
    for r, c in summary_roles.most_common():
        print(f"  {c:4d}  {r}")
    print("\n== POST-NORMALIZATION categories ==")
    for c, n in summary_cats.most_common():
        print(f"  {n:4d}  {c}")
    print("\n== POST-NORMALIZATION no_note_reasons ==")
    for r, c in summary_no_note.most_common():
        print(f"  {c:4d}  {r}")


if __name__ == "__main__":
    main()
