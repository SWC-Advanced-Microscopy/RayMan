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

## 2026-11-13 — Fix: helper rays pass through lenses *(lecturer)*

The lecturer tried the helper-ray method and found the helper stuck at the lens: like a real
ray, it stopped on the first lens it reached. A helper is a construction line, so it now
**passes through lenses and mirrors**. It only ends on one if the cursor is right at that
plane (within the snap distance), so ending on a lens deliberately is still possible, on any
lens along its path, not just the first. Double-clicking a helper's end runs it to the edge
rather than to the next lens. Real rays are unchanged.

Checked: 1 new unit test (64 in total); in the browser, a helper drawn through L1's centre
ran on past L2, one ended at L2 stopped there, and a double-click took a helper to the edge.

## 2026-11-13 — Phase 5: irises and fill-in rays *(lecturer's ideas)*

**Iris** (rail tool **I**): two blades reaching in from ±size to the opening ±r, with knife
edges.
- **Rays stop at a blade.** A ray drawn into a blade ends there ("blocked by A1"). Rays drawn
  through the opening carry on, since an iris does not bend light.
- **Closing and opening.** Closing an iris clips rays that went through it, and opening it gives
  them back. This is done when rays are solved, not by changing their data, so nothing is lost.
  Images and anything downstream see the clipped rays.
- **Snap points.** The iris centre and the two edges of the opening are points to aim through:
  chief and marginal rays.
- **Placing.** Irises (and scan mirrors) line up with lens focal points *and* with images and
  foci, which is where aperture stops (back focal planes) and field stops (image planes) go in
  Köhler illumination. Images win a tie with a coincident lens point.
- **Editing.** With an iris selected, the edges of its opening are drag handles. These handles
  take priority over rays passing through the same spot; testing found a parallel ray running
  exactly through the edge and stealing the click. The panel has the opening (with a slider),
  position and size.
- Helper rays ignore irises.

**Fill-in rays** (Settings: 0–20 per bundle, off by default):
- For each source with at least two ordinary rays drawn, the two outermost rays at the first
  lens or mirror are taken, and N faint, thin rays are interpolated between them, plane by
  plane. The height at each plane both rays pass through is blended, then the slope and length
  of the final segment.
- A thin lens maps (height, slope) linearly, so this is exactly what paraxial optics gives, *if
  the drawn rays are right*. If they are wrong, the fill shows it. Calculating the fill from
  the lens equation instead would quietly correct the student, and RayMan should not do that.
- Fill rays follow the drawn ones, meet at the image when the drawn rays are cut there, work
  for bundles from infinity, and are clipped by irises one by one.
- **A design fix found in testing:** the bundle is worked out *as if no iris were there*.
  Otherwise, closing an iris far enough to clip one of the two drawn rays made the entire fill
  vanish, the opposite of what a vignetting or Köhler demonstration needs.

Checked: 10 new unit tests (74 in total). In headless Chrome: an image drawn with two rays,
8 fill rays converging on it, an iris placed by click (it snapped to F), its opening dragged
from ±10 to ±3 (both drawn rays and all fill rays clipped, the image gone), then Undo
restoring everything.

**Still open:** iPad and pen support (raised at the end of Phase 4, awaiting the lecturer).

## 2026-11-13 — Rays left dangling by a new lens *(lecturer)*

The lecturer's case: rays are drawn out from a lens some distance, then another lens is placed
in their path. The old rays now pass straight through it. The lecturer wanted to pull them back
onto the new lens **without changing their angle**, and asked whether a snap to the old line
had been kept. It had only partly been: Select could drag a free end, but that re-drew the
segment from scratch, so a free-angle ray lost its angle. Two additions:

1. **Dragging a ray's end keeps its line.** While the end of a ray is dragged with Select,
   "same line" is the strongest snap. Pinned directions such as "through F′" stay pinned, and a
   free angle is kept as that slope. The usual rule then stops it on the first lens it reaches
   when the cursor is at or past it, so nudging a dangling end back lands it on the new lens at
   the old angle ("same line, to L2").
2. **"Stop this ray at L2 and carry on."** Some ends cannot be grabbed: a ray run to the edge,
   or one drawn ending at an image beyond the new lens. With the Ray tool, the point where a
   ray's last segment passes straight through a lens is now clickable. One click cuts the ray
   there, keeping its direction (still pinned, so it still follows), and drawing continues from
   the lens to add the refraction. Helper rays pass through lenses on purpose and are not
   offered this.

Checked: 3 new unit tests (77 in total). In the browser, a dangling free-angle ray was dragged
back onto a new lens (slope −0.185 before and after), and a ray running to the edge was cut at
the new lens with one click and continued.

## 2026-11-13 — Hint mode, and fill-in as a button *(lecturer's requests)*

**Hint mode** (lightbulb on the rail, key **G**). The lecturer wanted the colour-code diagrams
from the demo series (parallel blue, through F red, through the centre green) available to
beginners, combined with automatic colouring:
- turning hints on shows **three small rule diagrams** at the top of the screen, drawn in
  RayMan's own lens style: "Parallel ray: in parallel, out through F′", "Focal ray: in through
  F, out parallel", "Central ray: through the centre, straight on". They are slightly faded and
  fixed in place; the bench scrolls and zooms underneath, and they let clicks through;
- while hints are on, **rays are coloured by the rule they follow**, and the role colour wins
  over a colour picked by hand (otherwise a bench drawn all in one colour would show nothing).
  Rays that follow no rule keep their own colour;
- turning hints off removes both. Hints replace the earlier "Colour-code principal rays"
  switch in Settings (same scene setting, so saved scenes keep their state).

**Fill-in rays as a latched button** (rail, key **B**). The lecturer wanted fill-in toggled by
a latched button, not tucked away in Settings. The button's corner triangle (or a right-click)
opens a small flyout to choose 5, 10 or 20 rays per bundle. Choosing a count also turns fill-in
on, and the count is remembered in the browser. It was removed from Settings and from the Ray
flyout.

**Fill-in bug found in testing, and fixed.** With three rays from one point, the fill rays
stopped in mid-air near the object. The focal ray had been drawn with a pause before the lens,
leaving a free point there, and the fill paired up the two edge rays' points *by position in
the list* rather than by the lens each point sits on. The fill now interpolates only at the
lenses and mirrors both rays pass through, in order, and ignores free points, which are not
where a ray bends. Fill rays are also drawn in the bundle's own colour, never a rule colour:
a red fan in hint mode would suggest they were all focal rays.

Checked: 1 new unit test (78 in total). In the browser: hint mode on and off with the three
rays coloured blue, red and green, despite purple having been picked for new rays; the fill
button latching with counts 10 and 5; and the Phase 5 iris test, adapted to the button.

## 2026-11-13 — Hint diagrams without text *(lecturer)*

The three hint cards had a title and a line of text under each diagram. The lecturer asked for
just the diagrams, so the captions were removed and the cards made a little smaller. The F and
F′ labels inside the diagrams are kept, as part of the diagrams themselves.

## 2026-11-13 — iPad support *(lecturer's brief: the Pencil draws, fingers press buttons)*

- **Apple Pencil** (`pointerType: 'pen'`) does everything a mouse does. In the Ray tool a segment
  can also be drawn **press–drag–lift**: press on a start point or a ray's end, drag (the
  snapping preview follows), lift to place. Tap–tap still works. Mouse users get the same
  press–drag–lift for free. Pencil hover, on iPads that have it, drives the same previews as a
  mouse. Double-taps get twice the mouse's distance tolerance.
- **Fingers** (`pointerType: 'touch'`) only navigate: one finger pans, two pinch to zoom (about
  the midpoint, panning as they move), and a tap selects. A finger never draws or places
  anything. **Palm rejection:** while the Pencil is down, touches are ignored.
- **No keyboard on an iPad**, so: a **Delete** button on the rail (a ray loses its last segment,
  anything else is deleted; greyed out when nothing is selected); tapping the active tool again
  cancels a segment that has been started; Undo and Redo were already on the rail.
- **Fingers on the rail.** The small corner triangles (Ray colour, Fill-in count) are too small
  for a fingertip. Testing also showed Chrome steering finger taps aimed at the middle of the
  Ray button onto the triangle. So for touch, the whole button is the button, and a
  **long press** (half a second) opens its flyout, the usual iPad convention. Mouse and Pencil
  keep the corner.
- **Page behaviour:** the viewport no longer zooms under pinches, text is not selectable outside
  input fields (no callouts or selection loupes when pressing), and buttons ignore double-tap
  zoom.

Checked in headless Chrome by sending real `pen` and `touch` pointer events through Chrome's
low-level input API:
- Pencil taps placed a lens and an object;
- Pencil press–drag–lift strokes snapped "parallel to the axis, to L1" and "through F′ of L1";
- Pencil tap–tap formed the image;
- one finger panned, two fingers zoomed ×2, and finger taps on the canvas never drew;
- a touch during a Pencil press was ignored;
- re-tapping the tool cancelled a started segment;
- a finger tap selected a lens and opened its panel, and the rail's Delete removed a ray's last
  segment.

**Not yet tried on a real iPad.** Safari's handling of Pencil hover and of long presses is the
thing to watch.

## 2026-11-13 — Two toolbars, auto-hide, and the lamp filament *(lecturer's requests)*

**The toolbar did not fit on the page.** As asked:
- the logo at the top of the rail was removed, because it was confusing;
- the rail was split in two. **Things to place go on the left**: Select, Lens, Object, Point
  source, Lamp filament, Scan mirror, Iris, Ray. **Actions go on the right**: Undo, Redo,
  Delete, Fit, Fill-in and Hints, then File, Settings, Theme and Help;
- tooltips open towards the canvas on each side, and the Ray colour flyout now opens beside the
  left rail;
- the rails were tightened (58 → 48 px wide, 38 px buttons), and get more compact again on
  screens under 640 px tall;
- scrolling rails were considered and rejected, because a scrolling container would clip the
  tooltips that sit outside it.

**Auto-hide the toolbars** (Settings, desktop only). This is a preference of the browser, not
saved with the scene. When it is on:
- both rails float off the edges and the bench uses the full width;
- moving the mouse within 14 px of an edge slides that rail back over the bench, and it tucks
  away again shortly after the mouse leaves it;
- a rail stays out while one of its flyouts or menus is open.

The switch is not offered where the device cannot hover (iPad), as the lecturer asked. A slip
caught in testing: the hiding rule used an id selector, which outranked the class that brings
the rail back.

**Lamp filament** (left rail, key **A**): an object with two sides, as the lecturer described.
- **Shape:** a glowing coil on the axis, from a bottom end to a top end. Each end can be dragged
  anywhere above or below the axis (the top stays above the bottom); the panel also has the end
  heights, position and colour (amber by default).
- **Sources:** its top, bottom and middle are places to start rays and aim through.
- **Its image:** each end forms its own image, found from the rays as usual. When both ends are
  imaged through the same lens, a faint coil is drawn between the two images, dashed if
  virtual, so the lamp's image looks like a filament, inverted or not.

Checked: 2 new unit tests (80 in total). In headless Chrome: the two-rail layout; a filament
placed, its ends dragged to +12 and −6 mm, and its image at z = 100 running from −12 to +6
(inverted, ×1, as for an object at 2F); auto-hide hiding, peeking and remembering; and the rails
fitting a 600 px-tall window. All the earlier browser tests were re-run with updated selectors.

## 2026-11-13 — Floating palettes instead of full-height rails *(lecturer)*

The lecturer pointed out that the rails wasted space: the bottom half of the left rail held no
buttons but still hid the canvas. The rails are now two **floating palettes, only as tall as
their buttons**: rounded, translucent, with a soft shadow, sitting over the canvas at the
top-left (things to place) and top-right (actions). The bench runs the full width of the
window, visible under and between them. The right palette's spacer was removed. The wordmark,
help panel, properties panel, menus and flyouts now sit beside the palettes. The File and
Settings menus line up with the button that opened them. Auto-hide still works, sliding each
palette off its edge.

Checked in headless Chrome: palettes 50 px wide and 337 / 430 px tall in an 800 px window (294 /
374 px in a 600 px one, the compact sizes); the canvas full-width; menus aligned with their
buttons; auto-hide peeking; the iPad simulation and the filament checks unchanged.

## 2026-11-13 — Several optical axes *(lecturer)*

The lecturer wanted to add more optical axes above or below an existing one. An axis can be
added or removed; moving it moves all its components; deleting it deletes them too, after a
confirmation if it is populated. Axes are always horizontal.

