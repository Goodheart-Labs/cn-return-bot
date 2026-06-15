"""Update judge_guidance for two reviewed rows, then they get synced via
sync_valset_row.py. Both stay needs_note=no.

- Tents (2010758934366507334): our note affirms the real drone-concealment use
  AND cites real reporting (Militarnyi) — that is the "borderline-acceptable
  additive context" case, so it should tier DIRECTIONAL (harmless FP), not bad.
  Only the dismissive "not military tech"+shopping-links note is bad. The old
  "PASS only if declines" wording tripped evaluateResults.ts:185 (decline-guidance
  => any note bad), over-penalizing our accurate note.
- Kirk comedy (2052825590319690191): make the BAD tier explicit — fact-checking
  an overt stand-up bit as if sincere is a HARD false positive, never harmless,
  even when the Kirk facts are individually stated.
"""
import json
from pathlib import Path

ANN = Path(__file__).resolve().parents[3] / "datasets" / "big_eval" / "annotations"

TENTS_GUIDANCE = (
    "The tweet correctly (and hedged: 'unknown technology... apparently') reports a "
    "REAL, OSINT-documented Russian tactic — commercial pop-up shower/toilet tents "
    "repurposed as individual soldier shelters to evade FPV/thermal drones. Declining "
    "is the cleanest action (the post is substantially accurate). Tier any published "
    "note thus: BAD if it is dismissive like the original — claiming these are 'just "
    "commercial/toilet tents, NOT military technology / not for infantry use' (that "
    "contradicts the documented tactic and the video's own training audio) or if it "
    "cites only shopping listings. DIRECTIONAL (accurate but unnecessary) if it BOTH "
    "affirms that Russia is fielding the tents as improvised concealment against drones "
    "AND cites real reporting on the tactic (e.g. Militarnyi, United24, The Sun); "
    "correcting the tweet's hedged 'winter weather' guess to the documented "
    "drone-concealment purpose is acceptable context, not a debunk of an accurate post. "
    "GOOD is unavailable here — the underlying report is already true, so no published "
    "note is a needed correction."
)

KIRK_GUIDANCE = (
    "PASS only if the bot declines to write a note — this is overt stand-up comedy "
    "(known comedian Sammy Obeid, audience laughter, 'like and subscribe' framing). "
    "Tier ANY published note as BAD (a hard false positive), never directional/harmless: "
    "fact-checking the explosive-microphone / Iranian-general bit treats a joke as a "
    "sincere claim and misreads the post's genre entirely. This holds even when the "
    "note's Kirk facts are individually accurate, and a literal fact-check does not even "
    "engage the bit's actual content. The bot should recognize stand-up satire from the "
    "transcript (jokes, audience reaction, comedian's framing) and decline."
)

for tid, guidance in [("2010758934366507334", TENTS_GUIDANCE),
                       ("2052825590319690191", KIRK_GUIDANCE)]:
    p = ANN / f"{tid}.json"
    d = json.loads(p.read_text())
    d["judge_guidance"] = guidance
    p.write_text(json.dumps(d, indent=2, ensure_ascii=True) + "\n")
    print(f"updated {tid}: {len(guidance)} chars")
