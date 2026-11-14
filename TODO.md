# RayMan TODO — ideas to ponder

Found while building Köhler illumination (see `examples/kohler/`). Not decided yet: teaching is the
goal, and drawing rays slowly by hand has benefits.

## 1. Aim a ray "through a point after the lens"

**Problem.** To draw a ray from a filament point that passes the field-diaphragm edge *after* the
collector, you need the height where it should hit the collector. Today you can only choose that
freely or by snaps on the near side. The workaround is to draw it backwards: from the filament
image, through the diaphragm edge, to the collector, then "bent by collector" back to the filament,
then Shift+R to reverse it.

**Idea.** While drawing from P towards a lens L, with the cursor past L and near a snap point A
(iris edge, image, F′, sample-plane point, point on another ray), offer a snap:
*"to collector, aimed through the top edge of field"*. One click places two segments:

- P → L at exactly the height where the lens bends the ray through A;
- the bent segment on to A (ordinary "bent by L", so it continues as usual).

**Keeping it right.** The first segment gets a new rule, `{ kind: 'via', el: L, at: A }`. For a
thin lens the height has a closed form, with a = L.z − P.z, b = A.z − L.z:

    h = (A.y + P.y·b/a) / (1 + b/a − b/f)

So moving the lamp, the lens or the diaphragm, or changing f or the opening, keeps it aimed.

**Details.**
- A at P's own image: every height works, so the snap is not offered.
- One lens only (two lenses could come later).
- Works backwards too (sign of the bend as in `refract`).
- Reversing such a ray: the reversed ray would arrive freely and leave through A, so it becomes a
  fixed slope (as `refract` does now).

## 2. Fewer clicks per bundle

**Where the clicks go now.** For each ray at each lens: click its end, aim "straight on" to the
lens, click, click the end again, aim "bent by". Through an image add a Shift-click. The Köhler
demo (8 rays, 4 lenses) took about 100 clicks, nearly all repeating the lens law.

**Proposal, in two steps.**
- **a.** Double-click a ray's end on a lens: continue it "bent by" that lens to the next lens, image
  plane or edge. If it forms a real image on the way, it carries straight on through it. Today
  double-click only extends in a straight line. About one double-click per ray per lens.
- **b.** Shift-double-click: the same for every ray from the same source point (e.g. all rays from
  the filament top) that ends on that lens. One action per bundle per lens: about 12 actions for
  the Köhler demo instead of about 100.

**Teaching risk.** RayMan does not trace rays for you. Both steps keep the student choosing where
to go, one lens at a time; they only stop the lens law being redone by hand. Option: (b) only works
once one ray of the bundle has been bent by hand at that lens.

## Smaller ones, from the same exercise

- Images of iris edges (the field diaphragm imaged on the sample) are not marked as images; only
  images of light sources are.
- Reversing a ray turns "bent by" into a fixed slope, so it no longer follows when the lamp moves.

## From the second Köhler build (2026-11-14, the demo's real layout)

- Field points (rays from different lamp points crossing on the field diaphragm, the sample, the
  camera) are not marked: images are only of light sources. The demo marks them with dots.
- The weak "point on a ray" snap is ~12 px wide: a click 1 mm from another ray's point on a lens
  stays on that point even zoomed in 4×. Alt (no snapping) gets round it.
- The "image" labels of the lamp images sit on top of the F′ = F labels at the same planes.
- Fit (F) puts the lamp's F label under the left toolbar and the camera label at the right edge.

## Vertical stretch (parked, 2026-11-14)

Proposed from the *confocal-from-zero* demo, which stretches its pictures vertically so that beams
a few degrees off the axis can be seen. The lecturer called it "a nice idea" without asking for it
yet. It would be a view setting (×1, ×2, ×3): parallel lines stay parallel and crossings stay put,
so constructions are unchanged. The work is in hit-testing and snapping, which measure distances
in mm and would need to measure them on screen instead; lens shapes and labels must not stretch.