**Model.** The optical axis is now an element, `{ type: 'axis', y, label }`. Every other
element and every ray belongs to one axis (`axis: id`), and its positions are stored *relative
to that axis*. So moving an axis moves everything on it without touching anything on it, and
all the optics (focal points, snapping, images, roles, fill-in, irises, mirrors) works per axis
exactly as before. Each axis is its own bench: rays only see the lenses on their own axis, which
is how stacked diagrams in a lecture read.

**How it was built without rewriting the optics.** `scene.axisView(scene, id)` returns a *live
view* of one axis: reading `elements` or `rays` filters the scene; assigning them (as removing
and freezing rays do) writes back. `rays.js` and `snap.js` did not change: they work on a view
as on the old single-axis scene, and their tests still cover them unchanged. The renderer draws
each axis from its view with the picture shifted to the axis's height. The interaction code
works on "the current axis", the one nearest the pointer, or the one owning whatever is being
drawn or dragged, and measures the pointer from it. Hit-testing tries axes nearest first, so a
tall lens can still be grabbed when the pointer is nearer another axis.

**Using it.**
- **Adding:** the *Optical axis* tool (left palette, **X**); click to add one at that height,
  snapped to the grid.
- **Moving:** drag an axis line where nothing else is, or select it and press ↑/↓. The panel has
  its height and label; new axes are labelled "axis 2", "axis 3", … at their left end.
- **Deleting:** removes everything on the axis. If anything is on it, the in-app dialog asks
  first ("Delete this optical axis?"). The dialog was generalised from the Reset one to take
  its own title and text.
- **Placing:** lenses, objects and so on go on the axis nearest the pointer.
- **Fit to view** covers every axis, its rays and its images.
- **Old scenes and new benches** get one axis at 0, so everything already drawn keeps working.

**A bug found along the way and fixed:** freezing rays (on every edit when "Rays follow the
optics" is off) kept their shape but forgot which lens each point was on and which object they
came from. So with following off, any edit made images vanish, and with them the cut-off at
the image. A frozen point now remembers its lens: it counts as on it while the lens is still
exactly there. A frozen start remembers its source. A new unit test caught this, freezing
through an axis view and comparing the solved bench before and after.

Checked: 6 new unit tests (86 in total). In headless Chrome: a second axis added at −90; a
lens, an object and rays placed on it by pointer position; an image formed there; the axis
dragged to −60 with everything on it unchanged relative to it; Delete asking first and then
removing the axis with its contents; Undo restoring it. All earlier browser tests were re-run.

## 2026-11-13 — Objects snap to steps of F, with a dimension line *(lecturer)*

Objects already snapped to 2F of a lens. The lecturer asked for finer marks: every quarter F
between F and 2F, every half F beyond 2F, a line drawn between the lens and the object, and
only the nearest lens on each side counting.
- `snapObjectZ` (used for objects, lamp filaments and point sources, when placing and when
  dragging) offers F, 1¼F, 1½F, 1¾F, 2F, then 2½F … 6F on the object's side of the **nearest
  lens to its left and the nearest to its right**, and the lens centres. Focal points of lenses
  beyond those two are not offered. Other elements (objects, mirrors, irises) still count as
  before.
- The caption names the mark, "1.5F of L1", using F′ on a converging lens's outgoing side.
  While snapped, a **dimension line** is drawn just below the axis from the lens to the object,
  with arrowheads and the multiple ("1.5f"), plus dashed leaders up to the axis.

Checked: 1 new unit test (87 in total), covering ¼ and ½ steps, both sides between two
lenses, and ignoring a lens beyond the next one. In the browser, an object dragged to 1.25F
showed the caption and the dimension line.

## 2026-11-13 — Lens numbers per axis; 2F and 3F on hover *(lecturer)*

- **Numbering per axis.** Lenses, mirrors and irises are numbered per optical axis, so the first
  lens on axis 2 is L1, not L2, and its focal points are F and F′ (F₁, F₂ … once there are
  several on that axis). Existing scenes keep their labels.
- **Hovering over a lens** (mouse) shows faint hollow marks at 2F, 3F, 2F′ and 3F′ on its axis,
  labelled to match its F and F′. They stay for one second after the cursor leaves the lens,
  then go. On the iPad there is no hover, so they do not appear; the lecturer accepted that.

Checked: 1 new unit test (88 in total). In the browser: a lens on a second axis labelled L1;
the marks shown while hovering, still there 0.5 s after leaving, gone by 1.2 s.

## 2026-11-13 — Hover marks fade *(lecturer)*

The 2F/3F hover marks now stay at full strength for 750 ms after the cursor leaves the lens,
then fade out smoothly, gone at 1250 ms. Measured in the browser: full at 500 ms, 0.44 at
1000 ms, gone at 1400 ms.

A bug report is open, not yet reproduced: with hints on, a ray drawn from an image through
the centre of a second lens was coloured red (focal) instead of green. Rebuilding the setup in
tests (object → L1 → image → L2, rays from the image) classified the central ray correctly,
including with small images, where "through F" and "through the centre" lie almost on one
line. Waiting for the lecturer's saved scene.

## 2026-11-13 — Dragging an object inside F drops the focal ray *(lecturer)*

With three rays drawn from an object beyond F, dragging the object inside F left a strange
ray. The focal ray was still forced "through F", but F was now behind the tip, so the ray ran
backwards from F through the tip to the lens and then parallel. The lecturer asked for that
ray to be dropped when the object is dragged. Drawing a new object inside F with the parallel
and central rays already gave the right virtual image.

- A ray segment pinned *through* a point that has ended up behind its start no longer
  resolves: the ray stops there, is not drawn, and plays no part in images. Nothing is
  deleted: drag the object back beyond F and the focal ray reappears exactly as drawn. When
  drawing, a ray is never offered a snap through a point behind it, so this only arises
  when things move.
- Related: a ray that RayMan had lengthened (and shown faint after its real image went) is now
  drawn at full strength again while it is part of any image, such as the virtual image it
  forms once the object is inside F.

Checked: 1 new unit test (89 in total). In the browser, three rays drawn with the object at
2F, then the object dragged inside F: the focal ray gone, a virtual image at (−50, 20) from the
other two, both drawn at full strength.

## 2026-11-13 — Axis rays snap to F′ after the lens centre *(lecturer)*

A ray drawn along the optical axis through a lens centre would not snap to F′ on the other
side, although rays coming in off the axis did. A ray that reaches a lens centre is locked to
"straight on", and that locked continuation only ever ended at the cursor or the next lens; it
never looked for points to stop at. It now ends exactly on any snap point lying on its line
near the cursor (F′, an image, a focal-plane crossing; not points on other rays), with a ring
and a caption ("straight on through the centre of L1, to F′ of L1"). The same applies to the
one-click "through the centre and straight on".

Checked: 1 new unit test (90 in total), covering both ways of drawing it.

## 2026-11-13 — Reversing a ray; helpers have no arrows *(lecturer)*

**The problem.** The lecturer drew a ray from a lens centre backwards (to the left), to place
it parallel to another ray, then clicked the centre to extend it. The extension could bend at
any angle, and the ray's arrows pointed backwards. Rays have a direction: from where they were
started to where they end. A ray drawn outwards from the centre has its *start* there, so
clicking the centre began a new ray rather than continuing this one. The lecturer asked
whether rays need a way to flip direction, and what would be most elegant.

**The answer: Reverse.** A selected ray can be reversed with a ⇄ button on the right palette
(next to Delete) or **⇧R**. The light then runs the other way along the same line(s): the
arrows turn round and the old start becomes the end, ready to continue from. In the case above,
the end is at the lens centre, so continuing is locked to straight on, as it should be. An
alternative was considered and rejected: having a click on a ray's start reverse it
automatically. Clicking a lens centre or an object tip is also how new rays start (the helper
method depends on it), so that would be ambiguous.

`reverseRay` keeps the meaning of everything:
- every point keeps its pin: on lens L, at F′, at an image;
- every segment keeps its rule: through a point, parallel, parallel to another ray;
- a "straight on" moves to the other piece of its pair, so a line through a lens centre stays a
  single straight segment (a joint);
- the new start is the image the ray was drawn ending at, the point it ended on, or (for a ray
  run to the edge) a free point 150 mm out;
- other rays pinned to its points or segments are renumbered.

Being a constraint-preserving operation, a reversed ray still follows the optics. Its new
start, though, is fixed where the old end was.

**Helpers have no direction:** dashed helper rays, and their preview while drawing, no longer
show arrowheads.

Checked: 3 new unit tests (93 in total). In the browser: a ray drawn from a lens centre to the
left, reversed with ⇧R, then continued from the centre (locked straight on through it); and a
helper drawn without arrows.

## 2026-11-13 — Collimated beam *(lecturer)*

A new element (left palette, key **C**), as specified: width, rays from the top, middle and
bottom (filled in when fill-in is on), colour, and angle (±°). It snaps to the optical axis,
and can be raised or lowered so that its middle ray snaps through a lens centre.

- **Model.** `{ type: 'beam', z, y (centre height), width, angle, color }`. Placing one also
  creates its three rays, pinned to its `top`, `mid` and `bot` points. Those points spread
  across the beam at right angles to it, so a tilted beam keeps its width. Each ray's first
  segment has two new rules: direction `beam` (the beam's angle, so the rays follow when it is
  tilted) and end `next`, the first lens or mirror ahead *as things are now*. A lens added or
  moved later is therefore still reached; with no lens in the way the rays run to the edge.
  From there the rays are continued by hand, like any ray.
- **Optics.** The three rays share one source, a point at infinity, so where they cross after a
  lens is marked as a focus, and fill-in fills the bundle between the top and bottom rays. Hint
  mode colours them by role: parallel when the beam is level, central for a middle ray through
  a centre.
- **Snapping.** Along the axis it lines up with lens focal points, like objects. Up or down, its
  centre snaps onto the axis or to the height at which its middle ray passes through the centre
  of a lens ahead ("middle ray through the centre of L1"), else to the grid.
- **Look.** A bar across the beam in its colour, with a faint emitter block behind it. The
  rays take the beam's colour unless they have their own.
- **Deleting** a beam deletes its rays.

Checked: 3 new unit tests (96 in total). In the browser: a beam placed (snapped onto the axis),
tilted 5° in the panel, dragged until its middle ray snapped through the lens centre (at
−10.5 mm = −120·tan 5°), and filled in.

## 2026-11-13 — Copy and paste *(lecturer)*

A **Copy** button on the right palette (and ⌘C) copies the selected component; the lecturer
asked for the copy to appear as a ghost to paste.
- After copying, a ghost of the component follows the cursor, snapping as that kind of
  component does (a lens lines up its focal points; objects, filaments and beams take the F
  steps; mirrors and irises line up with images too). It goes on the axis nearest the pointer.
- A click pastes it, Shift-click pastes several, Esc stops, and ⌘V brings the ghost back later.
- The copy keeps every property (f, aperture, angle, width, colour, label…). A numbered label
  (L1, M1, A1) becomes the next free one on the axis it lands on, and the ghost already shows
  that name. A copied beam gets its own three rays.
- Rays and axes are not copied.

Checked: 1 new unit test (97 in total). In the browser, a lens with f = 35 copied, pasted as L2,
then ⌘V and two Shift-clicks made L3 and L4, all with f = 35.

## 2026-11-13 — Continuing the right one of coinciding rays *(lecturer)*

Two collimated beams of the same size but different angles, coloured differently, hit a lens
at exactly the same three points. When tracing on from there, RayMan always continued the same
one of the coinciding rays, so only one beam could be traced. The lecturer's suggestion was
adopted: where several ray points coincide, the Ray tool continues **the ray in the current
ray colour** (the one set in the Ray tool's corner flyout). A beam's rays count as the beam's
colour. With no match it falls back to the first, as before. Help mentions it.

Checked in the browser: two coinciding beams, red and blue; with the ray colour set to blue,
clicking the shared point continued the blue beam's ray, and with red, the red one.

## 2026-11-13 — Ending a ray on a focal plane *(lecturer)*

Continuing the middle ray of a tilted beam straight on through a lens centre to 1f, the focal
plane marker (the one shown for off-axis points) did not appear, or only sometimes. The marker
belonged to the snap "through where *another* ray crosses a focal plane", so it only appeared
when some other ray had already been drawn across that plane.

Rays can now **end on a lens's front or back focal plane** themselves (new end kind
`{ kind: 'plane', el, pt: 'F' | 'Fp' }`). When the cursor is at a focal plane ahead, the end
snaps onto it: the dashed plane is drawn, with a ring at the crossing and the caption "to the
back focal plane of L1". The end stays on the plane if the lens moves or f changes. This works
for the locked straight-on continuation through a lens centre and for ordinary pinned
segments; free segments (Alt) are left alone. A beam tilted by θ then visibly lands at f·tanθ.

Checked: 1 new unit test (98 in total; one older test had happened to click exactly on a
focal plane and was moved off it). In the browser, a 5° beam's middle ray continued through the
centre ended on the back focal plane at (50, 4.37) = f·tan 5°, with the plane shown.

## 2026-11-13 — A beam's rays are part of the beam *(lecturer)*

Deleting the middle ray of a collimated beam removed it entirely. With the ray continued
through a lens centre, "the last segment" was the whole straight line through the centre,
including the beam's own piece. The lecturer: the beam is a unit, and its three rays can never
be deleted on their own. Now Delete on a beam's ray only removes what was drawn after the
beam's own piece (the stretch to the first lens). When nothing else is left, a short note says
to delete the beam instead. Deleting the beam still removes its rays.

Checked in the browser: the middle ray continued through the centre, Delete removed only the
continuation, and a second Delete left the beam intact and showed the note.

## 2026-11-13 — A beam is coloured as a whole *(lecturer)*

Selecting one of a beam's rays and picking a colour used to recolour just that ray. A beam is a
unit, so now the colour goes to the beam, and all three rays take it: their own colours are
cleared. The colour flyout shows the beam's colour when one of its rays is selected, and
changing the beam's colour in its panel also clears any old per-ray colours.

Checked in the browser: selecting the top ray and picking purple made the beam purple, with no
ray keeping a colour of its own.

## 2026-11-13 — The colour flyout and the ray just drawn *(lecturer)*

Workflow problem: after drawing green rays, picking red recoloured the ray just drawn, because
it was still selected. The lecturer suggested deselecting a ray as soon as it is drawn, and
asked about the consequences. Deselecting would have cost two things: Delete right after
drawing (a quick way to remove a mis-click; ⌘Z would still do it), and the hint pill naming the
ray just drawn ("Central ray"), useful feedback while learning. So a different rule was adopted
that keeps both: **in the Ray tool the colour flyout only sets the colour of the next ray**,
never the ray still selected. To recolour an existing ray or beam, select it with Select (V)
and pick a colour; the flyout's note says which it will do. The lecturer can still ask for plain
deselection instead.

Checked in the browser: a green ray drawn, red picked in the Ray tool (the green ray stayed
green), the next ray red; the first ray then recoloured purple via Select.

## 2026-11-13 — The preview of a continued ray is in its colour *(lecturer)*

When continuing a ray from a node, the preview line was black until the click placed it. The
preview took the ray's *own* colour, and a beam's rays have none of their own: they take the
beam's. The preview now uses the colour the segment will actually be drawn in: the ray's own,
else its beam's, else the default. In hint mode it uses the ray's role colour.

Checked in the browser: continuing a green beam's ray, the preview is green.

## 2026-11-13 — The "parallel to that ray" glow covers the whole line *(lecturer)*

When a ray being drawn snapped parallel to a ray that runs straight through a lens centre, only
the piece up to the centre was highlighted, not the piece leaving the lens, which was confusing.
The glow now runs along the whole straight line the matched segment belongs to: it spreads
across any "straight on" joins, such as both sides of a lens centre.

Checked: 1 new unit test (99 in total).

## 2026-11-13 — Point sources own their rays *(lecturer)*

As specified: a point source's colour can be changed; all rays drawn from it take its colour;
to change their colour one changes the point source's; and copying the point source copies its
rays too.

Built with later generalisation in mind:
- **Ownership** (`rays.owner`): a ray belongs to the element it was started from, directly or
  by branching off one of that element's rays, if that element's kind is in `OWNERS`. That is
  currently point sources and collimated beams, which now share this mechanism.
- **Colour.** Owned rays are drawn in the owner's colour (only hint-mode role colours take
  precedence). Picking a colour for an owned ray recolours its owner instead, and the colour
  flyout says so. The point source has a colour field in its panel; its symbol uses it.
