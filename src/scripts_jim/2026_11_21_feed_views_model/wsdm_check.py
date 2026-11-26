# /// script
# requires-python = ">=3.11"
# dependencies = ["pandas", "numpy", "requests"]
# ///
"""How good are the WSDM Cup account's stored predictions? (GOO-844)

Since GOO-874, cn-x-watch scores every post of the WSDM Cup contest feed with
its predicted views still to come and stores each reading in
x_watch_feed_views. Once a post's readings reach 48 hours, its true views
still to come at each earlier reading are known. This compares the two at a
few ages, in the same terms as the tests on the first account's feeds: the
typical error is the median factor between prediction and truth.

    uv run src/scripts_jim/2026_11_21_feed_views_model/wsdm_check.py
"""

import numpy as np
import pandas as pd

import export

X_EPOCH_MS = 1288834974657
TARGET_AGE_H = 48
AGES_H = [1, 2, 3, 6, 12, 18, 23, 25, 30, 36, 42, 46]
AGE_TOLERANCE_H = 5 / 60
MIN_POSTS = 20

SQL = f"""
with r as (
  select tweet_id, impressions, views_to_come,
         extract(epoch from observed_at - to_timestamp(((tweet_id >> 22) + {X_EPOCH_MS}) / 1000.0)) / 3600 as age_h
  from x_watch_feed_views where x_account = 'wsdm'
),
final as (
  select distinct on (tweet_id) tweet_id, impressions as v48
  from r where abs(age_h - {TARGET_AGE_H}) < 0.25
  order by tweet_id, abs(age_h - {TARGET_AGE_H})
)
select r.tweet_id::text, r.age_h, r.impressions, r.views_to_come, f.v48
from r join final f using (tweet_id)
where r.views_to_come is not null
  and ({' or '.join(f'abs(r.age_h - {a}) < {AGE_TOLERANCE_H}' for a in AGES_H)})
"""


def main() -> None:
    rows = pd.DataFrame(export.query(SQL))
    for column in ["age_h", "impressions", "views_to_come", "v48"]:
        rows[column] = rows[column].astype(float)
    print(f"{rows.tweet_id.nunique()} WSDM feed posts have a reading at 48 hours")
    rows["age"] = rows.age_h.map(lambda a: min(AGES_H, key=lambda t: abs(t - a)))
    rows = rows.sort_values("age_h").drop_duplicates(["tweet_id", "age"])
    rows["truth"] = (rows.v48 - rows.impressions).clip(lower=0)
    out = []
    for age, part in rows.groupby("age"):
        if len(part) < MIN_POSTS:
            continue
        factor = np.exp(np.abs(np.log1p(part.views_to_come.to_numpy()) - np.log1p(part.truth.to_numpy())))
        out.append({"age_h": age, "posts": len(part), "typical_error": round(float(np.median(factor)), 2),
                    "within_2x": round(float(np.mean(factor <= 2)), 2),
                    "predicted_total": int(part.views_to_come.sum()), "true_total": int(part.truth.sum())})
    print(pd.DataFrame(out).to_string(index=False))


if __name__ == "__main__":
    main()
