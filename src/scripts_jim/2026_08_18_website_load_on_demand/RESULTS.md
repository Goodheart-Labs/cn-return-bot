# What the Common Notes website reads on a cold page load

Measured against the production backend with the anon key the site ships with,
by `measure.ts` in this folder. It issues the old query set and the new one
through supabase-js and counts the bytes each of them brings back. The schema
probe is the same in both and is left out of the totals.

## Before and after

| Load | Requests | Payload |
| --- | --- | --- |
| Before: the whole database, every project | 4 | 6,342.9 KB |
| After: no project in the URL, so the default project (75 notes) | 5 | 168.4 KB |
| After: `?project=zvi`, the largest project (75 notes) | 4 | 159.3 KB |
| After: `?project=dwarkesh` (31 notes) | 4 | 70.4 KB |
| After: `?project=arctotherium` (17 notes) | 4 | 33.5 KB |
| After: one note's source details, when the reader opens them | 1 | 0.3 KB |

The default project costs one extra request, because with no project in the URL
the page has to ask which projects have content before it knows what to load.

## Where the old 6.3 MB went

| Query | Rows | Payload |
| --- | --- | --- |
| `everything_items` with `select("*")` | 163 | 5,976.2 KB |
| `everything_notes` joined to claims and full sources | 192 | 508.6 KB |
| `everything_note_not_needed` with `select("*")` | 18 | 8.5 KB |
| `everything_projects` with `select("*")` | 10 | 1.8 KB |

Almost all of it is `everything_items.full_text`, the transcript or article body.
Nothing on the website renders it. The same query narrowed to the columns the
feed uses, for one project, is 10.8 KB.

Inside the notes payload, the citations' `quote` and `explanation` are 138 KB of
the 509 KB, and they only ever appear behind the "Show source details" button.

## Rendering is unchanged

The pre-change site (origin/main) and the changed site were loaded side by side
against the same backend, on ports 8004 and 8003. Both showed Zvi's Substack
with the same 75 note cards, in the same order, with the same buttons: 71
"Show source details", 92 "Note not needed", 75 "Suggest an improvement", 24
item chips.

The text inside the note boxes matches word for word once every source-details
reveal on the new page is opened. Before the change that text sat in the page
from the start, inside a container collapsed to zero height. Now it arrives when
the reveal is opened.
