# RayMan

![](images/rayman.png)

A bench for tracing rays by hand, for lectures and practice. You place thin ideal lenses and
draw rays yourself; RayMan keeps lines straight and snaps things into place. It does not trace
for you. See [`Claude/goal.md`](Claude/goal.md) for the brief.

**Authorship.** The code was written by Claude (Anthropic's model, working in Claude Code),
directed by the course lecturer. [`Claude/LOG.md`](Claude/LOG.md) records what was built, the
decisions made along the way, and why.

## Running it

Open `index.html` in a browser (Chrome, Safari, Firefox or Edge). There is no build step and no
internet connection needed, so it also works from a USB stick in a lecture theatre. It can be
hosted as static files anywhere.

Things to place (lenses, objects, lamp filaments, beams, irises, image planes, rays) are in the rail on the
left; actions (undo, delete, fill-in, hints, file, settings) on the right. Hover over a button
to see its name and shortcut, or press `?` for help. The [guide](guide/index.html) shows
the key features with pictures. The scan mirror and dichroic are under development: Settings →
"Show features under development". The bench is kept in the browser between visits. Use the File menu to save a
scene as a `.json` file or to save a picture.

## Status

- **Phase 1 (done):** grid and optical axis, pan/zoom, thin lenses (place, drag, f ±, aperture,
  focal planes), object arrows, point sources, snapping (a lens's centre, F or F′ lines up with
  other lenses' focal points, 2F points and centres, else the grid), properties panel,
  undo/redo, save/load, PNG export, light and dark themes.
- **Phase 2 (done):** drawing rays with snapping and highlights (parallel to the axis, through
  F/F′/lens centres, straight on). Rays stop at the next lens, can be continued, branched and
  extended, and follow when the optics move (this can be switched off).
- **Phase 3 (done):** recognising parallel/focal/central rays (optional colour coding);
  images found where the drawn rays cross (real) or where their backward extensions meet
  (virtual, dashed). An image is an object for the next lens, and everything follows when
  the optics move.
- **Phase 4 (done):** helper rays (dashed construction lines); snapping parallel to another
  ray and through the point where a ray crosses a focal plane; light from infinity forming a
  focus (tilted bundles, 4f relays); a scan mirror (unfolded: light passes through it and
  comes out tilted), with a Scan button that sweeps it.
- **Phase 5 (done):** irises that stop rays meeting their blades (clipping and restoring rays
  as they close and open; centre and edges are snap points; they line up with focal points
  and images, for Köhler illumination), and fill-in rays: faint rays interpolated between the
  two outermost rays of each bundle, which follow the drawn rays and are clipped by irises.
- **Hints** (lightbulb, G): the three ray-tracing rules shown at the top of the screen, and the
  rays drawn coloured by the rule they follow. **Fill-in** is a latched rail button (B).
- **Several optical axes:** an axis is an element (X) that can be added, dragged (everything on
  it moves with it) or deleted (with everything on it, after asking). Each axis is its own
  bench.
- **iPad:** the Apple Pencil draws (tap–tap or press–drag–lift); fingers pan, pinch-zoom, tap
  to select and press buttons, never drawing; a palm resting while the Pencil is down is
  ignored. Long-press a rail button to open its options. Not yet tried on a real iPad.

## Code

| File | What it does |
|---|---|
| `js/geom.js` | Pure geometry (no DOM): grid steps, focal points, intersections, refraction |
| `js/scene.js` | The scene model (elements and rays), save/load with validation, undo history |
| `js/snap.js` | Snapping rules for dragging things on the bench |
| `js/rays.js` | Solving rays from what they are pinned to, finding images, recognising principal rays, snapping while drawing, freezing ("baking") |
| `js/view.js` | World (mm, y up) ↔ screen transform, pan and zoom |
| `js/render.js` | All canvas drawing and the colour themes |
| `js/panel.js` | The properties panel for the selected element or ray |
| `js/app.js` | Tools, pointer and keyboard handling, popovers, files, start-up |

The files are classic scripts sharing a `window.RM` namespace, so the page works when opened
straight from disk. `geom.js`, `scene.js`, `snap.js`, `rays.js` and `view.js` can also be
`require`d by Node, which is how they are tested:

```
node --test tests/
```
