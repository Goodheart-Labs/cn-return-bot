# Every logo we considered

The real files of each logo option from September and October 2026, kept so
the choice can be revisited after the pull requests are gone. The explorer's
view "Considered logos" shows them side by side in the store listing, the
website header, the browser tab and toolbar, and the right-click menu.

The numbered folders are copied from git. Each one is the state of the files
at the named commit, so it is what that option shipped or would have shipped.

| Folder | Commit | What it is |
|---|---|---|
| `01-note-card-red-first` | `67926d8b` (main before GOO-330) | The old logo: a note card with two text lines and rating boxes in the order red, yellow, green. The website showed the thin `logo.svg`. The extension's icons came from the bolder `extension-icon-source.svg`. The website had no favicon. |
| `02-note-card-green-first` | `029ee2b0` (PR #533, GOO-301) | The same two drawings with the boxes in the order green, yellow, red. |
| `03-note-card-thin-everywhere` | `805ea0fb` (PR #533) | The thin website logo for every extension icon too. Rejected because it blurs at 16 pixels. |
| `04-note-card-thin-and-bold` | `d49d4867` (PR #533, final) | The thin logo at 48 and 128 pixels (website, stores, extensions page). The bold `extension-icon-small.svg` at 16 and 32 pixels (toolbar, right-click menu). |
| `05-stacked-notes-plain-blue` | `4abf2d46` (PR #532, GOO-299) | The stacked notes, plain brand blue, everywhere. Rejected because plain blue vanishes on Chrome's dark toolbar (contrast 1.0 to 1 on a hovered button). |
| `06-stacked-notes-blue-tile` | `04be1540` (PR #532) | White notes on a blue tile, everywhere. |
| `07-stacked-notes-light-and-dark` | `be0de50a` (PR #532, final) | Plain blue notes in light mode. Blue notes on a black tile (`-tile-`) on the dark toolbar and as the dark favicon. Blue notes on a white tile (`-menu-`) in the right-click menu, in both modes. The extension switched the toolbar icon with the colour scheme through an offscreen page. |
| `08-two-rectangles` | GOO-330 | The logo we picked: two rounded rectangles in the bright colour set, with a gap of 10 between the colours. The same drawing everywhere, with no tiles. |

The file names say where each file went:

- `logo.svg`: the website's header logo, and the source of the other files where nothing else is named.
- `extension-icon-16.png`, `-32`, `-48`, `-128`: the extension's manifest icons. 16 and 32 are the toolbar and the right-click menu, 48 the extensions page, 128 the Chrome Web Store with its transparent margin.
- `store-chrome-128.png`, `store-firefox-128.png`: the uploads for the two stores. Where there is no `store-chrome-128.png`, the store took `extension-icon-128.png`.
- `website-favicon*.png`, `website-favicon.svg`: the website's tab icon. `website-apple-touch-icon.png`: the icon iOS uses for a home screen bookmark.

`explorer/` holds the explorer's candidates, which never reached a pull
request. `export-logos.ts` draws each at its default settings, in every form
the explorer's "In context" view uses: `icon.svg` alone, `store-icon.svg` in
the store's margin, `small-icon.svg` for the toolbar, `dark-tile.svg` for dark
mode and `menu-tile.svg` for the menu. Run it again after changing a
candidate's defaults.
