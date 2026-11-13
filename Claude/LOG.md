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

## 2026-11-13 — Tweaks after trying Phase 3 *(lecturer's requests)*

1. **Through the lens centre in one go.** Drawing from the object tip through a lens centre
   used to need two clicks: one to the lens, another to continue. Now, if the segment is
   snapped through a lens centre and the cursor is past the lens, one click places both parts
   ("through the centre of L1, straight on"). The first part stays pinned to the centre and
   the second is "straight on", so the ray still follows if the lens moves. Clicking at the lens
   itself still stops there. Only the centre gets this treatment, because only there is light
   undeviated, so the continuation is not a guess.
2. **No panel for rays.** The lecturer found the properties panel distracting while drawing.
   Selecting a ray no longer opens it; the hint pill names the ray instead ("Central ray ·
   Delete removes its last segment"). Ray colour moved to a **flyout on the Ray tool**,
   Photoshop/Affinity-style: a small triangle in the button's corner (or a right-click on the
   button) opens swatches. The colour applies to the next ray drawn and to the selected ray.
   The triangle shows the current colour, and the choice is remembered in the browser.
3. **Delete** on a selected ray removes its last segment, and the ray when nothing is left.
4. **Reset canvas…** in the File menu (it replaces "New bench") wipes everything after a small
   in-app confirmation dialog, not the browser's: Enter resets, Esc or a click outside cancels.
   The reset is one undo step.
5. **Rays stop at the image.** Once rays form a real image, they are drawn ending at it. Only
   the drawing is cut. Behind the scenes, the moment an image forms, its rays' last segments are
   lengthened to the next lens or the edge, so the image keeps forming and the rays keep ending
   at it when lenses move or f changes. Rays aimed at a virtual image are not cut. The cut end
   is not an open end: clicking there starts a ray *from the image*, which is the workflow for
   using an image as the next object. One consequence: if the image later disappears (say a
   ray is deleted), the remaining ray shows its full lengthened extent.

Checked: 5 new unit tests (49 in total). A headless-Chrome run exercised each tweak:
- after the lens moved to −10, the image went to (102.5, −18.75), as the lens equation gives,
  and the rays stayed cut there;
- the Phase 2 and Phase 3 browser tests still pass, adapted to the flyout and the new menu.

### Ideas for later phases *(lecturer)*

- **Fill-in rays.** Once a path is defined by at least two rays, RayMan knows how any other
  ray from that point travels. An option to add, say, 10 rays drawn fainter and thinner, which
  move with the bundle.
- **Irises** (apertures and stops), needed to teach Köhler illumination.
- **Helper rays**, as on slide 1 of the confocal chalk talk: a ray through the lens centre,
  parallel to the ray being traced, shows where that ray crosses the back focal plane. There
  are other uses too.

Proposed order: **Phase 4** = helper rays, tilted parallel bundles (snap "parallel to that
ray", points on focal planes), the 4f relay workflow and the scan-mirror pivot. Helper rays
and tilted bundles rest on the same mechanics. **Phase 5** = irises/Köhler and fill-in ray
bundles. Fill-in rays can be calculated from the paraxial model once two rays define the
mapping, and are drawn as a fainter set.

## 2026-11-13 — Phase 4: helper rays, tilted bundles, 4f relays, scan mirror

**Helper rays.** A second kind of ray, chosen in the Ray tool's flyout or with **H** (**R** goes
back to ordinary rays). The rail button turns dashed while helper rays are being drawn.
- Helper rays are dashed, thinner and grey unless coloured.
- They are construction lines: they never form images, are never trimmed, and have no role.
- Everything else about them is a normal ray: they snap, follow and can be deleted.

**Two new snaps** make the textbook constructions possible:
- *parallel to that ray*: the direction matches another ray's segment, which glows while the
  snap holds;
- *through that ray at the back (or front) focal plane of L1*: the point where any ray
  segment crosses a lens's focal plane. The plane is drawn while the snap holds.

The helper-ray method from slide 1 of the confocal chalk talk then works as taught. To trace an
arbitrary ray through a lens, start a helper at the lens centre and draw it parallel to the
ray; the real ray leaves the lens through the point where the helper crosses the back focal
plane. Checked: done by mouse, the constructed ray and the central ray form the image at
(100, −10), which is what the lens equation gives.

