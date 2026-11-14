# RayMan: notes for Claude

RayMan is a static, no-build, vanilla-JS canvas app for tracing rays by hand in optics lectures.
The code is written by Claude, directed by the course lecturer. See `README.md` and `Claude/goal.md`.

## Keep these up to date with every change

- **The guide** (`guide/index.html`) shows the key features with screenshots: helper rays,
  light from infinity, irises and fill-in rays, the Objects panel. When a feature it describes
  changes, or a key feature is added, update the text **and** the pictures in the same piece of
  work. Keep it **generic and short** (the lecturer's wish): what a feature does and how to use
  it, in a sentence or two; let the pictures explain. No long walkthroughs of one system. The
  short help in `index.html` (the `?` panel) lists tools and keys and links to the guide.
- **Features under development** (the scan mirror, the dichroic) are hidden unless Settings →
  "Show features under development" is on (class `dev` in the markup, `DEV_TOOLS` in app.js).
  Keep them out of the guide until the lecturer says they are wanted.
- **The screenshots** are generated, not hand-made. The scenes are in
  `Claude/guide-shots/scenes.js`, the list of pictures in `Claude/guide-shots/shots.py`. Run
  `python3 Claude/guide-shots/shots.py` (all) or `... shots.py confocal relay` (some, by file
  name) to rebuild `guide/img/`. Look at the pictures afterwards: labels can collide.
- **`Claude/LOG.md`**: a dated record of what was done, the choices made and why.
- **Tests**: `node --test tests/`. Add tests for new behaviour.
- **Offline**: `sw.js` keeps the files in its `CORE` list for offline use. A new file loaded by
  `index.html` must be added there (`tests/sw.test.js` fails otherwise).

## Working style

- The lecturer curates features: propose, then build what is chosen, test it (unit tests and
  by mouse in headless Chrome, see `Claude/guide-shots/cdp.py`), fix what turns up.
- Do not add shortcuts that speed up drawing rays: the slow, by-hand workflow is the point.
- The lecturer tests at `localhost:8000/rayman`, a copy made by `./copy2webfolder.sh` (local,
  git-ignored). Run it after changes, or what is tested is stale. It must end by running
  `python3 tools/stamp-assets.py` on the copy: browsers, Safari on iPad above all, otherwise keep
  old scripts. Never stamp the repository's own files.
- Commit at sensible points; commit messages end with the attribution lines given in the session.
