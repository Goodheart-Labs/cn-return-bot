# Tech Debt Registry

Tracked cleanup items. Add entries here; remove when done.

## Dead code to delete

| File | Reason | Added |
|------|--------|-------|
| `src/bots/legacy/opus-scored.ts` | weight 0, never runs | Mar 2026 |
| `src/bots/legacy/opus-strict.ts` | weight 0, never runs | Mar 2026 |
| `src/pipeline/predictionScores.ts` | not called from active pipeline | Mar 2026 |

After deleting the legacy bots, check if `src/bots/legacy/` is empty and remove the directory too.