**Light from infinity.** Rays that start at free points are now treated as coming from a point
at infinity. Rays drawn parallel to the axis share one such point; rays drawn parallel to
another ray share that ray's point. They therefore form an "image" where they cross: a
**focus**, labelled as such. Unlike images of objects, a focus does not cut the rays off,
because in a relay the beam carries on to the next lens. A tilted bundle with its central ray
focuses at height f·tanθ in the back focal plane, and moves along it as the bundle tilts.

**Scan mirror** (rail tool **M**), drawn unfolded as agreed:
- a short mirror symbol on the axis, turned by half the beam tilt and hatched on its back;
- a ray reaching it stops there, like at a lens; drawing on from it snaps *reflected by M1*,
  leaving at the mirror's beam tilt relative to the incoming ray;
- a ray can also start at the mirror's pivot;
- the panel has beam tilt (with a slider), position, size and scan range;
- **Scan** sweeps the tilt ± range (2.4 s per sweep). Everything drawn from the mirror follows,
  so the beam visibly pivots and its focus moves along the focal plane;
- scanning is not recorded in the undo history: stopping it, or pressing Esc, puts the tilt
  back, and a save made during a scan records the resting tilt;
- lenses snap their F or F′ onto the mirror, which is how the scan lens goes one focal length
  from the mirror;
- checked with a three-ray beam through mirror, scan lens and tube lens: the beam focused at
  f·tan 5° in the shared focal plane, and Scan swept it.

**4f relays** needed no extra machinery beyond these. Help now has a short recipe: F on F′ for
the relay, F on the mirror for the scan lens, then draw the beam and press Scan.

**Engineering notes**
- *A ray can depend on another ray that depends on an earlier part of the first.* In the helper
  method, the real ray's second segment aims at the helper, and the helper is parallel to the
  real ray's first segment. The solver now hands out the points of a ray it is still working
  on, because those points are already final. Without this, the real ray could not be solved.
- *Snap tiers.* Testing showed "reflected by M1" losing to a far-off point on another ray that
  happened to lie almost on the same line. Snap candidates now come in two tiers. The weak tier
  is points on rays and "parallel to that ray"; these only win when nothing with optical
  meaning is within reach. The strong tier is everything else: F, F′, centres, images,
  focal-plane crossings, the mirror's reflection, straight on, parallel to the axis.
- A ray being drawn is never offered its own points or segments, which would make it depend on
  itself.

Checked: 11 new unit tests (60 in total), and the headless-Chrome runs for Phases 2 and 3,
the tweaks, and Phase 4.

Still open from planning: **iPad and pen support**, to be discussed with the lecturer.

## 2026-11-13 — Refinements before Phase 5 *(lecturer's requests)*

1. **Images are fainter than objects** (55 % opacity), and all images look alike, whether they
   are images of objects or images of images.
2. **No bend at a lens centre.** A ray that stops at a lens centre can only be continued
   straight on: the continuation is locked to the incoming line, and drawing backwards is not
   offered. Light is undeviated there, so there is no angle to choose. The point at the centre
   is then a *joint*, not a node: it gets no dot, cannot be continued or branched from, and the
   line into the centre and the line out of it form one segment, which Delete removes in one
   go. In the data it is still two pieces, a "through C" then a "straight on", so the image
   finder still sees the ray leaving the lens. Rays that *start* at a lens centre (helpers) can
   still go any way.
3. **Free ray points can be edited with Select.**
   - Dragging a ray's free end re-draws that last segment with all the usual snapping and
     highlights, as if drawing it again.
   - A free start point or a free point along the way can also be dragged; anything drawn on
     from it follows.
   - Pinned points (on a lens, through F′, …) belong to what they are pinned to and are not
     handles.
   - The end of a ray drawn ending at its image is not a handle either: its true end is beyond
     the image.
4. **A ray that lost its image partner is shown faint.** When a ray is lengthened automatically
   to keep an image forming, that segment is now marked as lengthened. If the image goes (say
   the other ray is deleted), the lengthened segment is drawn at 50 % until another ray meets
   it again, so it reads as provisional rather than as a bug.

Checked: 3 new unit tests (63 in total), and a headless-Chrome run of all four by mouse.