- **Group copy.** Kinds in `scene.GROUP_COPY` (currently point sources) are copied together
  with the rays they own (`copyOwnedRays`):
  - points pinned to the original, or to rays of the group, are re-pinned to the copies;
  - free points move along with the copy;
  - pins to other things (through a lens centre, onto a lens) are kept, so the copied rays obey
    the same rules from the new position.

  The paste snapshot remembers what it was copied from, so the rays can be found. Beams are not
  listed in `GROUP_COPY`, because they make their own rays when copied. Extending group copy to
  other kinds (objects, filaments) is a matter of adding them to `GROUP_COPY`, and to `OWNERS`
  if their rays should also take their colour.

Checked: 1 new unit test (100 in total). In the browser, a purple point source with two rays;
recolouring a ray recoloured the source; copying it pasted a second source with its own two
rays, still through the lens centre and parallel.

## 2026-11-13 — Fix: copied rays aimed at the original's image *(lecturer's saved scene)*

From the lecturer's scene (point sources FIRST and SECOND, SECOND a copy of FIRST): one of
SECOND's rays went to FIRST's image. That ray was pinned "through the image of FIRST through
L2". An image reference names its source point inside it, and the group copy re-pinned direct
references to the original but not references nested inside an image reference. It now does,
so a copied ray aimed at "its" image aims at the copy's image.

The scene already saved keeps the faulty copy; copying FIRST again gives a correct one. Replaying
the copy on the lecturer's file: the copy's third ray aims at its own image, which forms at
(95, 7.1), the same place as SECOND's.

Checked: 1 new unit test (101 in total).

## 2026-11-13 — Fix: rays started at a point source sitting on F *(lecturer's scene 2)*

The lecturer's point source sat exactly on F of L1. Rays started there were pinned to *F of L1*,
not to the point source: two snap points coincided, and lens points came first in the list. So
dragging the source left the rays behind, and they did not take its colour. Light sources
(object tips, point sources, filament and beam points) are now listed before lens, mirror and
iris points, so they win such ties. Rays already drawn in that scene stay pinned to F and need
redrawing.

Checked: 1 new unit test (102 in total).

## 2026-11-13 — Point-source default colour; axis rays through several centres *(lecturer)*

- A new point source (colour "A", the default) is drawn in the theme's warm source colour, but
  its rays fell back to the default ray colour (black). Owned rays now take the owner's colour
  *as drawn*: for a point source with the default colour, the theme's source colour. The
  preview while drawing from or continuing such a ray uses it too.
- A ray along the axis from F of L1 could not be drawn through to F′ of L2 in one go: the
  one-click "straight on" through a lens centre stopped at the next lens. It now carries on
  straight through any further lens it meets at the centre (undeviated there too), until the
  cursor or a snap point such as F′ of L2: "through the centre of L1, straight on to F′ of L2".

Checked: 1 new unit test (103 in total). In the browser, with lenses at 0 and 70 and a
default-coloured point source at F of L1, one click drew the ray through both centres to F′ of
L2, in the source's colour.

## 2026-11-13 — "Bent by the lens" *(lecturer's scene 3)*

After moving a point source that had sat at F, its middle ray (pinned through the lens centre)
followed, but the two outer rays did not. Those had been drawn *freely* to a height on L1, then
snapped "parallel to the axis", which was right only while the source was at F. RayMan kept
what was drawn: the same heights, still parallel. With an object the rays had followed because
they were principal rays, each a rule tied to the lens.

A new direction rule: **`refract`, "bent by L1"**, which is the ideal thin-lens law
(u′ = u − y/f) at the lens the ray is leaving. It is offered as a snap when continuing a ray
from a point on a lens (not for helpers), and it stays right when the source, the lens or f
changes. The user still chooses and draws it: RayMan only remembers that the bend was the
lens's own. Ties:
- When "bent by" gives exactly the same line as a classic rule (parallel, through F′), the
  classic rule wins, keeping the axis highlight and the F′ ring.
- The exception is a ray that came into the lens *freely*. Then that same line is remembered
  as "bent by L1", with the classic highlight still shown ("parallel to the axis (bent by L1)").
- Principal rays keep their classic rules, which already follow correctly.

Rays already drawn in the lecturer's scene keep their old rules and need redrawing.

Checked: 1 new unit test (104 in total). In the browser: a point source at F, a ray drawn
freely to L1 and continued (snapped parallel, remembered as bent by L1), then the source dragged
to 2F; the ray then crossed the axis at z = 100, as an ideal lens sends it.

## 2026-11-13 — "Bent by" through a second lens *(lecturer's scene 4)*

In the lecturer's scene, all rays did start at the point source. But beyond L2 they did not
follow the source: they had been continued from L2 "through F′ of L2" (right only while the
source sat at F, when the rays between the lenses were parallel), and the middle ray's exit
after L2 was likewise a fixed direction. The "bent by" substitution only applied to rays that
came into a lens *freely*. The right test is whether the incoming segment *guarantees* the
classic rule at this lens: in parallel to the axis (so out through F′), or in through this
lens's F (so out parallel). Otherwise (bent by the previous lens, straight on from another
lens's centre, free, a fixed slope) an exit along the lens's own bend is remembered as "bent by"
this lens, still showing the classic highlight.

Checked: 1 new unit test (105 in total), covering a ray through two lenses where the source
then moves and the ray keeps both lenses' bends. The rays in the lecturer's file keep their old
rules and need redrawing.

## Trace from an image
A click on a (non-focus) image where a ray also ends used to continue that ray, so an image could not be used as the next object. Now a plain click there starts a new ray from the image; Shift-click continues the ray, and the hover caption says so.

## Hide virtual images
- New scene setting `settings.virtual` (default true), toggled in Settings ("Show virtual images"). Off hides
  virtual images, virtual filament images and the dashed backward ray extensions. Stored with the scene (like
  `follow`) so a teaching scene can be saved with them hidden. Only rendering changes; solving is untouched.

## 2026-11-14 — Building Köhler illumination *(exercise)*

The lecturer asked for the Köhler setup of optics.mouse.vision/demos/resolution/kohler to be
built in RayMan, to find missing tools and bugs. Driven in headless Chrome with mouse clicks, aiming
like a person does (moving along the intended line until the caption shows the snap wanted). The
stages are saved in `examples/kohler/` (File → Open):
lamp ±6 at 0; collector f 25 at 50 (filament image at 100, inverted, same size); field diaphragm at 60
(2F of the condenser, so it is imaged 1:1 on the sample at 220); aperture diaphragm at 100 (the
filament image = condenser front focal plane); condenser f 40 at 140; objective f 20 at 240 (BFP 260);
tube lens f 60 at 300 (camera at 360). Rays from three filament points (red top, green middle,
blue bottom) show the aperture planes; file 6 has purple rays through the field-diaphragm edge
(field planes) meeting at (220, −13).

Bugs found and fixed:
- **"Bent by" was wrong for rays drawn right to left**: it applied u′ = u − y/f in both directions.
  Backwards it must undo the bend (u + y/f). Needed to draw a ray backwards from an image through
  a field stop and back through the lens to its source.
- **Rays pinned to another ray's *line* came loose** when that ray was lengthened to its image
  (or cut at a lens): `tailRefs` freed refs to the segment (parallel to it, its focal-plane
  crossings) as well as to its end point. Lengthening/cutting keeps the line, so only the end point
  is freed now. (Removing a segment, in `trimRay`, has its own test and still frees both.)
- **Rays could not be carried on through a real image.** Once rays form an image they are
  lengthened (hidden) to the next lens or the edge, so "Shift-click on an image continues the ray
  ending there" never found one. Shift-click on an image now cuts such a ray back to the image
  (end at that z, same line) and carries on drawing from it, "straight on" being the snap.
- **Focal-plane crossings of other rays were strong snaps everywhere.** In a bundle there are dozens,
  and they pulled rays aimed at a lens off target. They are strong only for the lens the ray is
  leaving (the helper-ray construction); otherwise weak, like points on rays.
- Hover caption said "continue this ray (Shift: continue this ray)"; the Shift note now only shows
  on an image.

Missing tools (not built, listed for the lecturer): aim a ray so it passes a point *after* a lens
(field-plane rays need the backward workaround); a plane/screen marker for sample and camera;
images of iris edges (field stop on the sample) are not marked, only images of sources; continuing a
whole bundle through the next lens takes ~4 clicks per ray; reversing a ray turns "bent by" into a
fixed slope; with lenses named, F/F′ labels lose their subscripts and become ambiguous.

## 2026-11-14 — Köhler follow-up *(lecturer)*

