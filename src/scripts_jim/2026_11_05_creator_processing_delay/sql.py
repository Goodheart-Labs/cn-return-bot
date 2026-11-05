"""Run one SQL query (read-only unless --write is passed) against prod through the Supabase management API.

The query comes on stdin. The result is printed as an aligned table.
"""
import json
import pathlib
import sys
import urllib.request

PROJECT_REF = "ugytvkevhsmcpunfvncw"
TOKEN = pathlib.Path.home().joinpath(".supabase/access-token").read_text().strip()

query = sys.stdin.read()
request = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
    data=json.dumps({"query": query, "read_only": "--write" not in sys.argv}).encode(),
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "curl/8.0"},
)
rows = json.load(urllib.request.urlopen(request))
if not rows:
    print("(no rows)")
    sys.exit()
columns = list(rows[0].keys())
cells = [[str(row[c]) if row[c] is not None else "" for c in columns] for row in rows]
widths = [max(len(c), *(len(r[i]) for r in cells)) for i, c in enumerate(columns)]
print("  ".join(c.ljust(w) for c, w in zip(columns, widths)))
for r in cells:
    print("  ".join(v.ljust(w) for v, w in zip(r, widths)))
