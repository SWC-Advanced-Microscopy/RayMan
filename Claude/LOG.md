# RayMan development log

RayMan is written by **Claude** (Anthropic's model, working in Claude Code), directed by the
course lecturer who owns this repository. The brief is in [`goal.md`](goal.md). This log
records what was done, what was decided, and why, in the order it happened. Decisions marked
*(lecturer)* were the lecturer's call; the rest were Claude's, and can be revisited.

---

## 2026-11-13 — Planning

**Research.** Claude read the brief and the two demo series it points to
(optics.mouse.vision: *ray-optics/ray-tracing* and *scanning-microscopy/confocal-from-zero*).
The demos' own source showed plain JavaScript on an HTML canvas with no framework, and gave the
palette: parallel ray blue `#5aa7ff`, focal ray red `#ff6b57`, central ray green `#7ee06b`,
dark navy background `#060913`.

**Plan.** Build in four phases, stopping after each so the lecturer can try it:
1. the bench: grid, optical axis, lenses, objects, snapping, properties panel;
2. drawing rays with snapping and highlights (the brief's steps 5–7);
3. recognising parallel/focal/central rays, automatic images (real and virtual) that become
   objects for the next lens;
4. tilted parallel bundles, 4f relays, a scan-mirror pivot.

**Decisions from the planning questions**
- Rays remember what they were snapped to and **follow** when lenses move or f changes, with a
  setting to turn that off. *(lecturer)*
- A ray being drawn **stops at the next lens** it crosses, else at the click; a double-click
  extends it to the next lens or the edge. *(lecturer agreed)*
- **No checking** of whether students' rays are right, for now. *(lecturer)*
- **Colour coding** of principal rays is optional and **off by default**; a ray is coloured by
  its role at the first lens after its object. *(lecturer)*
- The scan mirror stays an **unfolded pivot** on a straight axis rather than a real fold. *(lecturer)*
- **Mouse first.** The lecturer has an iPad and pen; touch/pen support is to be discussed later,
  because the hover-based drawing needs a press-drag-release alternative. *(lecturer)*
- A **point source** is offered as a helper; students can also build one themselves. *(lecturer)*
- **Dark and light themes.** *(lecturer)*

**Technical choices (Claude)**
- No build step and no dependencies: classic `<script>` files sharing a `window.RM`
  namespace, so `index.html` works when opened straight from disk or a USB stick in a lecture
  theatre with no network. ES modules were rejected because browsers block them on `file://`.
- Pure logic (geometry, scene, snapping, rays) is kept apart from drawing and the DOM, and
  unit-tested with Node's built-in test runner (`node --test tests/`).
- World units are millimetres, z along the axis, y up.
- Undo/redo stores whole-scene JSON snapshots: scenes are tiny, and it is hard to get wrong.
- The bench autosaves to the browser's local storage; scenes can also be saved as `.json` files.

## 2026-11-13 — Phase 1: the bench (commit `324c811`)

Built: canvas with grid and axis, pan/zoom, mm scale; thin lenses (place, drag along the axis,
f ±, semi-aperture, optional dashed focal planes); object arrows; point sources; properties
panel; undo/redo; save/load; PNG export; dark/light themes; help panel; keyboard shortcuts.

Snapping rules:
- a dragged lens lines up its **centre, F or F′** with other lenses' centres, focal points and
  2F points, otherwise the grid. Dragging lens 2 until its F sits on F′ of lens 1 is how a 4f
  system is built, so this was made easy;
- **F and F′ are draggable** to change f, and dragging F′ through the lens makes it diverging;
- **Alt** turns snapping off.

Checked by driving the page in headless Chrome (placing, dragging, typing in the panel, undo,
reload) and looking at screenshots. Two problems found and fixed:
- coinciding focal points (F₁′ on F₂) drew their labels on top of each other. They now share
  one dot labelled "F₁′ = F₂";
- where markers coincide, the selected lens's marker is the one that gets grabbed.

## 2026-11-13 — Feedback on Phase 1 *(lecturer)*

- **Light theme by default**; it looks better.
- Make the lenses look nicer, not like the arrow symbol of browser ray-optics simulators.
- **Objects green** by default, with an option to change the colour.
- Keep this log, be clear that Claude wrote the code, and commit when it makes sense.

Responses:
- Lenses are now drawn as glass: biconvex for f > 0 and biconcave for f < 0. They get thicker
  as the lens gets stronger, as a real lens of the same diameter would (sag ∝ ap²/f, clamped to
  a sensible pixel range), and a faint line marks the thin-lens plane where the refraction is
  drawn.
- Objects and rays get a colour picker: a few swatches, "A" for the default, and a free choice.
- In the light theme, uncoloured rays are dark slate. The demos' yellow is kept for dark mode,
  where it reads well; on white it does not.

## 2026-11-13 — Phase 2: drawing rays (in progress)

**How a ray is stored.** A ray is a polyline whose points each record *why* they are where they
are, not just coordinates:
- the start is pinned to something (object tip, point source, F, F′, lens centre, a point on
  another ray) or free;
- each segment has a direction: free, parallel to the axis, straight on (same slope as the
  previous segment), through a pinned point, or a fixed slope;
- each segment ends on a lens plane, at a z position, exactly on a pinned point, or at the edge.

Solving those rules every frame is what makes rays follow when the optics change. Recording
coordinates only would have made following impossible; recording full constraints (as a CAD
program would) would have been far more complex than this needs.

**Following off.** When following is switched off, every ray is "baked" into fixed coordinates
just before an edit is applied, so the rays stay exactly where they were. Deleting a lens or a
ray bakes only the pins that point at it, so the other rays keep their shape.

**Snapping while drawing.** The direction snaps to the nearest of: through an anchor (F, F′, a
lens centre, the object tip, a point on another ray), straight on, or parallel to the axis.
Every candidate is measured by how far the cursor is from it on screen, so the snap feels the
same at any zoom. Anchors get a slight preference so that "through F′" wins over a near-miss.
What the ray snapped to is highlighted: the axis glows for a parallel ray, and F′ or the lens
centre gets a ring with a caption. Following the brief, a click places the segment and stops;
clicking the ray's end continues it, and clicking a point in the middle of a ray starts a new
ray branching from there.

**A ray that misses a lens.** If it passes above the lens's semi-aperture, it does not stop on
the lens, as in reality.

**Checked in headless Chrome** by drawing the three principal rays from an object at 2F with
the mouse. They meet at (100, −15) mm, as they should. Moving the lens kept every ray obeying
its rule (still through F′, still parallel after F). With following off, changing f left the
rays untouched, and deleting the lens left their shape intact.

Bugs found while testing, and fixed:
- double-click did nothing, because `PointerEvent.detail` is not a reliable click count in
  Chrome. Double-clicks are now detected from the time and distance between presses. A double
  click on a segment that ends on a lens, which cannot be extended, just continues the ray;
- a far-off point on another ray could out-snap the intended direction. Points on rays now
  rank below F, F′ and lens centres.

Phase 2 committed. The lecturer then asked for a new layout (next entry).

## 2026-11-13 — New layout *(lecturer's request)*

The lecturer pointed out that the first layout copied the demo site (a header bar of labelled
buttons). That would become cluttered as tools are added. They asked for a Photoshop-style
vertical icon toolbar on the right, and for the whole thing to look elegant.

What changed, and why:
- **Tool rail on the right**, 58 px wide: tools at the top; undo, redo and fit in the middle;
  File, Settings, theme and Help at the bottom. Icons only, so the rail has room to grow. Each
  button has a tooltip with its name and shortcut, appearing after a short delay so it does not
  flicker while the mouse passes over.
- **The canvas runs full-bleed**, with only a small wordmark top-left. The header is gone, so
  the bench gets the whole height, which matters on a projector.
- **The properties panel floats beside the rail**, top-right. The File menu and Settings open
  as popovers next to their buttons. Clicking the canvas or pressing Esc closes them, and only
  one is open at a time.
- **The tool hint** is a quiet pill at the bottom centre ("**Ray** click to start · …"), and the
  coordinates sit small in the bottom-right corner.
- **Softer palette:** hairline borders, gentle shadows and translucent panels. The active tool
  is shown with a tint rather than a solid block. Section titles are small caps, the slider is
  thin and drawn by hand, and settings use a switch. The light theme's grid was made fainter.
- Kept from before: amber/orange as the single accent colour, because snap highlights must
  stand out from the blue/red/green principal rays; and the system font stack, because web fonts
  would break the offline requirement.
- "Fit to view" now includes the rays as well as the elements.

Checked with screenshots in headless Chrome of the bench, a tooltip, the File menu, Settings,
Help, a selected lens and dark mode. The Phase 2 drawing test was re-run against the new layout
and still passes.

## 2026-11-13 — Name and About card *(lecturer's request)*

- The full name is **"RayMan manual ray tracing"**: MANual, RAY tracing. The wordmark and the
  page title use it.
- The help panel ends with an **About RayMan** link. It opens the RayMan logo
  (`images/rayman.png`, supplied by the lecturer) on a white card in the middle of the screen,
  with a soft drop shadow, over a light dimming of the bench. Beneath it in small letters:
  "Manual ray-tracing for teaching optics / By the SWC AMF and Claude. / (Mostly by Claude)".
  Clicking anywhere, or Esc, dismisses it.
- The logo is 1.5 MB, so it is only loaded the first time About is opened, keeping start-up
  quick.

## 2026-11-13 — Small requests while Phase 3 was being built *(lecturer)*

- The About card had a "Click to close" browser tooltip. The lecturer found it ugly and
  unnecessary, so it was removed.
- A **GitHub logo** after the About link opens the repository.
- The About card has a **swcmicroscopy.com** link: underlined in light grey, with the underline
  vanishing on hover. It opens the site in a new tab and leaves the card open; clicking
  anywhere else closes the card.

## 2026-11-13 — Phase 3: principal rays and images

**Ray roles.** A ray's role is judged on the segment that reaches the first lens after the
ray's start:
- **parallel**: it arrives parallel to the axis;
- **focal**: it arrives on a line through F. For a diverging lens F lies beyond the lens, so
  this is the ray aimed at it;
- **central**: it meets the lens at its centre;
- a ray along the axis has no role.

The tolerance is 0.2 % of f, so snapped rays always qualify and near-misses drawn with Alt
usually do too. A ray drawn from an image is judged at the next lens, as the brief asks.
*Colour-code principal rays* is a switch in Settings, off by default *(lecturer)*. A colour
picked by hand always wins. The ray panel also says which kind of ray is selected.

**Images are found from the rays, never calculated from the lens equation.** RayMan must not
"do it for you", so the image appears where *your* rays cross, right or wrong. For each source
point (object tip, point source, or an earlier image) and each lens:
- take the segment leaving that lens on every ray from that source;
- the first pair, in drawing order, that meet within their drawn lengths gives a **real**
  image. It appears only once the rays have been drawn far enough to cross;
- if a pair diverges and only their backward lines meet, it is a **virtual** image. That is
  drawn with a dashed shaft and a hollow head, and the backward extensions of the rays that
  pass through it are drawn dashed;
- parallel rays (object at F) give no image.

Images are not stored, only derived, so they move whenever anything they depend on moves.
**An image is an object for the next lens:** it is offered as a place to start rays and to aim
through ("from the image"), and rays pinned to it follow it. Images inherit the colour of the
object they come from.

**Solving.** Rays can now depend on images, which depend on other rays, which may be aimed
through that same image. A small memoising solver handles this: a request that loops back on
itself is treated as unsolvable for that inner step, and anything computed during such a loop is
not cached, so the outer computation still finishes correctly. One unit test covers a third ray
aimed through the image its siblings formed.

**Deleting.** Removing a ray (or its last segment) can make an image disappear. Before such a
change, RayMan tries it on a copy, sees which images survive, and frees rays pinned to the ones
that will not, so those rays keep their shape.

**A fix found while testing in the browser.** At some zoom levels a click near the object tip
snapped to a grid point that sat exactly on the tip, yet the ray was recorded as starting at a
free point. Free starts have no source, so no image formed. A start point that lands exactly on
an anchor now counts as that anchor.

**Checked**:
- 11 new unit tests (44 in total);
- a headless-Chrome run drawing the rays with the mouse. An object at 2F gave its image at
  (100, −15). A second lens (f 50 at z 250) traced from that image gave (325, 7.5); the lens
  equation gives v = 75, m = −½. Moving L1 moved both images to the values the lens equation
  predicts. An object inside F gave a virtual image at (−50, 20), m = +2;
- the Phase 2 drawing test still passes.

Also fixed: Esc did nothing while a Settings switch had keyboard focus. Only text, number and
slider fields now keep keys to themselves.