The two bigger ideas (aiming a ray through a point after a lens; fewer clicks per bundle) went
into `TODO.md` to ponder: teaching is the goal and going slow has benefits. Done now:

- **Bug: an aperture diaphragm at the filament image did nothing when closed.** `blockAt` only
  tested points strictly between a segment's ends; at the filament image every ray has a corner
  exactly on the iris plane (the image point, or where it was carried on through the image), so it
  was never tested. A segment's end point now counts (its start does not: it was the previous
  segment's end). In the Köhler scene, closing the aperture to 4 mm now stops the red and blue
  bundles (images at ±6 mm), and the green one (image on the axis) passes.
- **Image plane markers** (tool S): a dashed, hatched line named "sample" (the first on an axis),
  then "camera", renamable. It snaps into place like an iris (focal points, images). Rays pass
  through it; a ray drawn to it ends on it ("to sample"), and can be double-clicked on from there.
  Where rays cross it is a (weak) snap point, "that ray at sample". Two knock-on fixes so it does
  not count as a lens: image finding follows the light on through straight corners (on a marker,
  or where a ray was carried on through an image) until something bends it, and fill-in rays skip
  markers. Added to the Köhler examples (sample at 220, camera at 360).
- **F/F′ labels name their lens**: F with the lens's name as a real (smaller, lowered) subscript,
  F_collector, F′_condenser; lenses still called Ln keep their number. The prime now sits on the
  F (F′₁ rather than F₁′). Names over 10 characters are cut. A label that would run into its
  neighbour drops to a second row.

Checked: 2 new unit tests (111 in total), and in headless Chrome on the Köhler files.

## 2026-11-14 — The scan mirror now acts like a mirror *(lecturer)*

The lecturer could not see how the scan mirror was meant to work: it wiggled when scanned, but
nothing followed it. The only way to use it was to draw a ray *to* the mirror and then pick up the
"reflected by M1" snap while drawing on from it. That is easy to miss, and a collimated beam's
rays just stopped on the mirror. The lecturer suggested a fake mirror: light passes *through* it
(the path stays unfolded, as agreed) and comes out tilted by the mirror. Done that way:

- **A ray reaching the mirror goes on through it, tilted by its beam tilt, in the same click**:
  to the next lens if the cursor is past it, to the cursor if not, and straight to the next lens if
  the click is on the mirror itself ("through M1, tilted 5°, to L1").
- **A ray already ending on the mirror** (an old file, or a ray cut there) can only go on through
  it, tilted, much as a ray at a lens centre can only go straight on.
- **Collimated beams and other rays that end on a mirror get a segment through it automatically**
  (`passMirrors`, run on every commit and on loading). Their rays run "to the next lens", so a
  mirror placed in front of a beam now passes the beam on, tilted. The added segment is marked
  `pass` and is taken off again if the mirror moves out of the way. Drawing on is left to the
  student, as everywhere else in RayMan.
- Scan already re-solved the rays every frame, so the beam after the mirror now visibly swings.
- A hand-drawn ray that a mirror is later put across still passes straight through. Its hover
  offers "send this ray through M1, tilted", which cuts it at the mirror and sends it through.
- Helper rays (construction lines) still pass the mirror undeviated.
- A `deflect` segment now needs its start to be on its mirror; a stale one fails instead of tilting
  a ray at whatever lens it now meets.

Checked: 4 new and 1 rewritten unit tests (115 in total), and a headless-Chrome screenshot of a
beam passing through M1 at 6° into the scan lens.

## 2026-11-14 — Towards a confocal: two-way mirror, beams turned round, an object explorer *(lecturer)*

The lecturer wants to build the de-scanned confocal of the *confocal-from-zero* demo (step 11):
laser running right to left, fluorescence collected left to right through the same scan mirror.
Working style agreed: Claude proposes features, the lecturer curates, Claude builds, tests and
fixes. The slow, by-hand workflow is part of the point, so no shortcuts for drawing yet.

- **"The mirror blocks the beam."** Not reproducible from the repository: the copy served at
  localhost:8000/rayman had not been updated since the mirror change. Redeployed with
  `copy2webfolder.sh`.
- **The scan mirror works from both sides.** The lecturer asked for it to be flippable. Rather
  than a direction switch, the turn is by direction of travel: atan u′ = atan u + s·tilt, with s
  the way the light runs. This is the mirror image left to right (a positive tilt turns light up
  either way), and it is reversible: light sent back along a ray retraces it. So the mirror
  **de-scans** returning fluorescence, as a real galvo does, with no extra machinery. ⇧R on a
  mirror now only swaps the side its hatching is drawn on (cosmetic, since light passes from
  both sides).
- **Collimated beams turn round** with ⇧R (also when one of the beam's own rays is selected,
  instead of reversing that ray alone). The beam becomes its mirror image (`dir: -1`): its rays
  run left, to the next lens or mirror that way. Rays continued by hand from the beam go back to
  their first piece, and anything pinned to them is frozen first.
- **Object explorer** (rail button with a layers icon, key **E**): per axis, each light source
  (object, point source, beam, filament) with its ray count and an eye switch; helper rays as
  one switch; the optics listed for selecting; "Switch everything on". A source switched off
  takes with it its rays, rays from its images, and any ray pinned to those (for example a
  helper drawn parallel to one). Implemented as flags (`hidden` on the source, `off` on its
  rays, `hideHelpers` on the axis) that the axis view filters, so solving, snapping, images,
  fill-in rays and drawing all simply do not see them. Writing a list through the view keeps
  what is switched off. Saved, and undoable.
- **Splash on load** (asked mid-session): the About card now opens every time the page is
  loaded (new tab, reopened tab, reload). A click or Esc closes it as before.

**Bugs found while building a confocal by mouse, and fixed:**
- *Scanned rays were pinned to coincidences.* Traced at tilt 0, the laser's middle ray hits lens
  centres and the sample centre, so it was saved as "straight on through the centre" and "to the
  centre of sample". Scanning then left it unbent at the lenses and dragged it back to the
  sample centre. A ray that has come through a scan mirror is now never pinned to a fixed point
  it merely passes: at a lens centre it is "bent by" the lens (the same there, right off it), a
  line snapped through F′ or a centre is saved as the equivalent "bent by" / "straight on", and
  it ends on the plane it reaches, not on a point in it. The hints still name the classic rule.
- *A fluorophore placed at the laser focus could not start a ray*: the click continued (or
  branched from) the laser rays ending there. A click on a point source now starts a ray from
  it, and Shift continues the ray ending there (the rule already used at images). Where an
  element's point and a point on a ray coincide, the element's point wins.
- Flipping a beam no longer says its rays "start again" when the only piece removed was the
  automatic one through a mirror.

