# Common Notes logo explorer (GOO-298)

A local page for trying out logo candidates. Each candidate has sliders, and
the page shows it at the sizes it ships and inside copies of the Chrome Web
Store listing, the website header, a browser's tab and toolbar, and the
right-click menu.

```bash
mac-tunnel serve 8007 bun run src/scripts_jim/2026_09_30_logo_explorer/server.ts 8007
```

- `js/logos.js` holds the five candidates: their controls, defaults, presets
  and the function that draws them.
- `js/geometry.js` builds the shapes with Paper.js, which the page loads from
  a CDN.
- `mocks/` holds the copied headers of the store listing and the website. The
  browser window and the menu are drawn in `js/previews.js`. Each mock marks
  the logo's place with `<span class="logo-slot" data-role="R" data-px="N">`,
  where R names which file goes there: store, header, favicon, toolbar or menu.
- The view "The two PRs" shows the real icon files of the two logo pull
  requests side by side: #532 (stacked notes) and #533 (today's logo with the
  boxes in the order green, yellow, red). `js/pullRequests.js` says which file
  each PR ships for each role. The server reads the files from the pushed
  branches with `git show` under `/shipped/<PR number>/<path in the repo>`,
  and fetches the branches once a minute.
- "Save snapshot" on the page writes the selected logo into `snapshots/` as an
  SVG file and a JSON file with every slider value.
