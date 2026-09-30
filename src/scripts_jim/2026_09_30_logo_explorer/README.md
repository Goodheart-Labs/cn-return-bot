# Common Notes logo explorer (GOO-298)

A local page for trying out logo candidates. Each candidate has sliders, and
the page shows it at the sizes it ships and inside copies of the Chrome Web
Store listing, the website header and a browser's tab and toolbar.

```bash
mac-tunnel serve 8007 bun run src/scripts_jim/2026_09_30_logo_explorer/server.ts 8007
```

- `js/logos.js` holds the five candidates: their controls, defaults, presets
  and the function that draws them.
- `js/geometry.js` builds the shapes with Paper.js, which the page loads from
  a CDN.
- `mocks/` holds the copied headers of the store listing and the website. Each
  marks the logo's place with `<span class="logo-slot" data-px="N">`.
- "Save snapshot" on the page writes the selected logo into `snapshots/` as an
  SVG file and a JSON file with every slider value.