Checked: 7 new unit tests (122 in total), including a full confocal in which the fluorescence
from the scanned spot leaves the mirror on the laser's line at tilts 0°, 3° and −5°. In headless
Chrome by mouse: beam then mirror; flipping the beam and moving it right of the mirror; the
explorer (off, undo, redo, all on, reload); the laser path traced through scan lens, tube lens
and objective, then Scan (the beam pivots about the objective's back focal plane); a fluorophore
at the focus and its light de-scanned by the mirror; the splash on load.

## 2026-11-14 — Curated features from the confocal demo, and an illustrated guide *(lecturer)*

The lecturer went through the proposals: (1) a fluorophore that follows the laser focus: no;
(2) dichroic: yes; (3) coloured planes: yes; (4) lens rims stopping light: yes, optional;
(5) scan extremes: yes; (6) vertical stretch: "nice idea", parked in `TODO.md` (it needs
snapping and hit-testing to work in screen distances); (7) ray labels: yes.

- **Dichroic** (tool **D**): a tilted glass plate on the axis, drawn unfolded, so light passes
  through it. In its panel, **Stops** picks a colour: rays of that colour end there (in a real
  microscope they would go the other way at the dichroic), others pass. The plate is tinted with
  that colour. A ray's colour is its owner's (beam, point source) or its own; the default colour
  is never stopped. A ray being drawn is stopped as it is drawn ("stopped by dichroic (its
  colour)"). The panel's colour swatches now work for any property, not only `color`.
- **Coloured image plane markers**, to show the families of conjugate planes.
- **Lens rims stop light** (Settings, off by default). Light meeting a lens or mirror outside
  its aperture is stopped at its rim and marked with a red ×. Off, it goes on past as before.
  Helper rays are never stopped. Irises, dichroics and rims share one stopping function.
- **Scan extremes** (a mirror's panel): the light it steers is drawn again faintly at rest tilt
  ± range, with a faint × where a rim stops it. During Scan the extremes stay at the resting tilt.
- **Ray names**: select a ray, press **N**, type (r1, h2); Enter keeps, Esc cancels, empty
  removes. A trailing number is drawn as a subscript, beside the ray's first segment on its upper
  side. Saved with the scene. (No ray panel, as agreed earlier: a small text box by the ray.)
- **The guide** (`guide/index.html`), as the lecturer asked: helper rays, light from infinity, 4f
  relays and scanning, building a confocal, irises and fill-in rays, and the Objects panel, with
  16 screenshots. Those sections left the `?` help, which now ends with a link to the guide. Links
  are written as `guide/index.html` and `../index.html` so they also work when RayMan is opened
  from disk, where a folder link shows a directory listing.
- **The screenshots are generated**: `Claude/guide-shots/scenes.js` builds each scene in the real
  app (through the same snapping a mouse uses), and `shots.py` fits it, hides the toolbars and
  saves a 2x PNG. Labels collided in the first confocal pictures; the scenes were spread out and
  the full-length ones are shot wider. `RM.app.redraw` is now exposed for this.
- **`CLAUDE.md`** (new) says to keep the guide and its pictures up to date with every change, and
  how to regenerate them. The local `copy2webfolder.sh` (not in git) no longer copies it to the
  website.
- A test screenshot (`t4a.png`) had been committed to the repository root by mistake in the
  previous commit; removed.

Checked: 4 new unit tests (126 in total). In headless Chrome: placing a dichroic and choosing its
stop colour (a blue beam stopped, then passing once its colour is reset), the rims setting, scan
extremes, naming a ray with N, and the guide (all images load; no sideways scroll at phone width).

## 2026-11-14 — Scanning parked as "under development"; a shorter guide *(lecturer)*

The lecturer: instructions should be **generic and not verbose**; remove the 4f/scanning
material from the guide; he is not sure that is the direction yet. The dichroic did not work as
he expected: in the unfolded picture the collected fluorescence passed through the laser beam's
source. So:

- **Settings → "Show features under development"** (off by default, remembered in this browser).
  Off, the scan mirror and dichroic tools, their keys (M, D) and their help lines are hidden;
  scenes that already contain them still show and work. Marked `dev` in the markup, `DEV_TOOLS`
  in app.js. The code for both stays, unchanged, for when the direction is decided.
- **The guide** is now four short sections (helper rays, light from infinity, irises and fill-in
  rays, the Objects panel), a sentence or two per point, six pictures, each a link to its full
  size. The 4f relay, scanning and confocal sections and their pictures are gone, and their
  scenes removed from the screenshot generator. The Objects-panel picture uses two point sources
  instead of the confocal.
- `CLAUDE.md` records both: keep the guide generic and short, and keep development features out
  of it until wanted.

Checked: 126 unit tests pass. In headless Chrome: with the switch off, the mirror and dichroic
buttons and help lines are hidden and M and D do nothing; on, they return; switching off while
one of those tools is active goes back to Select; the choice survives a reload. The guide loads
all six images.

## 2026-11-14 — Splash once per tab *(lecturer)*

The splash (About card) showed on every load, including "Back to RayMan" from the guide. Now it
shows once per browser tab: the first load in a tab sets a flag in `sessionStorage`, which
belongs to the tab, survives refreshes and navigation within it, and starts empty in a new tab.
Without storage (some private modes) it shows as before. The help's link to the guide now opens
in the same tab (it opened a new one, where "Back" would have been a first visit); the bench is
saved in the browser, so nothing is lost by leaving.

Checked in headless Chrome: first load shows it; refresh, and help → guide → back, do not; a new
tab does.

## 2026-11-14 — Sliders for every number on touch screens *(lecturer)*

On the iPad the lens aperture could not be changed: the number boxes with spinners work with a
mouse, not a finger. The lecturer asked whether to make separate desktop and touch controls.
Chosen instead: one panel, with a slider for every number shown only on touch screens
(`body.touch`: touch points present, or any coarse pointer, so an iPad with a keyboard counts).
Desktop keeps its compact boxes; there is one code path.

- Sizes and heights get fixed ranges (`touch: [min, max, step]` in panel.js), stretched to take
  in the current value.
- Positions (z, axis height) get a window of ±250 mm around the value, re-centred each time the
  slider is let go, so an element can be walked anywhere.
- On touch, all sliders get a 26 px thumb and more height.
- Fixed on the way: an iris set the opening's limit on every slider in its panel; now only on
  the opening's.

Checked in Chrome with touch emulation (5 touch points), dragging with touch events: aperture
25 → 62, position 60 → 284 with the window re-centred; undo recorded. On desktop only the
existing sliders show. Not yet tried on a real iPad.

## 2026-11-14 — No more stale code in browsers *(lecturer)*

After a deploy, Safari on the iPad kept showing the old version even after refreshing. The
lecturer: "Do the permanent fix, for sure. Otherwise users will be screwed."

- **Version stamps at deploy time.** `tools/stamp-assets.py <copy>` rewrites every local
  `src`/`href` in the copy's .html files to add `?v=<first 10 hex of the file's SHA-1>`. A
  changed file gets a new URL, so no cache can serve the old one; unchanged files keep theirs and
  stay cached. The repository's files stay unstamped (RayMan must still open from disk, e.g. a
  USB stick). Re-running replaces old stamps. `copy2webfolder.sh` (local, git-ignored) now runs
  it on the copy and no longer copies `tools/`.
- **`.htaccess`** in RayMan's folder: on Apache (the public site), `Cache-Control: no-cache` for
  html, js and css, so browsers revalidate on every visit (a cheap 304 when unchanged). This also
  covers the pages themselves, which cannot carry a stamp. Guarded by `IfModule mod_headers`.
  The local PHP server ignores it; it sends no caching headers at all.
- README has a short "Putting it on a website" section; CLAUDE.md notes the step.

Checked: deployed copy has 22 stamped links (8 scripts, the stylesheet, the guide's images);
the stamped site loads at localhost:8000/rayman in headless Chrome with touch emulation (no
errors, touch sliders present) and the guide's images load. An iPad that already cached the old
page needs one last private tab or website-data clear; from then on updates arrive on refresh.

## 2026-11-14 — Hint diagrams stay a row on an upright iPad *(lecturer)*

At 900 px and narrower the three rule diagrams (hints, G) switched to a column at the right edge,
on top of the right toolbar: an iPad held upright. They now stay a row at every width: on narrow
screens just below the name, between the two toolbars, each shrinking to fit. Wider screens are
unchanged.

Checked in headless Chrome at 820×1180 and 768×1024 (iPads upright), 390×844 (a phone),
1180×820 and 1400×850: always one row, never over either toolbar or the name.

## 2026-11-14 — Shorter Settings; the Ray tool shows its two kinds *(lecturer)*

- Settings: no grey text under "Features under development" (renamed from "Show features under
  development", which wrapped) and "Auto-hide the toolbars": they are obvious and it wasted
  space. Shorter grey text for virtual images ("With dashed back-extensions.") and lens rims
  ("Missed light stops there (×).").
- The Ray tool draws ordinary or helper rays, which was easy to miss. A small R or H now sits in
  the bottom-left of its icon (the colour triangle stays bottom-right), and its tooltip lists
  both kinds, one above the other: "Ray R" / "Helper ray H". This is for discovering the helper.

Checked in headless Chrome: the badge reads R, and H after pressing H; the tooltip shows two lines.

## 2026-11-14 — 1.5F, 2F and 3F always shown for a lone lens *(lecturer)*

When an axis has a single lens, its 1.5F, 2F and 3F marks (both sides) are drawn all the time,
fainter than F and F′. With more lenses they still appear only while a lens is hovered (which
now also shows 1.5F). Objects already snapped to these multiples. The guide's pictures, all
single-lens scenes, were regenerated to match.

Checked in headless Chrome: one lens shows the six marks; adding a second lens removes them.

## 2026-11-14 — The guide's helper-ray example follows the demo *(lecturer)*

The guide's helper-ray example now follows step 1 of the *confocal-from-zero* demo: a source just
inside F of an objective, then a tube lens, traced in four pictures (helpers at the objective; the
rays leave it through the crossings of its back focal plane; helpers at the tube lens; the rays
meet at the image). Built in RayMan with the same snaps a student uses. The demo stretches its
picture vertically; RayMan cannot, so the system is more compact than the demo's (objective f 40
with the source 4 inside F, tube lens f 100, 200 apart), virtual images are hidden in these shots
(the objective's virtual image is far to the left and pulled the view out), and the view is set to
the system.

Ray names now sit on the side of the ray away from the axis: below a ray that runs below it.
Before, both labels of a symmetric pair (h₃, h₄) landed between the rays and overlapped.
- (Same day.) The guide now says why drawing a helper from the lens centre works: RayMan snaps
  "parallel to that ray" to rays anywhere on the bench, including the one behind the lens, and
  that ray glows when the snap holds. The lecturer pointed out this is not obvious.

## 2026-11-14 — Add to Home Screen, with the lecturer's icon *(lecturer)*

The lecturer drew an icon (1254 px, square, full-bleed, no transparency: right for iOS) and wants
RayMan on the iPad home screen like an app.

- `images/icons/`: `apple-touch-icon.png` (180 px, what iOS uses), `icon-192.png` and
  `icon-512.png` (for the manifest: Android, Chrome, recent iOS), scaled with Lanczos. No
  "maskable" version: the lettering runs close to the edges and Android's shape masks would cut it.
- `manifest.json`: name "RayMan manual ray tracing", short name "RayMan", `display: standalone`,
  start at `index.html`, background and theme colour the light theme's `#fafbfc`. Named `.json`
  (not `.webmanifest`) so every server sends a type browsers accept.
- `index.html` head: the manifest and touch-icon links, the title under the icon
  (`apple-mobile-web-app-title`), status bar style, theme colour. The page already asked for
  full-screen (`apple-mobile-web-app-capable`).
- Answered: the home-screen app is the website in its own window, so it updates with the site;
  iOS may resume a paused copy, so close it in the app switcher to be sure. Its storage is separate
  from Safari's. Working offline would need a service worker, which needs HTTPS: not done.

Checked: Chrome reads the manifest from localhost:8000/rayman with no errors; the icons are served
as image/png; the deploy stamps the manifest and touch-icon links.

## 2026-11-14 — Works offline *(lecturer)*

The public site (optics.mouse.vision/rayman/) is https, so a service worker is allowed; the
lecturer wants RayMan usable offline from the iPad home screen.

- **`sw.js`, network first.** Online, every request goes to the website (so updates still show on
  the next load, which the lecturer insisted on after the stale-iPad episode) and the answer is
  kept. Offline, or if the network has not answered in 4 s (bad lecture-theatre wifi), the kept
  copy is used. Matching ignores the `?v=` stamps. On the first visit it stores the core app
  (`CORE`: page, stylesheet, scripts, manifest, icons, the splash logo); guide pages are kept as
  visited. Registered only on https or localhost, so opening from disk is unaffected.
- **`tests/sw.test.js`** checks `CORE` lists every local file `index.html` loads (it caught the
  splash logo on its first run) and that each listed file exists.

Checked in headless Chrome against localhost:8000/rayman: the worker installs and stores 16
files; with the network cut, reloading still runs the full app (styled, a lens can be placed),
also via the folder URL; online, a change to the deployed page shows on the very next reload.
Not yet tried on the iPad, which needs the https site.

## 2026-11-14 — Guide: how to install RayMan as an app *(lecturer)*

A last guide section, "Install as an app": a sentence on what it gives (home-screen app, updates
with the site, offline after the first visit), the icon shown as on a home screen (the real
180 px icon with iOS's rounded corners and its name below, on a wallpaper-like panel, done in
CSS so it always matches the deployed icon), then three steps for iPad and iPhone (Safari) and two
for Android (Chrome), each with its one caveat (iOS: separate saved bench, re-add for a new
icon; Android: shares Chrome's bench). The footer link now uses the accent colour.

Also found: the public site (optics.mouse.vision/rayman) predates the icon and offline commits,
so the lecturer's home-screen app had no icon; the site's deploy.sh needs running, then the app
re-adding on the iPad.

## 2026-11-14 — Magnification beside arrow images *(lecturer)*

The image of an object arrow is now labelled **M = …** beside it (on the axis side of the
tip, under "image"): its height over the object's height, so M = 1 is the same size, M = −2
twice the size and inverted, and a magnifier's virtual image reads M = 2. Through several lenses
it is the total magnification from the original object (the image's height over the object's),
which is what a microscope's M means. Like the image itself it comes from the drawn rays, so
wrong rays give a wrong M: RayMan doesn't correct the student. Rounded to two decimals, with a
real minus sign and a background halo so rays crossing it don't hide it. Point images, foci and
filament images get no M. `RM.rays.magnification(scene, image)`; tests in images.test.js. One
line in the `?` help; the open-iris guide picture regenerated (it now shows M = −1).

## 2026-11-14 — Virtual images off by default *(lecturer)*

A new bench now starts with "Show virtual images" off (`settings.virtual: false` in
`S.create`, the Settings switch unchecked in the markup). The setting belongs to the bench, so it
is kept in the bench autosaved to localStorage (and in saved files): a bench where it was switched
on keeps it on across visits, and "New" keeps the current settings. Files that store the setting
(the Köhler examples do) keep their own value; an old file without it now opens with virtual
images hidden. The `?` help says they are hidden until switched on. No guide picture changed.

## 2026-11-14: keyboard-only messages hidden on iPad
- On touch screens (`pointer: coarse`) the hint pill drops the Alt/Shift/Esc/key-letter parts (`forDevice` in app.js);
  "scroll to zoom" becomes "pinch to zoom". The copy toast and the "(Shift: continue…)" caption are touch-aware too.
- In the `?` help, the Keys list and the Alt/Shift/Del sentences carry class `desk-only` (hidden by CSS on coarse pointers).
- Why: Esc, Alt and Shift do not exist on an iPad with a Pencil and fingers.

## 2026-11-14 — Snapping parallel to a helper, and to several rays at once *(lecturer)*

The lecturer drew a telescope (long-f objective, short-f eyepiece, an on-axis then a 4° beam,
a helper from the intermediate image through the eyepiece centre) and could not snap the rays
leaving the eyepiece parallel to the helper: near F′ of the eyepiece (the exit pupil, where all
the narrow beams cross) other snaps won, and "parallel to that ray" flickered between the helper
and the last ray drawn parallel to it. Reproduced in Node by sweeping the cursor across the
right line: "parallel to that ray" was a weak snap, so F′, and the point where the previous
off-axis ray crosses the back focal plane, beat it whenever within reach; the correct line won
only with the cursor exactly on it. Two changes, chosen by the lecturer from four proposed:

- **Every exactly parallel ray at once** (`allParallel` in rays.js). All rays parallel to the
  chosen one (to rounding) glow, the pill says "parallel to those rays", and the snap is stored
  as parallel to the helper among them if there is one, else the first drawn. Exact ties had
  been decided by rounding, hence the flicker.
- **Parallel to a helper ray is a strong snap.** A helper is drawn on purpose as a construction
  line; parallel to an ordinary ray stays weak (a full bundle would otherwise pull rays straight
  through lenses). Where the line is also how the lens bends the ray, it is stored as "bent by"
  (as before) and reads "parallel to that ray (bent by L2)", with the helper glowing.

Not done (proposed, not chosen): demoting focal-plane crossings of other rays to weak unless they
are the helper construction; colour or recency as priorities (invisible rules); inferring a
parallel bundle from a ray through the front focal point ("bent by" already gives that line).

Checked by mouse in headless Chrome on the telescope: the first ray after the helper now snaps
parallel to it across ±6 px; later rays show both the helper and the earlier rays glowing.
One sentence added to the guide's helper section. Tests in phase4.test.js.

## 2026-11-14 — A ray's end continues only a ray of the kind being drawn; negative-lens steps *(lecturer)*

The lecturer traced a negative lens: a helper from the object tip aimed at F on the far side,
ended at the lens, then the Ray tool on ordinary rays (R) to carry on from its end, parallel
to the axis. The new segment was dashed: clicking a ray's end continued that ray, keeping its
kind, whatever kind was chosen. Reproduced by mouse in headless Chrome.

- **Fix** (`continuesAt` in app.js): a click on a ray's end continues it only if it is of the
  kind chosen (R or H). Otherwise a new ray of the chosen kind starts there ("branch from this
  ray"), both ways round: with H, a click on an ordinary ray's end starts a helper. Where two
  rays end at one point, the one of the chosen kind wins, then the one in the chosen colour
  (`rayNodeAt`). The "(Shift: continue a ray through it)" hint follows the same rule.
- An ordinary ray started on a helper has no light source (`raySource` stops at helpers), so it
  forms no image. The better way, now in the guide: an ordinary ray from the tip aimed **through
  F** beyond the lens. It already stopped at the lens, and continued parallel to the axis it
  joins the virtual image. A helper from the lens to F shows the aim.
- **Guide**: a short "A negative lens" section, the lecturer's steps (lens, object between F′
  and 1.5F′, through the centre, parallel then along a helper from F′, aimed at F), two pictures
  (`negative-1`, `negative-2`, scenes `negativeA/B`), and one sentence on the R/H rule. Ray names
  left off those pictures: r₁, h₁ and "virtual image" landed on one spot. One sentence in the
  `?` help. Tests in tests/negative.test.js (the steps give the image at z = −27.8, y = 11.1).

## 2026-11-14 — Köhler again, with the demo's real layout *(exercise)*

The first Köhler build followed wrong diagrams. Rebuilt from the demo
(localhost:8000/demos/resolution/kohler, the lecture slides' layout: every plane one focal length
from the next lens). Driven by mouse in headless Chrome as before, every click checked against the
hover caption, every result checked against the demo's numbers. The old six files are replaced by
`examples/kohler/`:

1. `collector`: lamp ±7 at 0 (the demo's three lamp points), collector f 50 at 50; three rays per
   lamp point (collector centre, and y_lamp ± 18 so they pass a field diaphragm of 19 later).
2. `relay`: + field lens f 90 at 190, condenser f 60 at 340, sample at 400. Lamp images at 280,
   y = −12.6, 0, 12.6 (×−1.8); each lamp point lights the sample from −12 to 12.
3. `field-diaphragm`: + iris at 100, r 19.  4. `aperture-diaphragm`: + iris at 280, r 16.
5. `whole-lamp-points`: + objective f 30 at 430, pupil iris r 10 at 460, tube lens f 60 at 520,
   camera at 580. Lamp images in the back focal plane at ±6.3, 0 (×0.9).
6. `whole-field-points`: the same optics, rays from the three lamp points through field points
   y = 15, 0, −15 at 100. They meet again at ∓10 on the sample (×−2/3) and ±20 on the camera.

It works: all of it can be built with the tools there are, and every image and crossing is where the
demo puts it. Closing the field diaphragm stops the outer rays; closing the aperture diaphragm to 10
stops the top and bottom lamp points at their images. Dragging the condenser 10 mm moves the field
diaphragm's image to 410, and undo puts it back. About 250 clicks for files 1–5.

Bugs fixed:
- **Snaps beyond the lens a segment stops on.** Drawing from the lamp to the collector, RayMan
  offered "through the edge of iris field, to collector": the straight line aimed at the field
  diaphragm edge *behind* the collector, where the light does not go (it is bent). The ray landed
  at 6 instead of 8. Now, for ordinary rays, a point beyond that lens is offered only if it is that
  lens's F (a negative lens: aimed at F, out parallel) or an image (a virtual object for it). Iris
  edges, markers, other lenses' points and F′ of a positive lens beyond it are not. Helpers, which
  pass through lenses, keep them all. Points before the lens are untouched: "through the edge of
  iris field, to field lens" (after the collector) is still there, and is useful.
- **1.5F, 2F, 3F labels overlapped** each other and F/F′ when the lens has a long name
  (F′_collector 1.5F′_collector 2F′_collector in one heap). They now keep clear of the F/F′ labels:
  where the name does not fit they read 1.5F′, 2F′…, and if that still runs into a label, a row lower.

Not changed, for the lecturer (in TODO.md): field points are not marked as images (rays from
different lamp points cross there; images are only of light sources); with the snap radius ~12 px a
weak "point on a ray" snap at y = −7 kept a click at −8 off even zoomed in 4×, so Alt was needed;
"image" labels at the lamp images sit on the F′ = F labels; the field-point rays need their
collector heights worked out by hand (TODO 1 would do it). Where a red, an orange and a blue ray end
at one sample point, the chosen colour picks the one continued (as designed): easy to extend the
wrong one if the colour is not set first.

Checked: 4 new tests in tests/kohler.test.js (137 in total), including the saved files' numbers.
No guide picture changed.

## 2026-11-14 — Iris: no panel when dragging its opening *(lecturer)*

Opening or closing an iris by dragging an edge of its opening brought up its properties panel,
which covered the rays being clipped. Now a press on the edge selects the iris without the panel
(`select(id, quiet)` in app.js; the quiet selection survives undo and other refreshes). Clicking a
blade still opens the panel, and a panel already open stays open while the edge is dragged. The
panel's grey description of an iris is gone. Guide: one sentence (click a blade for the panel).
Checked by mouse in headless Chrome on kohler-4: drag, undo, blade click, drag with panel open.

## 2026-11-14 — Guide: carrying rays on through an image; TODO idea 1 in pictures *(lecturer)*

Shift-click on an image (carry a ray that ends there on past it) was only in the `?` help. The
guide now has a short section, "Carrying rays on through an image", with two pictures: a point 2f
before L1, its three rays stopping at the image with the Shift hover caption showing, then each
carried on through L2 to the next image (scenes `throughA/B`, shots `through-1/2`; `shots.py`
learnt a `hover` option: a tool key, a screen point and modifier keys, for a hover caption). It
says it needs a keyboard. The `?` help's list of guide topics and the guide's description name it.

The lecturer did not follow idea 1 in TODO.md. It is rewritten around four pictures made with
RayMan (`Claude/guide-shots/todo_aim.py`, into `Claude/todo-img/`): the ray wanted (lamp top,
through the field-diaphragm edge after the collector), today's guesses, a mock-up of the proposed
snap (preview and caption set by hand), and the ray following the edge when the diaphragm closes.

## 2026-11-14 — Splash picture 1000×667; README typos; README kept short *(lecturer)*

The splash (the About card, shown at start-up once per tab) now uses `images/rayman_1000_667.jpg`
instead of the 1536×1024 `rayman.png`: 476 CSS px wide on screen, so 1000 px is sharp on Retina
screens and the file is 84 KB. `sw.js` `CORE` lists the new file in place of the old one (the
offline test passes). The README's own pictures are unchanged, apart from typo fixes: "Rayman",
"Pencel", "exapnder", "eample", "off-line", "Kohler" → "Köhler", and the alt text of the beam
expander and Köhler pictures (they had the basic example's text). CLAUDE.md now says the README is
kept short: a new feature goes in only if it matters to a reader, in a sentence or two.

## 2026-11-14 — Link previews: Open Graph and Twitter card tags *(lecturer)*

`index.html` now has `og:` and `twitter:` meta tags, so a link posted to Slack, Bluesky or X shows
the splash picture (`images/rayman_1000_667.jpg`, given as an absolute URL on
optics.mouse.vision/rayman, since scrapers need one), the title and a one-line description. The
card is `summary_large_image`, which crops the 3:2 picture to a wider strip on X. The guide does
not have tags yet. Previews only appear once the page is online at that address, and services
cache them: a changed picture may need the service's own preview refresh.

## 2026-11-15 — Install offline in the help panel's footer *(lecturer)*

The footer of the `?` panel now reads: About RayMan · GitHub · the RayMan icon and **Install offline**,
with a small dot between each, so the app mode is found by people who would not look for it.

The button runs the browser's own install prompt where one is offered (Chrome, Edge, Android). The
browser fires `beforeinstallprompt` only over https or on localhost, and the prompt can be used once,
so the stored event is cleared after use. Where there is no prompt to call (Safari on iPad, iPhone or
Mac), the button shows the steps in a toast instead: Share, then "Add to Home Screen"; or the browser
menu for Safari's "Add to Dock". If RayMan is already running as an installed app, it says so.
The offline copy itself is still made by `sw.js`; installing only adds the home-screen or dock icon.
The icon is `images/icons/icon-192.png`, already in the service worker's CORE list.
`tests/install.test.js` checks the footer order and that the button is wired to an action.

**iOS: a Share icon after "Install offline".** The "Tap Share" wording is RayMan's own toast, not
iOS's, and iOS cannot be made to show its install step, so the footer gets an image of the Share
icon (drawn in SVG, so it takes the link colour) after the text. It appears only on iOS: `app.js`
adds an `ios` class to `<html>` (iPads in desktop mode count, as they report a Mac), and the CSS
shows the icon only under that class. The toast still gives the words.

## 2026-11-16: issue #1, deleting a blocking iris did not bring the whole ray back

An iris that stopped a ray, then deleted, left the ray ending at the next lens: the light after it
was gone. Cause: `bake()` in `rays.js` (run before any delete to free pins) cut each ray's pieces
down to what the solver had reached, and a blocked ray is only reached as far as the iris. So the
pieces past the iris were thrown away for good. Fix: for a blocked ray `bake()` keeps the later
pieces, up to the first that mentions what is being removed (those would dangle, so they still go).
Chosen over "open the iris, then delete" (the issue's suggestion) because that is a workaround that
leaves every other caller of `bake()` with the same loss. Test in `tests/phase5.test.js`; also
checked by mouse in headless Chrome (select the iris, Delete: all rays complete again).

## 2026-11-16: issue #2, fill-in rays not crossing at an image

With three lenses, one bundle's fill between L2 and L3 ran across the bundle instead of through the
image, and spilled outside the drawn rays. Cause: the two drawn rays met at the image and each was
drawn on from there along the *other* one's line (click the image, then the point on L3 that lines
up with the other ray). On screen that is the same X as two straight rays, but `fillRays()` blends
heights plane by plane, top ray with top ray, so at L3 it paired the wrong ends. Fix: before
blending, `untangle()` swaps the two rays' tails at a free point where they meet (not on a lens),
when that makes both straighter. Only then: rays that genuinely kink alone are still left as drawn,
so the fill still shows a wrong ray. Test in `tests/phase5.test.js`; checked in headless Chrome with
the bundle drawn by the snapping rules, before (the issue's picture) and after.

## 2026-11-16: issue #3, embedding diagrams in web pages; share links; GitHub Pages

The lecturer asked for read-only RayMan diagrams in web pages, with Enlarge and Open in RayMan
buttons (each can be turned off in the page source), and for RayMan to be deployed on GitHub Pages.
Agreed changes and additions (posted on the issue before building):

- **Open in RayMan passes the scene in the link** (`…/#scene=<token>`), not the URL of a `.json`
  for RayMan to fetch: a fetch from another site needs that site to send CORS headers, which many
  do not, and the embed has the scene already. The token is the JSON deflated (zlib format, as
  Node 18 lacks `deflate-raw`) in base64url; a typical scene is a few hundred characters. The part
  after `#` never reaches a server. Opening is an undoable step (⌘Z gives back the reader's own
  bench), the splash is skipped, and the hash is removed so a reload does not open it again over
  later work. Whether RayMan is at the URL is tested by loading its icon (works across sites with no
  server help); if not, the button becomes **Download RayMan file**.
- **Two ways to give a scene:** `data-src` (clear, easy to update when an author keeps several
  files) or a `<script type="application/json">` inside the element.
- **Copy share link** and **Copy embed code** in the File menu (`js/share.js`).
  A copy opened from disk has no address others can use, so its links point at the public copy.
- `data-theme`, `data-alt`, `data-height`, `data-enlarge="off"`, `data-open="off"`, `data-rayman`.
- **Enlarge:** a panel 80% of the window's width and height over a blurred page; ✕ top left, Esc,
  or a click outside close it.
- `embed.js` loads RayMan's own drawing code, so diagrams look exactly as in the app. It finds the
  files beside itself; `tools/stamp-assets.py` now also stamps the names in its list, before the
  pages, so a page's link to `embed.js` changes whenever any of them does.
- The fit box moved from `app.js` into `share.js` (shared with the embed). It now leaves out
  virtual images while they are hidden: the objective's far-off virtual image had pushed the
  diagram to one side (RayMan's own Fit, `F`, had the same fault).
- **GitHub Pages:** `.github/workflows/pages.yml` copies the repo without the development files,
  stamps it and deploys it, on every push to main. The site is `swcmicroscopy.com/RayMan/` (the
  organisation's custom domain). The lecturer may later point optics.mouse.vision there.
- Example page `examples/embed/index.html` (scenes generated from the guide's scene builders), a
  "Share and embed" section in the guide with two generated pictures (`shots.py embed
  embed-enlarged`, from `Claude/guide-shots/embed.html`). Tests in `tests/share.test.js`. Checked
  in headless Chrome: all embeds draw, buttons, Enlarge and closing, Open (the link opens the scene
  in RayMan, ⌘Z restores the earlier bench), an unreachable RayMan gives Download, a missing file
  shows a message, a damaged link says so.

## 2026-11-16: the deploy no longer stamps data-src

The published example page showed `data-src="two-lenses.json?v=…"`, which the lecturer rightly
asked about: authors never write a stamp, and nothing explained it. `stamp-assets.py` matched
`src="` after a word boundary, which also matches inside `data-src="`. It now requires that no
letter or hyphen comes before `src`/`href`. The About card's logo (loaded from its `data-src` when
the card opens) loses its stamp too; it hardly ever changes, so that costs nothing. Test in
`tests/share.test.js`.

## 2026-11-16: RayMan moves from optics.mouse.vision to swcmicroscopy.com

The public site is now `swcmicroscopy.com/RayMan/` (GitHub Pages). The old `optics.mouse.vision/rayman/`
is kept only as a permanent (301) redirect, so old links keep working. The redirect is a rule in the
root `.htaccess` of the archive site (`light_lecture_demos/`, deployed by its `deploy.sh`), not in this
repository. It excludes `rayman/sw.js`, so the old service worker can still update. That worker is
replaced by a stub that deletes the old cache and unregisters itself; delete the stub and the
`sw.js` exception in a few months, once old visitors have been caught.

- Removed `copy2webfolder.sh` (local, git-ignored) and its `.gitignore` line. Testing is now by
  opening the repo or serving the repo root; GitHub Pages does the stamping on deploy.
- `index.html` social meta tags, and the README links, now point at `swcmicroscopy.com/RayMan/`. The
  social image is live there.
- Checked with `curl` after the deploy: the root, a deep guide link and a query string each return 301
  to the matching path on swcmicroscopy.com; `rayman/sw.js` returns 200 (not redirected).

## 2026-11-16: issue #4, the Objects panel took too much off the bench

Switching off the helper rays cut the rays drawn through them short (r1 and r2 stopped at the
objective), and switching off a point source took away helpers drawn parallel to its rays. The
cause: switched-off rays were left out of the axis view, and the solver looked rays up in that
view, so a ray aimed through (or parallel to) one that was off could not be placed.

- The axis view now also offers `all` (everything on the axis, off or not), and rays.js looks up
  elements and rays by id there. Lists (what is drawn, hit, snapped to, makes images) still leave
  out what is off, so the switch only changes what is shown, never where anything goes.
- `raysOf` (what a source's switch takes off) now grows only through start pins (branches), not
  through any reference: a helper at a lens centre parallel to a source's ray stays, and the
  "Helper rays" switch governs it (the lecturer's choice). Helpers started on the source go with it.
- At the lecturer's request the Objects panel is now a feature under development (class `dev`
  on its button and help line; E only when dev features are on; switching them off closes it),
  and it is out of the guide and its screenshot list for now.
- Tests: `tests/objects.test.js` with the issue's scene (`tests/scenes/issue4.json`); the
  confocal test now expects the parallel helper to stay. Checked by mouse in headless Chrome.

## 2026-11-17: issue #5, the right rail: light/dark moves to Settings, divider, tighter buttons

- Light/dark is now a "Dark mode" switch at the top of Settings. The theme button left the rail.
  `setTheme` keeps the switch in step with the theme, and the switch sets it.
- A divider sits before File on the right rail (after Objects, which is shown only with
  "Features under development" on; with it off the divider sits between Hints and File).
- The gaps between rail buttons are closed (`.rail .group` and `.rail` gap 3px and 2px → 0; short
  screens too). Button size is unchanged (38px). The gap was 3px, which is 8% of the button height;
  10% (3.8px) would need smaller buttons. Measured: right-rail pitch 41px → 38px; left rail
  10 buttons, about 27px saved.
- Tests: `tests/rail.test.js` (markup and CSS). Checked by mouse in headless Chrome: the switch turns
  dark mode on and off, with no errors.

## 2026-11-17: issue #6, the help pane: shorter text, three small pictures, reordered

- Images: removed the bracketed aside, the last sentence and the "Virtual images are hidden" line;
  "(dashed)" now reads "(must be enabled in Settings)". A small picture of one lens with an object
  three quarters of the lens's height, and its image.
- Drawing rays: removed the sentence on carrying a ray through a lens centre and the "Put a lens"
  sentence; **Double-click** is bold. Three small pictures, each under its sentence: a ray snapped
  through F (the snap), two rays ending at one point of a lens with the blue one carried on (the
  same-colour continuation).
- The small pictures are generated: `helpLens`, `helpSnap`, `helpContinue` in
  `Claude/guide-shots/scenes.js`, run with `python3 Claude/guide-shots/shots.py lens snap continue`
  (they go to `images/help/`, not `guide/img/`). They are in `sw.js` CORE for offline use.
- "The guide, with pictures" is now "Full guide". The "How to use RayMan" title and its sentence
  are gone (the panel keeps its close button). Tools sit before Keys, so all the buttons are
  discussed together.
- Tests: `tests/help.test.js`. Checked by mouse in headless Chrome: the pane scrolls through with
  the pictures in place and no errors.

## 2026-11-17: issue #7, the enlarged embed: zoom buttons, panning with the hand

- The enlarged view (the Enlarge button) is now live: zoom buttons + and − and 0 (reset) at the top
  left, after the ✕. Drag to pan (the cursor is a hand, grabbing while dragged); the wheel or
  trackpad zooms about the pointer. A finger pans on a touch screen (no pinch yet). Until the reader
  moves it, the view still refits when the window changes size.
- The inline diagram is unchanged (not live). `Canvas(host, scene, theme, live)` in `embed.js`.
- The guide's enlarged picture is regenerated (`shots.py embed-enlarged`) and its caption and the
  example page say that you can pan and zoom.
- Tests: `tests/embed-zoom.test.js` (source checks). Checked by mouse in headless Chrome on the
  example page: + zooms in, 0 resets, a drag pans, the wheel zooms, ✕ closes, no errors.

## 2026-11-17: help pictures and help pane, round two (after #6)

- The help pictures are drawn bare: no F, F′, 1.5F…3F marks and no L1 name. The renderer has a
  `bare` option (`st.bare` in `js/render.js`, not used by the app itself); the scenes set it with
  `GUIDE.bare(rings)`, which can also add snap rings.
- The snap picture now shows its snap: a ring at F, where the ray is snapped through.
- The lens picture is wider and shorter (380 px, 130 px high), so the lens and object fill it.
- "How to use RayMan" is back as the panel title (same style), with the close button on the same
  line at the right. Its intro sentence stays removed.
- The Toolbars section is removed. The line "The bench is kept in this browser…" stays, under Hints
  and the rest.
- Tests: `tests/help.test.js` updated (title present, no Toolbars).

## 2026-11-17: issue #8, the ruler: sensible numbers at every zoom, and a cursor line

- The ruler's step is `G.rulerStep(pxPerMm, width)` (`js/geom.js`): the nice step (1, 2 or 5 × 10ⁿ mm)
  for at least width/16 px between numbers (and at least 56 px on narrow screens). Across zooms that
  is about 6 to 16 numbers, averaging 10 to 11. It was "every major grid line", which gave dozens
  when zoomed out.
- A pale red line (`#rulerline`, a DOM element, 22 px high from the bottom) follows the cursor's z
  along the ruler. Only for a mouse (`pointerType` mouse): hidden on touch, pen and when the pointer
  leaves the bench.
- Tests: `tests/ruler.test.js`. Checked by mouse in headless Chrome at three zooms (labels, line
  position), and a touch gesture hides the line.

## 2026-11-17: issue #9, the ruler marker (follow-up to #8); the readout and hint pill removed

- The cursor's line on the ruler is 2 px wide and a stronger red. Beside it, a red box with white
  text gives the cursor's z in mm, in the ruler's font size. The ruler numbers that the line or box
  touches are left out, so none looks half-covered. Drawn by the renderer (`rulerGeometry`,
  `rulerMarker` in `js/render.js`), set from the pointer (`rulerMarker` in `js/app.js`), so it is
  part of the bench drawing and is not in the PNG export. Mouse only, as before.
- Removed: the changing z/y readout (`#coords`; it sat at the bottom right) and the hint pill along
  the bottom (`#hint`). Their text code (`showHint`, `forDevice`, the tool and role hint tables) is
  gone too. `TOUCH` stays.
- Tests: `tests/ruler.test.js` (the removals and the marker wiring). Checked by mouse in headless
  Chrome at three zooms, and a touch gesture clears the marker.

## 2026-11-17: the web embed's enlarged view: no close or zoom buttons, a reset, no ruler

- The enlarged view (`embed.js`) loses its top-left group (✕, +, 0, −). Esc and a click outside
  still close it. Reset is now a circular-arrow button ("Reset view") in the top right, left of
  Open in RayMan. The wheel and pinch zoom, and a drag pans.
- Pinch was not in the embed (only in the app), so removing the buttons would have left iPad
  readers with no zoom. The enlarged canvas now handles two pointers: pinch zooms about their
  midpoint, and the midpoint's movement pans. A pinch that leaves one finger goes on panning.
- The mm ruler along the bottom edge (the numbers and "mm") is off in the web canvas, both inline
  and enlarged. The renderer takes `scale: false` (`grid` in `js/render.js`); the app does not pass
  it, so the app keeps its ruler. The grid lines stay.
- The guide's caption and the embed-enlarged picture are updated (`Claude/guide-shots/shots.py embed
  embed-enlarged`).
- Tests: `tests/embed-zoom.test.js` (source checks). Checked by mouse and touch in headless Chrome on
  the guide's embed page: no close or zoom buttons, wheel and drag change the picture, reset brings
  back the first enlarged picture, a two-finger pinch zooms, Esc closes, no errors.

## 2026-11-17: the close cross is back (follow-up to the change above)

- The ✕ returns to the top left of the enlarged view, alone: the zoom buttons stay removed. Esc and
  a click outside still close it too. Reset stays top right, left of Open in RayMan.
- Tests: `tests/embed-zoom.test.js` updated; guide caption and picture updated.

## 2026-11-17: issues #10, #11, #12

- **#12 cursor:** the drawing cursor is now a red cross-hair (an SVG data-URL cursor, `CROSS` in
  `js/app.js`), arms 12.5 px, a quarter longer than the browser's 10 px, with a pale edge so it shows
  on any colour.
- **#11 object height:** `Snap.objectHeight` keeps an object at least 10 mm tall, either way up;
  dragging across the axis flips it to -10 mm. Used by the object tool and by dragging the tip.
  A typed height in the panel is not limited (the issue is about drawing).
- **#10 aperture:** as decided in the issue, a lens or mirror cannot be made smaller than the rays
  it takes: `R.minAperture` (largest |y| of a ray point on it). The aperture handle and the panel's
  semi-aperture box stop there; to shrink further the user deletes the rays. A ray stopped at the
  rim counts, so it holds the rim where it is.
- Tests: `tests/rays.test.js`, `tests/scene.test.js`. By mouse in headless Chrome: object near the
  axis is 10 / -10 mm; dragging the aperture past a 10 mm ray stops at 10 mm.

## 2026-11-17: issue #13, no parallel snap for the last ray from a point at F

- **Cause:** the purple ray was drawn by hand to the green ray's point on L1 (y = 19.97, not 20).
  From there the true exit line (bent by L1, parallel to the other purple rays) passes 0.03 mm from
  where the red ray crosses the back focal plane. That crossing is a strong snap (the helper-ray
  construction at the lens being left), so it won, and the ray went a hair off true: no longer
  exactly parallel, so "parallel to those rays" never showed.
- **Fix (lecturer's choice of three):** leaving a lens, a real ray's own bend wins. If "bent by"
  is within reach, a snap giving any other line loses to it; snaps on exactly that line still name
  it (classic rules, crossings that are the true construction). Helpers unchanged.
- And whatever snap wins, if its line is exactly parallel to other rays, they glow and the caption
  adds "parallel to that ray / those rays" (`parallelRays` in rays.js).
- A free ray leaving a lens near the axis no longer snaps "parallel to the axis" when that is not
  where the lens sends it (an old test asserted that; updated).
- Tests: `tests/phase4.test.js` with the issue's scene (`tests/scenes/issue13.json`). By mouse in
  headless Chrome on that scene: the ray from L1 aimed at the red crossing reads "bent by L1,
  parallel to those rays" and both purple rays glow.
- Noticed: rebuilding the guide pictures now leaves a ruler marker (e.g. "-111.4 mm") bottom left
  in most shots, from the ruler-marker change; the pictures were not updated.

## 2026-11-17: issue #14, an iris can fade the rays it stops

- Asked for: an iris option (off by default) to hide the rays it blocks upstream too. Lecturer's
  choice: drawn **faint** all along rather than invisible (so they can still be found and edited),
  fill-in rays too. Posted on the issue before building.
- `mask` on an iris (saved only when true), a checkbox "Fade the rays it stops" in its panel. A
  drawn ray stopped by such an iris is drawn at alpha 0.15 (`MASKED` in render.js), its nodes and
  arrows too; the selection glow stays full so a faded ray can be found. Fill-in rays stopped by
  it (`masked` from `fillRays`) are faded the same way.
- Guide: a sentence and a new picture (`iris-faded`) in the iris section.
- Guide pictures: the shot script now clears the ruler's cursor marker before each picture (the
  mouse parked bottom left had put "-111.4 mm" into them since the ruler marker); all pictures
  rebuilt.
- Tests: `tests/phase5.test.js` (only stopped fill-in rays are faded, the option round-trips, the
  panel has it). By mouse in headless Chrome on the issue's scene: click a blade, tick the box; the
  three stopped rays and the stopped fill-in rays fade, the rest are unchanged; saved with the scene.

## 2026-11-17: #14 follow-up, the edges of the light past a fading iris

- Lecturer: with the stopped rays faded, the light that gets through was hard to read. Now the
  outermost fill-in ray that passes, on each side where its neighbour (fill-in or drawn edge ray)
  is faded, is drawn like a drawn ray (full colour, 2.2 px, arrows): `edge` from `fillRays`. Where
  the drawn edge ray itself passes it already marks the edge, so nothing changes on that side.
  Only with a fading iris; otherwise fill-in rays are as before.
- Tests: `tests/phase5.test.js`. By mouse on the issue's scene: each bundle's passing light has
  bold edges. Guide sentence and `iris-faded` picture updated.

## 2026-11-17: #14 follow-up, stopped fill-in rays hidden

- Lecturer: fill-in rays stopped by such an iris are now not drawn at all (were faint); only the
  drawn rays stay, as faint selectable ghosts. The checkbox reads "Hide the rays it stops". Guide
  text and picture updated.

## 2026-11-17: issue #15, workbooks

- Asked for: a web page of exercises (embedded RayMan diagrams) that students click to work on in
  RayMan, the diagram in the page updating with their work, and a Save for the whole page.
  Lecturer's choices: Save downloads a copy of the page with the answers inside; answers also
  kept in localStorage (cheap, so a reload loses nothing); workbooks may be served from any
  site; nothing locked.
- `workbook.js` (loads `embed.js` and draws with its `Canvas`, now exposed on `RayManEmbed`).
  RayMan opens in an iframe over the page, not a new tab: no popup blockers, no lost tabs on an
  iPad, and the page stays in charge. The iframe is made once and reused, hidden with
  `visibility` (not `display:none`) so RayMan keeps its size.
- RayMan's workbook mode (`index.html?workbook`, only inside a frame): the page sends
  `{rayman:'open', id, scene}`, RayMan sends `{rayman:'scene', id, scene}` after every commit
  and undo/redo (`keep()` replaces the autosave write). `postMessage` with `'*'`, so any site
  works; each side accepts messages only from the other window (`e.source`). The student's own
  bench (autosave) is neither read nor written; no splash; each exercise gets a fresh undo
  history (`History.reset`); the view is zoomed out a little after fitting, to leave room to work.
- An exercise undone back to its start counts as untouched (its answer is dropped, Start again
  hides). Answer records carry a time; of the browser's copy and a saved file's, the newer wins.
- Save writes the page as first parsed (captured before the script changes anything) plus a
  `<script id="rayman-answers">` and a `<base href>` to where it came from, so the copy finds
  its scripts when opened from disk. Load reads that record from a saved file into the page
  online (for iPads, where opening a downloaded HTML file is awkward).
- Deploy: `stamp-assets.py` now also stamps `'embed.js'` in `workbook.js`.
- Example workbook `examples/workbook/` (lecturer's two exercises): one lens f = 50 mm, hints on;
  object at 1.75 f, trace the three rays; object at f, then add a second f = 50 mm lens and trace on.
- Found by mouse: embed's canvas CSS is scoped to `.rayman`, so on a 2× screen the exercise
  canvas showed at twice size; `.rm-btn`'s `all:unset` undid `hidden`. Both fixed in workbook.js.
- Tests: `tests/workbook.test.js`. By mouse in headless Chrome (served locally, and with the page
  on another origin than RayMan): open, place a lens, back, diagram updated; reload keeps it;
  undo to the start clears it, redo restores; Save → open the file from disk with storage
  cleared → answers there; Load the file → answers there; standalone autosave unchanged.
- Guide: a short Workbooks section with two generated pictures (`workbook`, `workbook-open`).

## 2026-11-17: workbook exercises from .json files (#15)

- The example workbook now loads each exercise's scene from a `.json` file beside the page
  (`data-src`, which `workbook.js` already supported), so building one is: save a scene from
  RayMan, point the page at it. Inline `<script type="application/json">` still works. Students
  use a URL, so `fetch` works; a page opened from disk cannot fetch (Chrome/Safari), noted in the
  guide. A Save copy carries a `<base>` to the online folder, so it finds the JSON.
- Test for `data-src` (fetch, inline wins, 404 and missing-scene messages) via `sceneText(el, get)`,
  exported with the other helpers; the example test now reads the JSON files.
- Objects in the examples were small (h = 10 on a lens of half height 40): now 30, 0.75 × `ap`.
  Rule added to CLAUDE.md. The guide picture's scene follows.
- Instructions: an element with class `rayman-instructions` and `data-for` the exercise id (inside
  the page's own text) is shown in the bar over RayMan, right of Back to workbook. The bar grows
  with the text (min 44 px, at most 35% of the height, then scrolls). Found by mouse: the title was
  written into the first `span` of the bar, which is the back button's label; the text now has
  its own element.
- Example texts reworded (lecturer's wording). `shots.py` serves the repo on localhost:8765 for the
  workbook pictures, since `data-src` needs http.

- Lecturer: 30 was too big. Example objects are now h = 25 (about 0.6 × `ap`, within "roughly
  0.75×"); scene file, guide scene and pictures follow.

## 2026-11-17: issue #16, image from rays drawn two ways

- Bug: an object through L1 then L2. One ray drawn from the object on through L1's image and
  L2, another started at L1's image and drawn through L2. They cross, but no image formed. Cause:
  `findImage` only paired rays with the same source key, and "the object" and "L1's image of
  the object" are different keys, though after L1 they are the same light.
- Fix (`rays.js`): `sameLight` splits a source into its root (the object or point) and the
  lenses that make it. A ray counts for the image of `src` through lens L if it comes from the
  same root, and the lenses its light has been through before L (those of its own source, then
  those it crosses) start with the lenses that make `src`, and do not include L. Same-key
  rays count as before. Both names for the image can now be found from the same rays, so
  `solveScene` lists an image once (`sameImage`: same lens, root, place and virtual/real).
- Tests: the issue's two scenes (`tests/scenes/issue16*.json`); mixed rays form the image at
  z = 920, M = 5; four rays drawn both ways give one image. By mouse in headless Chrome: carrying
  the object's ray through L2 forms the image (it did not before the fix).

## 2026-11-22: issue #17, clean code

- **Safety net first.** `tests/golden.test.js` solves every example and test scene and draws each
  (plain, dark, ray tool, each element selected or hovered) onto a recording canvas; the result
  is compared with `tests/golden.json` (hashes of the drawing calls, the solver output in full).
  Checked that it fails when a drawing constant or the solver changes. For app.js, which has no
  unit tests, the guide pictures are rebuilt in headless Chrome and must come out byte-identical.
- **Comments.** A `/** */` comment on about 140 functions that had none (all files).
- **Names.** render.js: `c, v, th, W, H, st, sol, e, o, im, els` became `ctx, view, theme,
  canvasWidth, canvasHeight, state, solution, element, options, image, elements`. rays.js:
  `sv, im, sol` became `solver, image, solution`. app.js: `cv, W, H` became `canvas,
  canvasWidth, canvasHeight`. Left alone on purpose: `e` (event), `p` (pointer), `r`, `d`, `st` in app.js, and the
  maths letters (`z, y, f, u`); renaming those blind across 1800 lines costs more than it gives.
  Two tests that match source text (`embed-zoom`, `ruler`) were updated to the new names.
- **Whitespace.** Blank lines between functions that ran together. Rules added to CLAUDE.md
  ("Code style").
- All 198 tests pass; guide pictures unchanged except `workbook.png`, which was stale (the
  example object got smaller in #15).
- **#18** (found on the way): `shots.py` failed at the workbook pictures when port 8765 was taken
  by another local server. It now asks the OS for a free port.

- Later the same day: every JS file got a "Short names used in this file" comment at the top, defining the
  short names it keeps (`e`, `p`, `r`, `z`, `y`...). Comments only; all 198 tests pass.
- `if (...) { a; b; c; }` lines holding two or more statements were split over several lines (100 of them, done by a
  script, checked by the golden tests and the rebuilt guide pictures). Closely related assignments outside an `if`
  (e.g. `ctx.lineWidth = 2; ctx.lineCap = 'round';`) stay on one line, as agreed.

## 2026-11-22: adversarial review, issues #19, #20, #21

Asked to look for bugs adversarially, flag security concerns, add tests and fix what turned up.
Method: read the code that takes input from outside (loading, links, embeds, workbooks), then
fuzzed: thousands of example scenes damaged at random (extreme numbers, elements and rays deleted
without care, references pointed elsewhere, indexes out of range), each loaded, solved, framed,
drawn, edited (delete, reverse, lengthen) and reloaded. A small fixed-seed version is now a test
(`tests/robustness.test.js`; `RAYMAN_FUZZ_SEED`, `RAYMAN_FUZZ_N` for longer runs).

- **#19, data loss.** RayMan offers "where that ray crosses the image plane" as a point, but the
  loader refused that reference (`pt: 'Z'`). Since undo/redo and the saved bench reload the scene,
  redo threw and the bench came back empty on the next visit (start-up overwrote it at once).
  Fixed the loader. Start-up now keeps an unreadable bench aside (`rayman.scene.unreadable`) and
  says so; undo/redo show a message instead of throwing. The fuzzing found more: Reverse wrote a
  slope-less segment for a zero-length piece (now refused) and renumbered references past the
  ray's end to negative indexes, which crashed the solver (now left out of range); freezing could
  write coordinates beyond what loads (now cut there: `G.storable`, one limit shared by the loader
  and the code that writes rays); fill-in rays recursed for ever when a ray left a crossing
  vertically (NaN slopes; now skipped, with a depth bound). Principle: whatever RayMan writes must
  load again.
- **#20, security.** Ids were any string and the Objects panel (dev feature) wrote them into HTML
  unescaped: a crafted link ran script for anyone with that panel open (confirmed in headless
  Chrome). Colours were any short string, put in a `style`. Now ids must be plain
  (`[A-Za-z0-9_-]`, as RayMan makes them), colours CSS colours only, and the panel escapes ids too.
- **#21, security/limits.** Share links unpack to at most 4 MB (a short link could unpack to
  hundreds of MB). Loaded labels cut to 40 characters; element numbers within 1 km, ray values
  within 1e12, |f| ≥ 0.1 mm (as the panel); a huge `nextId` no longer freezes id numbering.
  Workbook: answer records from a file or the browser are checked (`scenes: null` crashed Load),
  scenes go to RayMan's own origin rather than `*`, and the instructions lookup compares ids as
  text (an odd id made it throw).
- Not changed, on purpose: RayMan in workbook mode accepts a scene from whatever page frames it,
  and sends changes back to it (`*`): that is how a workbook on any site works, and it never
  touches the student's own bench. No Content-Security-Policy: `script-src 'self'` would be good
  defence in depth but may break opening RayMan from disk (file: pages); worth trying later.
- Checks: every new test fails on the old code and passes now (213 tests). By mouse in headless
  Chrome, old code against new: a ray from the image-plane crossing, then redo (old: exception) and
  reload (old: bench lost); crafted links (markup in an id, CSS in a colour, a zip bomb); an
  unreadable saved bench; the example workbook over http (exercise opens, changes come back).
  Golden tests unchanged; guide pictures rebuilt: no change (the scrollbar shade in
  `workbook.png` differs run to run; left as committed).
