# RayMan

A bench for tracing rays by hand, for lectures and practice. You place thin ideal lenses and
draw rays yourself; RayMan keeps lines straight and snaps things into place. It does not trace
for you. See `Claude/goal.md` for the brief.

## Running it

Open `index.html` in a browser (Chrome, Safari, Firefox or Edge). There is no build step and no
internet connection needed, so it also works from a USB stick in a lecture theatre. It can be
hosted as static files anywhere.

The bench is kept in the browser between visits. Use the save button to keep a scene as a
`.json` file, and the picture button to save a PNG.

## Status

- **Phase 1 (done):** grid and optical axis, pan/zoom, thin lenses (place, drag, f ±, aperture,
  focal planes), object arrows, point sources, snapping (a lens's centre, F or F′ lines up with
  other lenses' focal points, 2F points and centres, else the grid), properties panel, undo/redo,
  save/load, PNG export, dark and light themes.
- **Phase 2:** drawing rays with snapping and highlights (axis, F/F′, lens centre); rays follow
  when lenses move (can be switched off).
- **Phase 3:** recognising parallel/focal/central rays (optional colour coding), automatic
  images (real and virtual) that act as objects for the next lens.
- **Phase 4:** tilted parallel bundles, 4f relays, scan-mirror pivot.

## Code

| File | What it does |
|---|---|
| `js/geom.js` | Pure geometry (no DOM): grid steps, focal points, intersections, refraction |
| `js/scene.js` | The scene model, save/load with validation, undo history |
| `js/snap.js` | Snapping rules for dragging things on the bench |
| `js/view.js` | World (mm, y up) ↔ screen transform, pan and zoom |
| `js/render.js` | All canvas drawing and the colour themes |
| `js/panel.js` | The properties panel for the selected element |
| `js/app.js` | Tools, pointer and keyboard handling, files, start-up |

The files are classic scripts sharing a `window.RM` namespace, so the page works when opened
straight from disk. `geom.js`, `scene.js`, `snap.js` and `view.js` can also be `require`d by
Node, which is how they are tested:

```
node --test tests/
```
