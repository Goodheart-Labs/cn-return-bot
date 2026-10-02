# Common Notes logo explorer (GOO-298)

A local page for trying out logo candidates. Each candidate has sliders, and
the page shows it at the sizes it ships and inside copies of the Chrome Web
Store listing, the website header, a browser's tab and toolbar, and the
right-click menu.

The logo Jim picked here (GOO-330) is `CHOSEN_LOGO` in `js/logos.js`: the two
rectangles in the bright colour set, with a gap of 8 between the colours, the
red rectangle at Y 74, the green one turned by -6 degrees and the red one by 5. `export-logos.ts` draws it into
`src/everything-ui/assets/logo.svg`, the file every other logo file in the repo
is drawn from. `considered/` keeps every option we looked at, with its real
files, and its README says which is which.

```bash
mac-tunnel serve 8007 bun run src/scripts_jim/2026_09_30_logo_explorer/server.ts 8007
```

- `js/logos.js` holds the candidates: their controls, defaults, presets
  and the function that draws them.
- The candidates made of a green and a red shape (2, 3, 6 and 7) offer
  "Colour sets" in the panel: `PAIR_PALETTES` in `js/logos.js`. A set changes
  only the colours, so the shapes stay as they are.
- The squares and rectangles (6 and 7) have "Gaps and outlines": a gap
  between the three colours and an outline along the inside of each colour.
  Both are exact, because a rounded rectangle grown or shrunk by a fixed width
  is again a rounded rectangle (`grownBy` in `js/logos.js`).
- `js/geometry.js` builds the shapes with Paper.js, which the page loads from
  a CDN.
- `mocks/` holds the copied headers of the store listing and the website. The
  browser window and the menu are drawn in `js/previews.js`. Each mock marks
  the logo's place with `<span class="logo-slot" data-role="R" data-px="N">`,
  where R names which file goes there: store, header, favicon, toolbar or menu.
- "In context" and "Compare all" show each candidate as the extension
  would ship it (`shippedForms` in `js/logos.js`, the same rules as
  the stacked-notes logo of PR #532). A mark without a backdrop
  fills its whole square, sits on a black tile for the dark toolbar and the
  dark favicon, and on a white tile in the right-click menu. The squares and
  rectangles (candidates 6 and 7) skip the tiles and look the same
  everywhere. Today's logo (candidate 5) shows its bold version in the
  toolbar, the tab and the menu, as PR #533 ships it.
- The view "Considered logos" shows the files in `considered/` side by side
  in each place. `js/considered.js` says which file each option puts into
  each slot.
- "Save snapshot" on the page writes the selected logo into `snapshots/` as an
  SVG file and a JSON file with every slider value.
