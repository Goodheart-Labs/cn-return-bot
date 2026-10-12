---
target: critique everything (Common Notes frontend)
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/jim/dev/repos/cn-return-bot--feature-website-homepage-redesign/src/everything-web"
timestamp: 2026-09-28T19-31-10Z
slug: src-everything-web
---
Method: dual-agent (A: design review · B: detector and browser)

Target: the whole Common Notes frontend (homepage, projects overview, project page, leaderboard, extension on Substack and YouTube), rendered from Storybook, offline (web fonts fell back).

## Design Health Score
| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Clear rating states; bare "Loading…"; status card vanishes after 7 s |
| 2 | Match System / Real World | 2 | Pitch opens with Twitter/X, "initial user base", "Impressum", unexplained "Note not needed" |
| 3 | User Control and Freedom | 3 | Dismissible nudges and cards; "Write a note" dead end |
| 4 | Consistency and Standards | 2 | "Community note" vs "Common Notes"; extension "coming soon" vs live install; same box for helpful and needs-ratings |
| 5 | Error Prevention | 2 | Delete without confirm; phones sent to desktop stores |
| 6 | Recognition Rather Than Recall | 3 | Text labels; icon-only jump chips |
| 7 | Flexibility and Efficiency | 3 | Remembered sort, resizable list, draggable video card; no rating shortcuts |
| 8 | Aesthetic and Minimalist Design | 2 | Note card nests boxes three deep, raw URLs, many secondary actions |
| 9 | Error Recovery | 2 | Projects retry good; leaderboard no retry; raw error text in composers |
| 10 | Help and Documentation | 1 | Nothing explains "rated helpful" or donations |
| **Total** | | **23/40** | **Acceptable** |

## Design Specificity Verdict
Product surfaces (one shared note on web, Substack margin, YouTube card; hidden tallies; margin dot) are authored for Common Notes. The homepage is deliberately the category standard but keeps too little product signal: the first viewport never says extension, notes, Substack or YouTube, and the dark screenshot is unreadable on phones. The direction contract still names Hanken Grotesk; tokens now use Substack's system stacks (Jim's pinned choice), so the contract needs updating.
Detector: 3 side-tab hits (grey 4px rails; mostly false positives). Browser: low-contrast real (fg-subtle on surface-muted 2.4:1; fg-muted on tint 4.4:1), nested-cards real (10 project page, 2 YouTube), text-occlusion from VotingNudge real (4), link-overlap and layout-transition false positives.

## Priority Issues
- [P1] Voting nudge covers the note it asks to rate (web, Substack, YouTube). Fix: inline message in the rating row, or anchor below the pills. /impeccable layout, /impeccable clarify
- [P1] Phones sent to a desktop store from the homepage hero (Android Chrome, iOS dead end). Fix: pointer:fine check, "runs on a computer" message plus Read the notes link. /impeccable adapt
- [P1] First viewport does not say what Common Notes is; pitch leads with X and team-speak; three positioning points missing. Fix: one product subline under the headline; pitch leading with Common Notes. /impeccable clarify
- [P1] "Write a note" opens a "Coming Soon!" modal while the extension is live. Fix: explain writing in the extension plus store button. /impeccable onboard
- [P2] Note card noise: nested boxes, raw broken URLs, coloured idle pills, uppercase NOTE NOT NEEDED, fg-subtle text at 2.4:1; helpful and needs-ratings share one box. /impeccable distill, /impeccable polish

## Persona Red Flags
Jordan: no "extension"/"notes" above the fold; Impressum; sort by votes shows note counts; "rated helpful" unexplained. Casey: store button useless; screenshot unreadable; 24px pills, "Not helpful" wraps; sort control wraps; cramped header; long centred serif pitch. Sam: grey-400 text 2.5:1; status card timer not paused by focus; header links default focus outline; voting nudge not announced. Priya (daily ACX/Zvi reader): margin dot easy to miss; nudge covers note; rating basis unexplained; donations invisible before voting.

## Minor Observations
Leaderboard title left while content centred, no chevron on back link; Impressum heading without details; carousel arrows hover-only and 8px dots; extension nudge overlaps feed and duplicates header button; rating question wording varies by status; comma splice on leaderboard.

## Questions to Consider
Why prove "the note comes to the claim" with a dark screenshot instead of a live note? Which one positioning point earns the first viewport? Is the note card built for rating or auditing, and should the donation sit beside the pills?
