# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "pyarrow", "numpy", "scipy", "scikit-learn"]
# ///
"""Does the live cliff model hold on posts it never saw? (GOO-844)

The production constants (live_cliff.json) were fitted on 2026-11-23 on the
posts whose readings had reached 48 hours by then. This script tests them on
the posts published after the newest of those, a split by posting time. It
also fits the same three numbers on the new posts alone. If the two fits
agree and the errors match the old test, the model does not drift from day
to day.

    uv run src/scripts_jim/2026_11_21_feed_views_model/time_split.py
"""

import json

import numpy as np
import pandas as pd

import evaluate as ev
import production_fit as pf
import simple_formulas as sf
import ten_minutes as tm

# The production fit read the export up to 2026-11-23 07:00 UTC, so its newest
# post with 48 hours of readings was published 48 hours before that.
PRODUCTION_DATA_END = pd.Timestamp("2026-11-23 07:00", tz="UTC")
TEST_AGES_H = [1, 2, 3, 6, 12, 18, 23, 25, 30, 36, 42, 46]


def errors(test: pd.DataFrame, p) -> pd.DataFrame:
    rows = []
    for age in TEST_AGES_H:
        part = test[test.age == age]
        if len(part) < ev.MIN_TEST_POSTS:
            continue
        m = ev.metrics(part.to_come.to_numpy(), sf.rate(part) * pf.live_hours(part.age.to_numpy(), p))
        rows.append({"age_h": age, "posts": len(part), "typical_error": round(m["median_error"], 2), "within_2x": round(m["within_2x"], 2)})
    return pd.DataFrame(rows)


def main() -> None:
    live = json.loads((ev.DATA_DIR / "live_cliff.json").read_text())
    production = [live["b"], live["c"], live["tau_post"]]
    views, profiles = ev.load()
    series = ev.series_by_post(views, profiles.author_followers)
    cutoff = PRODUCTION_DATA_END - pd.Timedelta(hours=ev.TARGET_AGE_H)
    new = [t for t, s in series.items() if s[0] > cutoff]
    newest = max(series[t][0] for t in new)
    print(f"{len(new):,} posts published {cutoff:%m-%d %H:%M} to {newest:%m-%d %H:%M} UTC reach 48 hours; the production fit saw none of them")

    test = tm.examples_at(series, [(t, a, {}) for t in new for a in TEST_AGES_H])
    print("\nProduction constants on the new posts:")
    print(errors(test, production).to_string(index=False))

    young = [a for a in tm.HALF_HOUR_STEPS_H if a < pf.CLIFF_H]
    refit = sf.fit(tm.examples_at(series, [(t, a, {}) for t in new for a in young]), pf.live_hours, production)
    refit = [abs(refit[0]), float(np.clip(refit[1], 0, 1.5)), abs(refit[2])]
    print(f"\nFitted on the new posts alone: b = {refit[0]:.3f} (production {production[0]:.3f}), "
          f"c = {refit[1]:.3f} ({production[1]:.3f}), tau_post = {refit[2]:.1f} h ({production[2]:.1f} h)")
    print(errors(test, refit).to_string(index=False))


if __name__ == "__main__":
    main()
