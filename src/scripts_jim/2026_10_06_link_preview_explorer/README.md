# Link preview explorer (GOO-389)

How apps show the preview card of a commonnotes.net link, and new options for
that card.

- `cards/` holds the new card options as HTML pages, 1200 × 630 each.
- `render.ts` renders them, and the live card from `src/everything-web/og-card.html`,
  to `images/` at twice their size, the way the live `og.png` is made.
- `explorer/` is the page that shows every option inside mock-ups of each app,
  with each app's crop rules.

```bash
bun run src/scripts_jim/2026_10_06_link_preview_explorer/render.ts
mac-tunnel serve 8007 python3 -m http.server 8007 --directory src/scripts_jim/2026_10_06_link_preview_explorer
```
