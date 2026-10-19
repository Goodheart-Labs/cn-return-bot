---
target: critique everything (Common Notes frontend)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:/home/jim/dev/repos/cn-return-bot--feature-website-homepage-redesign/src/everything-web"
timestamp: 2026-09-28T21-51-29Z
slug: src-everything-web
---
Method: dual-agent (A: design review · B: detector and browser). Second run, after the fix plan.

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Status card count ambiguous; margin dot shows no count or status |
| 2 | Match System / Real World | 3 | "Note not needed", "Somewhat" unexplained; "Notes" page lists creators |
| 3 | User Control and Freedom | 3 | No Escape on the Substack note; YouTube card fades while reading |
| 4 | Consistency and Standards | 2 | Four install-button labels; pills shift while the hint shows; screenshot shows old note |
| 5 | Error Prevention | 3 | Delete confirmed; Share fails silently |
| 6 | Recognition Rather Than Recall | 3 | Icon-only jump chip and margin dot |
| 7 | Flexibility and Efficiency | 2 | No extension keyboard shortcuts |
| 8 | Aesthetic and Minimalist Design | 2 | Action links, chip and disclosure crowd the note; neutral pills share the link blue |
| 9 | Error Recovery | 3 | Plain errors with retry; extension "Something went wrong" |
| 10 | Help and Documentation | 2 | In-context help; no explanation of rating states or how it works |
| **Total** | | **26/40** | **Acceptable** |

## Design Specificity Verdict
Core authored for Common Notes (passage tint, margin rail, timed video card, rating-panel hint). Shell interchangeable (stock palette, system font, generic headline); the logo's coloured pills never reappear except in the colourful rating pills. Detector: CLI clean on all targets; browser: one real minor layout-transition (carousel dot animates width), false positives elsewhere from Storybook's shared stylesheet.

## Priority Issues
- [P1] Homepage screenshot shows the old note design; unreadable on phones; arrows cover it. Retake, crop tight, update alt text, move arrows. /impeccable polish
- [P1] Note action clutter buries the rating; neutral pills share the link blue. Grey action row, merge "Note not needed" button into its disclosure. /impeccable distill
- [P1] YouTube card covers two thirds of the video. Compact by default (~380 px, lower right), expand on click. /impeccable adapt
- [P2] Extension markers keyboard-inaccessible; margin dot 2.5:1. Focus ring, status in aria-label, darker dot, focus management and Escape. /impeccable harden
- [P2] AI-written notes not labelled. "Written by AI" in the author slot. /impeccable clarify

## Pills
Reviewer recommends colourful with calmer idle (grey border, coloured text, fill on select).

## Persona Red Flags
Jordan: "Notes" lists creators; icon-only chip; faint margin dot. Casey: tight header; unreadable screenshots; repeated computer sentence; "No" wraps; 40 px targets. Sam: markers mouse-only; claim not read out. Priya: X look-alike; no AI label; margin card has no mark or close.

## Minor Observations
Classic badge overlaps next word; Unicode ✎ icon in green for a neutral fact; initial placeholders look unfinished; leaderboard "(you)" by name match.
